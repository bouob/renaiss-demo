/**
 * Server-side money / qty sanitizers (fail closed).
 * Mirrors client/src/lib/moneyInput.js ceilings.
 */

export const MAX_MONEY = 999_999_999;
export const MAX_MONEY_DECIMALS = 2;
export const MAX_QTY = 9_999;
export const MAX_BLOCK = 99_999_999_999; // chain block numbers

const roundMoney = (value, decimals = MAX_MONEY_DECIMALS) => {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/**
 * Non-negative money ≤ MAX_MONEY, rounded to cents.
 * Empty → null. Invalid / negative / over max → null (callers may treat as omit).
 * @param {unknown} v
 * @returns {number|null}
 */
export function sanitizeMoney(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /[eE]/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return null;
  return roundMoney(n);
}

/**
 * Same as sanitizeMoney but invalid returns undefined (for "reject request" patterns).
 * @param {unknown} v
 * @returns {number|null|undefined}
 */
export function sanitizeMoneyStrict(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && /[eE]/.test(v)) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY) return undefined;
  return roundMoney(n);
}

/**
 * Integer qty in [1, MAX_QTY]; blank → 1; invalid → 1.
 * @param {unknown} v
 * @returns {number}
 */
export function sanitizeQty(v) {
  if (v === null || v === undefined || v === '') return 1;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return 1;
  if (n > MAX_QTY) return MAX_QTY;
  return n;
}

/**
 * Optional non-negative integer (blocks, cents when not money-rounded).
 * @param {unknown} v
 * @param {{ max?: number }} [opts]
 * @returns {number|null}
 */
export function sanitizeNonNegInt(v, opts = {}) {
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) return null;
  return n;
}
