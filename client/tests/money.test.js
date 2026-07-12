import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatUsdCents, centsToUsd } from '../src/lib/money.js';

const EM_DASH = '—';

describe('formatUsdCents', () => {
  it('renders cents as a two-decimal dollar string', () => {
    assert.equal(formatUsdCents(4200), '$42.00');
    assert.equal(formatUsdCents(124099), '$1240.99');
    assert.equal(formatUsdCents(1), '$0.01');
    assert.equal(formatUsdCents(0), '$0.00');
  });

  it('renders an em dash for every non-numeric value the upstream can send', () => {
    // priceUsdCents is `null` for an unpriced card; a malformed payload could
    // send a string, which would otherwise coerce into a plausible-looking price.
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, '4200', '', {}, []]) {
      assert.equal(formatUsdCents(bad), EM_DASH, `expected em dash for ${JSON.stringify(bad)}`);
    }
  });
});

describe('centsToUsd', () => {
  it('converts cents to a dollar number', () => {
    assert.equal(centsToUsd(4200), 42);
    assert.equal(centsToUsd(1), 0.01);
    assert.equal(centsToUsd(0), 0);
  });

  it('returns null (not 0) for non-numeric values so callers can propagate it', () => {
    // 0 would be a real price and would defeat a `?? fallback` downstream.
    for (const bad of [null, undefined, NaN, Infinity, '4200', {}]) {
      assert.equal(centsToUsd(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });
});
