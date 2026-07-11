# TASK-005 — Port BSC chain-adapter subset (adminDb→null stub)

Status: DONE

## Summary
Ported a read-only subset of
`D:/Desktop/Dokipoki/server/services/chainAdapters/bsc/renaissAdapter.js`
(1891 lines) into
`D:/Desktop/project-renaiss/server/services/chainAdapters/bsc/renaissAdapter.js`
(543 lines). Kept only `fetchHoldings` and `fetchNFTAttributes` plus the
RPC transport + CU-weighted sliding-window rate limiter they depend on, and
the `CONTRACT` constant. Everything the Dokipoki source builds on top of the
raw transfer walk for portfolio bookkeeping — durable per-wallet transfer
cursor (Firestore), USDT/pack-purchase cost-basis recovery, cross-wallet
cost recovery for cards that changed custody upstream, marketplace-sale
classification, and transaction-history classification
(`fetchTransactionHistory`, `fetchUnmintedPackClosures`, `isRenaissWallet`,
`prewarmTokenURIs`, `renaissAdapter` factory object) — was dropped entirely,
not stubbed. This app does inventory cost tracking via `/meta` (a later
task), not a full ledger replay.

## Files created
- `D:/Desktop/project-renaiss/server/services/chainAdapters/bsc/renaissAdapter.js`
  — exports `CONTRACT`, `isConfigured`, `fetchHoldings`, `fetchNFTAttributes`.

## Key design decisions
1. **No Firestore import.** The Dokipoki source imports `adminDb` from
   `../../firebaseAdmin.js` for a durable transfer-cursor store
   (`readFusedTransferStore`/`writeFusedTransferStore`). This port declares
   `const adminDb = null;` as an inert stub (never referenced by any live
   branch) instead of importing Firebase Admin — every wallet walk here is a
   full genesis→latest pass, cached in-memory with a 60s TTL per wallet, no
   persisted cursor. Confirmed by grep: 0 matches for `firebaseAdmin`.
2. **NFT-only transfer walk.** The source's `paginatedFusedWalk` fetches both
   the NFT contract AND USDT in one call (for pack-purchase cost basis,
   which this port drops). Simplified to `paginatedTransfers`, NFT-only
   (`category: ['erc721']`, single `contractAddresses: [CONTRACT]`) — the
   only data `fetchHoldings` actually needs.
3. **Fail-open on missing config.** `isConfigured()` mirrors the pattern
   already established in `renaissOsIndex.js` (TASK-003) — checks
   `process.env.BSC_RPC_URL` is set and Alchemy-v2-shaped. Both
   `fetchHoldings` (→ empty `Map`) and `fetchNFTAttributes` (→ `null`) check
   `isConfigured()` first and return without any network call when unset.
   `rpc()` itself still throws if reached unconfigured (defensive — should
   never happen given the two callers' guards).
4. **CU limiter simplified for a single process, no multi-Cloud-Function
   sharing math.** Dropped the Dokipoki source's 3-process account-sharing
   comment/divisor (that budget-splitting was specific to Dokipoki running
   `api` + `renaissScanWorker` + `scheduledReconciliationAudit`
   concurrently, none of which exist in this app) — kept a flat 50% headroom
   default (`ALCHEMY_CU_LIMIT` = 5000 CU/s), still env-overridable.
5. **Verbatim where it mattered:** the RPC retry/backoff logic
   (`isRetryableRpcError`, `getRetryDelayMs`, `getRetryAfterMs`,
   `getRpcHttpRetryDelayMs`), the CU-weighted sliding-window limiter
   (`acquireCuBudget`/`cuWindowSpend`), the `ethCall` LRU cache, and all of
   `fetchNFTAttributes`'s metadata-resolution logic (on-chain `tokenURI` →
   IPFS/Arweave/allowed-host JSON fetch → Alchemy `getNFTMetadata` fallback,
   including the SSRF-guard host allowlist and response-size/content-type
   checks) are ported verbatim, unchanged.

## Verification evidence

