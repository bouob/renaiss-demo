import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Build the router with injected fakes so the test needs no Firebase/network.
import { createPortfolioSeriesRouter } from '../routes/portfolioSeries.js';

function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function get(app, path, headers = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const fakeAuth = (req, _res, next) => { req.uid = 'u1'; next(); };

test('401 when auth middleware rejects', async () => {
  const router = createPortfolioSeriesRouter({
    requireAuth: (_req, res) => res.status(401).json({ error: 'no token' }),
    loadHoldings: async () => [],
    getSummary: async () => null,
    buildPortfolioSeries: async () => ({}),
  });
  const { status } = await get(appWith(router), '/portfolio-series');
  assert.equal(status, 401);
});

test('fail-open: no summary -> 200 empty payload', async () => {
  const router = createPortfolioSeriesRouter({
    requireAuth: fakeAuth,
    loadHoldings: async () => [{ cert: 'PSA1', renaissFmv: { found: true, href: '/card/pokemon/base/1' } }],
    getSummary: async () => null,
    buildPortfolioSeries: async ({ summary }) => ({
      portfolio: [], index: null, benchmark: { windows: {} }, perHolding: {},
      coverage: { included: 0, total: 1 }, attributionUrl: 'https://index.renaissos.com',
    }),
  });
  const { status, body } = await get(appWith(router), '/portfolio-series?wallet=0xaBcDef0123456789aBcDef0123456789aBcDef01');
  assert.equal(status, 200);
  assert.deepEqual(body.portfolio, []);
  assert.equal(body.index, null);
  assert.equal(body.coverage.total, 1);
});

test('happy path: passes holdings + summary to builder, returns its payload', async () => {
  let seen = null;
  const router = createPortfolioSeriesRouter({
    requireAuth: fakeAuth,
    loadHoldings: async (uid, wallet) => { seen = { uid, wallet }; return [{ cert: 'PSA1', renaissFmv: { found: true, href: '/card/pokemon/base/1' } }]; },
    getSummary: async () => ({ sparkline: [{ t: '2026-01-01', usdCents: 100 }], deltas: { d7: 0.01, d30: 0.02, d365: 0.03 } }),
    buildPortfolioSeries: async () => ({
      portfolio: [{ t: '2026-01-01', usdCents: 100 }], index: { sparkline: [] },
      benchmark: { windows: { d7: { portfolioDeltaPct: 0.02, indexDeltaPct: 0.01, alphaPct: 0.01 } } },
      perHolding: {
        a1: {
          deltaPct30d: 0.04,
          alphaPct30d: 0.02,
          windows: { d7: { deltaPct: 0.02, alphaPct: 0.01 } },
        },
      },
      coverage: { included: 1, total: 1 }, attributionUrl: 'https://index.renaissos.com',
    }),
  });
  const { status, body } = await get(appWith(router), '/portfolio-series?wallet=0xABCDEF0123456789ABCDEF0123456789ABCDEF01');
  assert.equal(status, 200);
  assert.equal(seen.uid, 'u1');
  assert.equal(seen.wallet, '0xabcdef0123456789abcdef0123456789abcdef01'); // lower-cased
  assert.equal(body.coverage.included, 1);
  assert.equal(body.benchmark.windows.d7.alphaPct, 0.01);
  assert.equal(body.perHolding.a1.windows.d7.deltaPct, 0.02);
});
