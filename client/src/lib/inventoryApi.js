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

export function fetchMeta({ authToken } = {}) {
  return getJson('/meta', { authToken });
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
