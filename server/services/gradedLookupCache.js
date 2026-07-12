/**
 * Firestore cache for the Renaiss OS graded-lookup endpoint (GET /v1/graded/{cert}).
 * Collection: hackathonGradedLookupCache/{cert}
 *
 * Stores the raw upstream payload so getGradedFmv and getGradedCardBrief can
 * share one cached response and each apply their own mapping. Successful
 * `found:false` payloads are cached too, so a cert the index does not have is
 * not re-fetched for the TTL window; `null` (adapter failure) is never cached.
 *
 * Fail-open: a Firestore outage must not prevent the adapter from trying the
 * upstream source. `db` defaults to the shared adminDb but is injectable for
 * tests.
 */

import { adminDb } from './firebaseAdmin.js';

const CACHE_COLLECTION = 'hackathonGradedLookupCache';
export const GRADED_LOOKUP_CACHE_TTL_MS = 8 * 60 * 60 * 1000;

function entryRef(db, cert) {
  // Cert is caller-validated against CERT_SHAPE (letters + digits, no `/`), so
  // it is a safe Firestore document ID as-is.
  return db.collection(CACHE_COLLECTION).doc(cert);
}

/**
 * @returns {Promise<object|null>} the cached raw upstream payload, or null on a
 * miss / expired entry / unavailable cache.
 */
export async function readGradedLookupCache(cert, db = adminDb) {
  if (!db) return null;
  try {
    const snap = await entryRef(db, cert).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    const cachedAtMs = Number(data.cachedAtMs);
    if (!Number.isFinite(cachedAtMs) || Date.now() - cachedAtMs > GRADED_LOOKUP_CACHE_TTL_MS) {
      return null;
    }
    return data.payload ?? null;
  } catch (err) {
    console.warn(`[gradedLookupCache] read failed: ${err?.message ?? err}`);
    return null;
  }
}

export async function writeGradedLookupCache(cert, payload, db = adminDb) {
  if (!db || !payload || typeof payload !== 'object') return;
  try {
    await entryRef(db, cert).set({
      cert,
      payload,
      cachedAtMs: Date.now(),
      schemaVersion: 1,
    }, { merge: true });
  } catch (err) {
    // Cache persistence is best effort; the caller already has usable data.
    console.warn(`[gradedLookupCache] write failed: ${err?.message ?? err}`);
  }
}
