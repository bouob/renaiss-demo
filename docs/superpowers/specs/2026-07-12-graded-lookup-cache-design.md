# Graded-lookup cache — design

**Date:** 2026-07-12
**Status:** Approved, pre-implementation

## Problem

`getGradedFmv` and `getGradedCardBrief` in `server/services/renaissOsIndex.js` both
call `GET /v1/graded/{cert}` with no caching. Every call goes through
`requestUpstreamJson`, which increments the shared per-instance `dailyCount`
unconditionally. Observed telemetry shows `gradedCardBrief` and `gradedFmv`
counts climbing past 595+ in a single UTC day, with `gradedCardBrief` already
~2× over its (informational-only) 300 soft budget.

Two compounding factors:

1. **No cache.** Repeated lookups of the same cert re-hit the upstream API every
   time. The existing `cardFmvSeriesCache.js` only covers the *series* endpoint
   (`getCardFmvSeries`), not the graded lookups.
2. **Concurrent double-fetch.** Callers fire the two functions concurrently for
   the same cert — `routes/card.js:51-52`, `routes/scan.js:90-91` — and
   `renaissAdjacentCertService.js:116` fans `getGradedCardBrief` across many
   certs via `Promise.all`. A single card view therefore costs 2 upstream calls
   for one cert.

## Goal

Stop repeated `/v1/graded/{cert}` lookups from draining the upstream daily
budget, without changing any observable contract of `getGradedFmv` /
`getGradedCardBrief` (both still return their mapped shape or `null`, never
throw).

## Design

Two layers.

### 1. New module `server/services/gradedLookupCache.js`

A near-clone of `cardFmvSeriesCache.js`:

- Firestore collection `hackathonGradedLookupCache/{cert}`, keyed by the
  already-shape-validated cert (`CERT_SHAPE`). Certs match `^[A-Za-z]{0,4}\d{1,20}$`,
  so they are safe Firestore document IDs (no `/`).
- TTL reuses the same 8h value as the series cache
  (`GRADED_LOOKUP_CACHE_TTL_MS = 8 * 60 * 60 * 1000`).
- `readGradedLookupCache(cert)` → cached **raw upstream payload** (the parsed
  `/v1/graded/{cert}` JSON) or `null` on miss / expired / cache unavailable.
- `writeGradedLookupCache(cert, payload)` → best-effort persist with
  `cachedAtMs` + `schemaVersion`.
- Fail-open: a Firestore outage must never prevent the upstream call. Same
  error handling and warnings as the series cache.
- Caches **any valid payload, including `found:false`** — repeatedly scanning a
  cert the index does not have will not re-hit the API for the TTL window.
  Never caches `null` (adapter failure), so transient errors are not pinned.

### 2. Shared single-flight helper in `renaissOsIndex.js`

New internal `getGradedLookupPayload(cert, feature)`:

1. Validate `CERT_SHAPE`; invalid → `null`.
2. In-memory `Map<cert, Promise>` (per warm instance). If a fetch for this cert
   is already in flight, return the same promise — this collapses the concurrent
   `Promise.all` pair into a single upstream call.
3. Read Firestore cache → return payload on hit.
4. Miss → `requestUpstreamJson('/v1/graded/{cert}', label, feature)`. On a
   non-null payload, `writeGradedLookupCache`. Clear the in-flight map entry in a
   `finally`.

`getGradedFmv` and `getGradedCardBrief` become:

```js
export async function getGradedFmv(cert) {
  const data = await getGradedLookupPayload(cert, 'gradedFmv');
  return data ? mapGradedLookupToFmv(data) : null;
}
export async function getGradedCardBrief(cert) {
  const data = await getGradedLookupPayload(cert, 'gradedCardBrief');
  return data ? mapGradedLookupToCardBrief(data) : null;
}
```

Each applies its own mapping to the shared raw payload.

### Telemetry effect

On a cache hit or an in-flight coalesce, no upstream call is made, so no
telemetry line and no `dailyCount` increment. Whichever function wins the
concurrent race emits one telemetry line (tagged with its own `feature`); the
other coalesces silently. Log volume drops roughly by half immediately
(concurrent dedupe) and then to ~1 upstream call per cert per 8h window.

## Non-goals

- No change to quota / circuit-breaker / telemetry internals.
- No cross-instance in-flight dedupe — Firestore handles the cross-instance and
  across-time cases; the in-memory map only dedupes within one warm instance.
- No cache-invalidation UI (demo scope).

## Testing

- New unit tests for `gradedLookupCache` mirroring `cardFmvSeriesCache`'s tests:
  hit, miss, expired (past TTL), fail-open when `adminDb` is null / throws,
  round-trip write→read.
- `renaissOsIndex` tests: `getGradedFmv` / `getGradedCardBrief` read through the
  cache; a concurrent pair for the same cert triggers exactly one
  `requestUpstreamJson`; a `found:false` payload is cached and served on the next
  call; a `null` upstream result is not cached.
