/**
 * Firestore cache + daily generate quota for merchant AI.
 * Collection: hackathonGeminiMerchantCache/{uid}/entries/{cert}
 * Usage:      hackathonGeminiMerchantUsage/{uid}/days/{yyyy-mm-dd}
 */

import { adminDb } from './firebaseAdmin.js';

const CACHE_COLLECTION = 'hackathonGeminiMerchantCache';
const USAGE_COLLECTION = 'hackathonGeminiMerchantUsage';

export const SOFT_TTL_MS = 24 * 60 * 60 * 1000;
export const HARD_TTL_MS = 72 * 60 * 60 * 1000;
export const DAILY_GENERATE_LIMIT = Number(process.env.MERCHANT_AI_DAILY_LIMIT || 15);

function entryRef(uid, cert) {
  return adminDb
    .collection(CACHE_COLLECTION)
    .doc(uid)
    .collection('entries')
    .doc(String(cert));
}

function usageRef(uid, day) {
  return adminDb.collection(USAGE_COLLECTION).doc(uid).collection('days').doc(day);
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * @returns {{ hit: 'fresh'|'stale'|null, content: object|null, ageMs: number|null, generatedAtMs: number|null }}
 */
export async function readMerchantCache(uid, cert) {
  if (!adminDb) return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  const snap = await entryRef(uid, cert).get();
  if (!snap.exists) return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  const data = snap.data() || {};
  const generatedAtMs = Number(data.generatedAtMs);
  if (!Number.isFinite(generatedAtMs) || !data.content) {
    return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  }
  const ageMs = Date.now() - generatedAtMs;
  if (ageMs <= SOFT_TTL_MS) {
    return { hit: 'fresh', content: data.content, ageMs, generatedAtMs };
  }
  if (ageMs <= HARD_TTL_MS) {
    return { hit: 'stale', content: data.content, ageMs, generatedAtMs };
  }
  return { hit: null, content: null, ageMs, generatedAtMs };
}

export async function writeMerchantCache(uid, cert, content, meta = {}) {
  if (!adminDb) return;
  const now = Date.now();
  await entryRef(uid, cert).set({
    cert: String(cert),
    content,
    generatedAtMs: now,
    schemaVersion: 1,
    decision: meta.decision ?? null,
    localePreferred: meta.locale ?? null,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}

/**
 * @returns {{ allowed: boolean, count: number, limit: number, day: string }}
 */
export async function checkAndIncrementUsage(uid) {
  if (!adminDb) {
    return { allowed: false, count: 0, limit: DAILY_GENERATE_LIMIT, day: utcDay() };
  }
  const day = utcDay();
  const ref = usageRef(uid, day);
  const snap = await ref.get();
  const count = Number(snap.exists ? snap.data()?.count : 0) || 0;
  if (count >= DAILY_GENERATE_LIMIT) {
    return { allowed: false, count, limit: DAILY_GENERATE_LIMIT, day };
  }
  await ref.set({
    count: count + 1,
    limit: DAILY_GENERATE_LIMIT,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { allowed: true, count: count + 1, limit: DAILY_GENERATE_LIMIT, day };
}

export async function peekUsage(uid) {
  if (!adminDb) return { count: 0, limit: DAILY_GENERATE_LIMIT, day: utcDay() };
  const day = utcDay();
  const snap = await usageRef(uid, day).get();
  const count = Number(snap.exists ? snap.data()?.count : 0) || 0;
  return { count, limit: DAILY_GENERATE_LIMIT, day };
}
