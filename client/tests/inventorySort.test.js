import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sortInventoryItems,
  normalizeSortKey,
  normalizeSortDir,
} from '../src/lib/inventorySort.js';

const rows = [
  { cert: 'a', name: 'Alpha', cost: 110, fmvUsd: 100, pnl: -10 },
  { cert: 'b', name: 'Bravo', cost: 450, fmvUsd: 500, pnl: 50 },
  { cert: 'c', name: 'Charlie', cost: null, fmvUsd: null, pnl: null },
  { cert: 'd', name: 'Delta', cost: 400, fmvUsd: 200, pnl: -200 },
  { cert: 'e', name: 'Echo', cost: 495, fmvUsd: 500, pnl: 5 },
];

describe('normalizeSortKey / normalizeSortDir', () => {
  it('falls back to fmv / desc for bad values', () => {
    assert.equal(normalizeSortKey('nope'), 'fmv');
    assert.equal(normalizeSortKey(null), 'fmv');
    assert.equal(normalizeSortDir('sideways'), 'desc');
    assert.equal(normalizeSortDir(undefined), 'desc');
  });
});

describe('sortInventoryItems', () => {
  it('sorts by FMV descending by default shape', () => {
    const sorted = sortInventoryItems(rows, 'fmv', 'desc');
    assert.deepEqual(sorted.map((r) => r.cert), ['b', 'e', 'd', 'a', 'c']);
  });

  it('sorts by cost descending with null last', () => {
    const sorted = sortInventoryItems(rows, 'cost', 'desc');
    assert.deepEqual(sorted.map((r) => r.cert), ['e', 'b', 'd', 'a', 'c']);
  });

  it('sorts by cost ascending with null last', () => {
    const sorted = sortInventoryItems(rows, 'cost', 'asc');
    assert.deepEqual(sorted.map((r) => r.cert), ['a', 'd', 'b', 'e', 'c']);
  });

  it('sorts by FMV ascending and keeps null last', () => {
    const sorted = sortInventoryItems(rows, 'fmv', 'asc');
    assert.deepEqual(sorted.map((r) => r.cert), ['a', 'd', 'b', 'e', 'c']);
  });

  it('sorts by unrealized P&L ascending (worst loss first) with null last', () => {
    const sorted = sortInventoryItems(rows, 'unrealized', 'asc');
    assert.deepEqual(sorted.map((r) => r.cert), ['d', 'a', 'e', 'b', 'c']);
  });

  it('sorts by unrealized P&L descending (biggest profit first)', () => {
    const sorted = sortInventoryItems(rows, 'unrealized', 'desc');
    assert.deepEqual(sorted.map((r) => r.cert), ['b', 'e', 'a', 'd', 'c']);
  });

  it('does not mutate the input array', () => {
    const copy = [...rows];
    sortInventoryItems(rows, 'fmv', 'desc');
    assert.deepEqual(rows, copy);
  });

  it('tie-breaks equal FMV by name then cert', () => {
    const tied = [
      { cert: 'z', name: 'Same', fmvUsd: 10, pnl: 1 },
      { cert: 'a', name: 'Same', fmvUsd: 10, pnl: 2 },
    ];
    const sorted = sortInventoryItems(tied, 'fmv', 'desc');
    assert.deepEqual(sorted.map((r) => r.cert), ['a', 'z']);
  });
});
