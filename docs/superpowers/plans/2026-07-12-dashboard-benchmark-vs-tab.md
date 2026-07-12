# Dashboard Benchmark Panel (Index / Vs tabs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed benchmark panel to the Dashboard so signed-in users can toggle between the existing Index view and a "My Collection vs Market" dual-line chart comparing their inventory to the Renaiss OS Index.

**Architecture:** The backend `/portfolio-series` endpoint, its API client (`portfolioSeriesApi.js`), and all `benchmark.*` i18n copy already exist. This plan adds only client UI: a pure rebase/alpha helper module (unit-tested via `node --test`), a `BenchmarkVsChart` presentational component, and a `BenchmarkPanel` tab wrapper that replaces the direct `<IndexTile>` render on the Dashboard. Wallet resolution is factored into a shared util reused by both Dashboard and the panel.

**Tech Stack:** React 18 (function components, hooks), react-i18next, Vite, plain SVG for charts, `node --test` + `node:assert/strict` for pure-helper unit tests.

## Global Constraints

- No backend, API-client, or i18n changes — all present. Use existing `benchmark.*` keys verbatim; do not invent copy.
- Wallet normalization rule is exactly `/^0x[0-9a-fA-F]{40}$/`, lowercased; localStorage key is `merchant_last_wallet`. One shared implementation only.
- The `/portfolio-series` endpoint is fail-open (HTTP 200 with empty payload). Branch UI on payload shape, never on HTTP status; a thrown fetch renders an empty state, never an error toast.
- The Vs tab must be unreachable for signed-out users (no unauthenticated fetch path).
- Payload shape: `{ portfolio: Array<{t:string,usdCents:number}>, index: {sparkline:Array<{t,usdCents}>, deltas:{d7,d30}, updatedAt:string}|null, perHolding, coverage:{included:number,total:number}, attributionUrl:string }`.
- Match existing code idioms: modal = `.modal-backdrop`/`.modal-panel` pattern (see `SoldHistoryModal.jsx`); `dateLocale` derived as `i18n.language === 'ja' ? 'ja-JP' : i18n.language === 'zh-TW' ? 'zh-TW' : 'en-US'`.

---

### Task 1: Shared wallet-resolution util

Factor the wallet key + normalization out of `Dashboard.jsx` so `BenchmarkPanel` can reuse the identical rule (DRY; avoids a second regex drifting).

**Files:**
- Create: `client/src/lib/lastWallet.js`
- Modify: `client/src/pages/Dashboard.jsx:12-17` (remove local `LAST_WALLET_KEY` + `normalizeWallet`, import from util) and `:79` (call site)

**Interfaces:**
- Produces:
  - `LAST_WALLET_KEY: string` (= `'merchant_last_wallet'`)
  - `normalizeWallet(addr: unknown): string` — returns lowercased address if it matches `/^0x[0-9a-fA-F]{40}$/`, else `''`
  - `readLastWallet(): string` — reads `localStorage[LAST_WALLET_KEY]`, returns `normalizeWallet` of it, `''` on any storage error

- [ ] **Step 1: Create the util module**

Create `client/src/lib/lastWallet.js`:

```js
export const LAST_WALLET_KEY = 'merchant_last_wallet';

/** Lowercased 0x-address if well-shaped, else empty string. */
export function normalizeWallet(addr) {
  const wallet = String(addr ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(wallet) ? wallet.toLowerCase() : '';
}

/** Wallet last loaded in Inventory, from localStorage; '' if unset/unavailable. */
export function readLastWallet() {
  try {
    return normalizeWallet(localStorage.getItem(LAST_WALLET_KEY));
  } catch {
    return '';
  }
}
```

- [ ] **Step 2: Update Dashboard to import the util**

In `client/src/pages/Dashboard.jsx`, delete the local `const LAST_WALLET_KEY = ...` (line 12) and the `function normalizeWallet(addr) { ... }` block (lines 14-17), and add to the import group near the top:

```jsx
import { readLastWallet } from '../lib/lastWallet.js';
```

Then in the inventory effect, replace the wallet-resolution block:

```jsx
        let wallet = '';
        try {
          wallet = normalizeWallet(localStorage.getItem(LAST_WALLET_KEY));
        } catch { /* ignore unavailable storage */ }
        const metaRes = await fetchMeta({ authToken: token, wallet: wallet || undefined });
```

with:

```jsx
        const wallet = readLastWallet();
        const metaRes = await fetchMeta({ authToken: token, wallet: wallet || undefined });
```

- [ ] **Step 3: Verify the app still builds/syntax-checks**

