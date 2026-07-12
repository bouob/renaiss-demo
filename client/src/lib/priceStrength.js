// Pure, deterministic mapping from a holding's 30-day alpha (performance vs the
// Renaiss L1 index) onto a signed strength value. The number is never shown to
// the user — it only drives the StrengthBar meter — but keeping the mapping here
// (side-effect free, no Date.now/random/render-order input) guarantees the same
// alpha always produces the same bar fill and color.

// Alpha magnitude (in percentage points) that saturates the bar to its end.
// A card beating/trailing the index by ±20pp over 30d pins the meter full.
export const STRENGTH_SATURATION_PP = 20;

// Below this magnitude the holding is treated as "at market" (grey), so tiny
// index-tracking noise never reads as a directional win or loss.
export const STRENGTH_NEUTRAL_PP = 1;

/**
 * @param {number|null|undefined} alphaPct30d - alpha as a fraction (0.106 = +10.6%),
 *   matching perHolding[].alphaPct30d from the portfolio-series API.
 * @returns {{ pp: number, norm: number, value: number, tone: 'positive'|'negative'|'neutral' } | null}
 *   `pp` = alpha in percentage points; `norm` = fill fraction in [-1, 1];
 *   `value` = internal -5..+5 score (never displayed); `tone` = color bucket.
 *   Returns null when alpha is missing/non-finite so callers render nothing.
 */
export function computeStrength(alphaPct30d) {
  if (alphaPct30d == null) return null;
  const numeric = Number(alphaPct30d);
  if (!Number.isFinite(numeric)) return null;

  const pp = numeric * 100;
  const norm = Math.max(-1, Math.min(1, pp / STRENGTH_SATURATION_PP));
  const value = norm * 5;
  const tone = Math.abs(pp) < STRENGTH_NEUTRAL_PP ? 'neutral' : pp > 0 ? 'positive' : 'negative';

  return { pp, norm, value, tone };
}
