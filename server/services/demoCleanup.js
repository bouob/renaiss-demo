/**
 * Discard all uid-scoped data for an abandoned anonymous demo account.
 *
 * Called from POST /meta/discard-demo after a demo visitor upgrades to a real
 * Google account. Nothing is migrated — the demo account is disposable, so we
 * wipe every collection keyed by its uid to avoid orphaned Firestore records.
 *
 * Idempotent and retry-safe: deleting a missing document is a no-op, so a
 * partial failure can simply be re-run with the same anon uid.
 */
import { adminDb } from './firebaseAdmin.js';

// Every collection scoped by `{collection}/{uid}`. Keep this in sync when a new
// uid-keyed collection is added, or that data will leak on demo teardown.
export const DEMO_UID_COLLECTIONS = [
  'hackathonMerchantInventory', // /{uid}/items/{cert}
  'hackathonMerchantSales', // /{uid}/wallets/{wallet}/items/{saleId}
  'hackathonGeminiMerchantCache', // /{uid}/entries/{cert}
  'hackathonGeminiMerchantUsage', // /{uid}/days/{yyyy-mm-dd}
];

// Firestore caps a batched write at 500 ops; stay comfortably under it.
const BATCH_LIMIT = 450;

/**
 * Depth-first collect a document ref and every descendant (children before
 * parents, so deletes never strand a subcollection). Uses listCollections/
 * listDocuments so intermediate docs that exist only as subcollection parents
 * (e.g. the sales `wallets/{wallet}` node) are still traversed.
 */
async function collectDocDeep(docRef, out) {
  const subcols = await docRef.listCollections();
  for (const col of subcols) {
    const docs = await col.listDocuments();
    for (const child of docs) {
      await collectDocDeep(child, out);
    }
  }
  out.push(docRef);
}

/**
 * Decide whether a decoded anon token may discard-and-delete its account.
 * Only an anonymous session qualifies, and never the caller's own (real) uid.
 * @returns {{ ok: boolean, status: number, error: string|null, anonUid?: string }}
 */
export function checkDiscardEligibility(decoded, callerUid) {
  if (decoded?.firebase?.sign_in_provider !== 'anonymous') {
    return { ok: false, status: 403, error: 'not_anonymous' };
  }
  const anonUid = decoded?.uid;
  if (!anonUid || anonUid === callerUid) {
    return { ok: false, status: 400, error: 'invalid_anon_uid' };
  }
  return { ok: true, status: 200, error: null, anonUid };
}

/**
 * Delete every uid-scoped record for `uid`, batched under the 500-op limit.
 * @returns {Promise<{ deleted: number }>} number of documents deleted.
 */
export async function discardDemoData(uid, { db = adminDb, batchLimit = BATCH_LIMIT } = {}) {
  if (!db || !uid) return { deleted: 0 };

  const refs = [];
  for (const name of DEMO_UID_COLLECTIONS) {
    await collectDocDeep(db.collection(name).doc(uid), refs);
  }

  let deleted = 0;
  for (let i = 0; i < refs.length; i += batchLimit) {
    const chunk = refs.slice(i, i + batchLimit);
    const batch = db.batch();
    for (const ref of chunk) batch.delete(ref);
    await batch.commit();
    deleted += chunk.length;
  }
  return { deleted };
}
