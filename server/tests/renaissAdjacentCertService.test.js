import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keys must be present at module load or requestUpstreamJson short-circuits to
// null and every neighbor would look like a transient failure.
process.env.RENAISS_INDEX_API_KEY = 'test-key';
process.env.RENAISS_INDEX_API_SECRET = 'test-secret';

const {
  __resetForTest: resetIndex,
  __setCacheForTest,
} = await import('../services/renaissOsIndex.js');

const {
  getAdjacentCertSuggestions,
  __resetForTest: resetService,
  __setMaxCacheEntriesForTest,
  __cacheSizeForTest,
} = await import('../services/renaissAdjacentCertService.js');

const { __resetForTest: resetMarketplace } = await import('../services/renaissMarketplaceLookup.js');

const realFetch = globalThis.fetch;

const CERT = 'PSA41932666';
const BELOW = 'PSA41932665';
const ABOVE = 'PSA41932667';

function fakeResponse(body, { status = 200 } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async json() { return body; },
  };
}

function foundPayload(name) {
  return {
    found: true,
    gradeLabel: '10 Gem Mint',
    card: {
      name,
      setName: 'Prismatic Evolutions',
      cardNumber: '161',
      priceUsdCents: 124099,
      confidence: 'high',
      imageUrl: 'https://img/full.png',
      imageUrlThumb: 'https://img/thumb.png',
      href: '/card/pokemon/prismatic/161',
      language: 'en',
    },
  };
}

/** A tRPC collectible.list body carrying an exact Serial match for `cert`. */
function marketplaceBody(cert) {
  return [{
    result: {
      data: {
        json: {
          collection: [{
            tokenId: tokenIdFor(cert),
            itemId: `${cert.toLowerCase()}-0000-4000-8000-000000000000`,
            name: 'Card',
            setName: 'Set',
            attributes: [{ trait: 'Serial', value: cert }],
          }],
        },
      },
    },
  }];
}

/** A deterministic 20-digit stand-in for the chain tokenId (must be ^\d{10,100}$). */
function tokenIdFor(cert) {
  return cert.replace(/\D/g, '').padEnd(20, '0');
}

/** A tRPC body with no rows — the marketplace genuinely does not carry the cert. */
const MARKETPLACE_EMPTY = [{ result: { data: { json: { collection: [] } } } }];

/**
 * Routes the stub by cert so each neighbor can succeed or fail independently.
 * `marketplace` overrides the tRPC enrich response (default: every cert is
 * listed, since the service now only returns neighbors the marketplace can
 * actually open). It receives the queried cert, so a stub can list one neighbor
 * and not the other.
 */
function stubFetchByCert(byCert, { marketplace } = {}) {
  let calls = 0;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('renaiss.xyz') || u.includes('collectible.list')) {
      const queried = decodeURIComponent(u).match(/PSA\d+/)?.[0] ?? '';
      return marketplace
        ? marketplace(queried)
        : fakeResponse(marketplaceBody(queried));
    }
    calls += 1;
    const hit = Object.entries(byCert).find(([cert]) => u.includes(cert));
    return hit ? hit[1]() : fakeResponse({ found: false, reason: 'not_in_index' });
  };
  return () => calls;
}

