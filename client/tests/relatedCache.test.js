import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getCachedRelated,
  setCachedRelated,
  clearRelatedCache,
  RELATED_CACHE_TTL_MS,
  __resetForTest,
  __setMaxEntriesForTest,
  __cacheSizeForTest,
} from '../src/lib/relatedCache.js';

const realNow = Date.now;
const OK = { gated: false, reason: null, neighbors: [{ cert: 'PSA1', delta: -1, tokenId: '1234567890123456' }] };

describe('relatedCache', () => {
  beforeEach(() => __resetForTest());
  afterEach(() => { Date.now = realNow; });

  it('clearRelatedCache drops every memo (this is what sign-out calls)', () => {
    // Without it, the next account signing in on this tab is served the previous
    // account's ownership-gated neighbors — the gate never runs, because no
    // request is made.
    setCachedRelated('PSA104644163', OK);
    clearRelatedCache();
    assert.equal(getCachedRelated('PSA104644163'), null);
    assert.equal(__cacheSizeForTest(), 0);
  });

  it('serves a stored result back within the TTL', () => {
    setCachedRelated('PSA104644163', OK);
    assert.deepEqual(getCachedRelated('PSA104644163'), OK);
  });

  it('expires an entry once the TTL has passed', () => {
    setCachedRelated('PSA104644163', OK);
    const t0 = realNow();
    Date.now = () => t0 + RELATED_CACHE_TTL_MS + 1;
    assert.equal(getCachedRelated('PSA104644163'), null);
  });

  it('misses on an unknown cert', () => {
    assert.equal(getCachedRelated('PSA000'), null);
  });

  it('refuses to cache a failed or degraded lookup', () => {
    // Caching a failure would make the Retry button useless: it would keep
    // serving the same failure until the TTL expired, even after upstream healed.
    const failures = [
      { gated: true, reason: 'not_held', neighbors: [] },
      { gated: true, neighbors: [] },
      { gated: false, reason: 'error', neighbors: [] },
      { gated: false, reason: null, neighbors: [], degraded: true },
      null,
    ];
    for (const bad of failures) {
      setCachedRelated('PSA104644163', bad);
      assert.equal(getCachedRelated('PSA104644163'), null, `must not cache ${JSON.stringify(bad)}`);
    }
  });

  it('caches a genuinely empty (ungated, healthy) result', () => {
    // "This market has no adjacent cards" is a real answer — re-asking costs an
    // upstream call for the same null.
    const empty = { gated: false, reason: null, neighbors: [], degraded: false };
    setCachedRelated('PSA84735372', empty);
    assert.deepEqual(getCachedRelated('PSA84735372'), empty);
  });

  it('evicts oldest-first past the entry cap', () => {
    __setMaxEntriesForTest(2);
    setCachedRelated('A', OK);
    setCachedRelated('B', OK);
    setCachedRelated('C', OK);
    assert.equal(__cacheSizeForTest(), 2);
    assert.equal(getCachedRelated('A'), null, 'oldest entry evicted');
    assert.deepEqual(getCachedRelated('C'), OK);
  });
});
