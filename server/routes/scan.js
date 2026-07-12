/**
 * POST /scan — wallet scan → holdings + sales history + FMV + pack cost prefill.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isValidAddressShape, isAllowedWallet } from '../lib/walletGuard.js';
import {
  fetchHoldings,
  fetchNFTAttributes,
  enrichHoldingsWithPackCost,
  fetchSaleHistory,
  isConfigured as isChainConfigured,
} from '../services/chainAdapters/bsc/renaissAdapter.js';
import { getGradedFmv, getGradedCardBrief, isConfigured as isIndexConfigured } from '../services/renaissOsIndex.js';
import { rememberHeldCerts } from '../services/heldCertGate.js';
import { runConcurrent } from '../utils/runConcurrent.js';

const router = Router();

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', holdings: [], sales: [] },
});

const ATTR_CONCURRENCY = 4;
const MAX_HOLDINGS = 80;
const MAX_SALE_ENRICH = 40;

router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const address = String(req.body?.address ?? req.body?.wallet ?? '').trim();

    if (!isValidAddressShape(address)) {
      return res.status(400).json({
        error: 'invalid_wallet',
        code: 'invalid_shape',
        holdings: [],
        sales: [],
      });
    }
    if (!isAllowedWallet(address)) {
      return res.status(400).json({
        error: 'invalid_wallet',
        code: 'blocked_address',
        holdings: [],
        sales: [],
      });
    }

    if (!isChainConfigured()) {
      return res.json({
        address: address.toLowerCase(),
        holdings: [],
        sales: [],
        salesSummary: { count: 0, totalSoldUsd: 0, totalCostUsd: 0, totalRealizedPnlUsd: 0 },
        warning: 'chain_unconfigured',
      });
    }

    const [holdingsMap, saleHist] = await Promise.all([
      fetchHoldings(address),
      fetchSaleHistory(address).catch((err) => {
        console.warn(`[scan] fetchSaleHistory: ${err?.message ?? err}`);
        return {
          sales: [],
          summary: { count: 0, totalSoldUsd: 0, totalCostUsd: 0, totalRealizedPnlUsd: 0 },
          truncated: false,
        };
      }),
    ]);

    const heldEntries = [...holdingsMap.entries()]
      .filter(([, row]) => row?.held)
      .slice(0, MAX_HOLDINGS);

    const costByToken = await enrichHoldingsWithPackCost(address, new Map(heldEntries));

    const items = await runConcurrent(heldEntries, ATTR_CONCURRENCY, async ([tokenId, row]) => {
      try {
        const attrs = await fetchNFTAttributes(tokenId);
        const serial = attrs?.serial ?? attrs?.cert ?? attrs?.attributes?.serial ?? null;
        let fmv = null;
        let brief = null;
        if (serial && isIndexConfigured()) {
          [fmv, brief] = await Promise.all([
            getGradedFmv(String(serial)),
            getGradedCardBrief(String(serial)),
          ]);
        }
        const costInfo = costByToken.get(String(tokenId)) ?? {};
        return {
          tokenId: String(tokenId),
          serial: serial ? String(serial) : null,
          name: brief?.name ?? attrs?.name ?? null,
          setName: brief?.setName ?? attrs?.setName ?? attrs?.set ?? null,
          grade: brief?.gradeLabel ?? attrs?.grade ?? attrs?.gradeLabel ?? null,
          imageUrl: attrs?.imageUrl ?? attrs?.image ?? null,
          indexImageUrl: brief?.imageUrl ?? brief?.imageUrlThumb ?? null,
          renaissFmv: fmv,
          found: Boolean(fmv?.found),
          acquireType: costInfo.acquireType ?? 'UNKNOWN',
          onChainCostUsd: Number.isFinite(costInfo.onChainCostUsd) ? costInfo.onChainCostUsd : null,
          costSource: costInfo.costSource ?? 'unavailable',
          packPaymentTxHash: costInfo.packPaymentTxHash ?? null,
          packContract: costInfo.packContract ?? null,
          acquiredFrom: row?.acquiredFrom ?? null,
        };
      } catch {
        return null;
      }
    });

    const holdings = items.filter(Boolean);
    rememberHeldCerts(holdings.map((h) => h.serial).filter(Boolean));

    // Enrich recent sales with NFT metadata (name/image/cert)
    let sales = Array.isArray(saleHist.sales) ? [...saleHist.sales] : [];
    const toEnrich = sales.slice(0, MAX_SALE_ENRICH);
    const enriched = await runConcurrent(toEnrich, ATTR_CONCURRENCY, async (sale) => {
      try {
        const attrs = await fetchNFTAttributes(sale.tokenId);
        // normalizeMetadata returns `image` (not imageUrl) + `set` (not setName)
        const serial = attrs?.serial ?? attrs?.cert ?? null;
        const imageUrl = attrs?.imageUrl ?? attrs?.image ?? sale.imageUrl ?? null;
        return {
          ...sale,
          cert: serial ? String(serial) : sale.cert,
          name: attrs?.name ?? sale.name,
          setName: attrs?.setName ?? attrs?.set ?? sale.setName,
          grade: attrs?.grade ?? attrs?.gradeLabel ?? sale.grade,
          imageUrl: typeof imageUrl === 'string' && imageUrl ? imageUrl : null,
        };
      } catch {
        return sale;
      }
    });
    for (let i = 0; i < enriched.length; i += 1) {
      sales[i] = enriched[i];
    }

    const packPrefill = holdings.filter((h) => Number.isFinite(h.onChainCostUsd)).length;

    return res.json({
      address: address.toLowerCase(),
      holdings,
      count: holdings.length,
      packCostPrefillCount: packPrefill,
      sales,
      salesSummary: saleHist.summary,
      salesTruncated: Boolean(saleHist.truncated),
    });
  } catch (err) {
    console.warn(`[scan] unexpected error: ${err?.message ?? err}`);
    return res.json({
      address: null,
      holdings: [],
      sales: [],
      salesSummary: { count: 0, totalSoldUsd: 0, totalCostUsd: 0, totalRealizedPnlUsd: 0 },
      error: 'scan_failed',
    });
  }
});

export default router;
