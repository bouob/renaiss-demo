/**
 * merchantCopilot.js — Merchant Copilot (Renaiss Index L4) decision-bucket
 * classification. Pure function, no I/O — reads only the L2/L3 signals
 * RenaissPortfolioSection already computes (alpha vs index, Dokipoki scoring
 * engine's thin_market_data flag and liquidity score). See
 * docs/handoff/renaiss-fusion-plan.md §3 (L4 layer) and §4 (why thin-data
 * holdings must not drive a strong call).
 */

/** alpha ≥ +5pp over the index over 30 days → promote (high-liquidity / no-score default). */
export const MERCHANT_PROMOTE_ALPHA_PCT = 0.05;
/** alpha ≤ −5pp over the index over 30 days → clear (high-liquidity / no-score default). */
export const MERCHANT_CLEAR_ALPHA_PCT = -0.05;

/** liquidityScore ≥ this → 'high' band (current ±5pp threshold, unchanged behavior). */
export const LIQUIDITY_BAND_HIGH_MIN_SCORE = 65;
/** liquidityScore ≥ this (and < high) → 'mid' band (wider ±7.5pp threshold). */
export const LIQUIDITY_BAND_MID_MIN_SCORE = 35;
/** alpha threshold in the 'mid' band — wider than the high-band ±5pp because
 *  thinner liquidity needs a stronger signal before a promote/clear call is trusted. */
export const MERCHANT_MID_LIQUIDITY_ALPHA_PCT = 0.075;

// Demo-only fallback for the seeded marquee cards. A live mover match always
// takes precedence in Inventory.jsx, so this only powers the offline demo.
export const DEMO_PROMOTE_ALPHA_BY_CERT = Object.freeze({
  PSA122603338: 0.12, // 25th Anniversary Birthday Pikachu
  PSA161025105: 0.09, // Umbreon ex
  PSA151789461: 0.08, // Grey Felt Hat Pikachu
});

/**
 * Graded liquidity bands (server/scoring/liquidity.js `analysis.scores.liquidity`,
 * 0-100) — single source of truth for the score cutoffs and the alpha
 * threshold each band applies. Ordered high → mid → low; `resolveLiquidityBand`
 * picks the first band whose `min` the score clears. `promoteAlphaPct`/
 * `clearAlphaPct` are `null` for `low`: below that floor the holding always
 * holds regardless of alpha (liquidity too thin to trust any call).
 * @typedef {'high'|'mid'|'low'} MerchantLiquidityBand
 */
export const LIQUIDITY_BANDS = [
  { key: 'high', min: LIQUIDITY_BAND_HIGH_MIN_SCORE, promoteAlphaPct: MERCHANT_PROMOTE_ALPHA_PCT, clearAlphaPct: MERCHANT_CLEAR_ALPHA_PCT },
  { key: 'mid', min: LIQUIDITY_BAND_MID_MIN_SCORE, promoteAlphaPct: MERCHANT_MID_LIQUIDITY_ALPHA_PCT, clearAlphaPct: -MERCHANT_MID_LIQUIDITY_ALPHA_PCT },
  { key: 'low', min: -Infinity, promoteAlphaPct: null, clearAlphaPct: null },
];

function resolveLiquidityBand(liquidityScore) {
  return LIQUIDITY_BANDS.find((band) => liquidityScore >= band.min);
}

/**
 * The full set of Merchant Copilot decision buckets — single source of truth
 * for consumers that enumerate them (the bucket-tally seed, the decision-badge
 * tones, the i18n keys). Adding a bucket is one edit here that those consumers
 * derive from, instead of re-hardcoding the literals in three unlinked places.
 * @typedef {'promote'|'hold'|'clear'} MerchantDecision
 */
export const MERCHANT_DECISIONS = /** @type {MerchantDecision[]} */ (['promote', 'hold', 'clear']);

