/**
 * GET /ticker — recent-trades style ticker derived from constituents' lastSaleAt.
 * Demo enhancer (P6). Fail-open empty when no data / unconfigured.
 */

import { Router } from 'express';
import { fetchWallSummary } from './wall.js';
import { readWallCache, writeWallCache, ATTRIBUTION_URL } from '../services/wallCache.js';
import { isConfigured } from '../services/renaissOsIndex.js';

const router = Router();

router.get('/ticker', async (_req, res) => {
  try {
    if (!isConfigured()) {
      return res.json({ trades: [], attributionUrl: ATTRIBUTION_URL });
    }

    let summary = readWallCache();
    if (!summary) {
      summary = await fetchWallSummary();
      if (summary) writeWallCache(summary);
    }
    if (!summary) {
      return res.json({ trades: [], attributionUrl: ATTRIBUTION_URL });
    }

    const pool = Array.isArray(summary.constituents) ? summary.constituents : [];
    const trades = pool
      .filter((c) => c?.lastSaleAt)
      .map((c) => ({
        name: c.name ?? null,
        setCode: c.setCode ?? null,
        grade: c.grade ?? null,
        priceUsdCents: Number.isFinite(c.priceUsdCents) ? c.priceUsdCents : null,
        lastSaleAt: c.lastSaleAt,
        deltaPct: Number.isFinite(c.deltaPct) ? c.deltaPct : null,
        href: c.href ?? null,
      }))
      .sort((a, b) => Date.parse(b.lastSaleAt) - Date.parse(a.lastSaleAt))
      .slice(0, 20);

    return res.json({
      trades,
      attributionUrl: summary.attributionUrl ?? ATTRIBUTION_URL,
      asOf: summary.fetchedAt ?? null,
    });
  } catch (err) {
    console.warn(`[ticker] ${err?.message ?? err}`);
    return res.json({ trades: [], attributionUrl: ATTRIBUTION_URL });
  }
});

export default router;
