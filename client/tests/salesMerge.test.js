import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeSalesResponses,
  summarizeSales,
  collectSalesWallets,
} from '../src/lib/salesMerge.js';

describe('summarizeSales', () => {
  it('skips TRANSFER_OUT from money totals', () => {
    const s = summarizeSales([
      { saleType: 'MARKETPLACE', soldPriceUsd: 10, costBasisUsd: 4, realizedPnlUsd: 6 },
      { saleType: 'TRANSFER_OUT', soldPriceUsd: 99, costBasisUsd: 99, realizedPnlUsd: 0 },
    ]);
    assert.equal(s.count, 1);
    assert.equal(s.totalCount, 2);
    assert.equal(s.totalSoldUsd, 10);
    assert.equal(s.totalRealizedPnlUsd, 6);
  });
});

describe('mergeSalesResponses', () => {
  it('dedupes by id and sorts newest first', () => {
    const { sales, summary } = mergeSalesResponses([
      {
        sales: [
          { id: '1', soldAt: '2026-01-01', soldPriceUsd: 1, costBasisUsd: 1, realizedPnlUsd: 0, saleType: 'MARKETPLACE' },
          { id: '2', soldAt: '2026-03-01', soldPriceUsd: 5, costBasisUsd: 2, realizedPnlUsd: 3, saleType: 'MARKETPLACE' },
        ],
      },
      {
        sales: [
          { id: '2', soldAt: '2026-03-01', soldPriceUsd: 5, costBasisUsd: 2, realizedPnlUsd: 3, saleType: 'MARKETPLACE' },
        ],
      },
    ]);
    assert.deepEqual(sales.map((s) => s.id), ['2', '1']);
    assert.equal(summary.count, 2);
    assert.equal(summary.totalSoldUsd, 6);
  });
});

describe('collectSalesWallets', () => {
  it('excludes the demo synthetic wallet and includes lastWallet', () => {
    const demo = '0x1bcff45abb471cfab483799d0ebfe090bc709dba';
    const real = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const last = '0xcccccccccccccccccccccccccccccccccccccccc';
    const wallets = collectSalesWallets(
      [{ wallet: demo }, { wallet: real }],
      demo,
      last,
    );
    assert.deepEqual(wallets.sort(), [last, real].sort());
  });
});
