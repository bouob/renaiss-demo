# Dashboard Benchmark Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tabbed benchmark panel to the Dashboard — an index view plus a signed-in-only "My Collection vs Market → Inventory Performance" comparison chart.

**Architecture:** A new fail-open `GET /portfolio-series` route exposes the already-ported `buildPortfolioSeries` builder (inventory certs → `getGradedFmv` enrichment → wall summary → rebased series). The Dashboard's left glass-card becomes a `BenchmarkPanel` that shows only `IndexTile` when signed out, and adds tabs + a Recharts comparison chart when signed in.

**Tech Stack:** Node/Express (ESM, `node --test`), React 18 + Vite, react-i18next, Recharts (new), plain CSS classes, Firebase Admin/Auth.

## Global Constraints

- **Signed-out hides the switcher and VS chart entirely** — no tabs, no "sign in" prompt; signed-out renders only `<IndexTile>`. Tabs + VS appear only when a Firebase `user` is present.
- **Defensive against upstream shape** — null-check every field read from the Renaiss index. `deltas.d30` is `number | null`; a null `d30` MUST render a neutral headline, never a comparison against 0.
- **Firestore collections are `hackathon`-prefixed** — this plan adds no new collection (reads existing `hackathonMerchantInventory`); any future cache doc must be `hackathon…`.
- **Fail-open** — the route returns HTTP 200 with an empty payload on any data gap; never 5xx for missing data.
- **Client verification is manual** — no client test harness exists; verify client tasks by driving the app (`/run` or `/verify`). Only add `recharts` to client deps — no test tooling.
- **Wallet source on the Dashboard** is `localStorage['merchant_last_wallet']` (the key `Inventory.jsx` writes as `LAST_WALLET_KEY`).

---

### Task 1: Backend `/portfolio-series` route

**Files:**
- Create: `server/routes/portfolioSeries.js`
- Modify: `server/app.js` (import + mount, near lines 12-20 and the `router.use` block)
- Modify: `server/package.json:15` (add test file to the `test` script)
- Test: `server/tests/portfolioSeries.test.js`

**Interfaces:**
- Consumes: `requireAuth` from `../middleware/requireAuth.js` (sets `req.uid`); `getGradedFmv(cert)` from `../services/renaissOsIndex.js` → `{ found, href, priceUsdCents, ... } | null`; `buildPortfolioSeries({ holdings, summary })` and `ATTRIBUTION_URL` from `../services/renaissPortfolioSeries.js`; `readWallCache()` from `../services/wallCache.js`; `fetchWallSummary()` from `./wall.js`; `adminDb` from `../services/firebaseAdmin.js`.
- Produces: Express `Router` default export mounted under `/merchant/api` and `/api`. Response shape: `{ portfolio: Array<{t,usdCents}>, index: object|null, perHolding: object, coverage: {included:number,total:number}, attributionUrl: string }`.

- [ ] **Step 1: Write the failing test**

Create `server/tests/portfolioSeries.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// Build the router with injected fakes so the test needs no Firebase/network.
import { createPortfolioSeriesRouter } from '../routes/portfolioSeries.js';

function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function get(app, path, headers = {}) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const fakeAuth = (req, _res, next) => { req.uid = 'u1'; next(); };

test('401 when auth middleware rejects', async () => {
  const router = createPortfolioSeriesRouter({
    requireAuth: (_req, res) => res.status(401).json({ error: 'no token' }),
    loadHoldings: async () => [],
    getSummary: async () => null,
    buildPortfolioSeries: async () => ({}),
  });
  const { status } = await get(appWith(router), '/portfolio-series');
  assert.equal(status, 401);
});

test('fail-open: no summary -> 200 empty payload', async () => {
  const router = createPortfolioSeriesRouter({
    requireAuth: fakeAuth,
    loadHoldings: async () => [{ cert: 'PSA1', renaissFmv: { found: true, href: '/card/pokemon/base/1' } }],
    getSummary: async () => null,
    buildPortfolioSeries: async ({ summary }) => ({
      portfolio: [], index: null, perHolding: {},
      coverage: { included: 0, total: 1 }, attributionUrl: 'https://index.renaissos.com',
    }),
  });
  const { status, body } = await get(appWith(router), '/portfolio-series?wallet=0xabc');
  assert.equal(status, 200);
  assert.deepEqual(body.portfolio, []);
  assert.equal(body.index, null);
  assert.equal(body.coverage.total, 1);
});

test('happy path: passes holdings + summary to builder, returns its payload', async () => {
  let seen = null;
  const router = createPortfolioSeriesRouter({
    requireAuth: fakeAuth,
    loadHoldings: async (uid, wallet) => { seen = { uid, wallet }; return [{ cert: 'PSA1', renaissFmv: { found: true, href: '/card/pokemon/base/1' } }]; },
    getSummary: async () => ({ sparkline: [{ t: '2026-01-01', usdCents: 100 }], deltas: { d30: 0.02 } }),
    buildPortfolioSeries: async () => ({
      portfolio: [{ t: '2026-01-01', usdCents: 100 }], index: { sparkline: [] },
      perHolding: {}, coverage: { included: 1, total: 1 }, attributionUrl: 'https://index.renaissos.com',
    }),
  });
  const { status, body } = await get(appWith(router), '/portfolio-series?wallet=0xABC');
  assert.equal(status, 200);
  assert.equal(seen.uid, 'u1');
  assert.equal(seen.wallet, '0xabc'); // lower-cased
  assert.equal(body.coverage.included, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/portfolioSeries.test.js`
