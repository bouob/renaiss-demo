import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem, selectInventoryItems,
  selectVisibleHoldings,
} from '../lib/inventoryItem.js';

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

  it('sanitizeItem keeps a valid decimal tokenId and drops junk', () => {
    // tokenId is the renaiss.xyz /card/{tokenId} deep-link key: a large decimal
    // uint256 string. A malformed value must be dropped, never persisted — the
    // client refuses to build a URL off it, so storing junk only masks the miss.
    const tokenId = '39468560625473669737299487652232890385753731921834312021449811470109026056283';
    assert.equal(sanitizeItem({ tokenId }, 'PSA114662766').tokenId, tokenId);
    for (const value of ['abc', '12345', '0xdeadbeefdead', '', null, undefined, 42]) {
      const patch = sanitizeItem({ tokenId: value }, 'PSA114662766');
      assert.ok(!('tokenId' in patch), `tokenId should be dropped for ${JSON.stringify(value)}`);
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

describe('selectVisibleHoldings', () => {
  const LINKED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const DEMO = '0xdddddddddddddddddddddddddddddddddddddddd';
  const rows = [
    { cert: 'PERSONAL', wallet: LINKED },
    { cert: 'MANUAL', wallet: null }, // cert/CSV add — persisted with no wallet
    { cert: 'OTHERW', wallet: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
    { cert: 'DEMO1', wallet: DEMO },
    { cert: 'PERSONAL', wallet: DEMO }, // demo copy shadowed by the personal row
    { cert: 'HIDDEN', wallet: LINKED, hidden: true },
  ];

  it('linked wallet: keeps personal + manual + other-wallet + unshadowed demo rows, drops hidden', () => {
    const out = selectVisibleHoldings(rows, LINKED.toUpperCase().replace('0X', '0x'), DEMO);
    assert.deepEqual(out.map((r) => r.cert).sort(), ['DEMO1', 'MANUAL', 'OTHERW', 'PERSONAL']);
  });

  it('demo wallet queried (unlinked fallback): keeps every visible row', () => {
    const out = selectVisibleHoldings(rows, DEMO, DEMO);
    assert.deepEqual(out.map((r) => r.cert).sort(), ['DEMO1', 'MANUAL', 'OTHERW', 'PERSONAL', 'PERSONAL']);
  });

  it('no wallet: keeps every visible row', () => {
    const out = selectVisibleHoldings(rows, '', DEMO);
    assert.equal(out.length, 5);
    assert.ok(!out.some((r) => r.hidden === true));
  });

  it('a hidden linked row still shadows its demo twin (neither appears)', () => {
    // Client parity: filterLinkedInventory shadows on the full linked-wallet
    // cert set BEFORE callers drop hidden rows, so Inventory shows neither the
    // hidden personal row nor its demo copy. The chart must not resurrect the
    // demo copy.
    const twinRows = [
      { cert: 'TWIN', wallet: LINKED, hidden: true },
      { cert: 'TWIN', wallet: DEMO },
      { cert: 'KEEP', wallet: DEMO },
    ];
    const out = selectVisibleHoldings(twinRows, LINKED, DEMO);
    assert.deepEqual(out.map((r) => r.cert), ['KEEP']);
  });
});
