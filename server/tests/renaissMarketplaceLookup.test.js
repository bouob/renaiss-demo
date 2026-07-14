import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickExact,
  lookupMarketplaceByCert,
  lookupMarketplaceByCerts,
  __resetForTest,
} from '../services/renaissMarketplaceLookup.js';

const realFetch = globalThis.fetch;
const CERT = 'PSA104644162';
const TOKEN = '39468560625473669737299487652232890385753731921834312021449811470109026056283';
const ITEM = '397dded3-fa77-4429-9910-c7cefe06c483';

function trpcBody({ serial = CERT, tokenId = TOKEN, itemId = ITEM, extra = [] } = {}) {
  return [{
    result: {
      data: {
        json: {
          collection: [
            {
              tokenId,
              itemId,
              name: 'Riolu',
              setName: 'Sv1s',
              attributes: [{ trait: 'Serial', value: serial }],
            },
            ...extra,
          ],
        },
      },
    },
  }];
}

describe('pickExact', () => {
  it('returns tokenId + renaissItemId when Serial matches exactly', () => {
    const hit = pickExact(trpcBody(), CERT);
    assert.equal(hit.tokenId, TOKEN);
    assert.equal(hit.renaissItemId, ITEM);
    assert.equal(hit.name, 'Riolu');
  });

  it('is case-insensitive on the cert / Serial', () => {
    const hit = pickExact(trpcBody({ serial: 'psa104644162' }), 'psa104644162');
    assert.equal(hit.tokenId, TOKEN);
  });

  it('rejects a fuzzy hit whose Serial is a different card', () => {
    const body = trpcBody({
      serial: 'PSA104644199',
      tokenId: '99999999999999999999',
      itemId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    });
    assert.equal(pickExact(body, CERT), null);
  });

  it('returns null on malformed tRPC shapes', () => {
    assert.equal(pickExact(null, CERT), null);
    assert.equal(pickExact([], CERT), null);
    assert.equal(pickExact([{ result: {} }], CERT), null);
  });
});

describe('lookupMarketplaceByCert', () => {
  beforeEach(() => __resetForTest());
  afterEach(() => { globalThis.fetch = realFetch; });

  it('hits tRPC once and caches the result', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async json() { return trpcBody(); },
      };
    };
    const a = await lookupMarketplaceByCert(CERT);
    const b = await lookupMarketplaceByCert(CERT);
    assert.equal(a.tokenId, TOKEN);
    assert.equal(b.tokenId, TOKEN);
    assert.equal(calls, 1);
  });

  it('caches a miss so a missing listing is not re-queried', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        async json() { return trpcBody({ serial: 'PSA0' }); },
      };
    };
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(calls, 1);
  });

  it('fails open on HTTP errors', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
    assert.equal(await lookupMarketplaceByCert(CERT), null);
  });

  it('does NOT cache a transient HTTP failure — it is not a determinate miss', async () => {
    // A 5xx means "tRPC is unwell", not "this cert is not on the marketplace".
    // Caching it for the 24h TTL would freeze the card as un-deep-linkable long
    // after the site recovered — and the client no longer has a ?q= fallback.
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return { ok: false, status: 503, async json() { return {}; } };
    };
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(calls, 2, 'a transient failure must be re-queried, not served from cache');
  });

  it('does NOT cache a thrown fetch (timeout / abort / network)', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('aborted');
    };
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(await lookupMarketplaceByCert(CERT), null);
    assert.equal(calls, 2, 'a thrown fetch must be re-queried, not served from cache');
  });
});

describe('lookupMarketplaceByCerts', () => {
  beforeEach(() => __resetForTest());
  afterEach(() => { globalThis.fetch = realFetch; });

  it('reports transient:false and maps each cert to its lookup on a healthy call', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, async json() { return trpcBody(); } });
    const { byCert, transient } = await lookupMarketplaceByCerts([CERT]);
    assert.equal(transient, false);
    assert.equal(byCert.get(CERT).tokenId, TOKEN);
  });

  it('reports transient:true when any cert failed transiently', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, async json() { return {}; } });
    const { byCert, transient } = await lookupMarketplaceByCerts([CERT]);
    assert.equal(transient, true, 'callers gate their own cache write on this');
    assert.equal(byCert.get(CERT), null, 'still fail-open: the value is null');
  });

  it('reports transient:false for a determinate miss (200, no exact match)', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      async json() { return trpcBody({ serial: 'PSA0' }); },
    });
    const { byCert, transient } = await lookupMarketplaceByCerts([CERT]);
    assert.equal(transient, false, 'a real "not on the marketplace" answer is cacheable');
    assert.equal(byCert.get(CERT), null);
  });
});
