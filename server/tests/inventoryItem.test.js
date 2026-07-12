import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem, selectInventoryItems } from '../lib/inventoryItem.js';

describe('inventoryItem shared module', () => {
  it('exposes the inventory collection name', () => assert.equal(COLLECTION, 'hackathonMerchantInventory'));
  it('CERT_SHAPE accepts a PSA cert and rejects junk', () => {
    assert.ok(CERT_SHAPE.test('PSA114662766'));
    assert.ok(!CERT_SHAPE.test('../etc/passwd'));
    assert.ok(!CERT_SHAPE.test('x'.repeat(65)));
  });
  it('sanitizeWallet lowercases a valid address and rejects bad shape', () => {
    assert.equal(sanitizeWallet('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'), '0xabcdef0123456789abcdef0123456789abcdef01');
    assert.equal(sanitizeWallet('not-a-wallet'), null);
  });
  it('sanitizeItem keeps demo fields and stamps updatedAt', () => {
    const patch = sanitizeItem({ wallet: '0xabcdef0123456789abcdef0123456789abcdef01', name: 'Pikachu', setName: 'Crown Zenith', grade: '10 Gem Mint', imageUrl: 'https://example.com/x.jpg', priceUsdCents: 29531, href: '/card/pokemon/x', status: 'active' }, 'PSA114662766');
    assert.equal(patch.cert, 'PSA114662766');
    assert.equal(patch.name, 'Pikachu');
    assert.equal(patch.priceUsdCents, 29531);
    assert.equal(typeof patch.updatedAt, 'string');
  });
  it('sanitizeItem keeps valid addedVia + sourceWallet and drops invalid', () => {
    const ok = sanitizeItem({ addedVia: 'scan', sourceWallet: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01' }, 'PSA114662766');
    assert.equal(ok.addedVia, 'scan');
    assert.equal(ok.sourceWallet, '0xabcdef0123456789abcdef0123456789abcdef01');
    const bad = sanitizeItem({ addedVia: 'wat', sourceWallet: 'nope' }, 'PSA114662766');
    assert.ok(!('addedVia' in bad));
    assert.ok(!('sourceWallet' in bad));
  });
  it('sanitizeItem keeps a numeric alphaPct30d and clamps out-of-range values', () => {
    assert.equal(sanitizeItem({ alphaPct30d: 0.12 }, 'PSA114662766').alphaPct30d, 0.12);
    assert.equal(sanitizeItem({ alphaPct30d: 99 }, 'PSA114662766').alphaPct30d, 10);
    assert.equal(sanitizeItem({ alphaPct30d: -5 }, 'PSA114662766').alphaPct30d, -1);
  });

  it('sanitizeItem drops a non-numeric alphaPct30d instead of coercing it to 0', () => {
    // Number(null) and Number('') are both 0 — persisting that would shadow the
    // nullish demo-alpha fallback and silently reclassify the row.
    for (const value of [null, '', false, [], 'abc', undefined]) {
      const patch = sanitizeItem({ alphaPct30d: value }, 'PSA114662766');
      assert.ok(!('alphaPct30d' in patch), `alphaPct30d should be dropped for ${JSON.stringify(value)}`);
    }
  });

  it('selectInventoryItems returns all rows when no wallet filter', () => {
    const rows = [{ cert: 'A', wallet: '0xaaa' }, { cert: 'B', wallet: null }];
    assert.deepEqual(selectInventoryItems(rows, null, null).map((r) => r.cert), ['A', 'B']);
  });
  it('selectInventoryItems filters by wallet OR default wallet when provided', () => {
    const rows = [
      { cert: 'A', wallet: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
      { cert: 'B', wallet: '0x1111111111111111111111111111111111111111' },
      { cert: 'C', wallet: '0xDEF0000000000000000000000000000000000000' },
    ];
    const out = selectInventoryItems(rows, '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '0xdef0000000000000000000000000000000000000');
    assert.deepEqual(out.map((r) => r.cert), ['A', 'C']);
  });
});
