/**
 * Idempotent per-account demo portfolio seeding.
 *
 * Called from GET /meta, so a read endpoint writes. That is deliberate, not an
 * oversight — this server has no sign-in hook to move it to: Firebase auth runs
 * entirely client-side and requireAuth only verifies an ID token per request,
 * so there is no server-side "account created" moment. The alternative — a
 * POST /inventory/bootstrap the client calls after onAuthStateChanged — races
 * the inventory GET that the same auth transition triggers, trading a purity
 * concern for an empty-first-paint bug.
 *
 * The expansion/backfill path below has to stay lazy regardless: accounts that
 * already exist cannot be reached by any user-create trigger. So moving the
 * initial seed out would leave two seeding paths, not zero.
 *
 * Costs are bounded: an account already on the current version costs one parent
 * read and returns; expansion runs once per account per version and reads the
 * items collection once; the caller wraps this in a catch, so a seed failure
 * never blocks the read.
 *
 * Revisit if the server ever grows a real auth-exchange endpoint (the way
 * Dokipoki has POST /api/auth/privy) — then the initial seed belongs there and
 * only the expansion stays here.
 */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { COLLECTION, sanitizeItem } from '../lib/inventoryItem.js';
import { DEFAULT_PORTFOLIO_ITEMS } from './defaultPortfolioSeed.js';

// The first 18 cards were shipped in the original default portfolio. Cards
// after that boundary are a one-time expansion for accounts already seeded.
const DEFAULT_PORTFOLIO_INITIAL_COUNT = 18;
const DEFAULT_PORTFOLIO_PRIOR_VERSION_COUNT = 36;
const DEFAULT_PORTFOLIO_EXPANSION_VERSION = 5;

export function syntheticWallet(uid) {
  return `0x${createHash('sha256').update(String(uid)).digest('hex').slice(0, 40)}`;
}

export async function ensureDefaultPortfolio(uid, db = adminDb) {
  if (!db || !uid) return { wallet: null, seeded: false };
  const wallet = syntheticWallet(uid);
  const parentRef = db.collection(COLLECTION).doc(uid);
  const parentSnap = await parentRef.get();
  const parentData = parentSnap.exists ? (parentSnap.data() || {}) : {};
  const defaultWallet = parentData.defaultWallet || wallet;
  if (parentData.seededDefaultAt) {
    // Accounts seeded before version tracking have no field at all; `undefined`
    // compares false against BOTH < and >=, so normalize before either guard.
    const seededVersion = Number.isFinite(parentData.seededDefaultExpansionVersion)
      ? parentData.seededDefaultExpansionVersion
      : 0;
    if (seededVersion >= DEFAULT_PORTFOLIO_EXPANSION_VERSION) {
      return { wallet: defaultWallet, seeded: false };
    }
    const expansionStart = parentData.seededDefaultExpansionVersion == null
      ? (parentData.seededDefaultExpansionAt ? 30 : DEFAULT_PORTFOLIO_INITIAL_COUNT)
      : DEFAULT_PORTFOLIO_PRIOR_VERSION_COUNT;
    const expansionItems = DEFAULT_PORTFOLIO_ITEMS.slice(expansionStart);
    const now = new Date().toISOString();
    const batch = db.batch();
    const itemsCol = parentRef.collection('items');
    // One collection read instead of a sequential get() per seed card: this runs
    // inside GET /meta, and the seed list is ~50 cards.
    const existingSnap = await itemsCol.get();
    const existing = new Map(existingSnap.docs.map((d) => [d.id, d.data() || {}]));

    for (const item of expansionItems) {
      if (existing.has(item.cert)) continue; // never overwrite an existing token
      const patch = sanitizeItem({ ...item, wallet: defaultWallet }, item.cert);
      batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
    }
    // Backfill pricing onto rows the account already has. seededVersion is
    // guaranteed < EXPANSION_VERSION here (the early return above covers the rest).
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      const current = existing.get(item.cert);
      if (!current) continue; // preserve delete-safety for rows the user removed
      const pricing = {};
      if (current.cost == null && item.cost != null) pricing.cost = item.cost;
      if (current.listPrice == null && item.listPrice != null) pricing.listPrice = item.listPrice;
      if (current.alphaPct30d == null && item.alphaPct30d != null) pricing.alphaPct30d = item.alphaPct30d;
      if (Object.keys(pricing).length > 0) batch.set(itemsCol.doc(item.cert), pricing, { merge: true });
    }
    batch.set(parentRef, {
      seededDefaultExpansionAt: now,
      seededDefaultExpansionVersion: DEFAULT_PORTFOLIO_EXPANSION_VERSION,
    }, { merge: true });
    await batch.commit();
    return { wallet: defaultWallet, seeded: true };
  }
  const now = new Date().toISOString();
  const batch = db.batch();
  const itemsCol = parentRef.collection('items');
  for (const item of DEFAULT_PORTFOLIO_ITEMS) {
    const patch = sanitizeItem({ ...item, wallet }, item.cert);
    batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
  }
  batch.set(parentRef, {
    seededDefaultAt: now,
    seededDefaultExpansionAt: now,
    seededDefaultExpansionVersion: DEFAULT_PORTFOLIO_EXPANSION_VERSION,
    defaultWallet: wallet,
  }, { merge: true });
  await batch.commit();
  return { wallet, seeded: true };
}

