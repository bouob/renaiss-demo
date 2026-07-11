/**
 * GET /sales?wallet= — uid-scoped sold history
 * POST /sales/bulk — upsert sales after scan
 * Collection: hackathonMerchantSales/{uid}/wallets/{wallet}/items/{saleId}
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { isValidAddressShape } from '../lib/walletGuard.js';

const router = Router();
const COLLECTION = 'hackathonMerchantSales';
const SALE_TYPES = new Set(['BUYBACK', 'MARKETPLACE', 'TRANSFER_OUT']);

function walletItemsRef(uid, wallet) {
  return adminDb
    .collection(COLLECTION)
    .doc(uid)
    .collection('wallets')
    .doc(wallet)
    .collection('items');
}

function sanitizeWallet(v) {
  const w = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return isValidAddressShape(w) ? w : null;
}

function sanitizeNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sanitizeSale(row, wallet) {
  const id = typeof row?.id === 'string' && row.id.length >= 4 && row.id.length <= 96
    ? row.id
    : null;
  if (!id) return null;
  const saleType = typeof row.saleType === 'string' && SALE_TYPES.has(row.saleType)
    ? row.saleType
    : 'MARKETPLACE';
  return {
    id,
    wallet,
    tokenId: row.tokenId != null ? String(row.tokenId).slice(0, 64) : null,
    cert: typeof row.cert === 'string' ? row.cert.slice(0, 64) : null,
    name: typeof row.name === 'string' ? row.name.slice(0, 200) : null,
    setName: typeof row.setName === 'string' ? row.setName.slice(0, 200) : null,
    grade: typeof row.grade === 'string' ? row.grade.slice(0, 40) : null,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl.slice(0, 500) : null,
    saleType,
    soldAt: typeof row.soldAt === 'string' ? row.soldAt.slice(0, 40) : null,
    soldBlock: sanitizeNumber(row.soldBlock),
    soldPriceUsd: sanitizeNumber(row.soldPriceUsd),
    costBasisUsd: sanitizeNumber(row.costBasisUsd),
    costSource: typeof row.costSource === 'string' ? row.costSource.slice(0, 40) : null,
    realizedPnlUsd: sanitizeNumber(row.realizedPnlUsd),
    saleTxHash: typeof row.saleTxHash === 'string' ? row.saleTxHash.slice(0, 80) : null,
    counterparty: typeof row.counterparty === 'string' ? row.counterparty.slice(0, 64) : null,
    updatedAt: new Date().toISOString(),
  };
}

function summarize(sales) {
  let totalSoldUsd = 0;
  let totalCostUsd = 0;
  let totalRealizedPnlUsd = 0;
  let count = 0;
  for (const s of sales) {
    if (s.saleType === 'TRANSFER_OUT') continue;
    count += 1;
    if (Number.isFinite(s.soldPriceUsd)) totalSoldUsd += s.soldPriceUsd;
    if (Number.isFinite(s.costBasisUsd)) totalCostUsd += s.costBasisUsd;
    if (Number.isFinite(s.realizedPnlUsd)) totalRealizedPnlUsd += s.realizedPnlUsd;
  }
  return {
    count,
    totalCount: sales.length,
    totalSoldUsd,
    totalCostUsd,
    totalRealizedPnlUsd,
  };
}

router.get('/sales', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', sales: [], summary: summarize([]) });
    }
    const wallet = sanitizeWallet(req.query?.wallet);
    if (!wallet) {
      return res.json({ sales: [], summary: summarize([]), wallet: null, reason: 'wallet_required' });
    }
    const snap = await walletItemsRef(req.uid, wallet).get();
    const sales = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    sales.sort((a, b) => {
      const at = a.soldAt ? Date.parse(a.soldAt) : 0;
      const bt = b.soldAt ? Date.parse(b.soldAt) : 0;
      if (bt !== at) return bt - at;
      return (Number(b.soldBlock) || 0) - (Number(a.soldBlock) || 0);
    });
    return res.json({ sales, summary: summarize(sales), wallet, uid: req.uid });
  } catch (err) {
    console.warn(`[sales:get] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'sales_read_failed', sales: [], summary: summarize([]) });
  }
});

router.post('/sales/bulk', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable' });
    }
    const wallet = sanitizeWallet(req.body?.wallet);
    if (!wallet) {
      return res.status(400).json({ error: 'invalid_wallet' });
    }
    const rows = Array.isArray(req.body?.sales) ? req.body.sales : [];
    if (rows.length === 0) {
      return res.json({ ok: true, accepted: 0, rejected: [] });
    }
    if (rows.length > 250) {
      return res.status(400).json({ error: 'too_many_items' });
    }

    const accepted = [];
    const rejected = [];
    const batch = adminDb.batch();
    let n = 0;
    for (const row of rows) {
      const patch = sanitizeSale(row, wallet);
      if (!patch) {
        rejected.push({ id: row?.id, reason: 'invalid' });
        continue;
      }
      const ref = walletItemsRef(req.uid, wallet).doc(patch.id);
      batch.set(ref, { ...patch, createdAt: patch.updatedAt }, { merge: true });
      n += 1;
      accepted.push(patch.id);
    }
    if (n > 0) await batch.commit();
    return res.json({ ok: true, accepted: accepted.length, rejected, wallet });
  } catch (err) {
    console.warn(`[sales:bulk] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'sales_bulk_failed' });
  }
});

export default router;
