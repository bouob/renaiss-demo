/**
 * renaissPortfolioSeries.js — pure "portfolio vs index" series builder.
 *
 * Extracted from D:/Desktop/Dokipoki/server/services/renaissIndexService.js's
 * Phase 2 section (`buildPortfolioSeries` + its private helpers + `hrefToSlug`).
 * Aligns each held card's FMV history (getCardFmvSeries — one upstream call
 * per unique card slug, deduped across duplicate holdings of the same card)
 * onto a global index summary's sparkline axis, producing a "my portfolio"
 * line comparable to "the index" line, plus a per-holding 30d alpha vs the
 * index.
 *
 * Deliberately excludes the source's Firestore-backed pieces
 * (`refreshGlobalIndexSummary` / `readIndexSummary` / `readPortfolioSeries` /
 * `portfolioMemCache` / the `renaissIndexGlobal` collection) — this module has
 * NO firebaseAdmin/adminDb import. Callers pass `summary` in directly (e.g.
 * from the /wall route's own cache — see server/routes/wall.js); they own
 * how/where that summary is fetched or persisted.
 *
 * The cross-slug getCardFmvSeries result cache (`seriesMemCache`) IS kept —
 * it is pure in-memory de-duplication (same both-success-only +
 * oldest-first-eviction shape as renaissAdjacentCertService.js's cert
 * cache), not persistence.
 *
 * Fail-open: `buildPortfolioSeries` never throws — a `getCardFmvSeries`
 * failure for one slug just drops that card to "uncovered", same fail-open
 * posture as the rest of the ported Renaiss adapters.
 */

import { getCardFmvSeries } from './renaissOsIndex.js';
import { runConcurrent } from '../utils/runConcurrent.js';

// Human-facing index site (attribution link target) — same value as
// Dokipoki's renaissIndexService.js ATTRIBUTION_URL.
export const ATTRIBUTION_URL = 'https://index.renaissos.com';

export const SERIES_CONCURRENCY = 4;
export const MAX_SERIES_SLUGS_PER_REQUEST = 60;
export const MIN_COVERAGE_FRACTION = 0.8;
export const BENCHMARK_WINDOWS = [7, 30, 365];
// Series cache freshness window — same order of magnitude as the source's
// PORTFOLIO_STALE_MS (there derived from SUMMARY_STALE_MS = 24h).
export const SERIES_STALE_MS = 24 * 60 * 60 * 1000;

// Cross-caller getCardFmvSeries result cache cap — the key space is every
// distinct card slug ever fetched, so it needs a hard bound on a long-lived
// instance. Oldest-first eviction.
export const MAX_SERIES_CACHE_ENTRIES = 500;

const seriesMemCache = new Map(); // slug -> { series, fetchedAt }
let maxSeriesCacheEntries = MAX_SERIES_CACHE_ENTRIES;

/**
 * Strips the `/card/` prefix from an ingested RenaissFmv href and returns
 * the 3-segment `{game}/{set}/{card}` slug getCardFmvSeries expects.
 * Segment *content* validation (charset, path traversal) is
 * getCardFmvSeries's job — this only checks the prefix and segment count so
 * an obviously-wrong href is skipped before spending an upstream call on it.
 *
 * @param {string|null|undefined} href
 * @returns {string|null}
 */
export function hrefToSlug(href) {
  const PREFIX = '/card/';
  if (typeof href !== 'string' || !href.startsWith(PREFIX)) return null;
  const segments = href.slice(PREFIX.length).split('/');
  return segments.length === 3 ? segments.join('/') : null;
}

// coverage.total counts the *candidates* (found FMV + resolvable card slug),
// not every held item — a wallet's ungraded / non-Renaiss cards can never
// enter the comparison, so including them would understate coverage.
function countCandidateHoldings(holdings) {
  let count = 0;
  for (const holding of holdings ?? []) {
    if (holding?.renaissFmv?.found && hrefToSlug(holding.renaissFmv?.href)) count += 1;
  }
  return count;
}

// First and last non-null point of a canonical-axis-aligned (forward-filled)
// series, in canonical date order — the pair the alpha math needs. `first`
// stays null when the series never lands a real value on the canonical axis
// at all.
function firstAndLastAligned(aligned) {
  let first = null;
  let last = null;
  for (const point of aligned) {
    if (point.usdCents != null) {
      if (first == null) first = point.usdCents;
      last = point.usdCents;
    }
  }
  return { first, last };
}

function windowKey(days) {
  return `d${days}`;
}

function computeTrailingDelta(aligned, days) {
  if (!Array.isArray(aligned) || aligned.length <= days) return null;
  const end = aligned[aligned.length - 1]?.usdCents;
  const start = aligned[aligned.length - 1 - days]?.usdCents;
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null;
  return end / start - 1;
}

