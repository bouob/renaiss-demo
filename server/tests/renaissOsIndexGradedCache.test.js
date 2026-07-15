import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Keys must be present at module load for requestUpstreamJson to reach fetch.
process.env.RENAISS_INDEX_API_KEY = 'test-key';
process.env.RENAISS_INDEX_API_SECRET = 'test-secret';

const {
  getGradedFmv,
  getGradedCardBrief,
  __resetForTest,
  __setCacheForTest,
} = await import('../services/renaissOsIndex.js');

const realFetch = globalThis.fetch;

// A fetch Response stub good enough for requestUpstreamJson.
function fakeResponse(body, { status = 200 } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    async json() { return body; },
  };
}

const CARD = { found: true, card: { priceUsdCents: 4200, href: '/card/pokemon/base/4' } };

function stubFetch(impl) {
  let calls = 0;
  globalThis.fetch = async (...args) => { calls += 1; return impl(...args); };
  return () => calls;
}

describe('renaissOsIndex graded-lookup cache', () => {
  beforeEach(() => __resetForTest());
  afterEach(() => { globalThis.fetch = realFetch; __setCacheForTest(null, null); });

  it('coalesces a concurrent fmv+brief pair into one upstream call', async () => {
    __setCacheForTest(async () => null, async () => {});
    const calls = stubFetch(async () => fakeResponse(CARD));
    const [fmv, brief] = await Promise.all([getGradedFmv('PSA126'), getGradedCardBrief('PSA126')]);
    assert.equal(calls(), 1);
    assert.equal(fmv.priceUsdCents, 4200);
    assert.equal(brief.priceUsdCents, 4200);
  });

  it('serves a cache hit without any upstream call', async () => {
    __setCacheForTest(async () => CARD, async () => { throw new Error('should not write'); });
    const calls = stubFetch(async () => fakeResponse(CARD));
    const fmv = await getGradedFmv('PSA126');
    assert.equal(calls(), 0);
    assert.equal(fmv.priceUsdCents, 4200);
  });

  it('writes a successful payload (including found:false) to the cache', async () => {
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    stubFetch(async () => fakeResponse({ found: false, reason: 'not_in_index' }));
    await getGradedFmv('PSA999');
    assert.equal(written.length, 1);
    assert.equal(written[0].cert, 'PSA999');
    assert.equal(written[0].payload.found, false);
  });

  it('does not cache a null (failed) upstream result', async () => {
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    stubFetch(async () => fakeResponse(null, { status: 500 }));
    const fmv = await getGradedFmv('PSA126');
    assert.equal(fmv, null);
    assert.equal(written.length, 0);
  });

  it('treats a 404 as a determinate miss (found:false), not a transient null', async () => {
    // A 404 says "the Index does not carry this cert" — a real answer. Folding
    // it into null (the transient signal) makes callers report an outage for a
    // cert that simply is not tracked.
    __setCacheForTest(async () => null, async () => {});
    stubFetch(async () => fakeResponse({ error: 'not found' }, { status: 404 }));

    const brief = await getGradedCardBrief('PSA404');
    assert.equal(brief?.found, false, 'a determinate answer, not null');
    assert.equal(brief.reason, 'not_found');
  });

  it('does NOT persist a 404 miss — a systemic 404 must not poison the 8h cache', async () => {
    // Unlike a 200 {found:false}, a 404 can be systemic (upstream moved the
    // path / revoked the key). Persisting it would freeze every probed cert as
    // "not tracked" for the full TTL, long after the path is restored. So a 404
    // is answered but never written — the miss is real for this request only.
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    const calls = stubFetch(async () => fakeResponse({}, { status: 404 }));

    await getGradedCardBrief('PSA404');
    assert.equal(written.length, 0, 'a 404 negative must not be persisted');

    // ...and because it is not cached, the next request re-queries (which is the
    // acceptable cost of not poisoning the cache — the adjacent service's own
    // in-memory cache still absorbs repeats within a page view).
    await getGradedCardBrief('PSA404');
    assert.equal(calls(), 2, 'not cached → re-queried, never served a frozen miss');
  });

  it('still persists a 200 {found:false} miss (that IS a durable answer)', async () => {
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    stubFetch(async () => fakeResponse({ found: false, reason: 'not_in_index' }));
    await getGradedCardBrief('PSA200');
    assert.equal(written.length, 1, 'a 200 miss stays cacheable — only 404 is excluded');
  });

  it('a 404 does not reset the breaker — a mixed 5xx/404 stream must still trip it', async () => {
    // The bug this guards: answering a 404 as a breaker "success" would zero the
    // consecutive-failure count, so an upstream flapping between 5xx and 404
    // (half cache-hit, half broken backend) could never trip the breaker and
    // would keep spending quota on a sick service.
    __setCacheForTest(async () => null, async () => {});
    const seq = [503, 503, 404, 503]; // BREAKER_THRESHOLD is 3; the 404 must NOT reset
    let i = 0;
    const calls = stubFetch(async () => {
      const status = seq[i] ?? 200;
      i += 1;
      return fakeResponse(status === 404 ? {} : {}, { status });
    });

    for (const cert of ['PSA1', 'PSA2', 'PSA3', 'PSA4']) await getGradedCardBrief(cert);
    const before = calls();
    await getGradedCardBrief('PSA5');
    assert.equal(calls(), before, 'breaker is open: the 404 did not wipe the 5xx failure count');
  });

  it('getGradedFmv reports a 404 as found:false too', async () => {
    __setCacheForTest(async () => null, async () => {});
    stubFetch(async () => fakeResponse({}, { status: 404 }));
    const fmv = await getGradedFmv('PSA404');
    assert.equal(fmv?.found, false);
    assert.equal(fmv.reason, 'not_found');
    assert.equal(fmv.priceUsdCents, null);
  });

  it('still treats 5xx as transient (null, uncached) — 404 handling must not soften it', async () => {
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    stubFetch(async () => fakeResponse({}, { status: 503 }));
    assert.equal(await getGradedCardBrief('PSA503'), null);
    assert.equal(written.length, 0);
  });
});
