# Deploy Merchant root site only (`merchant-dokipoki-dev`)

**Never** point this build at the default Dokipoki hosting site.

## Prerequisites (Console checklist)

- [ ] Hosting site `merchant-dokipoki-dev` exists
- [ ] `merchant.dokipoki.app` attached to **that** site (not default)
- [ ] DNS/SSL Connected
- [ ] Auth authorized domain includes `merchant.dokipoki.app`
- [ ] `merchantApi` `CORS_ORIGIN` includes `https://merchant.dokipoki.app,https://dokipoki-dev.web.app`

## Build root SPA

```bash
npm run install:all
# inject VITE_FIREBASE_* as in CI
npm run build:root
# → client/dist at site root (base=/)
```

## Deploy hosting to multi-site only

```bash
# Uses firebase.merchant-site.json (site: merchant-dokipoki-dev, public: client/dist)
npx firebase deploy --only hosting --config firebase.merchant-site.json --project dokipoki-dev --non-interactive
```

Optional: update function CORS in same change window:

```bash
# example — use your secret injection process
# CORS_ORIGIN=https://merchant.dokipoki.app,https://dokipoki-dev.web.app
npx firebase deploy --only functions:merchantApi --project dokipoki-dev
# or gcloud functions deploy merchantApi --update-env-vars=...
```

## Path mount remains

Dokipoki `Deploy to Dev` still clones this repo and builds default `base=/merchant/` into `client/dist/merchant/` on **default** site. That is independent of this multi-site deploy.