function computeWindowMetrics(aligned, summaryDeltas = {}) {
  const windows = {};
  for (const days of BENCHMARK_WINDOWS) {
    const key = windowKey(days);
    const deltaPct = computeTrailingDelta(aligned, days);
    const indexDeltaPct = Number.isFinite(summaryDeltas?.[key]) ? summaryDeltas[key] : null;
    windows[key] = {
      deltaPct,
      alphaPct: Number.isFinite(deltaPct) && Number.isFinite(indexDeltaPct)
        ? deltaPct - indexDeltaPct
        : null,
    };
  }
  return windows;
}

function isSeriesFresh(entry) {
  return Boolean(entry) && Date.now() - entry.fetchedAt < SERIES_STALE_MS;
}

// Returns the cached series for `slug` if present and unexpired, else null —
// null covers both "never fetched" and "fetched but the result was empty/
// failed" (those are never written, see writeSeriesCache), so a miss here
// always means "go fetch upstream", never "upstream previously said empty".
function readSeriesCache(slug) {
  const entry = seriesMemCache.get(slug);
  return isSeriesFresh(entry) ? entry.series : null;
}

// Both-success-only: callers only pass a non-empty series (see
// buildPortfolioSeries below) — an empty/failed fetch is never cached, so a
// transient upstream blip doesn't poison a slug as "no data" for the TTL.
// Oldest-first eviction mirrors renaissAdjacentCertService.js's writeCache.
function writeSeriesCache(slug, series) {
  if (!seriesMemCache.has(slug)) {
    while (seriesMemCache.size >= maxSeriesCacheEntries) {
      seriesMemCache.delete(seriesMemCache.keys().next().value); // evict oldest inserted
    }
  }
  seriesMemCache.set(slug, { series, fetchedAt: Date.now() });
}

/**
 * Aligns each held card's FMV history onto the given index summary's
 * sparkline axis and sums the covered holdings into a portfolio line
 * comparable to the index line. The only I/O is getCardFmvSeries (bounded to
 * SERIES_CONCURRENCY in flight, capped to MAX_SERIES_SLUGS_PER_REQUEST unique
 * card slugs per call) — everything else is pure aggregation. Never throws
 * (a getCardFmvSeries failure for one slug just drops that card to
 * uncovered).
 *
 * @param {{holdings: Array<object>, summary: object|null}} params -
 *   `holdings` items need at minimum `{id, renaissFmv: {found, href}}`;
 *   `summary` is a mapped IndexTile/IndexDetail shape carrying at least
 *   `sparkline`, `deltas`, `updatedAt` (or null when the index is unavailable
 *   — e.g. /wall's fail-open shape — which short-circuits to the empty
 *   result below without calling getCardFmvSeries at all).
 * @returns {Promise<{
 *   portfolio: Array<{t: string, usdCents: number}>,
 *   index: {sparkline: Array, deltas: object, updatedAt: string}|null,
 *   benchmark: {windows: Record<string, {portfolioDeltaPct: number|null, indexDeltaPct: number|null, alphaPct: number|null}>},
 *   perHolding: Record<string, {deltaPct30d: number|null, alphaPct30d: number|null, windows: Record<string, {deltaPct: number|null, alphaPct: number|null}>}>,
 *   coverage: {included: number, total: number},
 *   attributionUrl: string,
 * }>}
 */
