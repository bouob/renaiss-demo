/** Idempotent per-account demo portfolio seeding. */
import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { COLLECTION, sanitizeItem } from '../lib/inventoryItem.js';
import { DEFAULT_PORTFOLIO_ITEMS } from './defaultPortfolioSeed.js';

export function syntheticWallet(uid) {
  return `0x${createHash('sha256').update(String(uid)).digest('hex').slice(0, 40)}`;
}

export async function ensureDefaultPortfolio(uid, db = adminDb) {
  if (!db || !uid) return { wallet: null, seeded: false };
  const wallet = syntheticWallet(uid);
  const parentRef = db.collection(COLLECTION).doc(uid);
  const parentSnap = await parentRef.get();
  const parentData = parentSnap.exists ? (parentSnap.data() || {}) : {};
  if (parentData.seededDefaultAt) {
    return { wallet: parentData.defaultWallet || wallet, seeded: false };
  }
  const now = new Date().toISOString();
  const batch = db.batch();
  const itemsCol = parentRef.collection('items');
  for (const item of DEFAULT_PORTFOLIO_ITEMS) {
    const patch = sanitizeItem({ ...item, wallet }, item.cert);
    batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
  }
  batch.set(parentRef, { seededDefaultAt: now, defaultWallet: wallet }, { merge: true });
  await batch.commit();
  return { wallet, seeded: true };
}