/**
 * Re-insert any DEFAULT_PORTFOLIO_ITEMS certs missing from the account.
 * Used after unlinking a personal wallet so demo cards that were overwritten
 * by a colliding cert come back. Does not touch existing rows.
 *
 * @param {string} uid
 * @param {FirebaseFirestore.Firestore} [db]
 * @returns {Promise<{ wallet: string|null, restored: number }>}
 */
export async function restoreMissingDefaultItems(uid, db = adminDb) {
  if (!db || !uid) return { wallet: null, restored: 0 };
  const wallet = syntheticWallet(uid);
  const parentRef = db.collection(COLLECTION).doc(uid);
  const itemsCol = parentRef.collection('items');
  const existingSnap = await itemsCol.get();
  const existing = new Set(existingSnap.docs.map((d) => d.id));
  const now = new Date().toISOString();
  const batch = db.batch();
  let restored = 0;
  for (const item of DEFAULT_PORTFOLIO_ITEMS) {
    if (existing.has(item.cert)) continue;
    const patch = sanitizeItem({ ...item, wallet }, item.cert);
    batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
    restored += 1;
  }
  if (restored > 0) {
    batch.set(parentRef, {
      defaultWallet: wallet,
      seededDefaultAt: now,
      seededDefaultExpansionAt: now,
      seededDefaultExpansionVersion: DEFAULT_PORTFOLIO_EXPANSION_VERSION,
    }, { merge: true });
    await batch.commit();
  }
  return { wallet, restored };
}

/**
 * Drop every inventory row bound to `wallet` and restore any missing demo seed
 * certs in **one** Firestore batch so a mid-flight failure cannot leave the
 * account with personal rows deleted and demo certs unrestored.
 * Sales history is left intact (caller may clear client link only).
 *
 * @param {string} uid
 * @param {string} wallet
 * @param {FirebaseFirestore.Firestore} [db]
 * @returns {Promise<{ wallet: string|null, removed: number, restored: number }>}
 */