`node --check`:
```
$ cd D:/Desktop/project-renaiss/server && node --check services/chainAdapters/bsc/renaissAdapter.js && echo SYNTAX_OK
SYNTAX_OK
```

Grep — forbidden porting (all 0):
```
$ grep -ci "firebaseAdmin" renaissAdapter.js
0
$ grep -ci "webhook" renaissAdapter.js
0
$ grep -ci "reconcile" renaissAdapter.js
0
$ grep -ci "migration" renaissAdapter.js
0
$ grep -ci "store" renaissAdapter.js
0
```
(reworded the one explanatory comment from "No Firestore-backed persistence"
to "No durable per-wallet cursor is persisted" after an advisor pass flagged
that "Firestore" itself matches a case-insensitive `store` grep — now a
clean zero across all four forbidden terms, not just "0 or inert".)

Grep — required exports present:
```
$ grep -n "^export " renaissAdapter.js
23:export const CONTRACT = '0xF8646A3Ca093e97Bb404c3b25e675C0394DD5b30';
44:export function isConfigured() {
357:export async function fetchHoldings(walletAddress) {
517:export async function fetchNFTAttributes(tokenId) {
```

Grep — `adminDb` stub present, `BSC_RPC_URL` read from `process.env` (never
hardcoded), both fail-open (`isConfigured()` false) and network-call
branches present in both `fetchHoldings`/`fetchNFTAttributes` (see file
lines 357-372 and 517-540 — each starts with `if (!isConfigured()) return
<empty>;` before any `rpc()`/`ethCall()` reach):
```
$ grep -n "adminDb" renaissAdapter.js
17:// wallet/tokenId. adminDb is kept as an inert null stub purely so this file
19:const adminDb = null; // eslint-disable-line no-unused-vars -- ...
$ grep -n "BSC_RPC_URL" renaissAdapter.js
36:  const url = process.env.BSC_RPC_URL;
(+ 6 doc-comment references, no hardcoded URL anywhere)
```

## Not done / deferred
- No unit tests written (no test harness exists yet in
  `D:/Desktop/project-renaiss/server`; `package.json`'s `test` script is a
  placeholder — `TASK-001` scope, not this task's).
- Did not wire this adapter into any route (`/scan`, `/card`) — that's
  TASK-010, which depends on this task.
- **Flag for TASK-012's owner:** TASK-012 asks for "on-chain purchase-cost
  derivation (chain-first)… reading only from the ported adapter". This
  adapter exposes holdings + attributes only — the cost/tx-history logic
  (`fetchTransactionHistory`, pack-purchase cost basis, cross-wallet cost
  recovery) was deliberately dropped per this task's own criterion 3 ("no
  … migration porting"). TASK-012 will need a fresh minimal cost accessor
  (e.g. a `fetchAcquisitionTx`-style export added to this same file) rather
  than assuming today's exports already cover it — do not resurrect the
  full Dokipoki cost-basis pipeline to satisfy it.
- Did not `git commit` / `git push` per instructions.

## Dependency status observed
- TASK-001 (server scaffold) complete: `server/package.json` (ESM,
  `"type": "module"`), `server/index.js`, `server/env.js`,
  `server/middleware/`, `server/routes/` (empty) all present.
- TASK-003 (pure Renaiss index/pricing/adjacency core) complete:
  `server/services/renaissOsIndex.js`, `renaissCertAdjacency.js`,
  `renaissAdjacentCertService.js`, `renaissPortfolioSeries.js`,
  `server/lib/walletGuard.js` all present — `isConfigured()` naming
  convention in this task's file follows `renaissOsIndex.js`'s established
  pattern for consistency.

## Harness note
`WORKSPACE` and the handoff-schema path in the task prompt were literally
the string `undefined` (same issue TASK-004 flagged) — no `sprint-plan.md`
found at that location. Read `D:/Desktop/project-renaiss/PLAN.md` and the
existing `sprint-progress/TASK-004.md` for context/schema instead. This
file follows TASK-004's plain status/summary/evidence/notes structure.
