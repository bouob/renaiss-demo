import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  discardDemoData,
  checkDiscardEligibility,
  DEMO_UID_COLLECTIONS,
} from '../services/demoCleanup.js';

/**
 * In-memory Firestore stand-in keyed by full document path. Supports the
 * traversal APIs discardDemoData relies on — listCollections (on a doc),
 * listDocuments (on a collection), and batched deletes — including
 * intermediate docs that exist only as subcollection parents.
 */
function makeFakeDb(paths = []) {
  const store = new Map(paths.map((p) => [p, {}]));
  const batches = []; // committed batch sizes, for the 500-limit assertion
  const segs = (p) => p.split('/');

  // distinct segment at `depth` among stored paths that live under `prefix`
  function childrenAt(prefix, depth) {
    const out = new Set();
    for (const key of store.keys()) {
      if (!key.startsWith(`${prefix}/`)) continue;
      const ks = segs(key);
      if (ks.length > depth) out.add(ks[depth]);
    }
    return [...out];
  }

  function makeDocRef(path) {
    return {
      path,
      collection(name) { return makeColRef(`${path}/${name}`); },
      async listCollections() {
        return childrenAt(path, segs(path).length).map((n) => makeColRef(`${path}/${n}`));
      },
    };
  }

  function makeColRef(path) {
    return {
      path,
      doc(id) { return makeDocRef(`${path}/${id}`); },
      async listDocuments() {
        return childrenAt(path, segs(path).length).map((id) => makeDocRef(`${path}/${id}`));
      },
    };
  }

  return {
    _store: store,
    _batches: batches,
    collection(name) { return makeColRef(name); },
    batch() {
      const ops = [];
      return {
        delete(ref) { ops.push(ref.path); return this; },
        async commit() {
          batches.push(ops.length);
          for (const p of ops) store.delete(p);
        },
      };
    },
  };
}

const INV = 'hackathonMerchantInventory';
const SALES = 'hackathonMerchantSales';
const CACHE = 'hackathonGeminiMerchantCache';
const USAGE = 'hackathonGeminiMerchantUsage';

describe('discardDemoData', () => {
  it('deletes every uid-scoped record across all collections, incl. nested sales', async () => {
    const db = makeFakeDb([
      `${INV}/anon1`, // parent doc with seed markers
      `${INV}/anon1/items/certA`,
      `${INV}/anon1/items/certB`,
      `${SALES}/anon1/wallets/0xwallet/items/sale1`, // wallets doc never written directly
      `${CACHE}/anon1/entries/certA`,
      `${USAGE}/anon1/days/2026-07-15`,
    ]);

    const { deleted } = await discardDemoData('anon1', { db });

    assert.ok(deleted >= 6);
    for (const key of db._store.keys()) {
      assert.ok(!key.includes('anon1'), `leftover: ${key}`);
    }
  });

  it('leaves a different account untouched', async () => {
    const db = makeFakeDb([
      `${INV}/anon1/items/certA`,
      `${INV}/real2/items/certA`,
      `${SALES}/real2/wallets/0xw/items/s1`,
    ]);

    await discardDemoData('anon1', { db });

    assert.equal(db._store.has(`${INV}/real2/items/certA`), true);
    assert.equal(db._store.has(`${SALES}/real2/wallets/0xw/items/s1`), true);
    assert.equal(db._store.has(`${INV}/anon1/items/certA`), false);
  });

  it('keeps every batch under the Firestore 500-op limit', async () => {
    const paths = [];
    for (let i = 0; i < 600; i += 1) paths.push(`${INV}/anon1/items/cert${i}`);
    const db = makeFakeDb(paths);

    await discardDemoData('anon1', { db, batchLimit: 450 });

    assert.ok(db._batches.length >= 2, 'should split into multiple batches');
    for (const size of db._batches) assert.ok(size <= 500, `batch of ${size} exceeds limit`);
  });

  it('is idempotent / retry-safe (second run does not throw or touch other data)', async () => {
    const db = makeFakeDb([`${INV}/anon1/items/certA`, `${INV}/real2/items/certA`]);
    await discardDemoData('anon1', { db });
    await assert.doesNotReject(discardDemoData('anon1', { db }));
    assert.equal(db._store.has(`${INV}/real2/items/certA`), true);
  });

  it('no-ops without a db or uid', async () => {
    assert.deepEqual(await discardDemoData('anon1', { db: null }), { deleted: 0 });
    assert.deepEqual(await discardDemoData('', { db: makeFakeDb() }), { deleted: 0 });
  });

  it('covers exactly the known uid-scoped collections', () => {
    assert.deepEqual(DEMO_UID_COLLECTIONS, [INV, SALES, CACHE, USAGE]);
  });
});

describe('checkDiscardEligibility', () => {
  const anon = { uid: 'anon1', firebase: { sign_in_provider: 'anonymous' } };

  it('accepts an anonymous token whose uid differs from the caller', () => {
    assert.deepEqual(
      checkDiscardEligibility(anon, 'real2'),
      { ok: true, status: 200, error: null, anonUid: 'anon1' },
    );
  });

  it('rejects a non-anonymous token with 403 not_anonymous', () => {
    const google = { uid: 'g1', firebase: { sign_in_provider: 'google.com' } };
    const r = checkDiscardEligibility(google, 'real2');
    assert.equal(r.ok, false);
    assert.equal(r.status, 403);
    assert.equal(r.error, 'not_anonymous');
  });

  it('rejects discarding the caller\'s own uid with 400', () => {
    const r = checkDiscardEligibility(anon, 'anon1');
    assert.equal(r.ok, false);
    assert.equal(r.status, 400);
    assert.equal(r.error, 'invalid_anon_uid');
  });
});
