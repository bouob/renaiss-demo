import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticWallet, ensureDefaultPortfolio } from '../services/defaultPortfolio.js';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';

function makeFakeDb() {
  const store = new Map();
  const makeDocRef = (path) => ({
    path,
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    collection(name) { return makeCollectionRef(`${path}/${name}`); },
  });
  const makeCollectionRef = (path) => ({ doc(id) { return makeDocRef(`${path}/${id}`); } });
  return {
    _store: store,
    collection(name) { return makeCollectionRef(name); },
    batch() {
      const ops = [];
      return { set(ref, data) { ops.push([ref.path, data]); return this; }, async commit() { for (const [path, data] of ops) store.set(path, { ...(store.get(path) || {}), ...data }); } };
    },
  };
}

describe('syntheticWallet', () => {
  it('is deterministic and address-shaped', () => {
    assert.match(syntheticWallet('user-abc'), /^0x[0-9a-f]{40}$/);
    assert.equal(syntheticWallet('user-abc'), syntheticWallet('user-abc'));
    assert.notEqual(syntheticWallet('user-abc'), syntheticWallet('user-xyz'));
  });
});

describe('ensureDefaultPortfolio', () => {
  it('seeds cards and marker once', async () => {
    const db = makeFakeDb();
    const first = await ensureDefaultPortfolio('uid1', db);
    assert.equal(first.seeded, true);
    assert.ok(db._store.get('hackathonMerchantInventory/uid1')?.seededDefaultAt);
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      const row = db._store.get(`hackathonMerchantInventory/uid1/items/${item.cert}`);
      assert.equal(row.wallet, first.wallet);
      assert.ok(row.createdAt);
    }
    for (const item of DEFAULT_PORTFOLIO_ITEMS) db._store.delete(`hackathonMerchantInventory/uid1/items/${item.cert}`);
    const second = await ensureDefaultPortfolio('uid1', db);
    assert.equal(second.seeded, false);
    assert.equal(second.wallet, first.wallet);
    assert.deepEqual(await ensureDefaultPortfolio('uid1', null), { wallet: null, seeded: false });
  });
});
