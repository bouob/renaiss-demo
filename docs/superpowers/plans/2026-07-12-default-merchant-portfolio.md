# Default Merchant Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every merchant account opens with a ready-made 18-card default portfolio, seeded server-side on first sign-in, editable and deletable like any normal inventory row.

**Architecture:** On the first `GET /meta` for an account, a seed engine writes 18 real Renaiss graded cards to Firestore under a per-account synthetic wallet derived from the uid, guarded by a one-time marker on the account's parent doc so deleting cards never re-seeds. `GET /meta` with no `?wallet=` returns that synthetic wallet so the client auto-binds and shows the portfolio immediately.

**Tech Stack:** Node.js ESM, Express, Firebase Admin (Firestore), React (Vite), `node --test` test runner.

## Global Constraints

- Server is ESM (`"type": "module"`); use `import`/`export`, not `require`.
- Inventory doc path: `hackathonMerchantInventory/{uid}/items/{cert}`. Collection name constant is `COLLECTION`.
- `cert` must match `CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/` or the row is rejected on write.
- Money/qty/string fields must pass through the existing `sanitizeItem` — never write raw seed objects to Firestore.
- Synthetic wallet must pass `isValidAddressShape` (shape `^0x[0-9a-fA-F]{40}$`).
- Seeding runs **exactly once per account**, gated by a `seededDefaultAt` marker on the parent doc — not by item count (delete must stick).
- New test files must be added to the `test` script's file list in `server/package.json` (the runner takes an explicit list, not a glob).
- Commit after each task.

---

### Task 1: Extract shared inventory-item module

Move `sanitizeItem`, `sanitizeWallet`, `CERT_SHAPE`, and `COLLECTION` out of the route file into a shared `lib` module so both `meta.js` and the seed engine import one source of truth (avoids a route ↔ service circular import).

**Files:**
- Create: `server/lib/inventoryItem.js`
- Modify: `server/routes/meta.js` (remove the moved definitions; import them instead)
- Test: `server/tests/inventoryItem.test.js`
- Modify: `server/package.json` (register the new test file)

**Interfaces:**
- Produces:
  - `COLLECTION: string` (`'hackathonMerchantInventory'`)
  - `CERT_SHAPE: RegExp`
  - `sanitizeWallet(v: unknown): string | null` — lowercased 0x address or null
  - `sanitizeItem(body: object, cert: string): object` — the sanitized Firestore patch (includes `updatedAt`)

- [ ] **Step 1: Write the failing test**

Create `server/tests/inventoryItem.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLECTION,
  CERT_SHAPE,
  sanitizeWallet,
  sanitizeItem,
} from '../lib/inventoryItem.js';

describe('inventoryItem shared module', () => {
  it('exposes the inventory collection name', () => {
    assert.equal(COLLECTION, 'hackathonMerchantInventory');
  });

  it('CERT_SHAPE accepts a PSA cert and rejects junk', () => {
    assert.ok(CERT_SHAPE.test('PSA114662766'));
    assert.ok(!CERT_SHAPE.test('../etc/passwd'));
    assert.ok(!CERT_SHAPE.test('x'.repeat(65)));
  });

  it('sanitizeWallet lowercases a valid address and rejects bad shape', () => {
    assert.equal(
      sanitizeWallet('0xABCDEF0123456789ABCDEF0123456789ABCDEF01'),
      '0xabcdef0123456789abcdef0123456789abcdef01',
    );
    assert.equal(sanitizeWallet('not-a-wallet'), null);
  });

  it('sanitizeItem keeps demo fields and stamps updatedAt', () => {
    const patch = sanitizeItem(
      {
        wallet: '0xabcdef0123456789abcdef0123456789abcdef01',
        name: 'Pikachu',
        setName: 'Crown Zenith',
        grade: '10 Gem Mint',
        imageUrl: 'https://example.com/x.jpg',
        priceUsdCents: 29531,
        href: '/card/pokemon/x',
        status: 'active',
      },
      'PSA114662766',
    );
    assert.equal(patch.cert, 'PSA114662766');
    assert.equal(patch.wallet, '0xabcdef0123456789abcdef0123456789abcdef01');
    assert.equal(patch.name, 'Pikachu');
    assert.equal(patch.priceUsdCents, 29531);
    assert.equal(patch.href, '/card/pokemon/x');
    assert.equal(patch.status, 'active');
    assert.equal(typeof patch.updatedAt, 'string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/inventoryItem.test.js`
Expected: FAIL — `Cannot find module '../lib/inventoryItem.js'`.

- [ ] **Step 3: Create the shared module**

Create `server/lib/inventoryItem.js` with the definitions lifted verbatim from `server/routes/meta.js` (lines 15–88 in the current file):

