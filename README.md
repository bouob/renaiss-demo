# Merchant Copilot

Merchant-facing card shop intelligence on Renaiss market data — **Promote / Hold / Clear**.

| | URL |
|---|-----|
| Live (root site) | https://merchant.dokipoki.app/ |
| Health | https://merchant.dokipoki.app/api/health |
| Optional path mount | https://dokipoki-dev.web.app/merchant/ |

This repo (`bouob/renaiss-demo`) owns **Hosting multi-site + `merchantApi`**. Dokipoki Deploy to Dev only optionally mirrors `/merchant/` on the main site.

---

## Local dev

```bash
# server
cd server
npm install
# copy ../.env.example → ../.env and fill secrets (optional; APIs fail-open without keys)
npm run dev          # http://localhost:3101  /api/health

# client
cd client
npm install
npm run dev          # http://localhost:5174/  (or /merchant/ when base is path mode)
```

API prefixes (same Express app):

- Root site: `/api/**`
- Path mount: `/merchant/api/**`

---

## Main routes

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/health` | liveness |
| GET | `/api/wall` | L1 index + sparkline |
| GET | `/api/movers` | promote / hold / clear |
| GET | `/api/ticker` | sales pulse |
| GET | `/api/card/:cert` | FMV / brief |
| GET | `/api/related/:cert` | ±1 neighbors (gated) |
| POST | `/api/scan` | wallet scan (rate limited) |
| GET/PUT | `/api/meta` | inventory metadata (Firebase Auth) |
| POST | `/api/meta/bulk` | bulk upsert |

---

## Build / deploy

```bash
npm run build:root   # Vite base=/  → multi-site merchant-dokipoki-dev
npm run build:path   # Vite base=/merchant/ → optional Dokipoki path mount
```

CI (push `main` / workflow_dispatch):

- Server `npm run check` + `npm test`
- Client build
- Deploy `merchantApi` (must succeed) + Hosting multi-site
- Post-deploy health check
- Scheduled `health-monitor` every 30m

Secrets live in **GitHub Actions secrets** / Cloud Function env only — never in the repo.  
Use root `.env.example` and `client/.env.example` as the public templates.

Entrypoints: `server/app.js` (Express) · `server/index.js` (Firebase) · `server/function.js` (gcloud Functions Framework).

---

## Secrets policy

- Do **not** commit API keys, service-account JSON, or real wallet private keys.
- Placeholders only in `*.env.example`.