Run: `node --check client/src/lib/lastWallet.js`
Expected: no output (exit 0).

Run: `cd client && npx vite build` (or `npm run build --prefix client` from repo root)
Expected: build completes with no errors referencing `Dashboard.jsx` or an undefined `normalizeWallet`/`LAST_WALLET_KEY`.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/lastWallet.js client/src/pages/Dashboard.jsx
git commit -m "refactor(client): extract shared lastWallet util from Dashboard"
```

---

### Task 2: Pure rebase + alpha helpers (TDD)

Pure functions with no React/i18n imports so they run under `node --test`. This is the only unit-tested task.

**Files:**
- Create: `client/src/lib/benchmarkSeries.js`
- Create: `client/tests/benchmarkSeries.test.js`
- Modify: `client/package.json` (add a `test` script)

**Interfaces:**
- Produces:
  - `rebaseToShared(portfolio, indexSparkline): { portfolioRebased: Array<{t:string,v:number}>, indexRebased: Array<{t:string,v:number}>, baseDate: string } | null`
    - `portfolio` and `indexSparkline` are `Array<{t:string, usdCents:number}>`.
    - Finds the earliest date present in **both** series (with a finite `usdCents`) as `baseDate`; returns `null` if none.
    - For each series, over the ascending set of shared dates from `baseDate` onward, emits `{ t, v: usdCents / baseValue * 100 }` where `baseValue` is that series' value on `baseDate`.
  - `computeAlpha(portfolioRebased, indexRebased): number`
    - Returns `(lastPortfolioV - 100) - (lastIndexV - 100)` = percentage-point outperformance. `0` if either array is empty.

- [ ] **Step 1: Write the failing tests**

Create `client/tests/benchmarkSeries.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test client/tests/benchmarkSeries.test.js`
Expected: FAIL — cannot resolve `../src/lib/benchmarkSeries.js` (module not found).

- [ ] **Step 3: Write the implementation**

Create `client/src/lib/benchmarkSeries.js`:

```js
/**
 * Pure helpers for the Dashboard benchmark "inventory vs index" chart.
 * No React/i18n imports so they run under `node --test`.
 */

function toValueMap(series) {
  const map = new Map();
  for (const point of series ?? []) {
    const t = point?.t;
    const v = point?.usdCents;
    if (typeof t === 'string' && Number.isFinite(v)) map.set(t, v);
  }
  return map;
}

/**
 * Rebase both series to 100 at the earliest date they share (finite on both).
 * Returns null when there is no shared date.
 */
export function rebaseToShared(portfolio, indexSparkline) {
  const pMap = toValueMap(portfolio);
  const iMap = toValueMap(indexSparkline);

  const sharedDates = [...pMap.keys()].filter((t) => iMap.has(t)).sort();
  if (sharedDates.length === 0) return null;

  const baseDate = sharedDates[0];
  const pBase = pMap.get(baseDate);
  const iBase = iMap.get(baseDate);
  if (!pBase || !iBase) return null;

  const portfolioRebased = sharedDates.map((t) => ({ t, v: (pMap.get(t) / pBase) * 100 }));
  const indexRebased = sharedDates.map((t) => ({ t, v: (iMap.get(t) / iBase) * 100 }));
  return { portfolioRebased, indexRebased, baseDate };
}

/** Percentage-point outperformance of the portfolio line over the index line. */
export function computeAlpha(portfolioRebased, indexRebased) {
  if (!portfolioRebased?.length || !indexRebased?.length) return 0;
  const pLast = portfolioRebased[portfolioRebased.length - 1].v;
  const iLast = indexRebased[indexRebased.length - 1].v;
  return (pLast - 100) - (iLast - 100);
}
```

- [ ] **Step 4: Add the client test script**

In `client/package.json`, add to `"scripts"`:

```json
    "test": "node --test tests/*.test.js"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --prefix client`
Expected: PASS — all `rebaseToShared` and `computeAlpha` tests green.

- [ ] **Step 6: Commit**

```bash
git add client/src/lib/benchmarkSeries.js client/tests/benchmarkSeries.test.js client/package.json
git commit -m "feat(client): pure rebase/alpha helpers for benchmark chart"
```

---

### Task 3: BenchmarkVsChart component

Presentational dual-line chart + summary + "learn more" modal. No data fetching (parent passes the payload).

**Files:**
- Create: `client/src/components/BenchmarkVsChart.jsx`
- Modify: `client/src/styles.css` (append chart + legend + modal-copy styles)

**Interfaces:**
- Consumes: `rebaseToShared`, `computeAlpha` from `../lib/benchmarkSeries.js`.
- Produces: default export `BenchmarkVsChart({ portfolio, index, coverage, dateLocale })` — `index` is the payload's `index` object (`{ sparkline, deltas, updatedAt }`). Renders `benchmark.vsNoBenchmark` when `rebaseToShared` returns null; otherwise the chart.

- [ ] **Step 1: Write the component**

Create `client/src/components/BenchmarkVsChart.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rebaseToShared, computeAlpha } from '../lib/benchmarkSeries.js';