```javascript
/**
 * Shared inventory-item sanitizer + constants. Extracted from routes/meta.js so
 * both the /meta route and the default-portfolio seed engine write rows through
 * one code path (and to avoid a route ↔ service circular import).
 */

import { isValidAddressShape } from './walletGuard.js';
import { sanitizeMoney, sanitizeQty, sanitizeNonNegInt } from './moneySanitize.js';

export const COLLECTION = 'hackathonMerchantInventory';
export const CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/;

const STATUSES = new Set(['active', 'promoted', 'delisted', 'sold', 'hold', 'clear']);
const ACQUIRE_TYPES = new Set(['PACK_PULL', 'MINT', 'TRANSFER', 'UNKNOWN', 'PACK_PAYMENT']);
const COST_SOURCES = new Set([
  'manual',
  'pack_payment',
  'pack_payment_split',
  'pack_unmatched',
  'secondary_transfer',
  'unavailable',
  'buy',
]);

export function sanitizeWallet(v) {
  const w = typeof v === 'string' ? v.trim() : '';
  if (!isValidAddressShape(w)) return null;
  return w.toLowerCase();
}

function sanitizeString(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

export function sanitizeItem(body, cert) {
  const status = typeof body.status === 'string' && STATUSES.has(body.status)
    ? body.status
    : 'active';
  const wallet = sanitizeWallet(body.wallet);
  const acquireType = typeof body.acquireType === 'string' && ACQUIRE_TYPES.has(body.acquireType)
    ? body.acquireType
    : null;
  const costSource = typeof body.costSource === 'string' && COST_SOURCES.has(body.costSource)
    ? body.costSource
    : null;
  // Money: >=0, <=999_999_999, max 2 decimals (no negatives / scientific notation).
  // priceUsdCents is integer cents — cap at MAX_MONEY * 100.
  const priceUsdCents = sanitizeNonNegInt(body.priceUsdCents, { max: 999_999_999 * 100 });
  const patch = {
    cert,
    wallet,
    cost: sanitizeMoney(body.cost),
    listPrice: sanitizeMoney(body.listPrice),
    qty: sanitizeQty(body.qty),
    target: sanitizeMoney(body.target),
    stop: sanitizeMoney(body.stop),
    status,
    name: sanitizeString(body.name, 200),
    setName: sanitizeString(body.setName, 200),
    grade: sanitizeString(body.grade, 40),
    imageUrl: sanitizeString(body.imageUrl, 500),
    priceUsdCents,
    href: sanitizeString(body.href, 300),
    notes: sanitizeString(body.notes, 1000),
    acquireType,
    costSource,
    onChainCostUsd: sanitizeMoney(body.onChainCostUsd),
    packPaymentTxHash: sanitizeString(body.packPaymentTxHash, 80),
    updatedAt: new Date().toISOString(),
  };
  // Drop null optional pack fields so merge doesn't wipe prior values when omitted.
  if (patch.acquireType == null) delete patch.acquireType;
  if (patch.costSource == null) delete patch.costSource;
  if (patch.onChainCostUsd == null) delete patch.onChainCostUsd;
  if (patch.packPaymentTxHash == null) delete patch.packPaymentTxHash;
  if (patch.wallet == null) delete patch.wallet;
  return patch;
}
```

- [ ] **Step 4: Update `routes/meta.js` to import from the shared module**

In `server/routes/meta.js`:

Replace the import block near the top — remove `walletGuard`/`moneySanitize` imports that are now only used by the moved code, and add the shared import. The final import section should read:

```javascript
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { adminDb } from '../services/firebaseAdmin.js';
import { rememberHeldCert, rememberHeldCerts } from '../services/heldCertGate.js';
import { COLLECTION, CERT_SHAPE, sanitizeWallet, sanitizeItem } from '../lib/inventoryItem.js';
```

Then delete from `meta.js`:
- the local `export const COLLECTION = ...` line,
- the local `const CERT_SHAPE = ...` line,
- the `STATUSES`, `ACQUIRE_TYPES`, `COST_SOURCES` const declarations,
- the local `sanitizeWallet`, `sanitizeString`, and `sanitizeItem` function definitions.

Keep `itemRef`, `userOwnsCert`, and all route handlers. Note `COLLECTION` was previously exported from `meta.js`; re-export it so any existing importer keeps working — add this line after the imports:

```javascript
export { COLLECTION } from '../lib/inventoryItem.js';
```

- [ ] **Step 5: Run the new test + full suite to verify green**

Run: `cd server && node --test tests/inventoryItem.test.js`
Expected: PASS (4 tests).

Register the new file, then run everything. In `server/package.json`, change the `test` script to:

