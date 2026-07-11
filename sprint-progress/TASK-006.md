# TASK-006 — P1 `/wall` route (L1 market context, 1h cache)

Status: DONE

## Summary
- `server/routes/wall.js` — `GET /wall` merges `getIndices` + `getIndexDetail('pokemon')` (both-success-only) into index tile + sparkline + deltas + top-10.
- `server/services/wallCache.js` — in-memory 1h TTL (hackathonFeed/current concept).
- Fail-open `{ index: null }` when unconfigured / upstream miss.
- Mounted in `server/index.js` under `/merchant/api`.

## Evidence
- `node --check routes/wall.js` OK
- Smoke: `GET /wall` → `200 {"index":null,"cache":"miss"}` without keys
