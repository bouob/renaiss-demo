# Dashboard Benchmark Panel — Design

**Date:** 2026-07-12
**Status:** Approved (design), ready for planning
**Ports from:** `../dokipoki` — `FeedBenchmarkPanel.jsx`, `RenaissIndexComparisonChart.jsx`

## Goal

Bring Dokipoki's Feed benchmark surface to the renaiss-demo-main Dashboard: an
interactive index chart plus a **My Collection vs Market → Inventory
Performance** comparison. The two projects share the *backend* Renaiss OS Index
adapters but not the *frontend* stack, so this is a port adapted to the local
idiom, not a copy.

## Scope

**In scope**
- New tabbed benchmark panel on the Dashboard, replacing the left `IndexTile`
  glass-card in the existing `grid-2`.
- A signed-in-only **VS ("My Collection vs Market" / "Inventory Performance")**
  view with an interactive two-line comparison chart (Recharts).
- A new server route `GET /portfolio-series` exposing the already-ported
  `buildPortfolioSeries` builder.

**Out of scope (YAGNI)**
- Per-holding alpha table (`perHolding` from the builder) — surfaced later.
- Upgrading the index-tile sparkline to Recharts — the compact SVG `Sparkline`
  stays as the Index tab / signed-out default.
- Any new Firestore collection — the route reads existing inventory.

## Constraints (from user)

1. **Signed-out hides the switcher and the VS chart entirely.** No tabs, no
   "sign in to compare" prompt. Signed-out renders *only* the `IndexTile`.
   Tabs + VS appear only once a Firebase user is present.
2. **Defensive against upstream data shape.** Verify and null-check every field
   read from the Renaiss OS Index; never assume presence. See "Upstream data
   contract" below.
3. **Firestore collections must be `hackathon`-prefixed.** This design needs no
   new collection (reads existing `hackathonMerchantInventory`). Any future
   cache doc must be `hackathon…`.

## Upstream data contract (verified against `../dokipoki/docs/RENAISS_INDEX_API.md`)

- `getCardFmvSeries(slug, { window: 30 })` → `FmvSeriesResponse`
  `{ windowDays, fmvWindowDays, gradeLabel, points[], series[] }`. The adapter
  reads `points[]` (`{ t, usdCents, n, bySource }`). The **current day's point
  may have `n: 0`** (no observations yet); `buildPortfolioSeries` forward-fills
  and gates thin cards via `MIN_COVERAGE_FRACTION (0.8)`.
- `IndexDetail.sparkline` = `SeriesPoint[]` (`{ t, usdCents }`) — matches the
  adapter's `mapSparklinePoints`.
- `deltas = { d7, d30, d365 }`, **each `number | null`**. `d30` being null is a
  supported state, not an error.
- `buildPortfolioSeries` returns
  `{ portfolio[], index, perHolding, coverage: { included, total }, attributionUrl }`.

### Data-fragility rules baked into the design

- **Null `d30` guard.** The VS headline compares portfolio return to
  `index.deltas.d30`. If `d30` is null, DO NOT compare against 0 (that would
  falsely read as beating/trailing). Instead render a neutral state
  ("no benchmark for this window"). This is the one behavioral fix vs Dokipoki,
  whose `?? 0` fallback is silently wrong here.
- **Coverage surfaced.** Show `coverage.included`/`coverage.total`
  ("N of M holdings priced"). When `included < 2` the chart cannot rebase —
  render the VS empty state, not a broken chart.
- **Null-check every read.** `index`, `sparkline`, each point's `usdCents`,
  `updatedAt`, `attributionUrl` — all optional-chained with sane fallbacks,
  matching the fail-open posture of the existing adapters.

## Architecture

### Backend — `server/routes/portfolioSeries.js`

`GET /portfolio-series` (`requireAuth`, `?wallet=0x…`).

Responsibility: turn the signed-in user's held certs into the builder's inputs
and return its output. One clear purpose; depends only on existing services.

Flow:
1. `requireAuth` → `req.uid`. Read held certs from
   `hackathonMerchantInventory/{uid}/items` (wallet-scoped when `?wallet=`
   passed, mirroring `GET /meta`).
2. For each held cert, get `renaissFmv` via `getGradedFmv(cert)`
   (`renaissFmv.href` is NOT persisted in the inventory doc — it is produced at
   scan time — so the route re-derives it here). Enrichment is bounded by the
   builder's slug cap and protected by the existing quota/circuit-breaker in
   `renaissOsIndex.js`.
3. Read the index summary from `wallCache` (the same cached `/wall` summary;
   do not re-fetch upstream if warm).
