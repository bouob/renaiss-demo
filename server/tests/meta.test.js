import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { COLLECTION } from '../lib/inventoryItem.js';
import {
  isHeldCertAllowed,
  __resetHeldCertGateForTest,
} from '../services/heldCertGate.js';
import { __setAdminForTest } from '../services/firebaseAdmin.js';

const metaRouter = (await import('../routes/meta.js')).default;

const CERT = 'PSA41932666';

/**
 * Minimal fake Firestore covering only the paths the visibility route touches:
 * collection().doc().collection().doc().get()/set(). Keyed by full path string;
 * set(merge:true) shallow-merges, matching Firestore semantics for flat fields.
 */
function makeFakeFirestore() {
  const store = new Map();
  const docRef = (path) => ({
    path,
    async get() {
      return { exists: store.has(path), data: () => store.get(path) };
    },
    async set(data, opts = {}) {
      const base = opts.merge ? (store.get(path) || {}) : {};
      store.set(path, { ...base, ...data });
    },
    collection: (name) => colRef(`${path}/${name}`),
  });
  const colRef = (path) => ({ doc: (id) => docRef(`${path}/${id}`) });
  return { store, db: { collection: (name) => colRef(name) } };
}

/** verifyIdToken echoes the bearer token as the uid, so `Bearer alice` → uid alice. */
const fakeAuth = { async verifyIdToken(token) { return { uid: token }; } };

const itemPath = (uid, cert) => `${COLLECTION}/${uid}/items/${cert}`;

let fake;

async function post(path, { uid, body } = {}) {
  const app = express();
  app.use(express.json());
  app.use(metaRouter);
  const server = app.listen(0);
  const { port } = server.address();
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Authorization = `Bearer ${uid}`;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

describe('POST /meta/:cert/visibility', () => {
  beforeEach(() => {
    fake = makeFakeFirestore();
    __setAdminForTest({ db: fake.db, auth: fakeAuth });
    __resetHeldCertGateForTest();
  });
  afterEach(() => {
    __setAdminForTest({ db: null, auth: null });
    __resetHeldCertGateForTest();
  });

  it('hides an owned card, persists hidden:true, and keeps the /related quota (rememberHeldCert)', async () => {
    fake.store.set(itemPath('alice', CERT), { cert: CERT, wallet: '0xabc', status: 'active' });

    const { status, body } = await post(`/meta/${CERT}/visibility`, { uid: 'alice', body: { hidden: true } });

    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, cert: CERT, hidden: true });
    assert.equal(fake.store.get(itemPath('alice', CERT)).hidden, true);
    // Inverse of the old DELETE→forgetHeldCert wiring: a hidden card is still
    // owned, so it must stay on the held-cert allowlist.
    assert.equal(isHeldCertAllowed(CERT), true);
  });

  it('restores a hidden card (hidden:false)', async () => {
    fake.store.set(itemPath('alice', CERT), { cert: CERT, wallet: '0xabc', hidden: true });

    const { status, body } = await post(`/meta/${CERT}/visibility`, { uid: 'alice', body: { hidden: false } });

    assert.equal(status, 200);
    assert.equal(body.hidden, false);
    assert.equal(fake.store.get(itemPath('alice', CERT)).hidden, false);
  });

  it('returns 404 for a cert the user does not own, and does NOT remember it', async () => {
    const { status, body } = await post(`/meta/${CERT}/visibility`, { uid: 'alice', body: { hidden: true } });

    assert.equal(status, 404);
    assert.equal(body.error, 'not_found');
    assert.equal(isHeldCertAllowed(CERT), false);
  });

  it('is uid-scoped: user B cannot hide user A\'s row', async () => {
    fake.store.set(itemPath('alice', CERT), { cert: CERT, wallet: '0xabc' });

    const { status } = await post(`/meta/${CERT}/visibility`, { uid: 'bob', body: { hidden: true } });

    assert.equal(status, 404); // bob's own subcollection has no such cert
    assert.equal(fake.store.get(itemPath('alice', CERT)).hidden, undefined);
  });

  it('coerces a non-boolean hidden to false (strict === true)', async () => {
    fake.store.set(itemPath('alice', CERT), { cert: CERT, wallet: '0xabc' });

    const { status, body } = await post(`/meta/${CERT}/visibility`, { uid: 'alice', body: { hidden: 'yes' } });

    assert.equal(status, 200);
    assert.equal(body.hidden, false);
    assert.equal(fake.store.get(itemPath('alice', CERT)).hidden, false);
  });

  it('rejects a malformed cert with 400', async () => {
    const { status, body } = await post('/meta/ab/visibility', { uid: 'alice', body: { hidden: true } });
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_cert');
  });

  it('requires auth (401 without a token)', async () => {
    const { status } = await post(`/meta/${CERT}/visibility`, { body: { hidden: true } });
    assert.equal(status, 401);
  });
});
