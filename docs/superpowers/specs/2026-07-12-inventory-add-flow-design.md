# Inventory Add-Flow Redesign

**Date:** 2026-07-12
**Status:** Approved design
**Area:** `client/src/pages/Inventory.jsx`, `server/routes/meta.js`

## Problem

The Inventory page shows three always-visible "add" panels (wallet scan, manual
cert, CSV import) plus the holdings grid. Each add method **persists
immediately** — there is no review step before cards land in saved inventory.
The whole page is also gated on a wallet: manual-cert and CSV require a bound
wallet first, and `GET /meta` refuses to return anything without a `?wallet=`
filter. That wallet gate is unnecessary — inventory is stored per-user, not
per-wallet.

## Goals

1. Collapse the three add methods behind a single **Add Inventory** action.
2. Introduce a **staging step**: loaded cards appear as a removable list and are
   only written on explicit **Confirm**.
3. **Remove the page-wide wallet requirement.** The wallet is relevant only to
   the scan method (which inherently needs an address).
4. **Record provenance** per card so the user knows how and when each entered
   inventory.

## Non-goals

- No change to the holding detail modal's edit behaviour (cost / list price /
  status), the sales-history modal, market-movers chips, or hero stats.
- No change to the on-chain scan endpoint (`POST /scan`) or sales endpoints.
- No wallet-based filtering UI in the grid. Wallet becomes invisible plumbing.

## Key facts (verified)

- Inventory rows are stored at
  `hackathonMerchantInventory/{uid}/items/{cert}` — keyed by **uid + cert**.
  Wallet is a *field* on each row, not part of the storage key.
- `PUT /meta` and `POST /meta/bulk` already accept `wallet: null`
  (`sanitizeItem` drops a null wallet; merge preserves prior value).
- The only hard wallet dependencies are:
  1. `GET /meta` returns `[]` + `reason: 'wallet_required'` when no `?wallet=`.
  2. Wallet scan needs an address to read on-chain holdings.

## Page structure

The page collapses from "3 add panels + grid" to:

```
Hero (portfolio stats + sales button)
[ Add panel ]                 ← rendered only while an add flow is active
Your Inventory   [+ Add Inventory]
  filter pills (all / promote / hold / clear / pack)
  grid of holding tiles
```

- On sign-in, "Your Inventory" loads automatically (all uid-scoped cards, no
  wallet needed).
- Guests see the empty / local-only state as today.
- The wallet bar, inline scan form, inline cert form, and inline CSV section are
  removed from the always-visible layout.

## Add flow

1. **+ Add Inventory** (top-right of the inventory zone) opens a **modal
   containing only the 3 method cards**: *Scan a wallet*, *Add by cert*,
   *Import CSV*.
2. Selecting a method **closes the modal** and reveals an **Add panel** section
   on the page (above "Your Inventory") showing that method's input:
   - **Scan** → address field + Scan button → `scanWallet(address)` → maps
     holdings into staged rows (reusing existing mapping in `handleScan`).
   - **Cert** → cert field + Look up → `fetchCard(cert, { series: true })` →
     one staged row.
   - **CSV** → file picker → `parseInventoryCsv` → staged rows from `accepted`.
   - A small method selector in the panel lets the user switch method without
     losing the staged list.
3. Loaded items populate a **staged list** below the input — compact rows:
   thumbnail, name, grade/set, FMV, provenance line, and a **✕ remove**.
   Loading more (same or switched method) **accumulates** into the staged list.
   Nothing is persisted yet.
4. **Confirm (N cards)** in the panel footer:
   - Signed-in → `bulkMeta` (chunked ≤100) with wallet/provenance fields; if the
     batch came from a scan that returned sales, also `bulkSales`.
   - Guest → merge into local `items` state, no persistence, guest note shown.
   - Then collapse the Add panel and refresh "Your Inventory".
5. **Discard** (or close) clears the staged list and collapses the panel without
   writing anything.

### Staging state

New component-local state in `Inventory.jsx`:

- `addMethod`: `null | 'scan' | 'cert' | 'csv'` — which method's input is shown;
  `null` means the Add panel is hidden.
- `showAddModal`: boolean — the chooser modal.
- `staged`: array of staged item objects (same shape as saved rows, plus
  provenance fields, plus a client-only `_dupe` flag).
- `staging` / `stageError`: busy + error state scoped to the Add panel.

Confirm maps `staged` → persisted rows and reuses the existing `persistBulk`
path. On success, `setItems` is refreshed via `loadInventory` (see server
change) or, for guests, merged locally.

## Provenance

Each staged/saved card records:

- `addedVia`: `'scan' | 'cert' | 'csv'`
- `sourceWallet`: the scanned address (scan only; `null` otherwise)
- `createdAt`: import timestamp (already stored server-side)

Displayed as a subtle source line, e.g.:

- `Scanned from 0x1a2b…9f4c · Jul 12`
- `Added manually · Jul 12`
- `CSV import · Jul 12`

Shown in the staged list rows **and** in the holding detail modal
(`HoldingDetailModal`). A small source tag may also appear on grid tiles
(optional, low priority).

## Server change

`server/routes/meta.js`:

1. **`GET /meta` without `?wallet=` returns all of the user's items** (drop the
   `wallet_required` short-circuit). When `?wallet=` is present, keep the
   existing filter for backward-compat and sales matching.
2. Add `addedVia` and `sourceWallet` to `sanitizeItem`:
   - `addedVia`: string, one of `scan | cert | csv` (else dropped).
   - `sourceWallet`: reuse `sanitizeWallet` (null → dropped, so merge preserves).

No change to `PUT /meta`, `POST /meta/bulk`, `POST /scan`, or sales routes.

## Client data loading

Replace `loadWalletInventory(addr)` gating with a wallet-agnostic
`loadInventory()`:

- Signed-in → `fetchMeta({ authToken })` (no wallet) → all rows; plus
  `fetchSales({ authToken })` for realized P&L.
- Runs on sign-in and after a successful Confirm.
- `boundWallet` gating is removed from the grid empty-state and from the
  manual-cert / CSV "need wallet first" guards.

## Edge cases

- **Duplicate cert** (already saved or already staged): staged row is flagged
  ("already in inventory" / "already staged"). Still confirmable (merge updates
  the row) or removable. De-dupe staged rows by cert.
- **Scan returns sales**: on Confirm of a scan-sourced batch, still call
  `bulkSales` so realized P&L keeps working.
- **Guest users**: staging + Confirm operate on local state only; no
  persistence; guest note shown in the Add panel.
- **Empty staging**: Confirm disabled.
- **Load failure** (bad address / cert not found / CSV parse rejects): error
  shown inside the Add panel; the staged list is preserved.

## Testing

- **Server** (`server/tests/meta.test.js` or similar): `GET /meta` with no
  wallet returns all uid items; with `?wallet=` still filters; `sanitizeItem`
  accepts `addedVia`/`sourceWallet` and rejects out-of-range `addedVia`.
- **Client**: staging accumulation, remove, duplicate flagging, Confirm →
  persist path (mock `bulkMeta`), guest Confirm → local merge, discard clears
  staging.

## Rollout / compatibility

- Existing rows lack `addedVia`/`sourceWallet`; the provenance line falls back to
  "Added · <createdAt>" (or hides the method) when `addedVia` is absent.
- Rows previously saved with a wallet still load, since `GET /meta` now returns
  all uid rows regardless of wallet.