/**
 * Classifies a single holding into a Merchant Copilot action bucket, with the
 * liquidity-band reasoning exposed for the UI (badge tooltip / hint copy).
 *
 * Rules, in order:
 * 1. `alphaPct30d` missing/non-finite → not enough data to classify
 *    (`decision: null`).
 * 2. `marketDataLoaded !== true` → `'hold'` — an analyze payload that hasn't
 *    loaded (errored / still pending) means data quality is *unknown*, which
 *    must not license a strong call, and pre-empts both the score branch and
 *    the thin-data check below.
 * 3. `liquidityScore` is a finite number → **score-driven band** decides,
 *    ignoring `thinMarketData` (the score already reflects sale-count
 *    confidence — checking the boolean too would double-penalize the same
 *    signal):
 *    - `>= LIQUIDITY_BAND_HIGH_MIN_SCORE` ('high'): current ±5pp threshold.
 *    - `>= LIQUIDITY_BAND_MID_MIN_SCORE` ('mid'): wider ±7.5pp threshold —
 *      alpha that would have promoted/cleared under the high-band threshold
 *      but misses the wider one comes back as `'hold'` with `damped: true`.
 *    - below that ('low'): always `'hold'`, regardless of alpha.
 * 4. `liquidityScore` missing/non-finite → falls back to the original
 *    thin-data-only rule, unchanged: `thinMarketData === true` → `'hold'`,
 *    else the ±5pp threshold (docs/handoff/renaiss-fusion-plan.md §4).
 *
 * @param {object} params
 * @param {number|null|undefined} params.alphaPct30d - decimal alpha vs the
 *   Renaiss Index over 30 days (0.05 = +5%), from
 *   GET /api/renaiss/index/portfolio-series `perHolding[tokenId].alphaPct30d`.
 * @param {boolean} [params.thinMarketData] - Dokipoki scoring engine's
 *   `thin_market_data` flag (sale-count confidence < 0.5; server/scoring/liquidity.js).
 *   Only consulted when `liquidityScore` is missing (see rule 4).
 * @param {boolean} [params.marketDataLoaded=true] - whether the per-holding
 *   analyze payload actually resolved. `false` = errored or still pending, so
 *   the thin-data/liquidity-score signal is unknown (not confirmed-good) and
 *   must not license a strong call. Defaults `true` for callers that always
 *   pass loaded data.
 * @param {number|null|undefined} [params.liquidityScore] - Dokipoki scoring
 *   engine's `analysis.scores.liquidity` (0-100; server/scoring/engine.js).
 *   Omitted/non-finite → falls back to the pre-band thin-data rule untouched.
 * @returns {{ decision: MerchantDecision|null, liquidityBand: MerchantLiquidityBand|null, damped: boolean }}
 *   `decision: null` when there is not enough data to classify (the caller
 *   should not render a bucket). `damped` is `true` only when the mid band's
 *   wider threshold downgraded what would have been a promote/clear at the
 *   default threshold into a hold.
 */
export function classifyMerchantDecisionDetail({ alphaPct30d, thinMarketData, marketDataLoaded = true, liquidityScore } = {}) {
  if (!Number.isFinite(alphaPct30d)) return { decision: null, liquidityBand: null, damped: false };
  if (marketDataLoaded !== true) return { decision: 'hold', liquidityBand: null, damped: false };

  if (Number.isFinite(liquidityScore)) {
    const band = resolveLiquidityBand(liquidityScore);
    if (band.key === 'low') return { decision: 'hold', liquidityBand: 'low', damped: false };
    if (alphaPct30d >= band.promoteAlphaPct) return { decision: 'promote', liquidityBand: band.key, damped: false };
    if (alphaPct30d <= band.clearAlphaPct) return { decision: 'clear', liquidityBand: band.key, damped: false };
    const damped = band.key === 'mid'
      && (alphaPct30d >= MERCHANT_PROMOTE_ALPHA_PCT || alphaPct30d <= MERCHANT_CLEAR_ALPHA_PCT);
    return { decision: 'hold', liquidityBand: band.key, damped };
  }

  // No liquidity score — the original thin-data-only rule, byte-for-byte.
  if (thinMarketData === true) return { decision: 'hold', liquidityBand: null, damped: false };
  if (alphaPct30d >= MERCHANT_PROMOTE_ALPHA_PCT) return { decision: 'promote', liquidityBand: null, damped: false };
  if (alphaPct30d <= MERCHANT_CLEAR_ALPHA_PCT) return { decision: 'clear', liquidityBand: null, damped: false };
  return { decision: 'hold', liquidityBand: null, damped: false };
}

/**
 * Thin wrapper over {@link classifyMerchantDecisionDetail} for callers that
 * only need the bucket. Without `liquidityScore`, behavior is identical to
 * the pre-band classifier (see rule 4 above).
 * @param {Parameters<typeof classifyMerchantDecisionDetail>[0]} params
 * @returns {MerchantDecision|null}
 */
export function classifyMerchantDecision(params) {
  return classifyMerchantDecisionDetail(params).decision;
}
