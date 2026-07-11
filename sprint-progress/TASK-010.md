# TASK-010 — P3 Inventory intake server

Status: DONE

## Summary
- `POST /scan` — IP rate limit, `walletGuard` reject/accept, `fetchHoldings`/`fetchNFTAttributes`/`getGradedFmv`
- `GET /card/:cert` — FMV + brief, `{found:false}` branch, optional `?series=1`
- `GET /related/:cert` — **ownership gate** via `heldCertGate` + inventory check; gated-deny = empty, zero upstream
- `GET/PUT /meta` + `POST /meta/bulk` — `hackathonMerchantInventory/{uid}/items/{cert}`, `requireAuth`
- `server/middleware/requireAuth.js` + `services/firebaseAdmin.js` (fail-open null when no SA)

## Evidence
- related not held → `gated:true, reason:not_held`
- scan zero addr → `400 blocked_address`
- scan bad shape → `400 invalid_shape`
- scan valid + no RPC → `200 holdings:[] warning:chain_unconfigured`