Expected: FAIL — `Cannot find module '../routes/portfolioSeries.js'` / `createPortfolioSeriesRouter is not a function`.

- [ ] **Step 3: Write the route**

Create `server/routes/portfolioSeries.js`:

```js
/**
 * GET /portfolio-series — signed-in "my inventory vs the index" series.
 *
 * Sources the user's held certs (wallet-scoped) from Firestore, enriches each
 * with getGradedFmv (renaissFmv.href is produced at scan time and NOT persisted
 * in the inventory doc, so it is re-derived here), reads the cached /wall
 * summary, and hands both to the already-ported buildPortfolioSeries.
 *
 * Fail-open: any gap (no wallet, no holdings, cold summary, adapter disabled)
 * returns HTTP 200 with an empty payload — never 5xx for missing data.
 *
 * The default export wires the real dependencies; createPortfolioSeriesRouter
 * takes them as injectable params so the route is unit-testable without
 * Firebase or the network.
 */

import { Router } from 'express';
import { requireAuth as realRequireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { getGradedFmv } from '../services/renaissOsIndex.js';
import { buildPortfolioSeries as realBuild, ATTRIBUTION_URL } from '../services/renaissPortfolioSeries.js';
import { readWallCache } from '../services/wallCache.js';
import { fetchWallSummary } from './wall.js';
import { isValidAddressShape } from '../lib/walletGuard.js';

const INVENTORY_COLLECTION = 'hackathonMerchantInventory';

function sanitizeWallet(v) {
  const w = typeof v === 'string' ? v.trim() : '';
  if (!isValidAddressShape(w)) return null;
  return w.toLowerCase();
}

// Read held certs for uid+wallet, then enrich each with its FMV (found+href),
// which is what buildPortfolioSeries groups on. Certs with no FMV still return
// (renaissFmv: null) — the builder skips them via `!holding.renaissFmv?.found`.
async function realLoadHoldings(uid, wallet) {
  if (!adminDb || !wallet) return [];
  const snap = await adminDb.collection(INVENTORY_COLLECTION).doc(uid).collection('items').get();
  const certs = snap.docs
    .map((d) => ({ cert: d.data()?.cert || d.id, wallet: d.data()?.wallet }))
    .filter((row) => (typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '') === wallet)
    .map((row) => row.cert);

  const holdings = [];
  for (const cert of certs) {
    const renaissFmv = await getGradedFmv(cert); // null-safe: adapter never throws
    holdings.push({ cert, renaissFmv });
  }
  return holdings;
}

// Warm cache first; only compute a fresh summary if the /wall cache is cold.
async function realGetSummary() {
  return readWallCache() ?? (await fetchWallSummary());
}

export function createPortfolioSeriesRouter({
  requireAuth = realRequireAuth,
  loadHoldings = realLoadHoldings,
  getSummary = realGetSummary,
  buildPortfolioSeries = realBuild,
} = {}) {
  const router = Router();

  router.get('/portfolio-series', requireAuth, async (req, res) => {
    const wallet = sanitizeWallet(req.query?.wallet);
    const empty = { portfolio: [], index: null, perHolding: {}, coverage: { included: 0, total: 0 }, attributionUrl: ATTRIBUTION_URL };
    try {
      if (!wallet) return res.json(empty);
      const [holdings, summary] = await Promise.all([loadHoldings(req.uid, wallet), getSummary()]);
      const payload = await buildPortfolioSeries({ holdings, summary });
      return res.json(payload ?? empty);
    } catch (err) {
      console.warn(`[portfolio-series] ${err?.message ?? err}`);
      return res.json(empty); // fail-open
    }
  });

  return router;
}

export default createPortfolioSeriesRouter();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/portfolioSeries.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount the route**

In `server/app.js`, add the import beside the others (after line 20):

```js
import portfolioSeriesRouter from './routes/portfolioSeries.js';
```

Then mount it on the shared `router` (the same `router` that `app.use('/merchant/api', router)` and `app.use('/api', router)` bind at lines 59-60) — add beside the other `router.use(...)` mounts:

```js
router.use(portfolioSeriesRouter);
```

(If the existing routes are mounted as `router.use(wallRouter)` etc., match that exact call style; if they use `router.use('/', wallRouter)`, match that instead.)

- [ ] **Step 6: Update the test script**

In `server/package.json:15`, append the new test file to the `test` script:

```json
    "test": "node --test tests/moneySanitize.test.js tests/app.smoke.test.js tests/portfolioSeries.test.js",
