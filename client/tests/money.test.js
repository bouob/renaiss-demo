import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatUsdCents,
  centsToUsd,
  formatUsd,
  formatUsdSigned,
} from '../src/lib/money.js';

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

describe('formatUsd', () => {
  it('renders dollars with the sign outside the $', () => {
    assert.equal(formatUsd(42), '$42.00');
    assert.equal(formatUsd(10433.61), '$10433.61');
    assert.equal(formatUsd(0), '$0.00');
    assert.equal(formatUsd(-544.75), '-$544.75');
    assert.equal(formatUsd(-9.62), '-$9.62');
  });

  it('never produces the $- prefix that toFixed alone would yield for negatives', () => {
    assert.notEqual(formatUsd(-5), '$-5.00');
    assert.ok(!formatUsd(-5).startsWith('$-'));
  });

  it('renders an em dash for non-finite values', () => {
    for (const bad of [null, undefined, NaN, Infinity, -Infinity, '5', {}]) {
      assert.equal(formatUsd(bad), EM_DASH, `expected em dash for ${JSON.stringify(bad)}`);
    }
  });
});

describe('formatUsdSigned', () => {
  it('prefixes + for profit and - for loss', () => {
    assert.equal(formatUsdSigned(1.02), '+$1.02');
    assert.equal(formatUsdSigned(71.61), '+$71.61');
    assert.equal(formatUsdSigned(-9.62), '-$9.62');
    assert.equal(formatUsdSigned(-636.7), '-$636.70');
    assert.equal(formatUsdSigned(0), '$0.00');
  });

  it('renders an em dash for non-finite values', () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      assert.equal(formatUsdSigned(bad), EM_DASH);
    }
  });
});
