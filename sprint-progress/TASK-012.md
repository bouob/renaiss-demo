# TASK-012 — P5 series + cost + charts

Status: DONE

## Summary
- `/card/:cert?series=1` returns `series30d` + `returnPct30d` via `getCardFmvSeries`
- On-chain cost: adapter exposes `onChainCostUsd: null` / `costSource: 'unavailable'`; Inventory manual cost path is explicit fallback (both branches)
- Sparkline 30d on holdings + inventory-vs-market selected panel
- Alpha from movers cross for RS-style signal

## Notes
- Full Dokipoki ledger cost recovery was out of TASK-005 keep-set; manual-first is intentional per that handoff note.
