/**
 * Money / qty input guards — client-side.
 * Rules: no negatives, max 2 decimal places, hard ceiling (no 1e+n overflow UI).
 */

export const MAX_MONEY = 999_999_999;
export const MAX_MONEY_DECIMALS = 2;
export const MAX_QTY = 9_999;
export const MIN_YEAR = 1990;
export const MAX_YEAR = 2100;

/**
 * Live filter for controlled money inputs (cost, list, sale, target…).
 * Strips non-digits except one `.`, caps fractional digits, clamps max.
 * @param {string|number|null|undefined} raw
 * @param {{ max?: number, maxDecimals?: number }} [opts]
 * @returns {string}
 */
export function clampMoneyInput(raw, opts = {}) {
  const max = opts.max ?? MAX_MONEY;
  const maxDecimals = opts.maxDecimals ?? MAX_MONEY_DECIMALS;
  if (raw == null) return '';
  let s = String(raw).trim();
  if (s === '') return '';

  // Kill scientific notation / signs / letters early
  s = s.replace(/[eE+\-]/g, '');
  s = s.replace(/[^\d.]/g, '');

  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    const intPart = s.slice(0, firstDot).replace(/\./g, '') || '0';
    const decPart = s.slice(firstDot + 1).replace(/\./g, '').slice(0, maxDecimals);
    s = `${intPart}.${decPart}`;
  } else {
    s = s.replace(/\./g, '');
  }

  // Avoid empty integer with trailing dot only → "0."
  if (s === '.') return '0.';

  // Clamp complete finite values (keep trailing "." while typing)
  if (!s.endsWith('.')) {
    const n = Number(s);
    if (Number.isFinite(n) && n > max) {
      return formatMoneyCap(max, maxDecimals);
    }
  } else {
    const n = Number(s.slice(0, -1) || '0');
    if (Number.isFinite(n) && n > max) {
      return formatMoneyCap(max, maxDecimals);
    }
  }

  // Strip leading zeros from int part except "0" / "0.xx"
  if (s.includes('.')) {
    const [i, d] = s.split('.');
    const intNorm = i.replace(/^0+(?=\d)/, '') || '0';
    s = `${intNorm}.${d}`;
  } else if (s.length > 1) {
    s = s.replace(/^0+(?=\d)/, '') || '0';
  }

  return s;
}

function formatMoneyCap(max, maxDecimals) {
  if (maxDecimals <= 0) return String(Math.trunc(max));
  return max.toFixed(Math.min(maxDecimals, 2));
}

/**
 * Parse for save/API: null if blank; number rounded to cents; null if invalid.
 * @param {string|number|null|undefined} raw
 * @param {{ max?: number, maxDecimals?: number, allowBlank?: boolean }} [opts]
 * @returns {{ value: number|null, error?: string }}
 */
export function parseMoney(raw, opts = {}) {
  const max = opts.max ?? MAX_MONEY;
  const maxDecimals = opts.maxDecimals ?? MAX_MONEY_DECIMALS;
  const allowBlank = opts.allowBlank !== false;

  if (raw === '' || raw == null) {
    return allowBlank ? { value: null } : { value: null, error: 'required' };
  }
  const str = String(raw).trim();
  if (/[eE]/.test(str) || /[+\-]/.test(str.replace(/^\s*/, ''))) {
    return { value: null, error: 'invalid' };
  }
  if (str.includes('.')) {
    const dec = str.split('.')[1] || '';
    if (dec.length > maxDecimals) return { value: null, error: 'decimals' };
  }
  const n = Number(str);
  if (!Number.isFinite(n)) return { value: null, error: 'invalid' };
  if (n < 0) return { value: null, error: 'negative' };
  if (n > max) return { value: null, error: 'max' };
  const rounded = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals;
  return { value: rounded };
}

/**
 * @param {string|number|null|undefined} raw
 * @param {{ max?: number, min?: number, fallback?: number }} [opts]
 * @returns {{ value: number, error?: string }}
 */
export function parseQty(raw, opts = {}) {
  const max = opts.max ?? MAX_QTY;
  const min = opts.min ?? 1;
  const fallback = opts.fallback ?? 1;
  if (raw === '' || raw == null) return { value: fallback };
  const n = Number(String(raw).replace(/[^\d]/g, ''));
  if (!Number.isFinite(n) || !Number.isInteger(n)) return { value: fallback, error: 'invalid' };
  if (n < min) return { value: min, error: 'min' };
  if (n > max) return { value: max, error: 'max' };
  return { value: n };
}

/**
 * Integer qty typing filter (digits only, clamp max).
 * @param {string|number|null|undefined} raw
 * @param {{ max?: number }} [opts]
 */
export function clampQtyInput(raw, opts = {}) {
  const max = opts.max ?? MAX_QTY;
  let s = String(raw ?? '').replace(/\D/g, '');
  if (s === '') return '';
  s = s.replace(/^0+(?=\d)/, '') || '0';
  const n = Number(s);
  if (Number.isFinite(n) && n > max) return String(max);
  return s;
}

/** HTML attrs for money inputs */
export const MONEY_INPUT_ATTRS = {
  inputMode: 'decimal',
  min: '0',
  max: String(MAX_MONEY),
  step: '0.01',
  // type=text avoids e/E/- spinner loopholes; inputMode still shows decimal pad
};
