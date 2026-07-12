import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJson,
  validateMerchantResponse,
  buildMerchantPrompt,
  isGeminiConfigured,
} from '../services/geminiMerchantService.js';

const goodLocale = {
  verdict: 'Hold this card for now.',
  rationale: '• Thin sales data.\n• Alpha is near flat.',
  caveats: ['Low liquidity'],
};

describe('extractJson', () => {
  it('parses bare JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  });

  it('strips markdown fences', () => {
    assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  });

  it('recovers JSON buried in prose', () => {
    assert.deepEqual(extractJson('here you go:\n{"a":3}\nthanks'), { a: 3 });
  });
});

describe('validateMerchantResponse', () => {
  it('accepts a complete three-locale payload', () => {
    const parsed = { en: goodLocale, zh_TW: goodLocale, ja: goodLocale };
    const v = validateMerchantResponse(parsed);
    assert.ok(v);
    assert.equal(v.en.verdict, goodLocale.verdict);
    assert.deepEqual(v.en.caveats, ['Low liquidity']);
  });

  it('accepts locale key aliases from model output', () => {
    const parsed = { en: goodLocale, 'zh-TW': goodLocale, jp: goodLocale };
    const v = validateMerchantResponse(parsed);
    assert.ok(v);
    assert.equal(v.zh_TW.verdict, goodLocale.verdict);
    assert.equal(v.ja.verdict, goodLocale.verdict);
  });

  it('normalizes rationale arrays and string caveats', () => {
    const parsed = {
      en: {
        verdict: 'Promote this card while momentum is favorable.',
        rationale: ['Momentum remains positive.', 'Liquidity looks decent.'],
        caveats: 'Recent comps are still somewhat thin.',
      },
      zh_TW: goodLocale,
      ja: goodLocale,
    };
    const v = validateMerchantResponse(parsed);
    assert.ok(v);
    assert.equal(v.en.rationale, '• Momentum remains positive.\n• Liquidity looks decent.');
    assert.deepEqual(v.en.caveats, ['Recent comps are still somewhat thin.']);
  });

  it('rejects missing locales', () => {
    assert.equal(validateMerchantResponse({ en: goodLocale, zh_TW: goodLocale }), null);
  });

  it('rejects empty verdict/rationale', () => {
    const bad = { ...goodLocale, verdict: '' };
    assert.equal(
      validateMerchantResponse({ en: bad, zh_TW: goodLocale, ja: goodLocale }),
      null,
    );
  });
});

describe('buildMerchantPrompt', () => {
  it('includes the decision and card identity', () => {
    const p = buildMerchantPrompt(
      { cardName: 'Charizard', setName: 'Base', grade: 'PSA 10' },
      { decision: 'promote', alphaPct30d: 0.12, thinMarketData: false, renaissFmv: { priceUsdCents: 4200 } },
    );
    assert.match(p, /Charizard/);
    assert.match(p, /promote/);
    assert.match(p, /\+12\.0%/);
    assert.match(p, /\$42\.00/);
  });
});

describe('isGeminiConfigured', () => {
  it('is a boolean gate over GEMINI_API_KEY', () => {
    assert.equal(typeof isGeminiConfigured(), 'boolean');
  });
});
