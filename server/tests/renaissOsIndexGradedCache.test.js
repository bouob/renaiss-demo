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
});