```json
"test": "node --test tests/moneySanitize.test.js tests/app.smoke.test.js tests/portfolioSeries.test.js tests/inventoryItem.test.js",
```

Run: `cd server && npm test`
Expected: PASS — all existing suites plus the new one.

- [ ] **Step 6: Commit**

```bash
git add server/lib/inventoryItem.js server/routes/meta.js server/tests/inventoryItem.test.js server/package.json
git commit -m "refactor(server): extract shared inventoryItem sanitizer module"
```

---

### Task 2: Default portfolio seed data module

A static, logic-free module holding the 18 resolved real cards.

**Files:**
- Create: `server/services/defaultPortfolioSeed.js`
- Test: `server/tests/defaultPortfolioSeed.test.js`
- Modify: `server/package.json` (register the new test file)

**Interfaces:**
- Produces: `DEFAULT_PORTFOLIO_ITEMS: Array<{ cert, name, setName, grade, imageUrl, priceUsdCents?, href, status }>` — 18 entries.

- [ ] **Step 1: Write the failing test**

Create `server/tests/defaultPortfolioSeed.test.js`:

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';
import { CERT_SHAPE } from '../lib/inventoryItem.js';

describe('DEFAULT_PORTFOLIO_ITEMS', () => {
  it('has 18 cards', () => {
    assert.equal(DEFAULT_PORTFOLIO_ITEMS.length, 18);
  });

  it('every card has a cert matching CERT_SHAPE', () => {
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      assert.ok(CERT_SHAPE.test(item.cert), `bad cert: ${item.cert}`);
    }
  });

  it('certs are unique', () => {
    const certs = DEFAULT_PORTFOLIO_ITEMS.map((i) => i.cert);
    assert.equal(new Set(certs).size, certs.length);
  });

  it('every card has name, grade, imageUrl, href, and active status', () => {
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      assert.ok(item.name && typeof item.name === 'string');
      assert.ok(item.grade && typeof item.grade === 'string');
      assert.ok(item.imageUrl?.startsWith('https://'));
      assert.ok(item.href?.startsWith('/card/'));
      assert.equal(item.status, 'active');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/defaultPortfolioSeed.test.js`
Expected: FAIL — `Cannot find module '../services/defaultPortfolioSeed.js'`.

- [ ] **Step 3: Create the seed data module**

Create `server/services/defaultPortfolioSeed.js`. Prefix with a short header comment, then paste the exact array below (resolved from the product owner's `renaiss.xyz/card/{tokenId}` links via on-chain metadata + the Renaiss index; one card — `PSA113221413` — has no index price and omits `priceUsdCents`):

```javascript
/**
 * defaultPortfolioSeed.js — static seed data for the demo default portfolio.
 * 18 real Renaiss graded cards. `cert` is the PSA serial (inventory key); each
 * row was resolved once from a renaiss.xyz/card/{tokenId} link via the app's
 * fetchNFTAttributes + getGradedFmv. Pure data — append more cards by resolving
 * additional token IDs the same way. Consumed by services/defaultPortfolio.js.
 */

export const DEFAULT_PORTFOLIO_ITEMS = [
  {
    cert: 'PSA114662766',
    name: 'PSA 10 Gem Mint 2023 Pokemon Sword And Shield Crown Zenith 160 Pikachu',
    setName: 'Pokemon Sword And Shield Crown Zenith',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA114662766/nft_image.jpg',
    priceUsdCents: 29531,
    href: '/card/pokemon/pokemon-sword-and-shield-crown-zenith/160-pikachu-psa-10-35d7f310',
    status: 'active',
  },
  {
    cert: 'PSA136225944',
    name: 'PSA 10 Gem Mint 2025 Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex 003 Mega Gengar Ex',
    setName: 'Pokemon Japanese Mbg-Mega Starter Set Mega Gengar Ex',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA136225944/nft_image.jpg',
    priceUsdCents: 3684,
    href: '/card/pokemon/pokemon-japanese-mbg-mega-starter-set-mega-gengar-ex/003-mega-gengar-ex-psa-10-japanese-de0d46db',
    status: 'active',
  },
  {
    cert: 'PSA129297256',
    name: 'PSA 10 Gem Mint 2025 Pokemon Japanese M-P Promo 020 Pikachu',
    setName: 'Pokemon Japanese M-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA129297256/nft_image_silver.jpg',
    priceUsdCents: 8766,
    href: '/card/pokemon/mcdonald-s-japanese-m-p-promo/020-pikachu-psa-10-japanese-2fabc70d',
    status: 'active',
  },
  {
    cert: 'PSA82880232',
    name: 'PSA 10 Gem Mint 2022 Pokemon Japanese Sv Promo 001 Pikachu',
    setName: 'Pokemon Japanese Sv Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA82880232/nft_image_silver.jpg',
    priceUsdCents: 10644,
    href: '/card/pokemon/pokemon-japanese-sv-promo/001-pikachu-psa-10-japanese-3755455e',
    status: 'active',
  },
  {
    cert: 'PSA138521137',
    name: 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 068 Leafeon',
    setName: 'Pokemon Japanese Sv-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138521137/nft_image_silver.jpg',
    priceUsdCents: 16082,
    href: '/card/pokemon/pokemon-japanese-sv-p-promo/068-leafeon-psa-10-japanese-59d384c8',
    status: 'active',
  },
  {
    cert: 'PSA102412061',
    name: 'PSA 10 Gem Mint 2021 Pokemon Japanese S Promo 208 Pikachu',
    setName: 'Pokemon Japanese S Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA102412061/nft_image_silver.jpg',
    priceUsdCents: 34570,
    href: '/card/pokemon/pokemon-japanese-s-promo/208-pikachu-psa-10-japanese-cb41f898',
    status: 'active',
  },
  {
    cert: 'PSA115076682',
    name: 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 070 Sylveon',
    setName: 'Pokemon Japanese Sv-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA115076682/nft_image_silver.jpg',
    priceUsdCents: 16503,
    href: '/card/pokemon/pokemon-japanese-sv-p-promo/070-sylveon-psa-10-japanese-bb6789a5',
    status: 'active',
  },
  {
    cert: 'PSA123551179',
    name: 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv5a-Crimson Haze 078 Eevee',
    setName: 'Pokemon Japanese Sv5a-Crimson Haze',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA123551179/nft_image.jpg',
    priceUsdCents: 10757,
    href: '/card/pokemon/pokemon-japanese-sv5a-crimson-haze/078-eevee-psa-10-japanese-afbe060d',
    status: 'active',
  },
  {
    cert: 'PSA123315980',
    name: 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 064 Jolteon',
    setName: 'Pokemon Japanese Sv-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA123315980/nft_image_silver.jpg',
    priceUsdCents: 16546,
    href: '/card/pokemon/pokemon-japanese-sv-p-promo/064-jolteon-psa-10-japanese-efef4bb7',
    status: 'active',
  },
  {
    cert: 'PSA124850705',
    name: "PSA 10 Gem Mint 2025 Pokemon Japanese Sv10-Glory Of Team Rocket 109 Team Rocket's Meowth",
    setName: 'Pokemon Japanese Sv10-Glory Of Team Rocket',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA124850705/nft_image.jpg',
    priceUsdCents: 5754,
    href: '/card/pokemon/pokemon-japanese-sv10-glory-of-team-rocket/109-team-rocket-s-meowth-psa-10-japanese-5ce00471',
    status: 'active',
  },
  {
    cert: 'PSA113221413',
    name: 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 205 Vaporeon Ex',
    setName: 'Pokemon Japanese Sv8a-Terastal Fest Ex',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA113221413/nft_image.jpg',
    href: '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/205-vaporeon-ex-psa-10-japanese-97448cc3',
    status: 'active',
  },
  {
    cert: 'PSA113813015',
    name: 'PSA 10 Gem Mint 2021 Pokemon Japanese Sword & Shield Eevee Heroes 077 Glaceon V',
    setName: 'Pokemon Japanese Sword & Shield Eevee Heroes',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA113813015/nft_image.jpg',
    priceUsdCents: 22393,
    href: '/card/pokemon/pokemon-japanese-sword-shield-eevee-heroes/077-glaceon-v-psa-10-japanese-b23b0aab',
    status: 'active',
  },
  {
    cert: 'PSA116808013',
    name: 'PSA 10 Gem Mint 2021 Pokemon Japanese Sword & Shield Vmax Climax 252 Rayquaza Vmax',
    setName: 'Pokemon Japanese Sword & Shield Vmax Climax',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA116808013/nft_image_silver.jpg',
    priceUsdCents: 41303,
    href: '/card/pokemon/pokemon-japanese-sword-shield-vmax-climax/252-rayquaza-vmax-psa-10-japanese-4633a68b',
    status: 'active',
  },
  {
    cert: 'PSA138043745',
    name: 'PSA 10 Gem Mint 2024 Pokemon Japanese Sv8a-Terastal Fest Ex 202 Flareon Ex',
    setName: 'Pokemon Japanese Sv8a-Terastal Fest Ex',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA138043745/nft_image.jpg',
    priceUsdCents: 10683,
    href: '/card/pokemon/pokemon-japanese-sv8a-terastal-fest-ex/202-flareon-ex-psa-10-japanese-651a14fc',
    status: 'active',
  },
  {
    cert: 'PSA103938915',
    name: 'PSA 10 Gem Mint 2023 Pokemon Japanese Sv-P Promo 120 Pikachu',
    setName: 'Pokemon Japanese Sv-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA103938915/nft_image.jpg',
    priceUsdCents: 7422,
    href: '/card/pokemon/pokemon-japanese-sv-p-promo/120-pikachu-psa-10-japanese-f9e8e4ac',
    status: 'active',
  },
  {
    cert: 'PSA110241961',
    name: "PSA 10 Gem Mint 2025 Pokemon Japanese Sv-P Promo 232 Iono's Wattrel",
    setName: 'Pokemon Japanese Sv-P Promo',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA110241961/nft_image.jpg',
    priceUsdCents: 3977,
    href: '/card/pokemon/pokemon-japanese-sv-p-promo/232-iono-s-wattrel-psa-10-japanese-0db0d045',
    status: 'active',
  },
  {
    cert: 'PSA131053643',
    name: 'PSA 10 Gem Mint 2023 Pokemon Japanese Cll-Trading Card Game Classic Charizard & Ho-Oh Ex Deck 008 Pikachu',
    setName: 'Pokemon Japanese Cll-Trading Card Game Classic Charizard & Ho-Oh Ex Deck',
    grade: '10 Gem Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA131053643/nft_image.jpg',
    priceUsdCents: 24924,
    href: '/card/pokemon/pokemon-japanese-cll-trading-card-game-classic-charizard-ho-oh-ex-deck/008-pikachu-psa-10-japanese-79d9305f',
    status: 'active',
  },
  {
    cert: 'PSA125215675',
    name: "PSA 9 Mint 2025 Pokemon Japanese M1l-Mega Brave 086 Lillie's Determination",
    setName: 'Pokemon Japanese M1l-Mega Brave',
    grade: '9 Mint',
    imageUrl: 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com/graded-cards-renders/PSA125215675/nft_image.jpg',
    priceUsdCents: 4108,
    href: '/card/pokemon/pokemon-japanese-m1l-mega-brave/086-lillie-s-determination-psa-9-japanese-dea74bac',
    status: 'active',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/defaultPortfolioSeed.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Register test + run full suite**

In `server/package.json`, append `tests/defaultPortfolioSeed.test.js` to the `test` script's file list:

```json
"test": "node --test tests/moneySanitize.test.js tests/app.smoke.test.js tests/portfolioSeries.test.js tests/inventoryItem.test.js tests/defaultPortfolioSeed.test.js",
```

Run: `cd server && npm test`
Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add server/services/defaultPortfolioSeed.js server/tests/defaultPortfolioSeed.test.js server/package.json
git commit -m "feat(server): add default portfolio seed data (18 real cards)"
```

---

### Task 3: Seed engine (synthetic wallet + idempotent seeding)

The engine that derives the per-account wallet and writes the seed once. `ensureDefaultPortfolio` takes an injectable `db` (defaulting to `adminDb`) so it is unit-testable against an in-memory fake.

**Files:**
- Create: `server/services/defaultPortfolio.js`
- Test: `server/tests/defaultPortfolio.test.js`
- Modify: `server/package.json` (register the new test file)

**Interfaces:**
- Consumes: `DEFAULT_PORTFOLIO_ITEMS` (Task 2); `COLLECTION`, `sanitizeItem` (Task 1); `adminDb` from `services/firebaseAdmin.js`.
- Produces:
  - `syntheticWallet(uid: string): string` — deterministic `0x` + 40 hex, lowercased.
  - `ensureDefaultPortfolio(uid: string, db?: Firestore): Promise<{ wallet: string | null, seeded: boolean }>` — seeds once; no-op when already marked or when `db`/`uid` missing.

- [ ] **Step 1: Write the failing test**

Create `server/tests/defaultPortfolio.test.js`. The fake db implements only the Firestore surface the engine uses (`collection().doc().collection().doc()`, `doc().get()`, `batch().set()/commit()`):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syntheticWallet, ensureDefaultPortfolio } from '../services/defaultPortfolio.js';
import { DEFAULT_PORTFOLIO_ITEMS } from '../services/defaultPortfolioSeed.js';

// Minimal in-memory Firestore double. Docs are keyed by full path string.
function makeFakeDb() {
  const store = new Map(); // path -> data object
  const makeDocRef = (path) => ({
    path,
    async get() {
      return { exists: store.has(path), data: () => store.get(path) };
    },
    collection(name) {
      return makeCollectionRef(`${path}/${name}`);
    },
  });
  const makeCollectionRef = (path) => ({
    doc(id) {
      return makeDocRef(`${path}/${id}`);
    },
  });
  return {
    _store: store,
    collection(name) {
      return makeCollectionRef(name);
    },
    batch() {
      const ops = [];
      return {
        set(ref, data) {
          ops.push([ref.path, data]);
          return this;
        },
        async commit() {
          for (const [path, data] of ops) {
            store.set(path, { ...(store.get(path) || {}), ...data });
          }
        },
      };
    },
  };
}

describe('syntheticWallet', () => {
  it('is a valid lowercased 0x address', () => {
    const w = syntheticWallet('user-abc');
    assert.match(w, /^0x[0-9a-f]{40}$/);
  });

  it('is deterministic for the same uid', () => {
    assert.equal(syntheticWallet('user-abc'), syntheticWallet('user-abc'));
  });

  it('differs for different uids', () => {
    assert.notEqual(syntheticWallet('user-abc'), syntheticWallet('user-xyz'));
  });
});

describe('ensureDefaultPortfolio', () => {
  it('seeds all cards + marker on a fresh account', async () => {
    const db = makeFakeDb();
    const res = await ensureDefaultPortfolio('uid1', db);
    assert.equal(res.seeded, true);
    assert.match(res.wallet, /^0x[0-9a-f]{40}$/);

    // parent doc marker
    const parent = db._store.get('hackathonMerchantInventory/uid1');
    assert.ok(parent?.seededDefaultAt);
    assert.equal(parent.defaultWallet, res.wallet);

    // one item doc per seed card, wallet bound
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      const row = db._store.get(`hackathonMerchantInventory/uid1/items/${item.cert}`);
      assert.ok(row, `missing ${item.cert}`);
      assert.equal(row.wallet, res.wallet);
      assert.equal(row.cert, item.cert);
      assert.ok(row.createdAt);
    }
  });

  it('is idempotent — second call does not re-seed', async () => {
    const db = makeFakeDb();
    const first = await ensureDefaultPortfolio('uid1', db);
    const second = await ensureDefaultPortfolio('uid1', db);
    assert.equal(second.seeded, false);
    assert.equal(second.wallet, first.wallet);
  });

  it('does not re-seed after all items are deleted (marker persists)', async () => {
    const db = makeFakeDb();
    const first = await ensureDefaultPortfolio('uid1', db);
    // Simulate the merchant deleting every seeded card.
    for (const item of DEFAULT_PORTFOLIO_ITEMS) {
      db._store.delete(`hackathonMerchantInventory/uid1/items/${item.cert}`);
    }
    const again = await ensureDefaultPortfolio('uid1', db);
    assert.equal(again.seeded, false);
    // No item docs were re-created.
    const anyItem = db._store.get(
      `hackathonMerchantInventory/uid1/items/${DEFAULT_PORTFOLIO_ITEMS[0].cert}`,
    );
    assert.equal(anyItem, undefined);
    assert.equal(again.wallet, first.wallet);
  });

  it('no-ops without a db', async () => {
    const res = await ensureDefaultPortfolio('uid1', null);
    assert.deepEqual(res, { wallet: null, seeded: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/defaultPortfolio.test.js`
Expected: FAIL — `Cannot find module '../services/defaultPortfolio.js'`.

- [ ] **Step 3: Create the seed engine**

Create `server/services/defaultPortfolio.js`:

```javascript
/**
 * defaultPortfolio.js — per-account demo portfolio seeding.
 *
 * On an account's first /meta call, writes DEFAULT_PORTFOLIO_ITEMS into
 * hackathonMerchantInventory/{uid}/items/{cert}, bound to a deterministic
 * synthetic wallet derived from the uid. A one-time `seededDefaultAt` marker on
 * the parent doc makes this idempotent AND delete-safe: once seeded, deleting
 * cards never triggers a re-seed.
 */

import { createHash } from 'node:crypto';
import { adminDb } from './firebaseAdmin.js';
import { COLLECTION, sanitizeItem } from '../lib/inventoryItem.js';
import { DEFAULT_PORTFOLIO_ITEMS } from './defaultPortfolioSeed.js';

/**
 * Deterministic demo wallet for an account. sha256(uid) → first 40 hex chars,
 * `0x`-prefixed and lowercased so it passes isValidAddressShape.
 * @param {string} uid
 * @returns {string}
 */
export function syntheticWallet(uid) {
  const hex = createHash('sha256').update(String(uid)).digest('hex');
  return `0x${hex.slice(0, 40)}`;
}

/**
 * Seed the default portfolio once per account. No-op when already seeded, or
 * when the store / uid is unavailable (fails open like the rest of /meta).
 * @param {string} uid
 * @param {import('firebase-admin').firestore.Firestore} [db]
 * @returns {Promise<{ wallet: string | null, seeded: boolean }>}
 */
export async function ensureDefaultPortfolio(uid, db = adminDb) {
  if (!db || !uid) return { wallet: null, seeded: false };

  const wallet = syntheticWallet(uid);
  const parentRef = db.collection(COLLECTION).doc(uid);
  const parentSnap = await parentRef.get();
  const parentData = parentSnap.exists ? (parentSnap.data() || {}) : {};
  if (parentData.seededDefaultAt) {
    return { wallet: parentData.defaultWallet || wallet, seeded: false };
  }

  const now = new Date().toISOString();
  const batch = db.batch();
  const itemsCol = parentRef.collection('items');
  for (const item of DEFAULT_PORTFOLIO_ITEMS) {
    const patch = sanitizeItem({ ...item, wallet }, item.cert);
    batch.set(itemsCol.doc(item.cert), { ...patch, createdAt: patch.updatedAt }, { merge: true });
  }
  // Stamp the marker in the same batch so a failed commit leaves the account
  // unmarked (and thus retried next call) rather than half-seeded.
  batch.set(parentRef, { seededDefaultAt: now, defaultWallet: wallet }, { merge: true });
  await batch.commit();

  return { wallet, seeded: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/defaultPortfolio.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Register test + run full suite**

In `server/package.json`, append `tests/defaultPortfolio.test.js`:

```json
"test": "node --test tests/moneySanitize.test.js tests/app.smoke.test.js tests/portfolioSeries.test.js tests/inventoryItem.test.js tests/defaultPortfolioSeed.test.js tests/defaultPortfolio.test.js",
```

Run: `cd server && npm test`
Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add server/services/defaultPortfolio.js server/tests/defaultPortfolio.test.js server/package.json
git commit -m "feat(server): idempotent per-account default portfolio seeding"
```

---

### Task 4: Wire seeding into `GET /meta`

Ensure the seed runs on the first `/meta`, and when no `?wallet=` is supplied, filter by (and return) the synthetic wallet so the client can auto-bind.

**Files:**
- Modify: `server/routes/meta.js` (the `router.get('/meta', ...)` handler)
- Test: `server/tests/app.smoke.test.js` (add a route-mounted assertion)

**Interfaces:**
- Consumes: `ensureDefaultPortfolio` (Task 3), `sanitizeWallet` (Task 1).

- [ ] **Step 1: Add the seed import to `meta.js`**

At the top of `server/routes/meta.js`, add:

```javascript
import { ensureDefaultPortfolio } from '../services/defaultPortfolio.js';
```

- [ ] **Step 2: Update the `GET /meta` handler**

Replace the body of `router.get('/meta', requireAuth, async (req, res) => { ... })` down to the query with seeding + fallback wallet. The handler becomes:

```javascript
router.get('/meta', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', items: [] });
    }

    // Seed the demo portfolio on first touch (idempotent, delete-safe).
    const seed = await ensureDefaultPortfolio(req.uid).catch((err) => {
      console.warn(`[meta:get] seed skipped: ${err?.message ?? err}`);
      return { wallet: null, seeded: false };
    });

    // No explicit wallet → default to the account's synthetic demo wallet so the
    // seeded portfolio shows immediately on first sign-in.
    const walletFilter = sanitizeWallet(req.query?.wallet) || seed.wallet;
    if (!walletFilter) {
      return res.json({ items: [], uid: req.uid, wallet: null, reason: 'wallet_required' });
    }

    const snap = await adminDb
      .collection(COLLECTION)
      .doc(req.uid)
      .collection('items')
      .get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((row) => {
        const w = typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '';
        return w === walletFilter;
      });
    rememberHeldCerts(items.map((i) => i.cert || i.id));
    return res.json({ items, uid: req.uid, wallet: walletFilter });
  } catch (err) {
    console.warn(`[meta:get] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_read_failed', items: [] });
  }
});
```

- [ ] **Step 3: Add a smoke assertion that /meta is mounted and auth-gated**

`/meta` needs Firestore + auth, which aren't available in the unit test process, so assert the route is registered and rejects unauthenticated calls (proves the handler wiring didn't break app boot). Add inside the existing `describe('merchant Express app smoke', ...)` block in `server/tests/app.smoke.test.js`:

```javascript
  it('GET /api/meta without auth is rejected (route mounted)', async () => {
    if (!server) {
      server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
    }
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/meta`);
    // requireAuth rejects (401) when Firebase is configured, or the handler
    // returns 503 store_unavailable when it isn't — either proves the route is
    // mounted and the seeding wiring didn't crash app startup.
    assert.ok([401, 403, 503].includes(res.status), `unexpected status ${res.status}`);
  });
```

- [ ] **Step 4: Run the smoke suite**

Run: `cd server && node --test tests/app.smoke.test.js`
Expected: PASS, including the new assertion.

- [ ] **Step 5: Run the full suite**

Run: `cd server && npm test`
Expected: PASS — all suites.

- [ ] **Step 6: Commit**

```bash
git add server/routes/meta.js server/tests/app.smoke.test.js
git commit -m "feat(server): seed default portfolio on first /meta + default wallet"
```

---

### Task 5: Client auto-binds the default portfolio

On sign-in with no stored wallet, discover the synthetic wallet via `fetchMeta()` (no wallet) and load it, so the portfolio renders without the merchant typing a wallet.

**Files:**
- Modify: `client/src/pages/Inventory.jsx`

**Interfaces:**
- Consumes: server `GET /meta` no-wallet response `{ items, wallet }` (Task 4); existing `fetchMeta`, `loadWalletInventory`, `getToken`.

- [ ] **Step 1: Add a "default tried" guard flag**

In `client/src/pages/Inventory.jsx`, alongside the other `useState` declarations (near line 62), add:

```javascript
  const [defaultTried, setDefaultTried] = useState(false);
```

- [ ] **Step 2: Reset the guard on sign-out**

In the sign-out cleanup effect (the `useEffect` that runs `if (!user) { ... }`, around line 87), add `setDefaultTried(false);` inside the `if (!user)` block so a later sign-in re-discovers:

```javascript
  useEffect(() => {
    if (!user) {
      setItems([]);
      setBoundWallet('');
      setSelectedCert(null);
      setCsvNote(null);
      setPage(1);
      setError(null);
      setSales([]);
      setSalesSummary(null);
      setShowSales(false);
      setDefaultTried(false);
    }
  }, [user]);
```

- [ ] **Step 3: Add the discovery effect**

Add a new effect after the sign-out effect. It runs once per sign-in, only when nothing is bound and no wallet is stored, calls `fetchMeta()` with no wallet (which triggers the server seed and returns the synthetic wallet), then loads it quietly:

```javascript
  // First sign-in with no stored wallet: discover + bind the server-seeded
  // default portfolio so the grid isn't empty. Runs once per sign-in.
  useEffect(() => {
    if (!user || defaultTried || boundWallet) return;
    let stored = '';
    try {
      stored = normalizeWallet(localStorage.getItem(LAST_WALLET_KEY) || '') || '';
    } catch { /* ignore */ }
    if (stored) return; // returning user with a saved wallet — leave manual flow
    setDefaultTried(true);
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetchMeta({ authToken: token }); // no wallet → default
        const w = normalizeWallet(res?.wallet || '');
        if (w) await loadWalletInventory(w, { quiet: true });
      } catch { /* fail open — merchant can still load manually */ }
    })();
  }, [user, defaultTried, boundWallet, getToken]);
```

- [ ] **Step 4: Verify the client builds**

Run: `cd client && npm run build`
Expected: build succeeds with no errors referencing `Inventory.jsx`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Inventory.jsx
git commit -m "feat(client): auto-bind server-seeded default portfolio on first sign-in"
```

---

### Task 6: End-to-end verification

Confirm the feature works against a running app (not just unit tests), per the repo's verification norms.

**Files:** none (verification only).

- [ ] **Step 1: Start the stack**

Run the server and client dev processes (`cd server && npm run dev`, `cd client && npm run dev`), or use the project `/run` skill if available.

- [ ] **Step 2: Fresh account check**

Sign in with an account that has never loaded inventory. Confirm the Inventory page auto-populates with the 18 cards (images render, FMV prices show, the bound-wallet chip shows a `0x…` synthetic address).

- [ ] **Step 3: Card link check**

Open one card's detail / Renaiss link and confirm it navigates to the real card page (via the seeded `href`).

- [ ] **Step 4: Delete-safety check**

Delete one seeded card, reload the page. Confirm the deleted card does NOT come back (marker prevents re-seed) and the rest persist.

- [ ] **Step 5: Edit check**

Edit a seeded card (e.g. set a list price / change status), reload. Confirm the edit persists.

- [ ] **Step 6: Record the result**

Note the verification outcome in the PR / branch description (what was exercised and observed).

---

## Notes for the implementer

- The seed binds cards to a synthetic wallet that does not exist on-chain. This is intentional — the seed is for display. A real "scan wallet" against an actual address is a separate flow and still works unchanged.
- If Firebase Admin is not configured locally, `/meta` returns `503 store_unavailable` and no seeding happens; that is expected and the unit tests cover the seed engine in isolation.
- To add more demo cards later: resolve each new `renaiss.xyz/card/{tokenId}` link to its `{ cert, name, setName, grade, imageUrl, priceUsdCents, href }` (same fields as existing rows) and append to `DEFAULT_PORTFOLIO_ITEMS`. Update the count assertion in `defaultPortfolioSeed.test.js`.