```

- [ ] **Step 7: Run the full server suite + smoke test**

Run: `cd server && npm test`
Expected: PASS — existing tests plus the 3 new ones; `app.smoke.test.js` still green (route mounts without throwing at import).

- [ ] **Step 8: Commit**

```bash
git add server/routes/portfolioSeries.js server/tests/portfolioSeries.test.js server/app.js server/package.json
git commit -m "feat(server): fail-open GET /portfolio-series over buildPortfolioSeries"
```

---

### Task 2: i18n keys (en / ja / zh-TW)

**Files:**
- Modify: `client/src/i18n/locales/en.json`
- Modify: `client/src/i18n/locales/ja.json`
- Modify: `client/src/i18n/locales/zh-TW.json`

**Interfaces:**
- Produces: `benchmark.*` keys consumed by Tasks 4-5. Keys: `tabIndex`, `tabVs`, `vsTitle`, `vsExplain`, `vsBeating`, `vsTrailing`, `vsMatching`, `vsNoBenchmark`, `vsEmpty`, `vsNoWallet`, `loading`, `learnMore`, `chartPortfolio`, `chartIndex`, `rebasedNote`, `coverage`, `modalTitle`, `modalP1`, `modalP2`, `modalP3`, `modalClose`.

- [ ] **Step 1: Add the `benchmark` block to `en.json`**

Insert a `"benchmark"` object as a new top-level key (e.g. after the `"dashboard"` block, before `"inventory"`). Mind the trailing comma on the preceding block:

```json
  "benchmark": {
    "tabIndex": "Index",
    "tabVs": "My Collection vs Market",
    "vsTitle": "Inventory Performance",
    "vsExplain": "How your inventory's value has moved against the Renaiss OS Index over the last 30 days, both rebased to 100 at the start.",
    "vsBeating": "Your inventory is beating the index by {{pct}}",
    "vsTrailing": "Your inventory is trailing the index by {{pct}}",
    "vsMatching": "Your inventory is tracking the index",
    "vsNoBenchmark": "No 30-day index benchmark available for this window yet.",
    "vsEmpty": "Not enough priced holdings to compare yet ({{included}} of {{total}}). Scan more of your wallet in Inventory.",
    "vsNoWallet": "Load your wallet in Inventory first — then your inventory line appears here.",
    "loading": "Loading your inventory series…",
    "learnMore": "Learn more",
    "chartPortfolio": "My inventory",
    "chartIndex": "Renaiss OS Index",
    "rebasedNote": "Both lines rebased to 100 at the earliest shared date — shape, not basket size.",
    "coverage": "{{included}} of {{total}} holdings priced",
    "modalTitle": "How this comparison works",
    "modalP1": "Your inventory line sums the FMV history of every held card the Renaiss OS Index can price, aligned onto the index's daily grid.",
    "modalP2": "Both lines are rebased to 100 at the earliest date they share, so you compare growth shape — not the absolute size of your inventory versus the whole index.",
    "modalP3": "Cards the index can't price yet are left out; the coverage line shows how many of your holdings are included.",
    "modalClose": "Got it"
  },
