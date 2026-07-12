import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDemoItem,
  filterLinkedInventory,
  normalizeWalletAddr,
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

describe('normalizeWalletAddr', () => {
  it('lowercases valid addresses and rejects junk', () => {
    assert.equal(normalizeWalletAddr('0xAA' + 'a'.repeat(38)), '0xaa' + 'a'.repeat(38));
    assert.equal(normalizeWalletAddr('not-a-wallet'), '');
  });
});