const W = 480;
const H = 150;
const PAD = 10;
const PORTFOLIO_STROKE = '#7dd3fc'; // inventory line
const INDEX_STROKE = '#a78bfa';     // index line

function pathFrom(series, min, span) {
  const coords = series.map((pt, i) => {
    const x = PAD + (i / Math.max(1, series.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((pt.v - min) / span) * (H - PAD * 2);
    return `${x},${y}`;
  });
  return `M ${coords.join(' L ')}`;
}

function formatSignedPct(n) {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
}

export default function BenchmarkVsChart({ portfolio, index, coverage }) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);

  const rebased = useMemo(
    () => rebaseToShared(portfolio, index?.sparkline),
    [portfolio, index],
  );

  if (!rebased) {
    return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
  }

  const { portfolioRebased, indexRebased } = rebased;
  const alpha = computeAlpha(portfolioRebased, indexRebased);
  const allV = [...portfolioRebased, ...indexRebased].map((p) => p.v);
  const min = Math.min(...allV);
  const max = Math.max(...allV);
  const span = max - min || 1;

  const summaryKey = Math.abs(alpha) < 0.05
    ? 'benchmark.vsMatching'
    : alpha > 0 ? 'benchmark.vsBeating' : 'benchmark.vsTrailing';
  const summary = t(summaryKey, { pct: formatSignedPct(Math.abs(alpha)) });

  return (
    <div className="benchmark-vs">
      <div className="benchmark-vs-head">
        <p className="label" style={{ margin: 0 }}>{t('benchmark.vsTitle')}</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(true)}>
          {t('benchmark.learnMore')}
        </button>
      </div>

      <p className={`benchmark-vs-summary ${alpha >= 0 ? 'text-pos' : 'text-neg'}`}>{summary}</p>

      <div className="index-chart-frame">
        <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('benchmark.vsTitle')}>
          <path d={pathFrom(indexRebased, min, span)} fill="none" stroke={INDEX_STROKE}
                strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
          <path d={pathFrom(portfolioRebased, min, span)} fill="none" stroke={PORTFOLIO_STROKE}
                strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>

      <div className="benchmark-legend">
        <span className="benchmark-legend-item">
          <span className="benchmark-swatch" style={{ background: PORTFOLIO_STROKE }} />
          {t('benchmark.chartPortfolio')}
        </span>
        <span className="benchmark-legend-item">
          <span className="benchmark-swatch benchmark-swatch-dashed" style={{ background: INDEX_STROKE }} />
          {t('benchmark.chartIndex')}
        </span>
      </div>

      <p className="small benchmark-vs-note">{t('benchmark.rebasedNote')}</p>
      {coverage && (
        <p className="small benchmark-vs-coverage">
          {t('benchmark.coverage', { included: coverage.included, total: coverage.total })}
        </p>
      )}

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <div className="modal-panel" role="dialog" aria-modal="true"
               onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 className="modal-title">{t('benchmark.modalTitle')}</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setModalOpen(false)}>
                {t('benchmark.modalClose')}
              </button>
            </div>
            <div className="modal-body" style={{ gap: '0.75rem' }}>
              <p className="muted">{t('benchmark.modalP1')}</p>
              <p className="muted">{t('benchmark.modalP2')}</p>
              <p className="muted">{t('benchmark.modalP3')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append component styles**

Append to `client/src/styles.css`:

```css
.benchmark-vs-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.benchmark-vs-summary {
  margin: 0.4rem 0 0.6rem;
  font-weight: 600;
}
.benchmark-legend {
  display: flex;
  gap: 1.25rem;
  margin-top: 0.5rem;
  font-size: 0.8rem;
  color: var(--muted, rgba(255, 255, 255, 0.7));
}
.benchmark-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.benchmark-swatch {
  width: 14px;
  height: 3px;
  border-radius: 2px;
  display: inline-block;
}
.benchmark-swatch-dashed {
  background-image: none;
  opacity: 0.85;
  -webkit-mask-image: repeating-linear-gradient(90deg, #000 0 5px, transparent 5px 9px);
          mask-image: repeating-linear-gradient(90deg, #000 0 5px, transparent 5px 9px);
}
.benchmark-vs-note,
.benchmark-vs-coverage {
  margin: 0.35rem 0 0;
  opacity: 0.75;
}
```

- [ ] **Step 3: Syntax-check and build**

Run: `node --check client/src/components/BenchmarkVsChart.jsx`
Note: `--check` does not parse JSX; if it errors on JSX, skip it and rely on the build.

Run: `npm run build --prefix client`
Expected: build succeeds (component is not yet rendered anywhere, so this only proves it parses/imports cleanly).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BenchmarkVsChart.jsx client/src/styles.css
git commit -m "feat(client): BenchmarkVsChart dual-line inventory-vs-index chart"
```

---

### Task 4: BenchmarkPanel tab wrapper + Dashboard wiring

Tab bar wrapping IndexTile (Index tab) and the vs chart (Vs tab, signed-in only), with lazy fetch and state rendering. Then wire it into the Dashboard.

**Files:**
- Create: `client/src/components/BenchmarkPanel.jsx`
- Modify: `client/src/pages/Dashboard.jsx` (import + the `dashboard-index-card` render, ~line 156-158)
- Modify: `client/src/styles.css` (append tab-bar styles)

**Interfaces:**
- Consumes: `IndexTile` (`./IndexTile.jsx`), `BenchmarkVsChart` (`./BenchmarkVsChart.jsx`), `fetchPortfolioSeries` (`../lib/portfolioSeriesApi.js`), `readLastWallet` (`../lib/lastWallet.js`).
- Produces: default export `BenchmarkPanel({ index, user, getToken, dateLocale })`.

- [ ] **Step 1: Write the panel**

Create `client/src/components/BenchmarkPanel.jsx`:

```jsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import IndexTile from './IndexTile.jsx';
import BenchmarkVsChart from './BenchmarkVsChart.jsx';
import { fetchPortfolioSeries } from '../lib/portfolioSeriesApi.js';
import { readLastWallet } from '../lib/lastWallet.js';

const MIN_COVERED = 2;

export default function BenchmarkPanel({ index, user, getToken, dateLocale }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('index');
  const [series, setSeries] = useState(null); // resolved payload
  const [status, setStatus] = useState('idle'); // idle | loading | ready | nowallet

  // Reset when the signed-in user changes (avoid showing a prior account's data).
  useEffect(() => {
    setSeries(null);
    setStatus('idle');
    if (!user) setTab('index');
  }, [user]);

  const loadSeries = useCallback(async () => {
    setStatus('loading');
    const wallet = readLastWallet();
    if (!wallet) { setStatus('nowallet'); return; }
    try {
      const token = await getToken();
      if (!token) { setStatus('nowallet'); return; }
      const payload = await fetchPortfolioSeries({ authToken: token, wallet });
      setSeries(payload ?? null);
      setStatus('ready');
    } catch {
      setSeries(null);
      setStatus('ready'); // fail-open: render empty/no-benchmark state, not an error
    }
  }, [getToken]);

  const selectVs = useCallback(() => {
    setTab('vs');
    if (status === 'idle') loadSeries();
  }, [status, loadSeries]);

  // Guests: no tab bar, Index view only (zero visual change, no auth fetch path).
  if (!user) {
    return <IndexTile index={index} dateLocale={dateLocale} />;
  }

  return (
    <div className="benchmark-panel">
      <div className="benchmark-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'index'}
                className={`benchmark-tab ${tab === 'index' ? 'active' : ''}`}
                onClick={() => setTab('index')}>
          {t('benchmark.tabIndex')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'vs'}
                className={`benchmark-tab ${tab === 'vs' ? 'active' : ''}`}
                onClick={selectVs}>
          {t('benchmark.tabVs')}
        </button>
      </div>

      {tab === 'index' && <IndexTile index={index} dateLocale={dateLocale} />}

      {tab === 'vs' && (
        <div className="benchmark-vs-pane">
          {status === 'loading' && <div className="empty">{t('benchmark.loading')}</div>}
          {status === 'nowallet' && <div className="empty">{t('benchmark.vsNoWallet')}</div>}
          {status === 'ready' && (() => {
            if (!series || !series.index) {
              return <div className="empty">{t('benchmark.vsNoBenchmark')}</div>;
            }
            const included = series.coverage?.included ?? 0;
            if (included < MIN_COVERED || !series.portfolio?.length) {
              return (
                <div className="empty">
                  {t('benchmark.vsEmpty', {
                    included,
                    total: series.coverage?.total ?? 0,
                  })}
                </div>
              );
            }
            return (
              <BenchmarkVsChart
                portfolio={series.portfolio}
                index={series.index}
                coverage={series.coverage}
                dateLocale={dateLocale}
              />
            );
          })()}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Append tab-bar styles**

Append to `client/src/styles.css`:

```css
.benchmark-tabs {
  display: inline-flex;
  gap: 0.25rem;
  padding: 0.2rem;
  margin-bottom: 0.85rem;
  border-radius: 0.6rem;
  background: rgba(255, 255, 255, 0.05);
}
.benchmark-tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted, rgba(255, 255, 255, 0.7));
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 0.35rem 0.75rem;
  border-radius: 0.45rem;
  cursor: pointer;
}
.benchmark-tab.active {
  background: rgba(255, 255, 255, 0.12);
  color: var(--fg, #fff);
}
```

- [ ] **Step 3: Wire into the Dashboard**

In `client/src/pages/Dashboard.jsx`, replace the import of `IndexTile`:

```jsx
import IndexTile from '../components/IndexTile.jsx';
```

with:

```jsx
import BenchmarkPanel from '../components/BenchmarkPanel.jsx';
```

Then in the `dashboard-index-card` section, replace:

```jsx
              <section className="glass-card dashboard-index-card">
                <IndexTile index={index} dateLocale={dateLocale} />
              </section>
```

with:

```jsx
              <section className="glass-card dashboard-index-card">
                <BenchmarkPanel index={index} user={user} getToken={getToken} dateLocale={dateLocale} />
              </section>
```

- [ ] **Step 4: Build**

Run: `npm run build --prefix client`
Expected: build succeeds; no unused-import error for `IndexTile` in `Dashboard.jsx` (it is now imported only inside the panel).

- [ ] **Step 5: Drive the app to verify behavior**

Use the `verify` (or `run`) skill to launch the client + server, then confirm:
1. **Signed out:** Dashboard index card shows the Index view with **no tab bar** (unchanged).
2. **Signed in, no wallet loaded:** tab bar appears; clicking "My Collection vs Market" shows `benchmark.vsNoWallet` copy.
3. **Signed in, wallet with priced holdings loaded via Inventory:** the Vs tab shows the dual-line chart, legend, summary (beating/trailing/matching), rebased note, and coverage line; "Learn more" opens and closes the modal.
4. Switching back to the Index tab restores the original IndexTile view; re-selecting Vs does not refetch.

- [ ] **Step 6: Commit**

```bash
git add client/src/components/BenchmarkPanel.jsx client/src/pages/Dashboard.jsx client/src/styles.css
git commit -m "feat(client): benchmark panel tabs (Index / My Collection vs Market) on Dashboard"
```

---

## Self-Review

**Spec coverage:**
- BenchmarkPanel with Index/Vs tabs, guest fallback, lazy fetch, render-state table → Task 4. ✓
- BenchmarkVsChart dual-line rebased chart, legend, summary, coverage, learn-more modal → Task 3. ✓
- `rebaseToShared` + `computeAlpha` pure helpers with unit tests → Task 2. ✓
- Dashboard swap of `<IndexTile>` for `<BenchmarkPanel>` → Task 4, Step 3. ✓
- styles.css additions → Tasks 3 & 4. ✓
- Wallet resolution reusing the exact `merchant_last_wallet` + regex rule → Task 1 (shared util), consumed in Task 4. ✓
- Fail-open branching on payload shape, never HTTP status → Task 4 `loadSeries` catch → `status: 'ready'` with empty state. ✓
- `included < 2` threshold for `vsEmpty` → Task 4 `MIN_COVERED`. ✓
- No backend/API/i18n changes → confirmed; all keys referenced exist in `benchmark.*`. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code. ✓

**Type consistency:** `rebaseToShared`/`computeAlpha` signatures match between Task 2 definition and Task 3 usage; `BenchmarkVsChart` props (`portfolio`, `index`, `coverage`, `dateLocale`) match between Task 3 definition and Task 4 usage; `readLastWallet` produced in Task 1 and consumed in Task 4; payload fields (`index.sparkline`, `coverage.included/total`, `portfolio`) match the Global Constraints shape. ✓

**Note for implementer:** `computeAlpha`'s output is percentage points off the shared rebased base — the summary passes `Math.abs(alpha)` to the copy (which already says "beating/trailing by {{pct}}"), and the sign selects beating vs trailing.
