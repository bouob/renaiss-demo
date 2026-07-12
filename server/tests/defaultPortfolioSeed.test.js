import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';
import { CERT_SHAPE } from '../lib/inventoryItem.js';

describe('DEFAULT_PORTFOLIO_ITEMS', () => {
  it('has 46 cards', () => assert.equal(DEFAULT_PORTFOLIO_ITEMS.length, 46));
  it('has unique valid certs', () => {
    const certs = DEFAULT_PORTFOLIO_ITEMS.map((i) => i.cert);
    assert.equal(new Set(certs).size, certs.length);
    for (const cert of certs) assert.ok(CERT_SHAPE.test(cert));
  });
  it('has the fields needed for inventory display', () => {
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      assert.ok(item.name && item.grade && item.imageUrl.startsWith('https://'));
      assert.ok(item.href.startsWith('/card/'));
      assert.equal(item.status, 'active');
    }
  });

  it('includes demo promote fallbacks for marquee cards', () => {
    for (const cert of ['PSA122603338', 'PSA161025105', 'PSA151789461']) {
      const item = DEFAULT_PORTFOLIO_ITEMS.find((candidate) => candidate.cert === cert);
      assert.ok(item);
      assert.ok(item.alphaPct30d >= 0.08);
    }
  });
  it('fakes cost and selectively leaves list price empty around FMV', () => {
    const priced = DEFAULT_PORTFOLIO_ITEMS.filter((item) => Number.isFinite(item.priceUsdCents));
    assert.ok(priced.every((item) => Number.isFinite(item.cost)));
    assert.ok(priced.some((item) => item.listPrice == null));
    assert.ok(priced.some((item) => Number.isFinite(item.listPrice)));
    for (const item of priced) {
      const fmv = item.priceUsdCents / 100;
      for (const value of [item.cost, item.listPrice].filter(Number.isFinite)) {
        assert.ok(value >= fmv * 0.75 && value <= fmv * 1.25);
      }
    }
  });
});
