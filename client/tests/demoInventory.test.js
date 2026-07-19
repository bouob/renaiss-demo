import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoItem,
  isHiddenItem,
  filterLinkedInventory,
  normalizeWalletAddr,
  recoverLinkedWallet,
} from '../src/lib/demoInventory.js';

const DEMO_W = '0x1bcff45abb471cfab483799d0ebfe090bc709dba';
const REAL_W = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('isDemoItem', () => {
  it('matches the synthetic default wallet only', () => {
    assert.equal(isDemoItem({ wallet: DEMO_W, cert: 'PSA1' }, DEMO_W), true);
    assert.equal(isDemoItem({ wallet: REAL_W, cert: 'PSA1' }, DEMO_W), false);
    assert.equal(isDemoItem({ wallet: DEMO_W }, null), false);
    assert.equal(isDemoItem({}, DEMO_W), false);
  });
});

describe('isHiddenItem', () => {
  it('is true only for a strict boolean true (absent/false/junk are visible)', () => {
    // The strict === true contract is load-bearing: every hidden-filter path
    // (inventory list, portfolio stats, dashboard movers) relies on it, so a
    // stray truthy value like the string 'false' must NOT read as hidden.
    assert.equal(isHiddenItem({ hidden: true }), true);
    assert.equal(isHiddenItem({ hidden: false }), false);
    assert.equal(isHiddenItem({}), false);
    assert.equal(isHiddenItem({ hidden: undefined }), false);
    assert.equal(isHiddenItem({ hidden: 'false' }), false);
    assert.equal(isHiddenItem({ hidden: 1 }), false);
    assert.equal(isHiddenItem(null), false);
    assert.equal(isHiddenItem(undefined), false);
  });
});

describe('filterLinkedInventory', () => {
  const rows = [
    { cert: 'A', wallet: DEMO_W, name: 'demo-A' },
    { cert: 'B', wallet: DEMO_W, name: 'demo-B' },
    { cert: 'A', wallet: REAL_W, name: 'personal-A' }, // same cert as demo-A
    { cert: 'C', wallet: REAL_W, name: 'personal-C' },
    { cert: 'D', wallet: null, name: 'manual', addedVia: 'cert' },
  ];

  it('returns everything when no wallet is linked', () => {
    const out = filterLinkedInventory(rows, '', DEMO_W);
    assert.equal(out.length, 5);
  });

  it('hides demo rows that collide with personal certs when linked', () => {
    const out = filterLinkedInventory(rows, REAL_W, DEMO_W);
    const certs = out.map((r) => r.cert).sort();
    // personal A,C + manual D + demo B (A demo hidden)
    assert.deepEqual(certs, ['A', 'B', 'C', 'D']);
    const a = out.find((r) => r.cert === 'A');
    assert.equal(a.name, 'personal-A');
    assert.equal(isDemoItem(a, DEMO_W), false);
  });

  it('shows all demos again when unlinked (same input list with only demos+leftover)', () => {
    // After unlink server restores demos and drops personal — client just shows all.
    const afterUnlink = [
      { cert: 'A', wallet: DEMO_W, name: 'demo-A' },
      { cert: 'B', wallet: DEMO_W, name: 'demo-B' },
    ];
    const out = filterLinkedInventory(afterUnlink, '', DEMO_W);
    assert.deepEqual(out.map((r) => r.cert).sort(), ['A', 'B']);
  });
});

describe('recoverLinkedWallet', () => {
  const REAL_W2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('keeps a stored real wallet', () => {
    const items = [{ cert: 'A', wallet: DEMO_W }];
    assert.equal(recoverLinkedWallet(items, DEMO_W, REAL_W), REAL_W);
  });

  it('never returns the synthetic demo wallet, even when stored', () => {
    // A demo-only account: the synthetic wallet tags every row and may have
    // leaked into localStorage by an older client. It must not read as linked.
    const items = [
      { cert: 'A', wallet: DEMO_W },
      { cert: 'B', wallet: DEMO_W },
    ];
    assert.equal(recoverLinkedWallet(items, DEMO_W, ''), '');
    assert.equal(recoverLinkedWallet(items, DEMO_W, DEMO_W), '');
  });

  it('recovers a real wallet from item rows when nothing is stored', () => {
    const items = [
      { cert: 'A', wallet: DEMO_W },
      { cert: 'C', wallet: REAL_W2 },
    ];
    assert.equal(recoverLinkedWallet(items, DEMO_W, ''), REAL_W2);
  });

  it('falls back from a stored demo wallet to a real item wallet', () => {
    const items = [
      { cert: 'A', wallet: DEMO_W },
      { cert: 'C', wallet: REAL_W2 },
    ];
    assert.equal(recoverLinkedWallet(items, DEMO_W, DEMO_W), REAL_W2);
  });

  it('normalizes case and ignores malformed wallets', () => {
    const items = [
      { cert: 'A', wallet: 'garbage' },
      { cert: 'B', wallet: REAL_W2.toUpperCase().replace('0X', '0x') },
    ];
    assert.equal(recoverLinkedWallet(items, DEMO_W, 'nope'), REAL_W2);
    assert.equal(recoverLinkedWallet([], null, ''), '');
  });
});

describe('normalizeWalletAddr', () => {
  it('lowercases valid addresses and rejects junk', () => {
    assert.equal(normalizeWalletAddr('0xAA' + 'a'.repeat(38)), '0xaa' + 'a'.repeat(38));
    assert.equal(normalizeWalletAddr('not-a-wallet'), '');
  });
});
