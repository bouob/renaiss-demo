# Merchant API ops (renaiss-demo only)

## Why CI failed on `3f38a48`

Workflow **conclusion looked green** because `Deploy Cloud Function merchantApi` had `continue-on-error: true`, but **merchantApi never updated**.

| Path | Failure |
|------|---------|
| **A firebase CLI** | `403` on `firebaseextensions.googleapis.com` (SA missing Extensions Viewer / Firebase Admin surface) |
| **B gcloud gen2** | Cloud Build: **`function.js does not exist`** — source used `firebase-functions` export in `index.js` only; GCF buildpack / FF expects a Functions Framework entry (and often a `function.js` file). Earlier staging also risked monorepo root `package.json` `"build": vite`. Follow-ups: reserved `GOOGLE_FUNCTION_TARGET` build-env rejected; YAML env-vars-file broke on URL/base64 → use `--set-env-vars=^|^…`. |

**Fixed in `653725a` / CI run success:** gcloud path stages `main=function.js` + Functions Framework; post-deploy health returns `{ status, service: merchantApi }`.

Hosting multi-site still deployed → UI on `merchant.dokipoki.app` updated; **API stayed on old revision**.

## Entrypoints (after fix)

| File | Role |
|------|------|
| `server/app.js` | Pure Express app (`/api/*`, `/merchant/api/*`) |
| `server/index.js` | `export const merchantApi = onRequest(app)` for **firebase deploy**; local `IS_LOCAL_DEV` listen |
| `server/function.js` | `@google-cloud/functions-framework` `http('merchantApi', app)` for **gcloud** |

CI gcloud path rewrites staged `package.json` → `"main": "function.js"`.

## Deploy ownership

```text
renaiss-demo ci-deploy
  ├─ Hosting target merchant → merchant-dokipoki-dev (+ custom domain)
  └─ Function merchantApi (asia-east1)  ← must succeed

Dokipoki Deploy to Dev
  └─ optional path mount /merchant/ only (not required for merchant.dokipoki.app)
```

## Monitoring

- **Post-deploy** step in `ci-deploy.yml` curls health until 200.
- **`health-monitor.yml`** every 30 minutes + manual dispatch:
  - `https://merchant.dokipoki.app/api/health`
  - `https://merchant-dokipoki-dev.web.app/api/health`

## Local verify

```bash
cd server
npm ci
npm run check
npm test
npm run dev   # IS_LOCAL_DEV → :3101
curl -s http://127.0.0.1:3101/api/health
```

## SA permissions (firebase path A)

If firebase deploy still 403, grant deploy SA on project `dokipoki-dev`:

- Cloud Functions Admin / Developer  
- Service Account User  
- Cloud Build Editor  
- Artifact Registry Writer  
- **Firebase Extensions Viewer** (or broader Firebase Admin) — unblocks `firebase deploy --only functions`

gcloud path B should work with Functions + Run + Build permissions alone.
