import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeMoney,
  sanitizeQty,
  sanitizeNonNegInt,
  MAX_MONEY,
} from '../lib/moneySanitize.js';

describe('sanitizeMoney', () => {
  it('accepts zero and rounds to cents', () => {
    assert.equal(sanitizeMoney(0), 0);
    assert.equal(sanitizeMoney('12.345'), 12.35);
    assert.equal(sanitizeMoney(12.344), 12.34);
  });
  it('rejects negative, scientific, over max', () => {
    assert.equal(sanitizeMoney(-1), null);
    assert.equal(sanitizeMoney('1e6'), null);
    assert.equal(sanitizeMoney(Infinity), null);
    assert.equal(sanitizeMoney(MAX_MONEY + 1), null);
  });
  it('blank → null', () => {
    assert.equal(sanitizeMoney(''), null);
    assert.equal(sanitizeMoney(null), null);
  });
});

describe('sanitizeQty', () => {
  it('clamps and defaults', () => {
    assert.equal(sanitizeQty(null), 1);
    assert.equal(sanitizeQty(0), 1);
    assert.equal(sanitizeQty(3), 3);
    assert.equal(sanitizeQty(99999), 9999);
  });
});

describe('sanitizeNonNegInt', () => {
  it('rejects non-integers and negatives', () => {
    assert.equal(sanitizeNonNegInt(1.5), null);
    assert.equal(sanitizeNonNegInt(-2), null);
    assert.equal(sanitizeNonNegInt(42), 42);
  });
});
