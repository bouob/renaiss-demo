/**
 * GET /movers — L3/L4 market movers engine.
 * delta + alpha + promote/hold/clear + explainable reasons.
 * Defensive both-branch for embedded 7d/30d vs getCardFmvSeries fan-out.
 * Liquidity signal present → threshold + thin-market penalty; absent → delta+alpha only.
 */

import { Router } from 'express';
import {
  getCardFmvSeries,
  isConfigured,
} from '../services/renaissOsIndex.js';
import { hrefToSlug } from '../services/renaissPortfolioSeries.js';
import { runConcurrent } from '../utils/runConcurrent.js';
import { fetchWallSummary } from './wall.js';
import { readWallCache, writeWallCache, GAME, ATTRIBUTION_URL } from '../services/wallCache.js';

const router = Router();

const PROMOTE_ALPHA = 0.05;
const CLEAR_ALPHA = -0.05;
const MID_ALPHA = 0.075;
const MAX_SERIES_FANOUT = 40;
const SERIES_CONCURRENCY = 4;
const THIN_SALE_MS = 14 * 24 * 60 * 60 * 1000; // 14d without sale → thin

/**
 * Series return: (last - first) / first. Null if insufficient points.
 * @param {Array<{t:string,usdCents:number}>|null} points
 * @returns {number|null}
 */
function seriesReturn(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const first = points[0]?.usdCents;
  const last = points[points.length - 1]?.usdCents;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null;
  return (last - first) / first;
}

/**
 * Extract embedded 7d/30d when constituents already carry change fields.
 * @returns {{ d7: number|null, d30: number|null, source: string }|null}
 */
function extractEmbeddedDeltas(card) {
  const d7Candidates = [
    card?.delta7d, card?.change7d, card?.d7, card?.deltas?.d7,
  ];
  const d30Candidates = [
    card?.delta30d, card?.change30d, card?.d30, card?.deltas?.d30,
  ];
  const d7 = d7Candidates.find((v) => Number.isFinite(v));
  const d30 = d30Candidates.find((v) => Number.isFinite(v));

  // Branch (a): explicit multi-window fields present
  if (Number.isFinite(d7) || Number.isFinite(d30)) {
    return {
      d7: Number.isFinite(d7) ? d7 : null,
      d30: Number.isFinite(d30) ? d30 : (Number.isFinite(card?.deltaPct) ? card.deltaPct : null),
      source: 'embedded',
    };
  }

  // Single deltaPct on constituent/topMover (common upstream shape)
  if (Number.isFinite(card?.deltaPct)) {
    return { d7: null, d30: card.deltaPct, source: 'embedded_single' };
  }

  return null;
}

/**
 * Liquidity signal detection + thin-market flag.
 * @returns {{ hasSignal: boolean, thin: boolean, liquidityScore: number|null }}
 */
function assessLiquidity(card) {
  if (Number.isFinite(card?.liquidityScore)) {
    const score = card.liquidityScore;
    return { hasSignal: true, thin: score < 35, liquidityScore: score };
  }
  if (card?.lastSaleAt) {
    const t = Date.parse(card.lastSaleAt);
    if (Number.isFinite(t)) {
      const thin = (Date.now() - t) > THIN_SALE_MS;
      // Crude score from recency for band logic
      const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
      const score = ageDays <= 3 ? 80 : ageDays <= 14 ? 50 : 20;
      return { hasSignal: true, thin, liquidityScore: score };
    }
    return { hasSignal: true, thin: true, liquidityScore: 20 };
  }
  // No liquidity signal — degraded ranking path
  return { hasSignal: false, thin: false, liquidityScore: null };
}

/**
 * Classify promote / hold / clear with reason strings.
 * When liquidity signal exists: band thresholds + thin-market penalty.
 * When absent: pure ±5pp alpha (delta+alpha only).
 */
