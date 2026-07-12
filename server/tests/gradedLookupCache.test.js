import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readGradedLookupCache,
  writeGradedLookupCache,
  GRADED_LOOKUP_CACHE_TTL_MS,
} from '../services/gradedLookupCache.js';

// Minimal Firestore doc/collection fake — one flat store keyed by doc path.
function makeFakeDb() {
  const store = new Map();
  const docRef = (path) => ({
    path,
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    async set(data, opts) {
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
    },
  });
  return {
    _store: store,
    collection(name) { return { doc(id) { return docRef(`${name}/${id}`); } }; },
  };
}

describe('gradedLookupCache', () => {
  it('round-trips a written payload', async () => {
    const db = makeFakeDb();
    const payload = { found: true, card: { priceUsdCents: 1234 } };
    await writeGradedLookupCache('PSA126', payload, db);
    assert.deepEqual(await readGradedLookupCache('PSA126', db), payload);
  });

  it('caches a found:false payload', async () => {
    const db = makeFakeDb();
    const payload = { found: false, reason: 'not_in_index' };
    await writeGradedLookupCache('PSA999', payload, db);
    assert.deepEqual(await readGradedLookupCache('PSA999', db), payload);
  });

  it('returns null on a miss', async () => {
    const db = makeFakeDb();
    assert.equal(await readGradedLookupCache('PSA000', db), null);
  });

  it('returns null for an entry older than the TTL', async () => {
    const db = makeFakeDb();
    await writeGradedLookupCache('PSA126', { found: true }, db);
    // Backdate the stored entry beyond the TTL window.
    const key = 'hackathonGradedLookupCache/PSA126';
    db._store.set(key, {
      ...db._store.get(key),
      cachedAtMs: Date.now() - GRADED_LOOKUP_CACHE_TTL_MS - 1,
    });
    assert.equal(await readGradedLookupCache('PSA126', db), null);
  });

  it('fails open (returns null) when the db is unavailable', async () => {
    assert.equal(await readGradedLookupCache('PSA126', null), null);
  });

  it('fails open (returns null) when a read throws', async () => {
    const db = { collection() { throw new Error('firestore down'); } };
    assert.equal(await readGradedLookupCache('PSA126', db), null);
  });

  it('does not throw when a write fails', async () => {
    const db = { collection() { throw new Error('firestore down'); } };
    await writeGradedLookupCache('PSA126', { found: true }, db); // must not reject
  });

  it('does not persist a non-object payload', async () => {
    const db = makeFakeDb();
    await writeGradedLookupCache('PSA126', null, db);
    assert.equal(db._store.size, 0);
  });
});