4. Call `buildPortfolioSeries({ holdings, summary })`.
5. Respond `200` with the builder payload. **Fail-open**: any miss (no summary,
   no holdings, adapter disabled) returns
   `{ portfolio: [], index: null, perHolding: {}, coverage: { included: 0, total }, attributionUrl }`
   with HTTP 200 — never a 5xx for a data gap.

Mounted in `server/index.js` alongside the other routes.

### Frontend

Local stack is `useState`/`useEffect` + `httpClient` (no react-query), custom
CSS classes (no Tailwind/lucide), custom SVG charts. Recharts is added
specifically for the interactive comparison chart.

- **`client/package.json`** — add `recharts` dependency.

- **`client/src/lib/portfolioSeriesApi.js`** — `fetchPortfolioSeries({ authToken, wallet })`
  via `getJson('/portfolio-series', …)`. No hook; the panel fetches lazily
  (only when the VS tab is opened and a user is present), mirroring Dokipoki's
  `enabled` gate.

- **`client/src/components/ComparisonChart.jsx`** — port of
  `RenaissIndexComparisonChart`. Pure UI. Rebases `portfolio` and
  `index.sparkline` onto the earliest common date = 100 (`buildRebasedSeries`),
  renders two Recharts `Line`s (portfolio `#a78bfa`, index `#38bdf8`) inside a
  `ResponsiveContainer` with an interactive `Tooltip` + crosshair, legend,
  rebase note, coverage line, and attribution link. Merchant framing
  ("Inventory Performance" / "My inventory"). Renders nothing when
  `index == null` or `portfolio.length < 2`.

- **`client/src/components/BenchmarkPanel.jsx`** — port of `FeedBenchmarkPanel`
  into the local CSS idiom, occupying the left `glass-card`.
  - **Signed out** (`!user`): renders only `<IndexTile index={index} />`. No tab
    switch, no VS.
  - **Signed in**: a two-tab switch (Index ⇄ *My Collection vs Market*). Index
    tab = `IndexTile`. VS tab = headline + `ComparisonChart`, fetched lazily on
    first open.
  - **VS headline** from `portfolioReturn(portfolio)` vs `index.deltas.d30`:
    beating / trailing / matching — with the **null-`d30` neutral guard**.
  - **VS empty states**: loading skeleton; `coverage.included < 2` →
    "not enough priced holdings yet".
  - A "Learn more" info modal explaining rebasing + methodology (built from
    existing modal/markup primitives; no `BaseModal` dependency).

- **`client/src/App.jsx`** — pass `user`, an ID-token getter, and `wallet` into
  `<Dashboard>` (currently the public `/` route receives no auth props).

- **`client/src/pages/Dashboard.jsx`** — accept the auth props; replace the left
  `glass-card` (currently `<IndexTile>`) with `<BenchmarkPanel>`, passing
  `index`, `user`, token getter, and `wallet`. The right Top-10 card, hero
  stats, ticker, and movers are unchanged.

- **i18n** — add `benchmark.*` and comparison-chart keys to `en.json`,
  `ja.json`, `zh-TW.json`, ported and merchant-framed from Dokipoki's
  `feed.benchmark.*` / `renaiss.index.*`.

## Data flow

```
Dashboard (/, public)
  ├─ fetchWall()  ──────────────► index summary (sparkline, deltas, top10)
  │                                     │
  │                                     ▼
  └─ BenchmarkPanel(index, user, getToken, wallet)
        ├─ signed out ─► IndexTile(index)                    [no tabs]
        └─ signed in  ─► tabs
              ├─ Index ─► IndexTile(index)
              └─ VS ────► fetchPortfolioSeries({authToken, wallet})
                             │  GET /portfolio-series (requireAuth)
                             │    └─ inventory certs → getGradedFmv → holdings
                             │       + wallCache summary
                             │       → buildPortfolioSeries()
                             ▼
                          ComparisonChart(portfolio, index, coverage, attributionUrl)
                             + headline (d30 guard)
```

## Error handling

- Route is fail-open (HTTP 200 + empty payload on any gap); never 5xx for
  missing data.
- Client VS fetch failure → VS empty/error copy, Index tab and the rest of the
  Dashboard unaffected.
- All upstream field reads optional-chained per the fragility rules above.

## Testing

- **Server**: unit test for `GET /portfolio-series` — happy path (stubbed
  holdings + summary → non-empty portfolio), fail-open path (no summary → empty
  payload, 200), and auth required (401 without token). `buildPortfolioSeries`
  itself already has coverage.
- **Client**: render test for `BenchmarkPanel` — signed-out shows IndexTile and
  **no tabs**; signed-in shows tabs; VS tab with null `d30` renders the neutral
  headline (not beating/trailing); `coverage.included < 2` renders the empty
  state.

## Open questions

None. Ready for implementation plan.
