/**
 * Drift guard for the one constant that is deliberately duplicated across the
 * client/server boundary: DEMO_PROMOTE_ALPHA_BY_CERT.
 *
 * The client needs these values in guest mode (no Firebase → no server-side
 * seeding, so rows never carry a persisted alphaPct30d), and client code may
 * not import server code. Both copies are pure, import-free constants, so this
 * test reaches across for comparison only — nothing here ships at runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_PROMOTE_ALPHA_BY_CERT as SERVER_ALPHA } from '../services/defaultPortfolioSeed.js';
import { DEMO_PROMOTE_ALPHA_BY_CERT as CLIENT_ALPHA } from '../../client/src/lib/merchantCopilot.js';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';

describe('DEMO_PROMOTE_ALPHA_BY_CERT parity', () => {
  it('client mirror matches the server source of truth', () => {
    assert.deepEqual(
      Object.fromEntries(SERVER_ALPHA),
      { ...CLIENT_ALPHA },
      'server/services/defaultPortfolioSeed.js and client/src/lib/merchantCopilot.js have drifted — edit the server copy first, then mirror it',
    );
  });

  it('every marquee cert actually exists in the seed list', () => {
    const seeded = new Set(DEFAULT_PORTFOLIO_ITEMS.map((item) => item.cert));
    for (const cert of SERVER_ALPHA.keys()) {
      assert.ok(seeded.has(cert), `${cert} has a demo alpha but is not in DEFAULT_PORTFOLIO_ITEMS`);
    }
  });
});
