/**
 * GET /portfolio-series — signed-in "my inventory vs the index" series.
 *
 * Sources the user's held certs (wallet-scoped) from Firestore, enriches each
 * with getGradedFmv (renaissFmv.href is produced at scan time and NOT persisted
 * in the inventory doc, so it is re-derived here), reads the cached /wall
 * summary, and hands both to the already-ported buildPortfolioSeries.
 *
 * Fail-open: any gap (no wallet, no holdings, cold summary, adapter disabled)
 * returns HTTP 200 with an empty payload — never 5xx for missing data.
 *
 * The default export wires the real dependencies; createPortfolioSeriesRouter
 * takes them as injectable params so the route is unit-testable without
 * Firebase or the network.
 */

import { Router } from 'express';
import { requireAuth as realRequireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { getGradedFmv } from '../services/renaissOsIndex.js';
import { buildPortfolioSeries as realBuild, ATTRIBUTION_URL } from '../services/renaissPortfolioSeries.js';
import { readWallCache } from '../services/wallCache.js';
import { fetchWallSummary } from './wall.js';
import { isValidAddressShape } from '../lib/walletGuard.js';

const INVENTORY_COLLECTION = 'hackathonMerchantInventory';

function sanitizeWallet(v) {
  const w = typeof v === 'string' ? v.trim() : '';
  if (!isValidAddressShape(w)) return null;
  return w.toLowerCase();
}

// Read held certs for uid+wallet, then enrich each with its FMV (found+href),
// which is what buildPortfolioSeries groups on. Certs with no FMV still return
// (renaissFmv: null) — the builder skips them via `!holding.renaissFmv?.found`.
async function realLoadHoldings(uid, wallet) {
  if (!adminDb || !wallet) return [];
  const snap = await adminDb.collection(INVENTORY_COLLECTION).doc(uid).collection('items').get();
  const certs = snap.docs
    .map((d) => ({ cert: d.data()?.cert || d.id, wallet: d.data()?.wallet }))
    .filter((row) => (typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '') === wallet)
    .map((row) => row.cert);

  const holdings = [];
  for (const cert of certs) {
    const renaissFmv = await getGradedFmv(cert); // null-safe: adapter never throws
    holdings.push({ cert, renaissFmv });
  }
  return holdings;
}

// Warm cache first; only compute a fresh summary if the /wall cache is cold.
async function realGetSummary() {
  return readWallCache() ?? (await fetchWallSummary());
}

export function createPortfolioSeriesRouter({
  requireAuth = realRequireAuth,
  loadHoldings = realLoadHoldings,
  getSummary = realGetSummary,
  buildPortfolioSeries = realBuild,
} = {}) {
  const router = Router();

  router.get('/portfolio-series', requireAuth, async (req, res) => {
    const wallet = sanitizeWallet(req.query?.wallet);
    const empty = { portfolio: [], index: null, perHolding: {}, coverage: { included: 0, total: 0 }, attributionUrl: ATTRIBUTION_URL };
    try {
      if (!wallet) return res.json(empty);
      const [holdings, summary] = await Promise.all([loadHoldings(req.uid, wallet), getSummary()]);
      const payload = await buildPortfolioSeries({ holdings, summary });
      return res.json(payload ?? empty);
    } catch (err) {
      console.warn(`[portfolio-series] ${err?.message ?? err}`);
      return res.json(empty); // fail-open
    }
  });

  return router;
}

export default createPortfolioSeriesRouter();
