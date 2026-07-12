/**
 * Firestore cache for the Renaiss OS card FMV series endpoint.
 * Collection: hackathonCardFmvSeriesCache/{slug-and-window}
 *
 * This is intentionally fail-open: a Firestore outage must not prevent the
 * adapter from trying the upstream source.
 */

import { adminDb } from './firebaseAdmin.js';

const CACHE_COLLECTION = 'hackathonCardFmvSeriesCache';
export const CARD_FMV_SERIES_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

function entryRef(slug, window) {
  // Firestore document IDs cannot contain `/`; encode the complete request
  // identity so different windows never share a cached series.
  const key = encodeURIComponent(`${slug}:${window}`);
  return adminDb.collection(CACHE_COLLECTION).doc(key);
}

/**
 * @returns {Promise<Array<{t: string, usdCents: number}>|null>} cached series,
 * or null on a miss/unavailable cache.
 */
export async function readCardFmvSeriesCache(slug, window) {
  if (!adminDb) return null;
  try {
    const snap = await entryRef(slug, window).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const cachedAtMs = Number(data.cachedAtMs);
    if (!Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > CARD_FMV_SERIES_CACHE_TTL_MS) {
      return null;
    }
    return Array.isArray(data.points) ? data.points : null;
  } catch (err) {
    console.warn(`[cardFmvSeriesCache] read failed: ${err?.message ?? err}`);
    return null;
  }
}

export async function writeCardFmvSeriesCache(slug, window, points) {
  if (!adminDb || !Array.isArray(points)) return;
  try {
    await entryRef(slug, window).set({
      slug,
      window,
      points,
      cachedAtMs: Date.now(),
      schemaVersion: 1,
    }, { merge: true });
  } catch (err) {
    // Cache persistence is best effort; the caller already has usable data.
    console.warn(`[cardFmvSeriesCache] write failed: ${err?.message ?? err}`);
  }
}
