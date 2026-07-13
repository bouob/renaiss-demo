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
import { COLLECTION, sanitizeWallet } from '../lib/inventoryItem.js';
import { runConcurrent } from '../utils/runConcurrent.js';

// getGradedFmv shares one daily budget and circuit breaker across the whole
// module, so a large inventory must not be walked one blocking request at a
// time. Matches scan.js's pool size and holdings cap.
const FMV_CONCURRENCY = 4;
const MAX_HOLDINGS = 80;

// Read held certs for uid+wallet, then enrich each with its FMV (found+href),
// which is what buildPortfolioSeries groups on. Certs with no FMV still return
// (renaissFmv: null) — the builder skips them via `!holding.renaissFmv?.found`.
async function realLoadHoldings(uid, wallet) {
  if (!adminDb || !wallet) return [];
  const snap = await adminDb.collection(COLLECTION).doc(uid).collection('items').get();
  const held = snap.docs
    .map((d) => ({ cert: d.data()?.cert || d.id, wallet: d.data()?.wallet }))
    .filter((row) => (typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '') === wallet)
    .map((row) => row.cert);
  if (held.length > MAX_HOLDINGS) {
    // The reported coverage.total counts only what we enriched, so say so.
    console.warn(`[portfolio-series] ${held.length} holdings truncated to ${MAX_HOLDINGS}`);
  }
  const certs = held.slice(0, MAX_HOLDINGS);

  return runConcurrent(certs, FMV_CONCURRENCY, async (cert) => ({
    cert,
    renaissFmv: await getGradedFmv(cert), // null-safe: adapter never throws
  }));
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
    const empty = {
      portfolio: [],
      index: null,
      benchmark: { windows: {} },
      perHolding: {},
      coverage: { included: 0, total: 0 },
      attributionUrl: ATTRIBUTION_URL,
    };
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