export async function unlinkWalletInventory(uid, wallet, db = adminDb) {
  if (!db || !uid) return { wallet: null, removed: 0, restored: 0 };
  const w = String(wallet || '').trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(w)) return { wallet: null, removed: 0, restored: 0 };

  const demoWallet = syntheticWallet(uid);
  const parentRef = db.collection(COLLECTION).doc(uid);

  // Server-side demo-wallet guard: unlinking the synthetic wallet would batch
  // delete-and-reseed every demo row (silently resetting hidden flags). The
  // client refuses too, but an older client or a direct POST must not get
  // through. Check the stored defaultWallet as well — a legacy account's
  // parent doc is the authority, not the client-supplied wallet.
  const parentSnap = await parentRef.get();
  const storedDemoWallet = String(
    (parentSnap.exists && parentSnap.data()?.defaultWallet) || '',
  ).toLowerCase();
  if (w === demoWallet || (storedDemoWallet && w === storedDemoWallet)) {
    return { wallet: null, removed: 0, restored: 0, rejected: 'demo_wallet' };
  }

  const itemsCol = parentRef.collection('items');
  const snap = await itemsCol.get();

  const batch = db.batch();
  let removed = 0;
  /** Certs that will still exist after deletes (non-linked rows). */
  const remaining = new Set();

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const rowW = typeof data.wallet === 'string' ? data.wallet.toLowerCase() : '';
    if (rowW === w) {
      batch.delete(doc.ref);
      removed += 1;
    } else {
      remaining.add(doc.id);
    }
  }

  let restored = 0;
  const now = new Date().toISOString();
  for (const item of DEFAULT_PORTFOLIO_ITEMS) {
    if (remaining.has(item.cert)) continue;
    const patch = sanitizeItem({ ...item, wallet: demoWallet }, item.cert);
    batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
    remaining.add(item.cert);
    restored += 1;
  }

  if (restored > 0) {
    batch.set(parentRef, {
      defaultWallet: demoWallet,
      seededDefaultAt: now,
      seededDefaultExpansionAt: now,
      seededDefaultExpansionVersion: DEFAULT_PORTFOLIO_EXPANSION_VERSION,
    }, { merge: true });
  }

  if (removed > 0 || restored > 0) await batch.commit();
  return { wallet: w, removed, restored };
}

/**
 * Flip the `hidden` flag on every inventory row tagged with the account's
 * synthetic demo wallet. Rows are kept, not deleted, so hiding is non-destructive
 * and reversible (unlike the old clearDemoInventory hard-delete).
 *
 * Absent field means visible; we write `hidden: false` on restore rather than
 * FieldValue.delete() because the test fake-db does a shallow merge and would not
 * honour the delete sentinel — a plain boolean round-trips faithfully. Parent seed
 * markers are left untouched (the seeder never overwrites an existing cert, so a
 * hidden row is never un-hidden by re-seeding). Personal / manual rows and sales
 * history are left untouched.
 *
 * @param {string} uid
 * @param {boolean} hidden
 * @param {FirebaseFirestore.Firestore} [db]
 * @returns {Promise<{ wallet: string|null, changed: number }>}
 */
async function setDemoHidden(uid, hidden, db = adminDb) {
  if (!db || !uid) return { wallet: null, changed: 0 };
  const demoWallet = syntheticWallet(uid);
  const itemsCol = db.collection(COLLECTION).doc(uid).collection('items');
  const snap = await itemsCol.get();

  const batch = db.batch();
  let changed = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const rowW = typeof data.wallet === 'string' ? data.wallet.toLowerCase() : '';
    if (rowW !== demoWallet) continue;
    if ((data.hidden === true) === hidden) continue; // already in the target state
    batch.set(doc.ref, { hidden }, { merge: true });
    changed += 1;
  }

  if (changed > 0) await batch.commit();
  return { wallet: demoWallet, changed };
}

/**
 * Hide every demo row. `changed` is the number of rows newly hidden (0 if all
 * were already hidden). The bare `hidden` key is reserved for the per-item
 * boolean on `/meta/:cert/visibility`, so bulk ops report a neutral count.
 * @returns {Promise<{ wallet: string|null, changed: number }>}
 */
export async function hideDemoInventory(uid, db = adminDb) {
  return setDemoHidden(uid, true, db);
}

/**
 * Restore (un-hide) every demo row. `changed` is the number of rows newly shown.
 * @returns {Promise<{ wallet: string|null, changed: number }>}
 */
export async function showDemoInventory(uid, db = adminDb) {
  return setDemoHidden(uid, false, db);
}
