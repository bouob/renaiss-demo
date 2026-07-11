/**
 * In-memory 1h cache for the L1 wall payload (hackathonFeed/current concept).
 * No Firestore dependency for Version A — PLAN.md allows mem TTL as the cache.
 */

export const WALL_CACHE_TTL_MS = 60 * 60 * 1000; // 1h
export const ATTRIBUTION_URL = 'https://index.renaissos.com';
export const GAME = 'pokemon';

/** @type {{ payload: object, fetchedAtMs: number } | null} */
let memCache = null;

export function isFresh(entry, now = Date.now()) {
  return Boolean(entry && Number.isFinite(entry.fetchedAtMs)
    && (now - entry.fetchedAtMs) < WALL_CACHE_TTL_MS);
}

export function readWallCache() {
  if (!isFresh(memCache)) return null;
  return memCache.payload;
}

export function writeWallCache(payload) {
  memCache = { payload, fetchedAtMs: Date.now() };
  return payload;
}

export function __resetWallCacheForTest() {
  memCache = null;
}
