/**
 * money.js — USD formatting for display.
 *
 * Two input shapes exist in this app:
 *   1. Renaiss Index integers in **cents** (`priceUsdCents`) → formatUsdCents / centsToUsd
 *   2. Client-side **dollar** numbers (FMV, cost, P&L) → formatUsd / formatUsdSigned
 *
 * Not to be confused with `moneyInput.js`, which parses/clamps what a *user*
 * types into a money field — that is input sanitation, this is output
 * formatting.
 */

/** The em dash the UI shows for a missing value (matches i18n `common.emDash`). */
const EM_DASH = '—';

/**
 * @param {number|null|undefined} cents - integer cents, e.g. 4200.
 * @returns {string} `"$42.00"`, or an em dash when there is no usable number.
 *   Guards on the value itself rather than on null, since the upstream sends
 *   `null` for an unpriced card and a bad payload could send a string.
 */
export function formatUsdCents(cents) {
  if (!Number.isFinite(cents)) return EM_DASH;
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * @param {number|null|undefined} cents - integer cents, e.g. 4200.
 * @returns {number|null} dollars as a number (42), or null. For callers doing
 *   arithmetic (P&L, suggested list price) rather than display — they need a
 *   null they can propagate, not an em dash.
 */
export function centsToUsd(cents) {
  if (!Number.isFinite(cents)) return null;
  return cents / 100;
}

/**
 * Format a dollar amount for display (FMV, cost, portfolio totals).
 * Accounting sign lives outside the `$`: `"-$5.00"`, not `"$-5.00"`.
 *
 * @param {number|null|undefined} n - dollars, e.g. 42.5 or -9.62.
 * @returns {string} `"$42.50"` | `"-$9.62"` | `"—"`.
 */
export function formatUsd(n) {
  if (!Number.isFinite(n)) return EM_DASH;
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/**
 * Format a dollar amount with an explicit profit/loss sign.
 * Positives get a leading `+` so columns scan as sentiment, not just magnitude.
 *
 * @param {number|null|undefined} n - dollars, e.g. 1.02 or -9.62.
 * @returns {string} `"+$1.02"` | `"-$9.62"` | `"—"`.
 */
export function formatUsdSigned(n) {
  if (!Number.isFinite(n)) return EM_DASH;
  if (n > 0) return `+$${n.toFixed(2)}`;
  if (n < 0) return `-$${Math.abs(n).toFixed(2)}`;
  return '$0.00';
}
