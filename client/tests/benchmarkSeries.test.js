import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rebaseToShared, computeAlpha } from '../src/lib/benchmarkSeries.js';

describe('rebaseToShared', () => {
  it('rebases both series to 100 at the earliest shared date', () => {
    const portfolio = [
      { t: '2026-06-01', usdCents: 200 },
      { t: '2026-06-02', usdCents: 220 },
    ];
    const index = [
      { t: '2026-06-01', usdCents: 1000 },
      { t: '2026-06-02', usdCents: 1050 },
    ];
    const out = rebaseToShared(portfolio, index);
    assert.equal(out.baseDate, '2026-06-01');
    assert.deepEqual(out.portfolioRebased, [
      { t: '2026-06-01', v: 100 },
      { t: '2026-06-02', v: 110 },
    ]);
    assert.deepEqual(out.indexRebased, [
      { t: '2026-06-01', v: 100 },
      { t: '2026-06-02', v: 105 },
    ]);
  });

  it('uses the earliest date present in BOTH series as the base', () => {
    const portfolio = [
      { t: '2026-06-01', usdCents: 50 },
      { t: '2026-06-02', usdCents: 200 },
      { t: '2026-06-03', usdCents: 240 },
    ];
    const index = [
      { t: '2026-06-02', usdCents: 1000 },
      { t: '2026-06-03', usdCents: 1100 },
    ];
    const out = rebaseToShared(portfolio, index);
    assert.equal(out.baseDate, '2026-06-02');
    assert.deepEqual(out.portfolioRebased, [
      { t: '2026-06-02', v: 100 },
      { t: '2026-06-03', v: 120 },
    ]);
  });

  it('returns null when the series share no date', () => {
    const portfolio = [{ t: '2026-06-01', usdCents: 200 }];
    const index = [{ t: '2026-07-01', usdCents: 1000 }];
    assert.equal(rebaseToShared(portfolio, index), null);
  });

  it('ignores non-finite points when picking the base date', () => {
    const portfolio = [
      { t: '2026-06-01', usdCents: null },
      { t: '2026-06-02', usdCents: 200 },
    ];
    const index = [
      { t: '2026-06-01', usdCents: 1000 },
      { t: '2026-06-02', usdCents: 1000 },
    ];
    const out = rebaseToShared(portfolio, index);
    assert.equal(out.baseDate, '2026-06-02');
  });
});

describe('computeAlpha', () => {
  it('returns portfolio outperformance in percentage points', () => {
    const alpha = computeAlpha(
      [{ t: 'a', v: 100 }, { t: 'b', v: 110 }],
      [{ t: 'a', v: 100 }, { t: 'b', v: 105 }],
    );
    assert.equal(alpha, 5);
  });

  it('is negative when the portfolio trails', () => {
    const alpha = computeAlpha(
      [{ t: 'a', v: 100 }, { t: 'b', v: 102 }],
      [{ t: 'a', v: 100 }, { t: 'b', v: 108 }],
    );
    assert.equal(alpha, -6);
  });

  it('returns 0 for empty input', () => {
    assert.equal(computeAlpha([], []), 0);
  });
});
