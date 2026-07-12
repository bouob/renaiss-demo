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

  it('adds the expansion once for an account with the legacy seed marker', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('legacy-user');
    db._store.set('hackathonMerchantInventory/legacy-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      defaultWallet: wallet,
    });

    const first = await ensureDefaultPortfolio('legacy-user', db);
    assert.equal(first.seeded, true);
    const parent = db._store.get('hackathonMerchantInventory/legacy-user');
    assert.ok(parent.seededDefaultExpansionAt);
    assert.equal(
      db._store.has('hackathonMerchantInventory/legacy-user/items/PSA119266732'),
      true,
    );
    assert.equal(
      db._store.has('hackathonMerchantInventory/legacy-user/items/PSA114662766'),
      false,
    );

    const second = await ensureDefaultPortfolio('legacy-user', db);
    assert.equal(second.seeded, false);
    assert.equal(second.wallet, wallet);
  });

  it('does not overwrite an existing token during expansion', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('existing-token-user');
    const existing = DEFAULT_PORTFOLIO_ITEMS[18];
    db._store.set('hackathonMerchantInventory/existing-token-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      defaultWallet: wallet,
    });
    db._store.set(`hackathonMerchantInventory/existing-token-user/items/${existing.cert}`, {
      cert: existing.cert,
      wallet,
      name: 'User-owned name',
      cost: 123.45,
    });

    const result = await ensureDefaultPortfolio('existing-token-user', db);
    assert.equal(result.seeded, true);
    assert.deepEqual(
      db._store.get(`hackathonMerchantInventory/existing-token-user/items/${existing.cert}`),
      {
        cert: existing.cert,
        wallet,
        name: 'User-owned name',
        cost: 123.45,
      },
    );
  });

  it('updates existing users with demo promote signals without replacing their cards', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('already-expanded-user');
    const showcase = DEFAULT_PORTFOLIO_ITEMS.find((item) => item.cert === 'PSA151789461');
    db._store.set('hackathonMerchantInventory/already-expanded-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      seededDefaultExpansionAt: '2026-07-02T00:00:00.000Z',
      seededDefaultExpansionVersion: 4,
      defaultWallet: wallet,
    });
    db._store.set(`hackathonMerchantInventory/already-expanded-user/items/${showcase.cert}`, {
      cert: showcase.cert,
      wallet,
      name: 'User-owned card name',
    });

    const result = await ensureDefaultPortfolio('already-expanded-user', db);
    assert.equal(result.seeded, true);
    assert.equal(
      db._store.get(`hackathonMerchantInventory/already-expanded-user/items/${showcase.cert}`).name,
      'User-owned card name',
    );
    assert.equal(
      db._store.get(`hackathonMerchantInventory/already-expanded-user/items/${showcase.cert}`).alphaPct30d,
      showcase.alphaPct30d,
    );
    assert.equal(
      db._store.get('hackathonMerchantInventory/already-expanded-user').seededDefaultExpansionVersion,
      5,
    );
  });

  it('adds newer cards once for an account with the prior expansion marker', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('expanded-user');
    db._store.set('hackathonMerchantInventory/expanded-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      seededDefaultExpansionAt: '2026-07-02T00:00:00.000Z',
      defaultWallet: wallet,
    });

    const first = await ensureDefaultPortfolio('expanded-user', db);
    assert.equal(first.seeded, true);
    assert.equal(
      db._store.has('hackathonMerchantInventory/expanded-user/items/PSA133140294'),
      true,
    );
    assert.equal(
      db._store.has('hackathonMerchantInventory/expanded-user/items/PSA119266732'),
      false,
    );
    assert.equal(
      db._store.get('hackathonMerchantInventory/expanded-user').seededDefaultExpansionVersion,
      5,
    );
  });

  it('adds the latest cards once for an account on expansion version 2', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('version-two-user');
    db._store.set('hackathonMerchantInventory/version-two-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      seededDefaultExpansionAt: '2026-07-02T00:00:00.000Z',
      seededDefaultExpansionVersion: 3,
      defaultWallet: wallet,
    });

    const first = await ensureDefaultPortfolio('version-two-user', db);
    assert.equal(first.seeded, true);
    assert.equal(
      db._store.has('hackathonMerchantInventory/version-two-user/items/PSA161025105'),
      true,
    );
    assert.equal(
      db._store.get('hackathonMerchantInventory/version-two-user').seededDefaultExpansionVersion,
      5,
    );
  });

  it('backfills pricing once without recreating deleted rows', async () => {
    const db = makeFakeDb();
    const wallet = syntheticWallet('pricing-user');
    db._store.set('hackathonMerchantInventory/pricing-user', {
      seededDefaultAt: '2026-07-01T00:00:00.000Z',
      seededDefaultExpansionAt: '2026-07-02T00:00:00.000Z',
      seededDefaultExpansionVersion: 3,
      defaultWallet: wallet,
    });
    const first = DEFAULT_PORTFOLIO_ITEMS[0];
    db._store.set(`hackathonMerchantInventory/pricing-user/items/${first.cert}`, {
      cert: first.cert,
      wallet,
      cost: 123.45,
    });
    db._store.delete('hackathonMerchantInventory/pricing-user/items/PSA136225944');

    const result = await ensureDefaultPortfolio('pricing-user', db);
    assert.equal(result.seeded, true);
    const updated = db._store.get(`hackathonMerchantInventory/pricing-user/items/${first.cert}`);
    assert.equal(updated.cost, 123.45);
    assert.equal(updated.listPrice, first.listPrice);
    assert.equal(
      db._store.has('hackathonMerchantInventory/pricing-user/items/PSA136225944'),
      false,
    );
    assert.equal(
      db._store.get('hackathonMerchantInventory/pricing-user').seededDefaultExpansionVersion,
      5,
    );
  });
});
