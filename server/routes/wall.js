/**
 * GET /wall — L1 market context (index tile + sparkline + deltas + top-10).
 * 1h mem cache (hackathonFeed/current concept). Fail-open: { index: null }.
 */

import { Router } from 'express';
import { getIndices, getIndexDetail, isConfigured } from '../services/renaissOsIndex.js';
import {
  ATTRIBUTION_URL,
  GAME,
  readWallCache,
  writeWallCache,
} from '../services/wallCache.js';

const router = Router();

/**
 * Merge getIndices() + getIndexDetail(pokemon) into a single summary.
 * Both must succeed (both-success-only) — partial never becomes "current".
 * @returns {Promise<object|null>}
 */
export async function fetchWallSummary() {
  if (!isConfigured()) return null;

  const [indices, detail] = await Promise.all([
    getIndices(),
    getIndexDetail(GAME),
  ]);
  if (!indices || !detail) return null;

  const tile = indices.find((t) => t.game === GAME);
  if (!tile) return null;

  const top10 = Array.isArray(detail.constituents)
    ? detail.constituents.slice(0, 10)
    : Array.isArray(tile.topMovers)
      ? tile.topMovers.slice(0, 10)
      : [];

  return {
    game: tile.game,
    label: tile.label ?? detail.label ?? null,
    value: tile.value,
    base: tile.base,
    deltas: tile.deltas ?? { d7: null, d30: null, d365: null },
    sparkline: Array.isArray(tile.sparkline) ? tile.sparkline : [],
    topMovers: Array.isArray(tile.topMovers) ? tile.topMovers.slice(0, 10) : [],
    top10,
    constituents: Array.isArray(detail.constituents) ? detail.constituents : [],
    constituentCount: tile.constituentCount ?? detail.constituentCount ?? null,
    windowDays: detail.windowDays ?? null,
    baseDate: detail.baseDate ?? null,
    updatedAt: tile.updatedAt ?? detail.updatedAt ?? null,
    fetchedAt: new Date().toISOString(),
    attributionUrl: ATTRIBUTION_URL,
  };
}

router.get('/wall', async (_req, res) => {
  try {
    // Cache-read-first branch
    const cached = readWallCache();
    if (cached) {
      return res.json({ index: cached, cache: 'hit' });
    }

    // Fail-open when keys absent / upstream fails — HTTP 200 + index:null
    const summary = await fetchWallSummary();
    if (!summary) {
      return res.json({ index: null, cache: 'miss' });
    }

    writeWallCache(summary);
    return res.json({ index: summary, cache: 'miss' });
  } catch (err) {
    console.warn(`[wall] unexpected error: ${err?.message ?? err}`);
    return res.json({ index: null, cache: 'error' });
  }
});

export default router;
