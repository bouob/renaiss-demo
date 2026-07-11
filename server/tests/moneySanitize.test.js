import { describe, it, expect } from 'vitest';
import {
  sanitizeMoney,
  sanitizeQty,
  sanitizeNonNegInt,
  MAX_MONEY,
} from '../lib/moneySanitize.js';

describe('sanitizeMoney', () => {
  it('accepts zero and cents', () => {
    expect(sanitizeMoney(0)).toBe(0);
    expect(sanitizeMoney('12.345')).toBe(12.35);
    expect(sanitizeMoney(12.344)).toBe(12.34);
  });
  it('rejects negative, NaN, scientific, over max', () => {
    expect(sanitizeMoney(-1)).toBeNull();
    expect(sanitizeMoney('1e6')).toBeNull();
    expect(sanitizeMoney(Infinity)).toBeNull();
    expect(sanitizeMoney(MAX_MONEY + 1)).toBeNull();
  });
  it('blank → null', () => {
    expect(sanitizeMoney('')).toBeNull();
    expect(sanitizeMoney(null)).toBeNull();
  });
});

describe('sanitizeQty', () => {
  it('clamps and defaults', () => {
    expect(sanitizeQty(null)).toBe(1);
    expect(sanitizeQty(0)).toBe(1);
    expect(sanitizeQty(3)).toBe(3);
    expect(sanitizeQty(99999)).toBe(9999);
  });
});

describe('sanitizeNonNegInt', () => {
  it('rejects non-integers and negatives', () => {
    expect(sanitizeNonNegInt(1.5)).toBeNull();
    expect(sanitizeNonNegInt(-2)).toBeNull();
    expect(sanitizeNonNegInt(42)).toBe(42);
  });
});
