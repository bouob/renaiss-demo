import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Keys ON at module load: if the gate ever leaked, the route WOULD reach fetch.
// A test with the keys unset would pass for the wrong reason.
process.env.RENAISS_INDEX_API_KEY = 'test-key';
process.env.RENAISS_INDEX_API_SECRET = 'test-secret';

const relatedRouter = (await import('../routes/related.js')).default;
const {
  rememberHeldCert,
  forgetHeldCert,
  __resetHeldCertGateForTest,
} = await import('../services/heldCertGate.js');
const {
  __resetForTest: resetIndex,
  __setCacheForTest,
} = await import('../services/renaissOsIndex.js');
const {
  __resetForTest: resetAdjacency,
} = await import('../services/renaissAdjacentCertService.js');
// The marketplace lookup keeps its own 24h cache, so a hit cached by an earlier
// test would survive into one that stubs tRPC as down — and the "degraded" case
// would silently render as a healthy list.
const {
  __resetForTest: resetMarketplace,
} = await import('../services/renaissMarketplaceLookup.js');

const realFetch = globalThis.fetch;
const CERT = 'PSA41932666';
const UPSTREAM_HOST = 'api.renaissos.com';

/**
 * Counts calls to the Renaiss upstream only. The test drives the route over
 * real HTTP to 127.0.0.1, so a blanket fetch stub would swallow the test's own
 * request — anything that is not the upstream is passed through untouched.
 */
function countUpstreamCalls() {
  let calls = 0;
  globalThis.fetch = async (url, ...rest) => {
    const u = String(url);
    // Marketplace tRPC enrich; stub it so CI never depends on renaiss.xyz
    // availability. It must return an exact Serial match: the service only keeps
    // neighbors the marketplace lists, so an empty collection would filter every
    // neighbor away and this suite would assert on the wrong thing.
    if (u.includes('renaiss.xyz') || u.includes('collectible.list')) {
      const queried = decodeURIComponent(u).match(/PSA\d+/)?.[0] ?? '';
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        async json() {
          return [{
            result: {
              data: {
                json: {
                  collection: queried ? [{
                    tokenId: queried.replace(/\D/g, '').padEnd(20, '0'),
                    itemId: `${queried.toLowerCase()}-0000-4000-8000-000000000000`,
                    attributes: [{ trait: 'Serial', value: queried }],
                  }] : [],
                },
              },
            },
          }];
        },
      };
    }
    if (!u.includes(UPSTREAM_HOST)) return realFetch(url, ...rest);
    calls += 1;
    return {
      status: 200,
      ok: true,
      headers: { get: () => null },
      async json() {
        return { found: true, gradeLabel: '10 Gem Mint', card: { name: 'Neighbor', priceUsdCents: 1000 } };
      },
    };
  };
  return () => calls;
}

async function get(path) {
  const app = express();
  app.use(relatedRouter);
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

// relatedLimiter is module-level, IP-keyed, 30/min, and every test here shares
// 127.0.0.1 — keep the request count well under that or the limiter starts
// answering for the route and later tests fail for the wrong reason.
describe('GET /related/:cert', () => {
  beforeEach(() => {
    __resetHeldCertGateForTest();
    resetIndex();
    resetAdjacency();
    resetMarketplace();
    __setCacheForTest(async () => null, async () => {});
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    __setCacheForTest(null, null);
  });

  it('spends ZERO upstream calls on a cert the caller does not hold', async () => {
    // The whole cost story rests on this: an arbitrary cert must not be able to
    // burn the shared Renaiss quota/breaker that getGradedFmv also depends on.
    const calls = countUpstreamCalls();
    const { status, body } = await get(`/related/${CERT}`);

    assert.equal(calls(), 0);
    assert.equal(status, 200);
    assert.equal(body.gated, true);
    assert.equal(body.reason, 'not_held');
    assert.deepEqual(body.neighbors, []);
  });

  it('opens the gate once the cert has been looked up', async () => {
    // rememberHeldCert is what GET /card/:cert calls (server/routes/card.js) —
    // that request is the modal's mount-time fetch, and it is the only thing
    // that admits a guest's cert to the allowlist.
    rememberHeldCert(CERT);
    const calls = countUpstreamCalls();
    const { status, body } = await get(`/related/${CERT}`);

    assert.equal(status, 200);
    assert.equal(body.gated, false);
    assert.equal(body.reason, null);
    assert.ok(calls() > 0, 'a held cert should reach upstream');
    assert.equal(body.neighbors.length, 2);
    assert.deepEqual(body.neighbors.map((n) => n.delta), [-1, 1]);
    assert.equal(body.degraded, false, 'a healthy answer is not degraded');
  });

  it('passes `degraded` through to the client when an upstream fell over', async () => {
    // The service knows the empty list came from a failure, but the client can
    // only say so if the ROUTE forwards the flag — it builds its payload field by
    // field, so a new field is dropped unless it is added here. Without this
    // assertion, the UI silently reports "no adjacent cards on this market" for
    // what is really an outage.
    rememberHeldCert(CERT);
    globalThis.fetch = async (url, ...rest) => {
      const u = String(url);
      if (u.includes('renaiss.xyz') || u.includes('collectible.list')) {
        return { status: 503, ok: false, headers: { get: () => null }, async json() { return {}; } };
      }
      if (!u.includes(UPSTREAM_HOST)) return realFetch(url, ...rest);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        async json() {
          return { found: true, gradeLabel: '10 Gem Mint', card: { name: 'Neighbor', priceUsdCents: 1000 } };
        },
      };
    };

    const { status, body } = await get(`/related/${CERT}`);

    assert.equal(status, 200);
    assert.equal(body.gated, false);
    assert.deepEqual(body.neighbors, [], 'no neighbor survives without a tokenId');
    assert.equal(body.degraded, true);
  });

  it('re-gates a cert once it is forgotten (e.g. the holding was deleted)', async () => {
    // DELETE /meta/:cert calls forgetHeldCert so a removed card can no longer
    // spend the shared Renaiss quota via /related.
    rememberHeldCert(CERT);
    forgetHeldCert(CERT);
    const calls = countUpstreamCalls();
    const { status, body } = await get(`/related/${CERT}`);

    assert.equal(calls(), 0);
    assert.equal(status, 200);
    assert.equal(body.gated, true);
    assert.equal(body.reason, 'not_held');
  });

  it('rejects a malformed cert without touching upstream', async () => {
    const calls = countUpstreamCalls();
    const { status, body } = await get('/related/ab');

    assert.equal(calls(), 0);
    assert.equal(status, 200);
    assert.equal(body.reason, 'invalid_cert');
  });

  it('always answers 200 — the route is fail-open, never a 4xx/5xx', async () => {
    countUpstreamCalls();
    const notHeld = await get(`/related/${CERT}`);
    const malformed = await get('/related/ab');

    assert.equal(notHeld.status, 200);
    assert.equal(malformed.status, 200);
  });
});
