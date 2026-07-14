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

  it('treats a 404 as a determinate miss, not a transient failure', async () => {
    // A 404 says "the Index does not carry this cert" — a real answer. Folding
    // it into null (the transient signal) makes callers report an outage for a
    // cert that simply is not tracked, and re-queries upstream forever because a
    // null is never cached.
    const written = [];
    __setCacheForTest(async () => null, async (cert, payload) => { written.push({ cert, payload }); });
    const calls = stubFetch(async () => fakeResponse({ error: 'not found' }, { status: 404 }));

    const brief = await getGradedCardBrief('PSA404');
    assert.equal(brief?.found, false, 'a determinate answer, not null');
    assert.equal(brief.reason, 'not_found');
    assert.equal(written.length, 1, 'the negative is cacheable');
    assert.equal(written[0].payload.found, false);

    // ...and the cached negative is served back without touching upstream.
    __setCacheForTest(async () => written[0].payload, async () => {});
    const again = await getGradedCardBrief('PSA404');
    assert.equal(again.found, false);
    assert.equal(calls(), 1, 'no second upstream call for a known miss');
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
