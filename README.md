# Merchant Copilot

Merchant-facing card shop intelligence on Renaiss market data. The app helps a dealer review cards, scan wallets, track inventory, and generate AI-assisted promote / hold / clear guidance.

| Surface | URL |
|---|---|
| Live site | https://merchant.dokipoki.app/ |
| Health check | https://merchant.dokipoki.app/api/health |
| Optional path mount | https://dokipoki-dev.web.app/merchant/ |

The repository owns the Merchant Copilot monorepo:

- `client/`: React + Vite frontend
- `server/`: Express API deployed as `merchantApi`
- `scripts/`: hosting prep utilities used by root build scripts

## Repository layout

```text
.
├── client/   # React app
├── server/   # Express API + Firebase / Cloud Function entrypoints
├── scripts/  # build and hosting helpers
└── docs/     # project notes
```

## Prerequisites

- Node.js 20
- npm

## Environment setup

Server and client env vars use separate templates:

- Root server template: [`.env.example`](/Users/shejacker/renaiss-demo-main/.env.example)
- Client template: [`client/.env.example`](/Users/shejacker/renaiss-demo-main/client/.env.example)

Setup:

```bash
cp .env.example .env
cp client/.env.example client/.env
```

Notes:

- Server secrets stay in root `.env` only.
- `VITE_*` values in `client/.env` are safe public Firebase web config values.
- Missing server integrations fail open for some features:
  - no Renaiss key: index / FMV endpoints degrade to empty or null data
  - no BSC RPC URL: wallet scan returns no holdings
  - no Gemini key: AI merchant insight returns unconfigured unless cache exists
  - no Firebase Admin service account: inventory metadata routes are unavailable

## Install

```bash
npm run install:all
```

Or install each package independently:

```bash
npm install --prefix server
npm install --prefix client
```

## Local development

Run the API:

```bash
npm run dev:server
```

The server listens on `http://localhost:3101`.

Run the client in another terminal:

```bash
npm run dev:client
```

The Vite app runs on `http://localhost:5174`.

The frontend supports both API prefixes through the same Express app:

- root-site mode: `/api/**`
- path-mount mode: `/merchant/api/**`

By default, the Vite base is `/merchant/`. Root-site builds use `/`.

## Scripts

Root scripts:

```bash
npm run dev:server
npm run dev:client
npm run build
npm run build:path
npm run build:root
npm run test:ci
```

Useful breakdown:

- `npm run build`: standard client build plus hosting preparation
- `npm run build:path`: client build with `--base /merchant/` plus hosting preparation
- `npm run build:root`: client build with `--base /`
- `npm run check:server`: syntax checks for key server files
- `npm run test:server`: Node test suite for server logic and routes
- `npm run test:client`: Node test suite for client-side logic

## API surface

Mounted under both `/api` and `/merchant/api`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/wall` | market wall / index tiles |
| GET | `/movers` | promote / hold / clear movers |
| GET | `/ticker` | sales pulse ticker |
| GET | `/card/:cert` | card details and FMV |
| GET | `/related/:cert` | adjacent related certs |
| POST | `/scan` | wallet scan |
| GET | `/meta` | inventory metadata for signed-in user |
| PUT | `/meta` | upsert inventory metadata |
| POST | `/meta/bulk` | bulk metadata upsert |
| POST | `/meta/unlink-wallet` | unlink saved wallet |
| GET | `/insight/merchant-usage` | Gemini quota / usage state |
| POST | `/insight/merchant` | AI merchant verdict |
| GET | `/sales` | authenticated sold-history list |
| POST | `/sales/bulk` | authenticated sold-history bulk write |
| GET | `/portfolio-series` | authenticated portfolio time series |

## Deployment

Current entrypoints:

- [`server/app.js`](/Users/shejacker/renaiss-demo-main/server/app.js): pure Express app
- [`server/index.js`](/Users/shejacker/renaiss-demo-main/server/index.js): Firebase Functions entry
- [`server/function.js`](/Users/shejacker/renaiss-demo-main/server/function.js): Functions Framework / gcloud entry

Merchant hosting deploy command:

```bash
npm run deploy:merchant-site
```

This builds the root-site variant and deploys Firebase Hosting target `merchant` with `firebase.merchant-site.json`.

## Testing

Run the full CI-equivalent local suite:

```bash
npm run test:ci
```

That covers:

- server syntax checks
- server tests
- client tests
- production build

## Security

- Do not commit `.env`, API keys, service-account JSON, or private wallet material.
- Keep placeholders only in `*.env.example`.
- Client env vars must remain limited to `VITE_*` public config.
