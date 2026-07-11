# Deploy Merchant root site only (`merchant-dokipoki-dev`)

**Never** deploy this build to the default Dokipoki hosting site (`dokipoki-dev`).

| Site ID | URL |
|---------|-----|
| default (dokipoki-dev) | `https://dokipoki-dev.web.app` — main app + optional `/merchant` path |
| **merchant-dokipoki-dev** | `https://merchant-dokipoki-dev.web.app` — Merchant root SPA |

## One-time setup

```bash
# From project-renaiss root; requires firebase login with access to dokipoki-dev
npx -y firebase-tools@13 login
npx -y firebase-tools@13 use dokipoki-dev

# Create site (skip if already exists)
npx -y firebase-tools@13 hosting:sites:create merchant-dokipoki-dev --project dokipoki-dev

# Bind local target "merchant" → site merchant-dokipoki-dev
# (.firebaserc already has this target; re-run if cloning fresh)
npx -y firebase-tools@13 target:apply hosting merchant merchant-dokipoki-dev --project dokipoki-dev
```

## Build + deploy (root `base=/`)

```bash
# Optional: copy client Firebase public config into client/.env (VITE_*)
npm run build:root
npx -y firebase-tools@13 deploy --only hosting:merchant \
  --config firebase.merchant-site.json \
  --project dokipoki-dev
```

Or: `npm run deploy:merchant-site`

## Custom domain (Console)

1. Hosting → **merchant-dokipoki-dev** → Add custom domain `merchant.dokipoki.app`
2. Remove that domain from default site if present
3. Auth → Authorized domains → add `merchant.dokipoki.app` and `merchant-dokipoki-dev.web.app`
4. `merchantApi` env:  
   `CORS_ORIGIN=https://merchant.dokipoki.app,https://merchant-dokipoki-dev.web.app,https://dokipoki-dev.web.app`

## Path mount remains

Dokipoki `Deploy to Dev` still clones this repo with `base=/merchant/` into  
`dokipoki-dev.web.app/merchant/` — independent of this multi-site deploy.
