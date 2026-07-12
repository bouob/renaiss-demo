/** Idempotent per-account demo portfolio seeding. */
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