function classifyMover({ alphaPct30d, liquidity }) {
  if (!Number.isFinite(alphaPct30d)) {
    return { decision: null, reason: 'Insufficient return data to classify.', damped: false };
  }

  // Liquidity-present branch
  if (liquidity.hasSignal) {
    if (liquidity.thin || (Number.isFinite(liquidity.liquidityScore) && liquidity.liquidityScore < 35)) {
      return {
        decision: 'hold',
        reason: `Thin market / low liquidity — hold despite alpha ${(alphaPct30d * 100).toFixed(1)}pp vs index.`,
        damped: true,
      };
    }
    const score = liquidity.liquidityScore;
    if (Number.isFinite(score) && score < 65) {
      // mid band: wider ±7.5pp
      if (alphaPct30d >= MID_ALPHA) {
        return {
          decision: 'promote',
          reason: `Alpha +${(alphaPct30d * 100).toFixed(1)}pp over index (mid-liquidity threshold ±7.5pp). Feature this card.`,
          damped: false,
        };
      }
      if (alphaPct30d <= -MID_ALPHA) {
        return {
          decision: 'clear',
          reason: `Alpha ${(alphaPct30d * 100).toFixed(1)}pp under index (mid-liquidity). Consider clearing.`,
          damped: false,
        };
      }
      const damped = alphaPct30d >= PROMOTE_ALPHA || alphaPct30d <= CLEAR_ALPHA;
      return {
        decision: 'hold',
        reason: damped
          ? `Alpha ${(alphaPct30d * 100).toFixed(1)}pp would fire at high-liquidity ±5pp but mid band needs ±7.5pp — hold.`
          : `Alpha ${(alphaPct30d * 100).toFixed(1)}pp within mid-liquidity dead band — hold.`,
        damped,
      };
    }
    // high liquidity / no score but has signal and not thin
    if (alphaPct30d >= PROMOTE_ALPHA) {
      return {
        decision: 'promote',
        reason: `Alpha +${(alphaPct30d * 100).toFixed(1)}pp over index with usable liquidity. Promote.`,
        damped: false,
      };
    }
    if (alphaPct30d <= CLEAR_ALPHA) {
      return {
        decision: 'clear',
        reason: `Alpha ${(alphaPct30d * 100).toFixed(1)}pp under index with usable liquidity. Clear.`,
        damped: false,
      };
    }
    return {
      decision: 'hold',
      reason: `Alpha ${(alphaPct30d * 100).toFixed(1)}pp within ±5pp of index — hold.`,
      damped: false,
    };
  }

  // Liquidity-absent degradation: rank by delta+alpha only (no thin penalty)
  if (alphaPct30d >= PROMOTE_ALPHA) {
    return {
      decision: 'promote',
      reason: `Alpha +${(alphaPct30d * 100).toFixed(1)}pp over index (no liquidity signal; delta+alpha only). Promote with caution.`,
      damped: false,
    };
  }
  if (alphaPct30d <= CLEAR_ALPHA) {
    return {
      decision: 'clear',
      reason: `Alpha ${(alphaPct30d * 100).toFixed(1)}pp under index (no liquidity signal; delta+alpha only). Clear with caution.`,
      damped: false,
    };
  }
  return {
    decision: 'hold',
    reason: `Alpha ${(alphaPct30d * 100).toFixed(1)}pp near index (no liquidity signal) — hold.`,
    damped: false,
  };
}

async function loadSummary() {
  const cached = readWallCache();
  if (cached) return cached;
  const summary = await fetchWallSummary();
  if (summary) writeWallCache(summary);
  return summary;
}

/**
 * Build movers list from a wall summary. Exported for tests / reuse.
 * @param {object|null} summary
 * @returns {Promise<object[]>}
 */
