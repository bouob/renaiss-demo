/**
 * Firestore cache for the daily market insight feed.
 * Collection: hackathonGeminiMarketInsight/days/{yyyy-mm-dd}
 */

import { adminDb } from './firebaseAdmin.js';

const CACHE_COLLECTION = 'hackathonGeminiMarketInsight';

export const SOFT_TTL_MS = 24 * 60 * 60 * 1000;
export const HARD_TTL_MS = 72 * 60 * 60 * 1000;

function dayRef(day) {
  return adminDb.collection(CACHE_COLLECTION).doc('days').collection('entries').doc(day);
}

export function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

export async function readMarketInsightCache(day = utcDay()) {
  if (!adminDb) return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  const snap = await dayRef(day).get();
  if (!snap.exists) return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  const data = snap.data() || {};
  const generatedAtMs = Number(data.generatedAtMs);
  if (!Number.isFinite(generatedAtMs) || !data.content) {
    return { hit: null, content: null, ageMs: null, generatedAtMs: null };
  }
  const ageMs = Date.now() - generatedAtMs;
  if (ageMs <= SOFT_TTL_MS) return { hit: 'fresh', content: data.content, ageMs, generatedAtMs };
  if (ageMs <= HARD_TTL_MS) return { hit: 'stale', content: data.content, ageMs, generatedAtMs };
  return { hit: null, content: null, ageMs, generatedAtMs };
}

export async function writeMarketInsightCache(day, content, meta = {}) {
  if (!adminDb) return;
  const now = Date.now();
  await dayRef(day).set({
    day,
    content,
    generatedAtMs: now,
    schemaVersion: 1,
    summary: meta.summary ?? null,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}
