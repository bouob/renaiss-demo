# TASK-008 — P2 `/movers` engine

Status: DONE

## Summary
- `server/routes/movers.js` — `GET /movers`
- Per-card 7d/30d delta + alpha (card − index) + promote/hold/clear + reason strings
- **Branch (a)** embedded `delta7d/change30d/deltas` / single `deltaPct`
- **Branch (b)** `getCardFmvSeries` fan-out when change fields absent (cap 40, concurrency 4)
- **Liquidity present**: thin/lastSaleAt score → mid/high thresholds + thin → hold penalty
- **Liquidity absent**: delta+alpha only ranking
- Fail-open empty movers when `!isConfigured()`

## Evidence
- Smoke: `GET /movers` → `200 {"movers":[],...}` without keys
