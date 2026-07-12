# Dashboard Benchmark Panel — Index / "My Collection vs Market" tabs

**Date:** 2026-07-12
**Branch:** `feat/dashboard-benchmark-panel`
**Status:** Design approved

## Problem

Signed-in users have their inventory priced against the Renaiss OS Index, but
there is no UI surfacing that comparison. The backend already computes an
"inventory vs index" series; only the client view is missing.

## Existing scaffolding (do not rebuild)

- **Endpoint:** `GET /portfolio-series` (`server/routes/portfolioSeries.js`),
  wired in `server/app.js`. Auth-required, wallet-scoped, **fail-open**: any
  gap returns HTTP 200 with an empty payload, never 5xx.
- **Payload shape** (from `server/services/renaissPortfolioSeries.js`):
  ```
  {
    portfolio: Array<{ t: string, usdCents: number }>,
    index: { sparkline: Array<{ t: string, usdCents: number }>,
             deltas: { d7, d30, ... }, updatedAt: string } | null,
    perHolding: Record<string, { deltaPct30d: number, alphaPct30d: number }>,
    coverage: { included: number, total: number },
    attributionUrl: string
  }
  ```
- **API client:** `client/src/lib/portfolioSeriesApi.js` →
  `fetchPortfolioSeries({ authToken, wallet })`.
- **i18n:** `benchmark.*` keys present in `en.json`, `ja.json`, `zh-TW.json`
  (`tabIndex`, `tabVs`, `vsTitle`, `vsExplain`, `vsBeating`, `vsTrailing`,
  `vsMatching`, `vsNoBenchmark`, `vsEmpty`, `vsNoWallet`, `loading`,
  `learnMore`, `chartPortfolio`, `chartIndex`, `rebasedNote`, `coverage`,
  `modalTitle`, `modalP1..P3`, `modalClose`).

## Design

### 1. `client/src/components/BenchmarkPanel.jsx` (new)

Wraps the index view in a tabbed panel, replacing the direct `<IndexTile>`
render inside the Dashboard's `dashboard-index-card` section.

Props: `{ index, user, getToken, dateLocale }`.

- **Tab bar** with two tabs: `benchmark.tabIndex` ("Index") and
  `benchmark.tabVs` ("My Collection vs Market").
- **Guest fallback:** when `user` is falsy, the tab bar is not rendered and the
  panel shows only the Index view (`<IndexTile>`) — zero visual change for
  signed-out users. The Vs tab is therefore unreachable without auth.
- **Index tab:** renders the existing `<IndexTile index={index}
  dateLocale={dateLocale} />` unchanged.
- **Vs tab (signed-in only):** lazily fetches on first activation.
  - Resolve wallet from `localStorage` key `merchant_last_wallet`, normalized
    the same way `Dashboard.jsx` already does (`/^0x[0-9a-fA-F]{40}$/`,
    lowercased). Reuse that normalization; do not invent a second rule.
  - Call `fetchPortfolioSeries({ authToken: await getToken(), wallet })`.
  - Cache the resolved payload in component state so re-selecting the tab does
    not refetch within the same mount.

  **Render states** (branch on payload shape, never on HTTP status):
  | Condition | Copy |
  |---|---|
  | fetch in flight | `benchmark.loading` |
  | no wallet resolved | `benchmark.vsNoWallet` |
  | `index == null` | `benchmark.vsNoBenchmark` |
  | `coverage.included < 2` or empty `portfolio` | `benchmark.vsEmpty` with `{included, total}` |
  | otherwise | `<BenchmarkVsChart>` |

  The `included < 2` threshold: a single covered holding cannot form a
  meaningful two-point-plus comparison line; treat it as "not enough".

### 2. `client/src/components/BenchmarkVsChart.jsx` (new)

The dual-line overlay chart plus its summary and modal.

Props: `{ portfolio, index, coverage, attributionUrl, dateLocale }`.

- **Rebase helper** (pure, exported for test) `rebaseToShared(portfolio,
  indexSparkline)`:
  - Build a date→value map for each series.
  - Find the earliest date present in **both** series (shared base date). If
    none, return `null` (caller renders `vsNoBenchmark`).
  - For each series, rebase every point from the base date onward to
    `value / baseValue * 100`.
  - Return `{ portfolioRebased: [{t, v}], indexRebased: [{t, v}], baseDate }`
    on the shared date axis (dates present in both), in ascending date order.
- **Alpha helper** (pure, exported for test) `computeAlpha(portfolioRebased,
  indexRebased)`: `portfolioReturn - indexReturn` where each return is
  `(lastV - 100)` (percentage points off the rebased 100 base). Returns a
  number in percent.
- **Summary line:** choose `vsBeating` / `vsTrailing` / `vsMatching` by
  `Math.abs(alpha) < 0.05` → matching, else sign of alpha. `{{pct}}` formatted
  as a signed percentage to 2 dp.
- **Chart SVG:** both rebased lines on one shared y-scale (min/max across both
  series so they are visually comparable). Portfolio line and index line get
  distinct fixed strokes (do not rely on Sparkline's up/down auto-color).
  Follows `Sparkline.jsx`'s visual idiom (soft gradient fill under the
  portfolio line, rounded stroke). A **legend** maps each stroke to
  `chartPortfolio` / `chartIndex`.
- **Captions:** `rebasedNote` under the chart; `coverage` with
  `{included, total}`.
- **Learn more:** a `benchmark.learnMore` link/button opening an inline modal
  (`modalTitle`, `modalP1..P3`, `modalClose`). Follow the existing modal
  pattern in the codebase (e.g. `SoldHistoryModal.jsx` /
  `HoldingDetailModal.jsx`) rather than a bespoke overlay.

### 3. `client/src/pages/Dashboard.jsx` (edit)

In the `dashboard-index-card` section, replace:
```jsx
<IndexTile index={index} dateLocale={dateLocale} />
```
with:
```jsx
<BenchmarkPanel index={index} user={user} getToken={getToken} dateLocale={dateLocale} />
```
`user`, `getToken`, `index`, and `dateLocale` are already in scope. The direct
`IndexTile` import may be dropped from Dashboard once the panel owns it.

### 4. `client/src/styles.css` (edit)

- `.benchmark-tabs` tab bar + active-tab state, sitting inside the existing
  `.glass-card`.
- Chart legend row and coverage caption.
- Reuse existing modal/glass styling; add only what the tabs and legend need.

## Error handling

The endpoint is fail-open, so the panel never sees a 5xx for missing data. A
thrown fetch (network/auth) is caught and rendered as the empty/no-wallet
state — never an error toast. The Vs tab is not rendered for guests, so there
is no unauthenticated fetch path.

## Testing

- Unit tests for `rebaseToShared` and `computeAlpha` (pure functions): shared
  base date selection, no-overlap → null, rebasing math, and alpha sign.
- Component behavior (tab switch, lazy fetch, state rendering) verified by
  driving the running app.

## Out of scope

- No new backend, API-client, or i18n work — all present.
- No new nav route (rejected in favor of in-panel tabs).
- `perHolding` alpha per card is already consumed elsewhere
  (`merchantCopilot.js`); this panel does not surface per-holding rows.
