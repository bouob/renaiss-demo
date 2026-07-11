# Default Merchant Portfolio — Design

Date: 2026-07-12
Status: Approved (design)

## Problem

For demo purposes, every merchant account should open with a ready-made
inventory instead of an empty grid. Inventory today is stored per-account and
**wallet-scoped** at `hackathonMerchantInventory/{uid}/items/{cert}`, and
`GET /meta` returns nothing until a wallet is bound (via wallet scan or CSV
import). A fresh account therefore shows an empty page.

We want each account to be seeded once with a default 40-item portfolio.
Edit / delete / scan on the seeded rows must keep working like any normal row.

## Constraints & decisions

- **Trigger:** server-side, on first `/meta` touch (first sign-in). No user
  action required; every account is covered, including future ones.
- **Wallet:** a per-account **synthetic** wallet derived deterministically from
  the account `uid`. Isolated per account, always the same for a given account.
- **Delete-safe:** seeding must run exactly once per account. Because delete is
  allowed, a "zero items" check would re-seed after a merchant clears their
  portfolio — so seeding is guarded by a one-time marker on the parent doc, not
  by item count.
- **Seed contents:** 18 real Renaiss graded cards supplied by the product owner
  as `renaiss.xyz/card/{tokenId}` links. The identifier in those links is the
  **NFT token ID**, not the inventory `cert`. Each token ID was resolved once
  (offline, via the app's own `fetchNFTAttributes` + `getGradedFmv`) to its real
  `cert` (PSA serial), `name`, `setName`, `grade`/`gradeLabel`, `imageUrl`,
  `priceUsdCents`, and Renaiss `href`. All 18 resolved and were found in the
  index (17 with a live FMV price; one — `PSA113221413` Vaporeon Ex — found but
  no price). The resolved rows are baked into the static seed module as literal
  data; no per-account network calls happen at seed time.

  The seed module is just an array, so more cards can be appended later by
  resolving additional token IDs the same way.

## Architecture

### 1. Seed data — `server/services/defaultPortfolioSeed.js`

Static module exporting `DEFAULT_PORTFOLIO_ITEMS`: an array of the 18 resolved
cards as plain objects using the fields the inventory model already understands
(`cert`, `name`, `setName`, `grade`, `imageUrl`, `priceUsdCents`, `href`,
`status: 'active'`). `cost` and `listPrice` are left unset — the merchant hasn't
priced them, and the UI already derives a suggested sell from `priceUsdCents`
(`listPrice ?? priceUsdCents * 1.05`). The one card with no index price seeds
without `priceUsdCents`. No logic — just data.

### 2. Seed engine — `server/services/defaultPortfolio.js`

- `syntheticWallet(uid)` → deterministic `0x…` address from `sha256(uid)`
  (first 40 hex chars, lowercased). Passes `isValidAddressShape`. Same uid
  always maps to the same demo wallet; different uids do not collide in
  practice.
- `ensureDefaultPortfolio(uid)` → idempotent seed:
  1. Read parent doc `hackathonMerchantInventory/{uid}`.
  2. If `seededDefaultAt` is set, return `{ wallet: <stored defaultWallet>,
     seeded: false }` and do nothing.
  3. Otherwise, run every seed row through the existing `sanitizeItem` logic,
     bind each to `syntheticWallet(uid)`, batch-write them (Firestore batch
     limit 500; 40 rows is well within one batch), and stamp the parent doc
     `{ seededDefaultAt: <ISO>, defaultWallet: <wallet> }`.
  4. Return `{ wallet, seeded: true }`.
- Guards: no-op and returns `{ wallet: null, seeded: false }` when `adminDb` is
  unavailable, so `/meta` degrades exactly as it does today.

To keep the dependency direction clean, `sanitizeItem` is lifted out of
`server/routes/meta.js` into a shared module (e.g. `server/lib/inventoryItem.js`)
that both `meta.js` and the seed engine import. `meta.js` re-exports nothing new;
the route keeps using the shared `sanitizeItem`. This avoids a route ↔ service
circular import.

### 3. `GET /meta` change — `server/routes/meta.js`

- `await ensureDefaultPortfolio(req.uid)` near the top of the handler (after the
  `adminDb` guard).
- When the request has **no** `?wallet=`: filter by the synthetic wallet
  returned from the seed call and return it in the response
  (`{ items, uid, wallet }`) instead of today's `{ items: [], reason:
  'wallet_required' }`. This lets the client discover and bind the demo wallet.
- When a `?wallet=` **is** supplied: behavior is unchanged — filter by that
  wallet exactly as today.
- `PUT /meta`, `POST /meta/bulk`, `/sales`, `/scan` are untouched; seeded rows
  are ordinary rows and edit/delete/scan continue to work.

### 4. Client — `client/src/pages/Inventory.jsx`

- On mount, when there is no wallet in `localStorage` (`merchant_last_wallet`),
  call `fetchMeta()` with no wallet argument.
- Bind the synthetic `wallet` returned by the server (`setBoundWallet`, populate
  the wallet input) and persist it via the existing `rememberWallet` helper, so
  the default portfolio shows immediately on first sign-in and on return visits.
- No change to `inventoryApi.fetchMeta` signature — it already omits the wallet
  query when none is passed.

## Data flow

1. Merchant signs in → Inventory mounts → no stored wallet → `fetchMeta()`.
2. Server `GET /meta` → `ensureDefaultPortfolio(uid)` seeds 40 rows under the
   synthetic wallet on first ever call (no-op afterward) → responds with those
   rows and the synthetic `wallet`.
3. Client binds and remembers the wallet; grid renders the 40 items.
4. Subsequent visits reuse the stored wallet; edits/deletes mutate rows
   directly and are never overwritten by re-seeding.

## Error handling

- `adminDb` unavailable → seed no-ops; `/meta` returns `store_unavailable` /
  empty exactly as today.
- Seed write failure → surfaced through the existing `/meta` try/catch
  (`meta_read_failed`); the marker is only stamped in the same batch as the
  items, so a failed seed leaves the account unmarked and is retried next call.
- Malformed seed rows → dropped/normalized by `sanitizeItem`; a row with an
  invalid `cert` shape is skipped rather than aborting the batch.

## Testing

- `syntheticWallet`: deterministic (same uid → same address), valid address
  shape, distinct uids → distinct addresses.
- `ensureDefaultPortfolio`: seeds all rows + marker on a fresh account; second
  call is a no-op (idempotent); after simulated delete of all items, still does
  not re-seed because the marker persists. (adminDb mocked.)
- `GET /meta` (smoke): fresh uid, no wallet param → response includes a synthetic
  `wallet` and the seeded items; passing an explicit wallet preserves existing
  behavior.
- Seed-data sanity: every `DEFAULT_PORTFOLIO_ITEMS` row has a `cert` matching the
  route's `CERT_SHAPE` (so none are silently dropped on write).

## Out of scope

- UI for choosing/resetting the demo portfolio (delete is the reset path).
- Backfilling the seed into pre-existing accounts on any trigger other than
  their next `/meta` call (the lazy trigger covers them automatically).
- Live FMV/image resolution correctness for the seed certs — that depends on the
  real cert list the product owner supplies.
