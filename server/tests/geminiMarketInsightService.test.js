import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJson,
  validateMarketInsightResponse,
  buildMarketInsightPrompt,
  isGeminiConfigured,
} from '../services/geminiMarketInsightService.js';

const goodLocale = {
  short7d: { title: 'Short-term tone', body: 'The market stayed constructive over the last week. Momentum is positive, but the move is still narrow.' },
  mid30d: { title: '30-day reset', body: 'The 30-day view is softer than the 7-day bounce. That suggests recent stabilization rather than a full recovery.' },
  long365d: { title: 'Long arc intact', body: 'The 365-day trend remains positive. The market is still well above last year despite recent chop.' },
};

describe('extractJson', () => {
  it('parses bare JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  it('recovers JSON wrapped in fences', () => {
    assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  });
});

describe('validateMarketInsightResponse', () => {
  it('accepts a complete three-locale payload', () => {
    const parsed = { en: goodLocale, zh_TW: goodLocale, ja: goodLocale, ko: goodLocale };
    const v = validateMarketInsightResponse(parsed);
    assert.ok(v);
    assert.equal(v.en.short7d.title, 'Short-term tone');
  });

  it('accepts locale aliases', () => {
    const parsed = { en: goodLocale, 'zh-TW': goodLocale, jp: goodLocale, korean: goodLocale };
    const v = validateMarketInsightResponse(parsed);
    assert.ok(v);
    assert.equal(v.zh_TW.mid30d.title, '30-day reset');
    assert.equal(v.ko.long365d.title, 'Long arc intact');
  });

  it('rejects missing periods', () => {
    assert.equal(validateMarketInsightResponse({ en: goodLocale, zh_TW: goodLocale, ja: { short7d: goodLocale.short7d }, ko: goodLocale }), null);
  });
});

describe('buildMarketInsightPrompt', () => {
  it('includes official 7/30/365 windows', () => {
    const p = buildMarketInsightPrompt({
      label: 'Pokemon Index',
      value: 123.45,
      deltas: { d7: 0.01, d30: -0.02, d365: 0.3 },
      constituentCount: 50,
      updatedAt: '2026-07-13T00:00:00.000Z',
    });
    assert.match(p, /Past 7 days: \+1\.00%/);
    assert.match(p, /Past 30 days: -2\.00%/);
    assert.match(p, /Past 365 days: \+30\.00%/);
  });
});

describe('isGeminiConfigured', () => {
  it('is a boolean gate over GEMINI_API_KEY', () => {
    assert.equal(typeof isGeminiConfigured(), 'boolean');
  });
});
