/**
 * Merge per-wallet GET /sales payloads into one list + summary.
 * Mirrors server summarize(): skip TRANSFER_OUT from money totals.
 */

/**
 * @param {Array<{ sales?: Array, summary?: object }>} responses
 * @returns {{ sales: Array, summary: object }}
 */
export function mergeSalesResponses(responses) {
  const list = Array.isArray(responses) ? responses : [];
  const byId = new Map();
  for (const res of list) {
    for (const sale of res?.sales || []) {
      const id = sale?.id || sale?.saleTxHash || null;
      const key = id ? String(id) : JSON.stringify([sale?.cert, sale?.soldAt, sale?.soldBlock]);
      if (!byId.has(key)) byId.set(key, sale);
    }
  }
  const sales = [...byId.values()];
  sales.sort((a, b) => {
    const at = a.soldAt ? Date.parse(a.soldAt) : 0;
    const bt = b.soldAt ? Date.parse(b.soldAt) : 0;
    if (bt !== at) return bt - at;
    return (Number(b.soldBlock) || 0) - (Number(a.soldBlock) || 0);
  });
  return { sales, summary: summarizeSales(sales) };
}

/**
 * @param {Array<object>} sales
 */
export function summarizeSales(sales) {
  let totalSoldUsd = 0;
  let totalCostUsd = 0;
  let totalRealizedPnlUsd = 0;
  let count = 0;
  const list = Array.isArray(sales) ? sales : [];
  for (const s of list) {
    if (s?.saleType === 'TRANSFER_OUT') continue;
    count += 1;
    if (Number.isFinite(s.soldPriceUsd)) totalSoldUsd += s.soldPriceUsd;
    if (Number.isFinite(s.costBasisUsd)) totalCostUsd += s.costBasisUsd;
    if (Number.isFinite(s.realizedPnlUsd)) totalRealizedPnlUsd += s.realizedPnlUsd;
  }
  return {
    count,
    totalCount: list.length,
    totalSoldUsd,
    totalCostUsd,
    totalRealizedPnlUsd,
  };
}

/**
 * Wallets to query for sales: linked / non-demo item wallets + lastWallet.
 * @param {Array<object>} items
 * @param {string|null|undefined} defaultWallet
 * @param {string|null|undefined} lastWallet
 * @returns {string[]}
 */
export function collectSalesWallets(items, defaultWallet, lastWallet) {
  const demo = String(defaultWallet || '').toLowerCase();
  const set = new Set();
  for (const it of items || []) {
    const w = String(it?.wallet || '').toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(w) && w !== demo) set.add(w);
  }
  const last = String(lastWallet || '').toLowerCase();
  if (/^0x[0-9a-f]{40}$/.test(last) && last !== demo) set.add(last);
  return [...set];
}
