/**
 * money.js — USD formatting for the Renaiss Index's cents-denominated prices.
 *
 * Every price the Renaiss OS Index returns (`priceUsdCents`) is an integer
 * number of cents. This module is the single place that turns those into
 * display strings or dollar numbers.
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