export async function buildMovers(summary) {
  if (!summary) return [];

  const indexD30 = Number.isFinite(summary?.deltas?.d30) ? summary.deltas.d30 : 0;
  const indexD7 = Number.isFinite(summary?.deltas?.d7) ? summary.deltas.d7 : null;

  // Prefer constituents; fall back to topMovers
  const pool = Array.isArray(summary.constituents) && summary.constituents.length > 0
    ? summary.constituents
    : (Array.isArray(summary.topMovers) ? summary.topMovers : []);

  const cards = pool.slice(0, 80);
  const needsSeries = [];
  const prepared = [];

  for (const card of cards) {
    const embedded = extractEmbeddedDeltas(card);
    const slug = hrefToSlug(card?.href);
    if (embedded) {
      prepared.push({ card, d7: embedded.d7, d30: embedded.d30, deltaSource: embedded.source, slug });
    } else if (slug) {
      // Branch (b): fan-out getCardFmvSeries when change fields absent
      needsSeries.push({ card, slug });
    } else {
      prepared.push({ card, d7: null, d30: null, deltaSource: 'none', slug: null });
    }
  }

  const seriesJobs = needsSeries.slice(0, MAX_SERIES_FANOUT);
  const seriesResults = await runConcurrent(seriesJobs, SERIES_CONCURRENCY, async (item) => {
    try {
      const points30 = await getCardFmvSeries(item.slug, { window: 30 });
      const d30 = seriesReturn(points30);
      // Derive ~7d from last ~25% of 30d series when available (avoids extra call)
      let d7 = null;
      if (Array.isArray(points30) && points30.length >= 4) {
        const slice = points30.slice(-Math.max(2, Math.floor(points30.length / 4)));
        d7 = seriesReturn(slice);
      }
      return { ...item, d7, d30, deltaSource: 'series_fallback' };
    } catch {
      return { ...item, d7: null, d30: null, deltaSource: 'series_error' };
    }
  });

  for (const r of seriesResults) {
    if (r) prepared.push(r);
  }

  const movers = [];
  for (const row of prepared) {
    const { card, d7, d30, deltaSource, slug } = row;
    if (!Number.isFinite(d30)) continue;

    const alphaPct30d = d30 - indexD30;
    const alphaPct7d = Number.isFinite(d7) && Number.isFinite(indexD7) ? d7 - indexD7 : null;
    const liquidity = assessLiquidity(card);
    const { decision, reason, damped } = classifyMover({ alphaPct30d, liquidity });

    movers.push({
      name: card.name ?? null,
      setName: card.setName ?? null,
      setCode: card.setCode ?? null,
      cardNumber: card.cardNumber ?? null,
      grade: card.grade ?? null,
      imageUrl: card.imageUrl ?? null,
      imageUrlThumb: card.imageUrlThumb ?? null,
      priceUsdCents: Number.isFinite(card.priceUsdCents) ? card.priceUsdCents : null,
      href: card.href ?? null,
      slug: slug ?? null,
      lastSaleAt: card.lastSaleAt ?? null,
      deltaPct7d: Number.isFinite(d7) ? d7 : null,
      deltaPct30d: d30,
      indexDeltaPct30d: indexD30,
      alphaPct30d,
      alphaPct7d,
      deltaSource,
      hasLiquiditySignal: liquidity.hasSignal,
      thinMarketData: liquidity.thin,
      liquidityScore: liquidity.liquidityScore,
      decision,
      reason,
      damped,
    });
  }

  // Rank: promote first, then |alpha| desc within decision
  const rank = { promote: 0, hold: 1, clear: 2, null: 3 };
  movers.sort((a, b) => {
    const ra = rank[a.decision] ?? 3;
    const rb = rank[b.decision] ?? 3;
    if (ra !== rb) return ra - rb;
    return Math.abs(b.alphaPct30d ?? 0) - Math.abs(a.alphaPct30d ?? 0);
  });

  return movers;
}

router.get('/movers', async (_req, res) => {
  try {
    // Fail-open when not configured — empty movers, no network
    if (!isConfigured()) {
      return res.json({
        movers: [],
        index: null,
        attributionUrl: ATTRIBUTION_URL,
        game: GAME,
      });
    }

    const summary = await loadSummary();
    if (!summary) {
      return res.json({
        movers: [],
        index: null,
        attributionUrl: ATTRIBUTION_URL,
        game: GAME,
      });
    }

    const movers = await buildMovers(summary);
    return res.json({
      movers,
      index: {
        game: summary.game,
        value: summary.value,
        deltas: summary.deltas,
        updatedAt: summary.updatedAt,
        fetchedAt: summary.fetchedAt,
      },
      attributionUrl: summary.attributionUrl ?? ATTRIBUTION_URL,
      game: summary.game ?? GAME,
    });
  } catch (err) {
    console.warn(`[movers] unexpected error: ${err?.message ?? err}`);
    return res.json({
      movers: [],
      index: null,
      attributionUrl: ATTRIBUTION_URL,
      game: GAME,
    });
  }
});

export default router;
