import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';
import { CERT_SHAPE } from '../lib/inventoryItem.js';

describe('DEFAULT_PORTFOLIO_ITEMS', () => {
  it('has 18 cards', () => assert.equal(DEFAULT_PORTFOLIO_ITEMS.length, 18));
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
});
