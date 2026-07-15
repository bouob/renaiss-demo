import { getJson, postJson, putJson } from './httpClient.js';

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

/**
 * Tear down an anonymous demo account after upgrading to Google. Sends the
 * demo account's `anonToken` in the body and the new Google user's token in
 * the Authorization header (via `authToken`).
 */
export function discardDemoAccount(anonToken, { authToken } = {}) {
  return postJson('/meta/discard-demo', { anonToken }, { authToken, timeoutMs: 60_000 });
}

/** Hide or restore a single holding the user owns (demo or personal). */
export function setMetaVisibility(cert, hidden, { authToken } = {}) {
  return postJson(`/meta/${encodeURIComponent(cert)}/visibility`, { hidden }, { authToken });
}

/** Hide every seeded demo row for the account (reversible). */
export function hideDemoInventory({ authToken } = {}) {
  return postJson('/meta/hide-demo', {}, { authToken, timeoutMs: 60_000 });
}

/** Restore (un-hide) every seeded demo row for the account. */
export function showDemoInventory({ authToken } = {}) {
  return postJson('/meta/show-demo', {}, { authToken, timeoutMs: 60_000 });
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
