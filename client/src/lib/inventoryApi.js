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