```

- [ ] **Step 2: Add the same block to `ja.json`**

```json
  "benchmark": {
    "tabIndex": "指数",
    "tabVs": "自分のコレクション vs 市場",
    "vsTitle": "在庫パフォーマンス",
    "vsExplain": "過去30日間、あなたの在庫価値がRenaiss OS指数に対してどう動いたか。両方を開始時点100に基準化しています。",
    "vsBeating": "あなたの在庫は指数を{{pct}}上回っています",
    "vsTrailing": "あなたの在庫は指数を{{pct}}下回っています",
    "vsMatching": "あなたの在庫は指数に連動しています",
    "vsNoBenchmark": "この期間の30日指数ベンチマークはまだありません。",
    "vsEmpty": "比較できる価格付き在庫が不足しています（{{total}}件中{{included}}件）。インベントリでウォレットをスキャンしてください。",
    "vsNoWallet": "先にインベントリでウォレットを読み込むと、在庫ラインがここに表示されます。",
    "loading": "在庫シリーズを読み込み中…",
    "learnMore": "詳しく",
    "chartPortfolio": "自分の在庫",
    "chartIndex": "Renaiss OS指数",
    "rebasedNote": "両ラインは最も早い共通日を100に基準化——規模ではなく形状の比較です。",
    "coverage": "{{total}}件中{{included}}件が価格付き",
    "modalTitle": "この比較の仕組み",
    "modalP1": "在庫ラインは、Renaiss OS指数が価格を算出できる保有カードすべてのFMV履歴を、指数の日次グリッドに合わせて合計したものです。",
    "modalP2": "両ラインは共通する最も早い日を100に基準化しているため、在庫全体と指数全体の規模ではなく、成長の形状を比較できます。",
    "modalP3": "指数がまだ価格を算出できないカードは除外されます。カバレッジ表示で、含まれる保有数がわかります。",
    "modalClose": "了解"
  },
```

- [ ] **Step 3: Add the same block to `zh-TW.json`**

```json
  "benchmark": {
    "tabIndex": "指數",
    "tabVs": "我的收藏 vs 市場",
    "vsTitle": "庫存表現",
    "vsExplain": "過去30天，你的庫存價值相對 Renaiss OS 指數的走勢；兩者皆以起點100為基準重算。",
    "vsBeating": "你的庫存領先指數 {{pct}}",
    "vsTrailing": "你的庫存落後指數 {{pct}}",
    "vsMatching": "你的庫存與指數同步",
    "vsNoBenchmark": "此區間尚無30天指數基準可比較。",
    "vsEmpty": "可比較的已定價庫存不足（{{total}} 件中 {{included}} 件）。請在庫存頁掃描更多錢包內容。",
    "vsNoWallet": "請先在庫存頁載入你的錢包，你的庫存線就會顯示在這裡。",
    "loading": "正在載入你的庫存序列…",
    "learnMore": "了解更多",
    "chartPortfolio": "我的庫存",
    "chartIndex": "Renaiss OS 指數",
    "rebasedNote": "兩條線皆以最早的共同日期重算為100——比較走勢形狀，而非規模大小。",
    "coverage": "{{total}} 件中 {{included}} 件已定價",
    "modalTitle": "此比較如何運作",
    "modalP1": "庫存線彙總 Renaiss OS 指數能定價的每張持有卡的 FMV 歷史，並對齊到指數的每日格線。",
    "modalP2": "兩條線都以最早的共同日期重算為100，因此你比較的是成長走勢，而非你的庫存相對整個指數的絕對規模。",
    "modalP3": "指數尚無法定價的卡片會被排除；涵蓋率會顯示納入了多少持有卡。",
    "modalClose": "知道了"
  },
```

- [ ] **Step 4: Verify JSON validity**

Run: `cd client && node -e "['en','ja','zh-TW'].forEach(l=>{JSON.parse(require('fs').readFileSync('src/i18n/locales/'+l+'.json','utf8'));console.log(l,'ok')})"`
Expected: `en ok` / `ja ok` / `zh-TW ok` (no JSON parse error — catches a stray/missing comma).

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/locales/en.json client/src/i18n/locales/ja.json client/src/i18n/locales/zh-TW.json
git commit -m "feat(i18n): benchmark panel keys (en/ja/zh-TW)"
```

---

### Task 3: Recharts dependency + client API wrapper

**Files:**
- Modify: `client/package.json` (add `recharts`)
- Create: `client/src/lib/portfolioSeriesApi.js`

**Interfaces:**
- Consumes: `getJson` from `./httpClient.js` (signature `getJson(path, { authToken })`).
- Produces: `fetchPortfolioSeries({ authToken, wallet })` → `Promise<{ portfolio, index, perHolding, coverage, attributionUrl }>`.

- [ ] **Step 1: Add Recharts**

Run: `cd client && npm install recharts`
Expected: `recharts` appears under `dependencies` in `client/package.json`; lockfile updated.

- [ ] **Step 2: Create the API wrapper**

Create `client/src/lib/portfolioSeriesApi.js`:

```js
import { getJson } from './httpClient.js';

/**
 * GET /portfolio-series — signed-in inventory-vs-index series.
 * Auth-required; wallet-scoped. Server is fail-open, so a resolved value with
 * `index: null` / empty `portfolio` means "no comparison yet", not an error.
 */
export function fetchPortfolioSeries({ authToken, wallet } = {}) {
  const q = wallet ? `?wallet=${encodeURIComponent(wallet)}` : '';
  return getJson(`/portfolio-series${q}`, { authToken });
}
```

- [ ] **Step 3: Verify the client still builds**

Run: `cd client && npm run build`
Expected: build succeeds (Recharts resolves; no import errors).

- [ ] **Step 4: Commit**

```bash
git add client/package.json client/package-lock.json client/src/lib/portfolioSeriesApi.js
git commit -m "feat(client): add recharts + portfolioSeries API wrapper"
```

---

### Task 4: `ComparisonChart` component (interactive two-line chart)

**Files:**
- Create: `client/src/components/ComparisonChart.jsx`

**Interfaces:**
- Consumes: `recharts` (`LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer`), `react-i18next` `useTranslation`.
- Produces: default export `ComparisonChart({ portfolio, index, coverage, attributionUrl })`. Renders `null` when `index == null` or `portfolio.length < 2`.

- [ ] **Step 1: Create the component**

Create `client/src/components/ComparisonChart.jsx`:

```jsx
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { RENAISS_INDEX_BASE_URL } from '../lib/renaissIndexUrl.js';

const PORTFOLIO_COLOR = '#a78bfa';
const INDEX_COLOR = '#38bdf8';

// portfolio + index.sparkline are both [{ t, usdCents }]. Rebase both onto the
// earliest date BOTH report = 100 so the lines compare shape, not basket size.
// Dates present on only one side are dropped (never fabricated). Defensive:
// every point is null-checked before use.
function buildRebasedSeries(portfolio, sparkline) {
  const pByDate = new Map();
  for (const p of portfolio ?? []) {
    if (p?.t != null && Number.isFinite(p?.usdCents)) pByDate.set(p.t, p.usdCents);
  }
  const iByDate = new Map();
  for (const p of sparkline ?? []) {
    if (p?.t != null && Number.isFinite(p?.usdCents)) iByDate.set(p.t, p.usdCents);
  }
  const common = [...pByDate.keys()].filter((t) => iByDate.has(t)).sort((a, b) => new Date(a) - new Date(b));
  if (common.length === 0) return [];
  const pBase = pByDate.get(common[0]);
  const iBase = iByDate.get(common[0]);
  if (!pBase || !iBase) return [];
  return common.map((t) => ({
    date: t.slice(5, 10), // "YYYY-MM-DD…" -> "MM-DD"
    portfolio: (pByDate.get(t) / pBase) * 100,
    index: (iByDate.get(t) / iBase) * 100,
  }));
}

function ChartTooltip({ active, payload, label, t }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-date">{label}</div>
      {payload.map((row) => (
        <div key={row.dataKey} className="chart-tooltip-row">
          <span className="chart-tooltip-dot" style={{ backgroundColor: row.color }} />
          {row.dataKey === 'portfolio' ? t('benchmark.chartPortfolio') : t('benchmark.chartIndex')}
          <strong>{Number(row.value).toFixed(1)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function ComparisonChart({ portfolio, index, coverage, attributionUrl }) {
  const { t } = useTranslation();
  const data = useMemo(
    () => buildRebasedSeries(Array.isArray(portfolio) ? portfolio : [], index?.sparkline),
    [portfolio, index],
  );

  if (index == null || !Array.isArray(portfolio) || portfolio.length < 2 || data.length < 2) return null;

  const xTicks = [data[0].date, data[data.length - 1].date];

  return (
    <div className="comparison-chart">
      <div style={{ width: '100%', height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={xTicks}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: '#b4b9d1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              width={34}
              stroke="rgba(255,255,255,0.2)"
              tick={{ fill: '#b4b9d1', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeDasharray: '3 3' }}
              content={(props) => <ChartTooltip {...props} t={t} />}
            />
            <Line type="monotone" dataKey="portfolio" stroke={PORTFOLIO_COLOR} strokeWidth={2.25} dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="index" stroke={INDEX_COLOR} strokeWidth={2.25} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="comparison-chart-legend">
        <span><span className="chart-tooltip-dot" style={{ backgroundColor: PORTFOLIO_COLOR }} /> {t('benchmark.chartPortfolio')}</span>
        <span><span className="chart-tooltip-dot" style={{ backgroundColor: INDEX_COLOR }} /> {t('benchmark.chartIndex')}</span>
      </div>
      <p className="small muted" style={{ margin: '0.35rem 0 0' }}>{t('benchmark.rebasedNote')}</p>
      {coverage && (
        <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
          {t('benchmark.coverage', { included: coverage.included, total: coverage.total })}
        </p>
      )}
      <a
        className="index-source-link"
        href={attributionUrl || RENAISS_INDEX_BASE_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {t('index.sourcePrefix')} {t('index.sourceLabel')} ↗
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Add chart/tooltip styles**

Append to the global stylesheet (find it with `grep -rl "glass-card" client/src --include=*.css`; typically `client/src/index.css` or `App.css`):

```css
.comparison-chart-legend { display: flex; gap: 1rem; margin-top: 0.5rem; font-size: 0.8rem; color: rgba(255,255,255,0.6); }
.comparison-chart-legend span { display: inline-flex; align-items: center; gap: 0.4rem; }
.chart-tooltip-dot { width: 8px; height: 8px; border-radius: 999px; display: inline-block; }
.chart-tooltip { background: rgba(20,20,28,0.92); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 0.5rem 0.65rem; font-size: 0.78rem; }
.chart-tooltip-date { color: rgba(255,255,255,0.5); margin-bottom: 0.25rem; }
.chart-tooltip-row { display: flex; align-items: center; gap: 0.4rem; }
.chart-tooltip-row strong { margin-left: auto; }
```

- [ ] **Step 3: Verify the build**

Run: `cd client && npm run build`
Expected: build succeeds (no unresolved imports; `renaissIndexUrl.js` export `RENAISS_INDEX_BASE_URL` exists — it is already used by `Dashboard.jsx`).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/ComparisonChart.jsx client/src/*.css client/src/**/*.css
git commit -m "feat(client): interactive rebased ComparisonChart (recharts)"
```

