/**
 * inventorySort.js — pure sort for the Inventory page.
 *
 * Applied after filter, before pagination, so list and grid share one order.
 * Null / non-finite values always sink to the end (either direction) so
 * unpriced rows never bury the cards a merchant is actually comparing.
 */

const SORT_KEYS = new Set(['fmv', 'unrealized']);
const SORT_DIRS = new Set(['asc', 'desc']);

/**
 * @param {'fmv'|'unrealized'|string|null|undefined} key
 * @returns {'fmv'|'unrealized'}
 */
export function normalizeSortKey(key) {
  return SORT_KEYS.has(key) ? key : 'fmv';
}

/**
 * @param {'asc'|'desc'|string|null|undefined} dir
 * @returns {'asc'|'desc'}
 */
export function normalizeSortDir(dir) {
  return SORT_DIRS.has(dir) ? dir : 'desc';
}

/**
 * @param {object} item
 * @param {'fmv'|'unrealized'} sortKey
 * @returns {number|null}
 */
function sortValue(item, sortKey) {
  const raw = sortKey === 'unrealized' ? item?.pnl : item?.fmvUsd;
  return Number.isFinite(raw) ? raw : null;
}

function tieBreak(a, b) {
  const nameA = String(a?.name || '');
  const nameB = String(b?.name || '');
  const byName = nameA.localeCompare(nameB);
  if (byName !== 0) return byName;
  return String(a?.cert || a?.id || '').localeCompare(String(b?.cert || b?.id || ''));
}

/**
 * @param {Array<object>} items
 * @param {'fmv'|'unrealized'|string} sortKey
 * @param {'asc'|'desc'|string} sortDir
 * @returns {Array<object>} new array
 */
export function sortInventoryItems(items, sortKey, sortDir) {
  const key = normalizeSortKey(sortKey);
  const dir = normalizeSortDir(sortDir);
  const list = Array.isArray(items) ? [...items] : [];
  const mul = dir === 'asc' ? 1 : -1;

  return list.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va == null && vb == null) return tieBreak(a, b);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (va !== vb) return (va - vb) * mul;
    return tieBreak(a, b);
  });
}