export async function buildPortfolioSeries({ holdings, summary }) {
  if (!summary) {
    return {
      portfolio: [],
      index: null,
      benchmark: { windows: {} },
      perHolding: {},
      coverage: { included: 0, total: countCandidateHoldings(holdings) },
      attributionUrl: ATTRIBUTION_URL,
    };
  }

  // Group candidate holdings (found FMV with a resolvable card slug) by
  // slug — duplicate holdings of the same card share one upstream call but
  // each still contributes its own copy to the portfolio sum and its own
  // entry in perHolding.
  const slugToHoldings = new Map();
  for (const holding of holdings ?? []) {
    if (!holding?.renaissFmv?.found) continue;
    const slug = hrefToSlug(holding.renaissFmv?.href);
    if (!slug) continue;
    if (!slugToHoldings.has(slug)) slugToHoldings.set(slug, []);
    slugToHoldings.get(slug).push(holding);
  }

  // Slugs beyond the cap are left unfetched — their holdings fall through to
  // uncovered/unlisted-in-perHolding further down, same as a failed fetch.
  const includedSlugs = Array.from(slugToHoldings.keys()).slice(0, MAX_SERIES_SLUGS_PER_REQUEST);

  const seriesBySlug = new Map();
  await runConcurrent(includedSlugs, SERIES_CONCURRENCY, async (slug) => {
    // A slug already fetched (by this or any other caller) within
    // SERIES_STALE_MS skips the upstream call entirely.
    const cached = readSeriesCache(slug);
    if (cached) {
      seriesBySlug.set(slug, cached);
      return;
    }

    // Per-slug guard so one card's upstream failure drops only that card to
    // uncovered (as the JSDoc promises) instead of rejecting the whole pool.
    // getCardFmvSeries is documented never-throw, but a violated contract must
    // not collapse the entire chart + every other card's alpha.
    try {
      const series = await getCardFmvSeries(slug, { window: 365 });
      if (series && series.length) {
        seriesBySlug.set(slug, series);
        writeSeriesCache(slug, series);
      }
    } catch (err) {
      console.warn(`[renaissPortfolioSeries] getCardFmvSeries(${slug}) failed: ${err.message}`);
    }
  });

  const canonicalDates = (summary.sparkline ?? []).map((point) => point.t).sort();

  // Forward-fill each fetched series onto the canonical axis, and decide per
  // slug whether it has enough real (not forward-filled-from-nothing) data
  // to count toward the portfolio sum.
  const alignedBySlug = new Map(); // slug -> { aligned, covered }
  for (const [slug, series] of seriesBySlug) {
    const byDate = new Map();
    for (const point of series) {
      if (typeof point.usdCents === 'number' && Number.isFinite(point.usdCents)) {
        byDate.set(point.t, point.usdCents);
      }
    }
    const availableDates = Array.from(byDate.keys()).sort();
    if (!availableDates.length) continue; // every point was null/non-finite

    // Data starting after the canonical window opens can't be forward-filled
    // for the leading days — those would silently understate the portfolio.
    const startsLate = canonicalDates.length > 0 && availableDates[0] > canonicalDates[0];

    // Carry in the latest real value dated before the canonical window opens,
    // so an extra pre-window point forward-fills into the first canonical
    // day instead of being dropped and leaving a leading null.
    // availableDates is ascending.
    let lastValue = null;
    if (canonicalDates.length > 0) {
      for (const d of availableDates) {
        if (d >= canonicalDates[0]) break;
        lastValue = byDate.get(d);
      }
    }
    let filledCount = 0;
    const aligned = canonicalDates.map((date) => {
      if (byDate.has(date)) lastValue = byDate.get(date);
      if (lastValue == null) return { t: date, usdCents: null };
      filledCount += 1;
      return { t: date, usdCents: lastValue };
    });

    const coverageFraction = canonicalDates.length ? filledCount / canonicalDates.length : 0;
    const covered = !startsLate && coverageFraction >= MIN_COVERAGE_FRACTION;
    alignedBySlug.set(slug, { aligned, covered });
  }

  const portfolio = canonicalDates.map((date, i) => {
    let usdCents = 0;
    for (const [slug, { aligned, covered }] of alignedBySlug) {
      if (!covered) continue;
      const value = aligned[i].usdCents;
      if (value != null) usdCents += value * (slugToHoldings.get(slug)?.length ?? 0);
    }
    return { t: date, usdCents };
  });

  const portfolioMetrics = computeWindowMetrics(portfolio, summary.deltas);
  const benchmarkWindows = {};
  for (const days of BENCHMARK_WINDOWS) {
    const key = windowKey(days);
    benchmarkWindows[key] = {
      portfolioDeltaPct: portfolioMetrics[key]?.deltaPct ?? null,
      indexDeltaPct: Number.isFinite(summary.deltas?.[key]) ? summary.deltas[key] : null,
      alphaPct: portfolioMetrics[key]?.alphaPct ?? null,
    };
  }

  const perHolding = {};
  let included = 0;
  for (const [slug, { aligned, covered }] of alignedBySlug) {
    if (covered) included += slugToHoldings.get(slug)?.length ?? 0;

    const { first, last } = firstAndLastAligned(aligned);
    const windows = computeWindowMetrics(aligned, summary.deltas);
    if (!first && !Number.isFinite(windows.d30?.deltaPct)) continue; // no usable baseline at all

    const deltaPct30d = Number.isFinite(windows.d30?.deltaPct)
      ? windows.d30.deltaPct
      : (first ? (last / first - 1) : null);
    const alphaPct30d = Number.isFinite(deltaPct30d) && Number.isFinite(summary.deltas?.d30)
      ? deltaPct30d - summary.deltas.d30
      : null;
    for (const holding of slugToHoldings.get(slug) ?? []) {
      perHolding[holding.id] = { deltaPct30d, alphaPct30d, windows };
    }
  }

  return {
    portfolio,
    index: { sparkline: summary.sparkline, deltas: summary.deltas, updatedAt: summary.updatedAt },
    benchmark: { windows: benchmarkWindows },
    perHolding,
    coverage: { included, total: countCandidateHoldings(holdings) },
    attributionUrl: summary.attributionUrl ?? ATTRIBUTION_URL,
  };
}

/** Test-only: resets the in-memory series cache between test cases. */
export function __resetForTest() {
  seriesMemCache.clear();
  maxSeriesCacheEntries = MAX_SERIES_CACHE_ENTRIES;
}

/** Test-only: shrinks the cache cap so eviction is exercisable without
 * inserting MAX_SERIES_CACHE_ENTRIES distinct slugs. */
export function __setMaxSeriesCacheEntriesForTest(n) {
  maxSeriesCacheEntries = n;
}

/** Test-only: current number of cached series slugs. */
export function __seriesCacheSizeForTest() {
  return seriesMemCache.size;
}