---

### Task 5: `BenchmarkPanel` component (tabs, VS headline, modal)

**Files:**
- Create: `client/src/components/BenchmarkPanel.jsx`

**Interfaces:**
- Consumes: `IndexTile` from `./IndexTile.jsx` (`<IndexTile index dateLocale />`); `ComparisonChart` from `./ComparisonChart.jsx` (Task 4); `fetchPortfolioSeries` from `../lib/portfolioSeriesApi.js` (Task 3); `benchmark.*` i18n keys (Task 2). Wallet from `localStorage['merchant_last_wallet']`.
- Produces: default export `BenchmarkPanel({ index, user, getToken, dateLocale })`.
  - `user`: Firebase user object or null.
  - `getToken`: `() => Promise<string|null>` (App's `getToken`).

- [ ] **Step 1: Create the component**

Create `client/src/components/BenchmarkPanel.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import IndexTile from './IndexTile.jsx';
import ComparisonChart from './ComparisonChart.jsx';
import { fetchPortfolioSeries } from '../lib/portfolioSeriesApi.js';

const LAST_WALLET_KEY = 'merchant_last_wallet';

function formatSignedPercent(fraction) {
  return `${Math.abs(fraction * 100).toFixed(1)}%`;
}

// Portfolio's own return over the series window (first -> last finite point).
function portfolioReturn(portfolio) {
  const finite = (portfolio ?? []).filter((p) => Number.isFinite(p?.usdCents));
  if (finite.length < 2) return null;
  const first = finite[0].usdCents;
  const last = finite[finite.length - 1].usdCents;
  if (!first) return null;
  return last / first - 1;
}

// Headline: compares portfolio return to index d30. GUARD: a null d30 must NOT
// be treated as 0 (that would falsely read as beating/trailing) — render the
// neutral "no benchmark" state instead.
function Headline({ portfolio, index, t }) {
  const pReturn = portfolioReturn(portfolio);
  const d30 = index?.deltas?.d30;
  if (pReturn == null) return null;
  if (!Number.isFinite(d30)) {
    return <p className="benchmark-headline muted">{t('benchmark.vsNoBenchmark')}</p>;
  }
  const relative = pReturn - d30;
  const pct = formatSignedPercent(relative);
  let text;
  let cls;
  if (relative > 0.005) { text = t('benchmark.vsBeating', { pct }); cls = 'text-pos'; }
  else if (relative < -0.005) { text = t('benchmark.vsTrailing', { pct }); cls = 'text-neg'; }
  else { text = t('benchmark.vsMatching'); cls = ''; }
  return <p className={`benchmark-headline ${cls}`}>{text}</p>;
}

function LearnMoreModal({ onClose, t }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="glass-card modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 className="section-title" style={{ marginTop: 0 }}>{t('benchmark.modalTitle')}</h3>
        <p className="muted">{t('benchmark.modalP1')}</p>
        <p className="muted">{t('benchmark.modalP2')}</p>
        <p className="muted">{t('benchmark.modalP3')}</p>
        <button type="button" className="btn btn-primary" onClick={onClose}>{t('benchmark.modalClose')}</button>
      </div>
    </div>
  );
}

function VsBody({ series, loading, wallet, t }) {
  if (!wallet) return <p className="muted">{t('benchmark.vsNoWallet')}</p>;
  if (loading) return <div className="empty">{t('benchmark.loading')}</div>;
  const portfolio = series?.portfolio ?? [];
  const index = series?.index ?? null;
  const coverage = series?.coverage;
  const canCompare = index != null && (coverage?.included ?? portfolio.length) >= 2 && portfolio.length >= 2;
  if (!canCompare) {
    return (
      <p className="muted">
        {t('benchmark.vsEmpty', { included: coverage?.included ?? 0, total: coverage?.total ?? 0 })}
      </p>
    );
  }
  return (
    <div className="stack" style={{ gap: '0.75rem' }}>
      <Headline portfolio={portfolio} index={index} t={t} />
      <ComparisonChart
        portfolio={portfolio}
        index={index}
        coverage={coverage}
        attributionUrl={series?.attributionUrl}
      />
    </div>
  );
}

export default function BenchmarkPanel({ index, user, getToken, dateLocale = 'en-US' }) {
  const { t } = useTranslation();
  const signedIn = Boolean(user?.uid);
  const [mode, setMode] = useState('index');
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const wallet = (() => {
    try { return localStorage.getItem(LAST_WALLET_KEY) || ''; } catch { return ''; }
  })();

  // Signed-out: hard reset to index mode so no VS state lingers across sign-out.
  useEffect(() => { if (!signedIn) setMode('index'); }, [signedIn]);

  // Lazy fetch: only when VS opened, signed in, and a wallet is known.
  useEffect(() => {
    if (mode !== 'vs' || !signedIn || !wallet) return undefined;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        const data = await fetchPortfolioSeries({ authToken: token, wallet });
        if (!cancelled) setSeries(data);
      } catch {
        if (!cancelled) setSeries(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, signedIn, wallet, getToken]);

  // CONSTRAINT: signed-out shows ONLY the index tile — no tabs, no VS.
  if (!signedIn) {
    return (
      <div className="benchmark-panel">
        <IndexTile index={index} dateLocale={dateLocale} />
      </div>
    );
  }

  const isIndex = mode === 'index';
  return (
    <div className="benchmark-panel">
      <div role="tablist" aria-label={t('benchmark.tabVs')} className="benchmark-tabs">
        <button type="button" role="tab" aria-selected={isIndex} className={`benchmark-tab ${isIndex ? 'active' : ''}`} onClick={() => setMode('index')}>
          {t('benchmark.tabIndex')}
        </button>
        <button type="button" role="tab" aria-selected={!isIndex} className={`benchmark-tab ${!isIndex ? 'active' : ''}`} onClick={() => setMode('vs')}>
          {t('benchmark.tabVs')}
        </button>
      </div>

      {isIndex ? (
        <IndexTile index={index} dateLocale={dateLocale} />
      ) : (
        <div>
          <div className="index-tile-head" style={{ marginBottom: '0.5rem' }}>
            <p className="label" style={{ margin: 0 }}>{t('benchmark.vsTitle')}</p>
            <button type="button" className="index-source-link" onClick={() => setModalOpen(true)}>
              {t('benchmark.learnMore')}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>{t('benchmark.vsExplain')}</p>
          <VsBody series={series} loading={loading} wallet={wallet} t={t} />
        </div>
      )}

      {modalOpen && <LearnMoreModal onClose={() => setModalOpen(false)} t={t} />}
    </div>
  );
}
```

- [ ] **Step 2: Add tab + modal styles**

Append to the same stylesheet as Task 4 Step 2:

```css
.benchmark-tabs { display: flex; gap: 0.25rem; padding: 0.25rem; background: rgba(255,255,255,0.04); border-radius: 999px; margin-bottom: 0.85rem; }
.benchmark-tab { flex: 1; border: 0; background: transparent; color: rgba(255,255,255,0.45); font-size: 0.8rem; font-weight: 500; padding: 0.4rem 0.75rem; border-radius: 999px; cursor: pointer; transition: color .15s, background .15s; }
.benchmark-tab.active { background: rgba(255,255,255,0.1); color: #fff; }
.benchmark-headline { font-size: 0.9rem; font-weight: 500; margin: 0; }
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; padding: 1.5rem; z-index: 50; }
.modal-card { max-width: 30rem; }
```

(If the codebase already defines a `.modal-overlay`, reuse it and drop the duplicate rule — check with `grep -rn "modal-overlay" client/src`.)

- [ ] **Step 3: Verify the build**

Run: `cd client && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/BenchmarkPanel.jsx client/src/*.css client/src/**/*.css
git commit -m "feat(client): BenchmarkPanel — signed-in tabs + VS headline (d30 guard) + modal"
```

---

### Task 6: Wire `BenchmarkPanel` into the Dashboard

**Files:**
- Modify: `client/src/App.jsx` (pass `user` + `getToken` to `<Dashboard>`)
- Modify: `client/src/pages/Dashboard.jsx` (accept props; replace left `glass-card`)

**Interfaces:**
- Consumes: `BenchmarkPanel` from `../components/BenchmarkPanel.jsx` (Task 5).
- Produces: `Dashboard({ user, getToken })`.

- [ ] **Step 1: Pass auth props into Dashboard**

In `client/src/App.jsx`, change the index route (currently `<Route path="/" element={<Dashboard />} />`) to:

```jsx
        <Route path="/" element={<Dashboard user={user} getToken={getToken} />} />
```

- [ ] **Step 2: Consume props + swap the left card in Dashboard**

In `client/src/pages/Dashboard.jsx`:

Add the import beside the other component imports (near line 10):

```jsx
import BenchmarkPanel from '../components/BenchmarkPanel.jsx';
```

Change the signature (line 19) from `export default function Dashboard() {` to:

```jsx
export default function Dashboard({ user, getToken } = {}) {
```

Replace the left glass-card block (currently lines 134-136):

```jsx
            <div className="glass-card">
              <IndexTile index={index} dateLocale={dateLocale} />
            </div>
```

with:

```jsx
            <div className="glass-card">
              <BenchmarkPanel index={index} user={user} getToken={getToken} dateLocale={dateLocale} />
            </div>
```

Leave the now-unused `IndexTile` import in place ONLY if still referenced elsewhere; otherwise remove the `import IndexTile ...` line to avoid an unused-import lint error (it is no longer used directly in Dashboard — `BenchmarkPanel` renders it).

- [ ] **Step 3: Verify the build + lint**

Run: `cd client && npm run build`
Expected: build succeeds, no unused-import error for `IndexTile`.

- [ ] **Step 4: Drive the app to verify behavior (manual — no client test harness)**

Use the `/run` skill (or `cd client && npm run dev`) and confirm, on the Dashboard (`/`):
- **Signed out:** the left card shows the index tile only — **no tabs**, no VS content.
- **Signed in (no wallet loaded):** tabs appear; VS tab shows the "load your wallet in Inventory first" copy.
- **Signed in, wallet with priced holdings:** VS tab shows the headline + interactive two-line chart; hovering shows the tooltip/crosshair; the Index tab still shows the sparkline HUD.
- **Signed-in with a null-`d30` index:** VS headline reads the neutral "no benchmark" copy, not beating/trailing. (Can be checked against real upstream data or by temporarily stubbing `deltas.d30 = null`.)

- [ ] **Step 5: Commit**

```bash
git add client/src/App.jsx client/src/pages/Dashboard.jsx
git commit -m "feat(client): mount BenchmarkPanel on the Dashboard (auth-threaded)"
```

---

## Self-Review Notes

- **Spec coverage:** route (Task 1) ✓; signed-out-only-IndexTile constraint (Task 5 Step 1 + Task 6 Step 4) ✓; null-`d30` guard (Task 5 `Headline`) ✓; coverage surfaced (Tasks 4-5) ✓; Recharts interactivity (Task 4 Tooltip/cursor) ✓; `hackathon`-prefixed collection, no new collection (Task 1 `INVENTORY_COLLECTION`) ✓; i18n en/ja/zh-TW (Task 2) ✓; fail-open (Task 1 tests + route) ✓; wallet from localStorage (Task 5) ✓.
- **Client tests:** deliberately manual (Task 6 Step 4) — the client has no test harness and the spec authorized only the `recharts` dependency. Documented as a constraint rather than silently dropped.
- **Type consistency:** `fetchPortfolioSeries({ authToken, wallet })` defined in Task 3, consumed identically in Task 5. `BenchmarkPanel({ index, user, getToken, dateLocale })` defined in Task 5, called with matching props in Task 6. Builder payload keys (`portfolio/index/perHolding/coverage/attributionUrl`) consistent across Tasks 1, 4, 5.