describe('getAdjacentCertSuggestions', () => {
  beforeEach(() => {
    resetIndex();
    resetService();
    resetMarketplace();
    // Bypass the Firestore graded-lookup cache so this file only exercises the
    // adjacency service's own in-memory cache.
    __setCacheForTest(async () => null, async () => {});
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    __setCacheForTest(null, null);
  });

  it('returns both neighbors with their delta, and strips the internal language field', async () => {
    stubFetchByCert({
      [BELOW]: () => fakeResponse(foundPayload('Umbreon ex')),
      [ABOVE]: () => fakeResponse(foundPayload('Charizard ex')),
    });
    const { neighbors } = await getAdjacentCertSuggestions(CERT);

    assert.equal(neighbors.length, 2);
    assert.deepEqual(neighbors.map((n) => n.delta), [-1, 1]);
    assert.deepEqual(neighbors.map((n) => n.cert), [BELOW, ABOVE]);
    assert.equal(neighbors[0].name, 'Umbreon ex');
    assert.equal(neighbors[0].priceUsdCents, 124099);
    assert.equal(neighbors[0].psaPop, null);
    // `language` is an internal routing field for the POP match step this
    // project does not port — the documented response shape excludes it.
    assert.equal('language' in neighbors[0], false);
  });

  it('caches a both-success result so a repeat view spends no upstream calls', async () => {
    const calls = stubFetchByCert({
      [BELOW]: () => fakeResponse(foundPayload('Umbreon ex')),
      [ABOVE]: () => fakeResponse(foundPayload('Charizard ex')),
    });
    await getAdjacentCertSuggestions(CERT);
    const afterFirst = calls();
    const second = await getAdjacentCertSuggestions(CERT);

    assert.equal(calls(), afterFirst, 'second call must be served from cache');
    assert.equal(second.neighbors.length, 2);
  });

  it('does NOT cache when a neighbor failed transiently — the invariant', async () => {
    // A null brief means breaker/quota/timeout/5xx, not "this cert has no
    // neighbor". Freezing that for the 6h TTL would leave the card stuck as
    // "no neighbors" long after upstream recovered.
    // Exactly one failing cert: BREAKER_THRESHOLD is 3, and tripping the
    // breaker would make the re-fetch assertion pass for the wrong reason.
    const calls = stubFetchByCert({
      [BELOW]: () => fakeResponse(null, { status: 500 }),
      [ABOVE]: () => fakeResponse(foundPayload('Charizard ex')),
    });

    const first = await getAdjacentCertSuggestions(CERT);
    assert.equal(first.neighbors.length, 1, 'fail-open: still returns the healthy neighbor');
    assert.equal(first.neighbors[0].delta, 1);
    // A null brief shortens the list for the same reason a tRPC blip empties it:
    // upstream fell over. `degraded` covers BOTH upstreams, not just marketplace.
    assert.equal(first.degraded, true);
    assert.equal(__cacheSizeForTest(), 0, 'a transient failure must not be cached');

    const afterFirst = calls();
    await getAdjacentCertSuggestions(CERT);
    assert.ok(calls() > afterFirst, 'second call must re-query upstream, not serve a frozen result');
  });

  it('drops a neighbor the marketplace does not carry, keeping the one it does', async () => {
    // The whole point of the list: every row must open on renaiss.xyz. A cert
    // the marketplace has no listing for is not shown at all — no dead row, and
    // no consolation link to the Index pricing page (which is not a buy surface).
    stubFetchByCert(
      {
        [BELOW]: () => fakeResponse(foundPayload('Riolu')),
        [ABOVE]: () => fakeResponse(foundPayload('Riolu')),
      },
      { marketplace: (cert) => fakeResponse(cert === BELOW ? marketplaceBody(cert) : MARKETPLACE_EMPTY) },
    );

    const { neighbors, degraded } = await getAdjacentCertSuggestions(CERT);
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].cert, BELOW);
    assert.equal(neighbors[0].delta, -1);
    assert.equal(neighbors[0].tokenId, tokenIdFor(BELOW));
    assert.equal(degraded, false, 'an unlisted cert is a real answer, not a failure');
    assert.equal(__cacheSizeForTest(), 1, 'a definitive answer is cacheable');
  });

  it('reports degraded when EVERY Index brief failed, so the empty list is not read as "none listed"', async () => {
    // The sibling of the marketplace case: if the Index itself is down, the
    // marketplace enrich never even runs (no found neighbors to enrich), and the
    // list is empty for a reason the merchant can retry away.
    stubFetchByCert({
      [BELOW]: () => fakeResponse(null, { status: 500 }),
      [ABOVE]: () => fakeResponse(null, { status: 500 }),
    });

    const { neighbors, degraded } = await getAdjacentCertSuggestions(CERT);
    assert.deepEqual(neighbors, []);
    assert.equal(degraded, true);
    assert.equal(__cacheSizeForTest(), 0);
  });

  it('reports degraded (not "no neighbors") when the enrich failed transiently', async () => {
    // A tRPC 5xx leaves every neighbor without a tokenId, so the filtered list
    // is empty — but that is a lookup failure, not "this market has no adjacent
    // cards". The flag lets the client say so, and the result is never cached.
    const calls = stubFetchByCert(
      {
        [BELOW]: () => fakeResponse(foundPayload('Umbreon ex')),
        [ABOVE]: () => fakeResponse(foundPayload('Charizard ex')),
      },
      { marketplace: () => fakeResponse({}, { status: 503 }) },
    );

    const first = await getAdjacentCertSuggestions(CERT);
    assert.deepEqual(first.neighbors, []);
    assert.equal(first.degraded, true);
    assert.equal(__cacheSizeForTest(), 0, 'a transient marketplace failure must not be cached');

    const afterFirst = calls();
    await getAdjacentCertSuggestions(CERT);
    assert.ok(calls() > afterFirst, 'second call must re-query, not serve a frozen empty result');
  });

  it('caches a genuinely empty result (every neighbor definitively not found)', async () => {
    // This is what makes the UI's "retry on empty" safe: a real empty answer is
    // cached, so retrying it costs nothing upstream.
    const calls = stubFetchByCert({
      [BELOW]: () => fakeResponse({ found: false, reason: 'not_in_index' }),
      [ABOVE]: () => fakeResponse({ found: false, reason: 'not_in_index' }),
    });

    const first = await getAdjacentCertSuggestions(CERT);
    assert.deepEqual(first.neighbors, []);
    assert.equal(__cacheSizeForTest(), 1);

    const afterFirst = calls();
    await getAdjacentCertSuggestions(CERT);
    assert.equal(calls(), afterFirst, 'a cached empty result must not re-query');
  });

  it('spends zero upstream calls on an unparseable cert', async () => {
    const calls = stubFetchByCert({});
    const result = await getAdjacentCertSuggestions('SGC1234');
    assert.deepEqual(result.neighbors, []);
    assert.equal(calls(), 0);
  });

  it('evicts oldest-first once the cache cap is reached', async () => {
    __setMaxCacheEntriesForTest(1);
    stubFetchByCert({});
    await getAdjacentCertSuggestions('PSA10000001');
    await getAdjacentCertSuggestions('PSA20000002');
    assert.equal(__cacheSizeForTest(), 1);
  });
});
