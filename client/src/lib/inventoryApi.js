import { getJson, postJson, putJson, delJson } from './httpClient.js';

export function fetchCard(cert, { series = false, authToken } = {}) {
  const q = series ? '?series=1' : '';
  return getJson(`/card/${encodeURIComponent(cert)}${q}`, { authToken });
}

export function scanWallet(address, { authToken } = {}) {
  return postJson('/scan', { address }, { authToken, timeoutMs: 120_000 });
}

export function fetchRelated(cert, { authToken } = {}) {
  return getJson(`/related/${encodeURIComponent(cert)}`, { authToken });
}

/** Wallet-scoped inventory rows. Without wallet, server returns []. */
export function fetchMeta({ authToken, wallet } = {}) {
  const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
  return getJson(`/meta${q}`, { authToken });
}

export function putMeta(item, { authToken } = {}) {
  return putJson('/meta', item, { authToken });
}

export function bulkMeta(items, { authToken } = {}) {
  return postJson('/meta/bulk', { items }, { authToken });
}

/** Remove personal holdings for wallet and restore overwritten demo seed certs. */
export function unlinkWallet(wallet, { authToken } = {}) {
  return postJson('/meta/unlink-wallet', { wallet }, { authToken, timeoutMs: 60_000 });
}

/** Delete a single holding the user owns (demo or personal). */
export function deleteMeta(cert, { authToken } = {}) {
  return delJson(`/meta/${encodeURIComponent(cert)}`, { authToken });
}

/** Delete every seeded demo row for the account. */
export function clearDemoInventory({ authToken } = {}) {
  return postJson('/meta/clear-demo', {}, { authToken, timeoutMs: 60_000 });
}

export function fetchTicker(options = {}) {
  return getJson('/ticker', options);
}

/**
 * Gemini merchant verdict for a held cert (lazy, auth required).
 * @param {object} body
 * @param {{ authToken: string }} options
 */
export function analyzeMerchantInsight(body, { authToken } = {}) {
  return postJson('/insight/merchant', body, { authToken, timeoutMs: 60_000 });
}

export function fetchMerchantInsightUsage({ authToken } = {}) {
  return getJson('/insight/merchant-usage', { authToken });
}

export function fetchSales({ authToken, wallet } = {}) {
  const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
  return getJson(`/sales${q}`, { authToken });
}

export function bulkSales(sales, wallet, { authToken } = {}) {
  return postJson('/sales/bulk', { sales, wallet }, { authToken, timeoutMs: 60_000 });
}
