/**
 * POST /scan — wallet scan → holdings + metadata + FMV + pack cost prefill.
 * Rejects blocked/invalid wallets via walletGuard.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { isValidAddressShape, isAllowedWallet } from '../lib/walletGuard.js';
import {
  fetchHoldings,
  fetchNFTAttributes,
  enrichHoldingsWithPackCost,
  isConfigured as isChainConfigured,
} from '../services/chainAdapters/bsc/renaissAdapter.js';
import { getGradedFmv, isConfigured as isIndexConfigured } from '../services/renaissOsIndex.js';
import { rememberHeldCerts } from '../services/heldCertGate.js';
import { runConcurrent } from '../utils/runConcurrent.js';

const router = Router();

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', holdings: [] },
});

const ATTR_CONCURRENCY = 4;
const MAX_HOLDINGS = 80;

router.post('/scan', scanLimiter, async (req, res) => {
  try {
    const address = String(req.body?.address ?? req.body?.wallet ?? '').trim();

    if (!isValidAddressShape(address)) {
      return res.status(400).json({ error: 'invalid_wallet', code: 'invalid_shape', holdings: [] });
    }
    if (!isAllowedWallet(address)) {
      return res.status(400).json({ error: 'invalid_wallet', code: 'blocked_address', holdings: [] });
    }

    if (!isChainConfigured()) {
      return res.json({
        address: address.toLowerCase(),
        holdings: [],
        warning: 'chain_unconfigured',
      });
    }

    const holdingsMap = await fetchHoldings(address);
    const heldEntries = [...holdingsMap.entries()]
      .filter(([, row]) => row?.held)
      .slice(0, MAX_HOLDINGS);

    const costByToken = await enrichHoldingsWithPackCost(address, new Map(heldEntries));

    const items = await runConcurrent(heldEntries, ATTR_CONCURRENCY, async ([tokenId, row]) => {
      try {
        const attrs = await fetchNFTAttributes(tokenId);
        const serial = attrs?.serial ?? attrs?.cert ?? attrs?.attributes?.serial ?? null;
        let fmv = null;
        if (serial && isIndexConfigured()) {
          fmv = await getGradedFmv(String(serial));
        }
        const costInfo = costByToken.get(String(tokenId)) ?? {};
        return {
          tokenId: String(tokenId),
          serial: serial ? String(serial) : null,
          name: attrs?.name ?? null,
          setName: attrs?.setName ?? attrs?.set ?? null,
          grade: attrs?.grade ?? attrs?.gradeLabel ?? null,
          imageUrl: attrs?.imageUrl ?? attrs?.image ?? null,
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

    const packPrefill = holdings.filter((h) => Number.isFinite(h.onChainCostUsd)).length;

    return res.json({
      address: address.toLowerCase(),
      holdings,
      count: holdings.length,
      packCostPrefillCount: packPrefill,
    });
  } catch (err) {
    console.warn(`[scan] unexpected error: ${err?.message ?? err}`);
    return res.json({ address: null, holdings: [], error: 'scan_failed' });
  }
});

export default router;
