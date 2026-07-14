/**
 * relatedCache.js — per-session memo of GET /related/:cert responses.
 *
 * The server already caches adjacent-cert results (6h) and marketplace lookups
 * (24h), so this layer is not about upstream quota — it is about not paying an
 * HTTP round trip + Cloud Function invocation every time a merchant reopens a
 * card they already looked at. Reopening within the TTL renders the neighbors
 * immediately, with no "load" click.
 *
 * Only *successful* results are stored. Caching a failure would defeat the
 * Retry button: it would keep replaying the same failure until the TTL expired,
 * even after upstream recovered — the same both-success rule the service itself
 * follows (server/services/renaissAdjacentCertService.js).
 *
 * In-memory and per-tab: a reload starts empty. That is the intended blast
 * radius for a 10-minute memo.
 */

export const RELATED_CACHE_TTL_MS = 10 * 60 * 1000;
export const MAX_RELATED_CACHE = 200;

/** @type {Map<string, { data: object, at: number }>} */
const cache = new Map();
let maxEntries = MAX_RELATED_CACHE;

/**
 * @param {string} cert
 * @returns {object|null} the cached payload, or null on a miss / expiry.
 */
export function getCachedRelated(cert) {
  const key = normalizeKey(cert);
  if (!key) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= RELATED_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

/**
 * Stores a successful lookup. A gated / errored / degraded payload is silently
 * ignored — the caller does not need to branch.
 * @param {string} cert
 * @param {object|null} data - the GET /related/:cert payload
 */
export function setCachedRelated(cert, data) {
  const key = normalizeKey(cert);
  if (!key || !isCacheable(data)) return;
  if (!cache.has(key)) {
    while (cache.size >= maxEntries) {
      cache.delete(cache.keys().next().value); // oldest inserted
    }
  }
  cache.set(key, { data, at: Date.now() });
}

export function clearRelatedCache() {
  cache.clear();
  maxEntries = MAX_RELATED_CACHE;
}

function isCacheable(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.gated || data.reason) return false;
  if (data.marketplaceDegraded) return false;
  return Array.isArray(data.neighbors);
}

function normalizeKey(cert) {
  const s = typeof cert === 'string' ? cert.trim().toUpperCase() : '';
  return s || null;
}

/** Test-only: shrink the cap so eviction is exercisable without 200 inserts. */
export function __setMaxEntriesForTest(n) {
  maxEntries = n;
}

/** Test-only. */
export function __cacheSizeForTest() {
  return cache.size;
}
