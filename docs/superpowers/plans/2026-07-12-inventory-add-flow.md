# Inventory Add-Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Inventory page's three always-visible, auto-saving add panels with an **Add Inventory** button → modal chooser → inline staged list → **Confirm** flow, drop the page-wide wallet requirement, and record per-card provenance.

**Architecture:** One server change (`GET /meta` returns all uid rows when no `?wallet=`; provenance fields added to the shared sanitizer) plus a client refactor of `Inventory.jsx` introducing staging state (`addMethod`, `staged`) and an inline Add panel. Wallet becomes invisible plumbing kept only on scanned rows.

**Tech Stack:** Node/Express (server, `node:test`), React + Vite + react-i18next (client, no unit-test harness — client tasks verify via `npm --prefix client run build` and manual driving).

## Global Constraints

- Inventory storage key is **uid + cert** at `hackathonMerchantInventory/{uid}/items/{cert}`. Wallet is a row field, never part of the key.
- **Login is required; a Renaiss wallet binding is NOT.** The `/inventory` route is already wrapped in `RequireAuth` (`client/src/App.jsx:59-71`); `requireAuth` guards every `/meta` route. Do not remove either gate. The redesign removes only the *wallet* requirement, never auth. Guest/local branches in `Inventory.jsx` fire only in the fail-open case (`!firebaseOk`, local dev) — keep them.
- `sanitizeItem` lives in **`server/lib/inventoryItem.js`** (tested) and `server/routes/meta.js:12` **already imports it** — there is no duplicate to consolidate. Add new fields to the shared module only.
- **Default-portfolio seeding must be preserved.** `GET /meta` calls `ensureDefaultPortfolio(uid)` which seeds demo cards under a synthetic `seed.wallet`. The wallet-gate removal must keep those cards visible, not delete the seeding.
- `CERT_SHAPE = /^[A-Za-z0-9._-]{3,64}$/`.
- `addedVia` allowed values: exactly `'scan' | 'cert' | 'csv'` (anything else → dropped).
- Server test command: `node --test server/tests/<file>` (run from repo root) or `npm --prefix server test`.
- Client verification command: `npm --prefix client run build` (must exit 0).
- All user-facing strings go through `t(...)`; add keys to **all three** locales: `client/src/i18n/locales/{en,ja,zh-TW}.json`.
- Signed-in writes persist; guests operate on local state only (existing pattern — preserve it).

---

### Task 1: Provenance fields in shared sanitizer

**Files:**
- Modify: `server/lib/inventoryItem.js` (add `addedVia`, `sourceWallet` to `sanitizeItem`)
- Test: `server/tests/inventoryItem.test.js`

**Note:** `meta.js` already imports the shared `sanitizeItem` (no duplicate to consolidate) and the module already has an `alphaPct30d` field — insert the two new fields alongside the existing ones.

**Interfaces:**
- Produces: `sanitizeItem(body, cert)` now emits `addedVia?: 'scan'|'cert'|'csv'` and `sourceWallet?: string` (both dropped when null/invalid, like `wallet`).

- [ ] **Step 1: Write the failing test**

Add to `server/tests/inventoryItem.test.js` inside the `describe` block:

```js
it('sanitizeItem keeps valid addedVia + sourceWallet and drops invalid', () => {
  const ok = sanitizeItem({
    addedVia: 'scan',
    sourceWallet: '0xABCDEF0123456789ABCDEF0123456789ABCDEF01',
  }, 'PSA114662766');
  assert.equal(ok.addedVia, 'scan');
  assert.equal(ok.sourceWallet, '0xabcdef0123456789abcdef0123456789abcdef01');

  const bad = sanitizeItem({ addedVia: 'wat', sourceWallet: 'nope' }, 'PSA114662766');
  assert.ok(!('addedVia' in bad));
  assert.ok(!('sourceWallet' in bad));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/tests/inventoryItem.test.js`
Expected: FAIL (`ok.addedVia` is `undefined`).

- [ ] **Step 3: Add fields to the shared sanitizer**

In `server/lib/inventoryItem.js`, add an allow-set near the top (after `COST_SOURCES`):

```js
const ADDED_VIA = new Set(['scan', 'cert', 'csv']);
```

Inside `sanitizeItem`, add to the `patch` object (e.g. after `packPaymentTxHash`):

```js
    addedVia: typeof body.addedVia === 'string' && ADDED_VIA.has(body.addedVia)
      ? body.addedVia : null,
    sourceWallet: sanitizeWallet(body.sourceWallet),
```

And extend the null-drop block before `return patch;`:

```js
  if (patch.addedVia == null) delete patch.addedVia;
  if (patch.sourceWallet == null) delete patch.sourceWallet;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/tests/inventoryItem.test.js`
Expected: PASS.

- [ ] **Step 5: Verify all server tests pass**

Run: `npm --prefix server test`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/lib/inventoryItem.js server/tests/inventoryItem.test.js
git commit -m "feat(server): inventory provenance fields (addedVia/sourceWallet)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `GET /meta` returns all uid rows when no wallet filter (keep seeding)

**Files:**
- Modify: `server/lib/inventoryItem.js` (add pure `selectInventoryItems`)
- Modify: `server/routes/meta.js` GET handler (lines ~38-73) — use the helper, drop the `wallet_required` dead-end, keep `ensureDefaultPortfolio` seeding.
- Test: `server/tests/inventoryItem.test.js`

**Login stays required** (`requireAuth` on the route). This removes only the *wallet* gate. Default-portfolio seeding (`ensureDefaultPortfolio`) must still run so demo cards keep appearing.

**Interfaces:**
- Consumes: `sanitizeWallet` (existing export).
- Produces: `selectInventoryItems(rows, walletFilter, defaultWallet)` — `rows: Array<{wallet?: string}>`, `walletFilter: string|null`, `defaultWallet: string|null`. **No `walletFilter` → return all rows** (login-only view). With a `walletFilter` → rows whose lowercased `wallet` equals `walletFilter` **or** `defaultWallet` (keeps seeded demo cards visible next to a scanned wallet).

- [ ] **Step 1: Write the failing test**

Add to `server/tests/inventoryItem.test.js` (add `selectInventoryItems` to the top import line):

```js
it('selectInventoryItems returns all rows when no wallet filter', () => {
  const rows = [{ cert: 'A', wallet: '0xaaa' }, { cert: 'B', wallet: null }];
  assert.deepEqual(selectInventoryItems(rows, null, null).map((r) => r.cert), ['A', 'B']);
});
it('selectInventoryItems filters by wallet OR default wallet when provided', () => {
  const rows = [
    { cert: 'A', wallet: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    { cert: 'B', wallet: '0x1111111111111111111111111111111111111111' },
    { cert: 'C', wallet: '0xDEF0000000000000000000000000000000000000' },
  ];
  const out = selectInventoryItems(
    rows,
    '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '0xdef0000000000000000000000000000000000000',
  );
  assert.deepEqual(out.map((r) => r.cert), ['A', 'C']); // scanned wallet + seeded default
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/tests/inventoryItem.test.js`
Expected: FAIL (`selectInventoryItems` not exported).

- [ ] **Step 3: Implement the helper**

In `server/lib/inventoryItem.js` add:

```js
/**
 * Filter mapped inventory rows by wallet.
 * No walletFilter → return all rows (login-only view).
 * With walletFilter → rows matching it OR the seeded default wallet.
 */
export function selectInventoryItems(rows, walletFilter, defaultWallet = null) {
  const list = Array.isArray(rows) ? rows : [];
  const w = walletFilter ? String(walletFilter).toLowerCase() : '';
  if (!w) return list;
  const dw = defaultWallet ? String(defaultWallet).toLowerCase() : '';
  return list.filter((row) => {
    const rw = typeof row.wallet === 'string' ? row.wallet.toLowerCase() : '';
    return rw === w || (dw && rw === dw);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test server/tests/inventoryItem.test.js`
Expected: PASS.

- [ ] **Step 5: Rewire the GET handler**

In `server/routes/meta.js`, add `selectInventoryItems` to the existing `../lib/inventoryItem.js` import. Replace the GET `/meta` handler body (keep the `ensureDefaultPortfolio` call; remove the `walletFilter = ... || seed.wallet` defaulting and the `wallet_required` short-circuit; replace the inline filter with the helper):

```js
router.get('/meta', requireAuth, async (req, res) => {
  try {
    if (!adminDb) {
      return res.status(503).json({ error: 'store_unavailable', items: [] });
    }
    const seed = await ensureDefaultPortfolio(req.uid).catch((err) => {
      console.warn(`[meta:get] seed skipped: ${err?.message ?? err}`);
      return { wallet: null, seeded: false };
    });
    // Login-only: no ?wallet= returns every card under this uid (incl. seeded
    // demo cards). A ?wallet= narrows to that wallet, but seeded default cards
    // stay visible alongside it.
    const walletFilter = sanitizeWallet(req.query?.wallet); // null when absent/invalid
    const defaultWallet = seed.wallet ? seed.wallet.toLowerCase() : null;
    const snap = await adminDb
      .collection(COLLECTION)
      .doc(req.uid)
      .collection('items')
      .get();
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const items = selectInventoryItems(rows, walletFilter, defaultWallet);
    rememberHeldCerts(items.map((i) => i.cert || i.id));
    return res.json({ items, uid: req.uid, wallet: walletFilter });
  } catch (err) {
    console.warn(`[meta:get] ${err?.message ?? err}`);
    return res.status(500).json({ error: 'meta_read_failed', items: [] });
  }
});
```

- [ ] **Step 6: Verify**

Run: `node --check server/routes/meta.js && npm --prefix server test`
Expected: parse OK; all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/lib/inventoryItem.js server/routes/meta.js server/tests/inventoryItem.test.js
git commit -m "feat(server): GET /meta returns all uid rows without wallet (login-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: i18n keys for the add flow and provenance

**Files:**
- Modify: `client/src/i18n/locales/en.json` (`inventory` object)
- Modify: `client/src/i18n/locales/ja.json` (`inventory` object)
- Modify: `client/src/i18n/locales/zh-TW.json` (`inventory` object)

**Interfaces:**
- Produces: translation keys consumed by Tasks 4-8. Exact key names below.

- [ ] **Step 1: Add keys to `en.json` under `inventory`**

Add these keys (keep existing ones):

```json
"addInventory": "Add inventory",
"addModalTitle": "Add inventory",
"addModalSubtitle": "Choose how to add cards. Nothing is saved until you confirm.",
"methodScan": "Scan a wallet",
"methodScanDesc": "Pull on-chain graded holdings from an address.",
"methodCert": "Add by cert",
"methodCsv": "Import CSV",
"methodCsvDesc": "Upload a file with a cert column.",
"methodCertDesc": "Look up one graded card by cert number.",
"addPanelTitle": "Add inventory · {{method}}",
"changeMethod": "Change method",
"staged": "Staged ({{count}})",
"stagedEmpty": "Load cards above — they appear here to review before saving.",
"stagedDupeInventory": "Already in inventory",
"stagedDupeStaged": "Already staged",
"removeStaged": "Remove",
"confirmAdd": "Confirm ({{count}} cards)",
"discard": "Discard",
"confirmSaved": "Added {{count}} cards to your inventory.",
"guestConfirmNote": "Sign in to save these to your account.",
"scanAddHint": "Enter a wallet address to pull its graded holdings.",
"certAddHint": "Enter a graded cert number.",
"csvAddHint": "Header row must include a cert column.",
"provenanceScan": "Scanned from {{wallet}} · {{date}}",
"provenanceCert": "Added manually · {{date}}",
"provenanceCsv": "CSV import · {{date}}",
"provenanceUnknown": "Added · {{date}}",
"emptyInventory": "No cards yet — use Add inventory to get started."
```

- [ ] **Step 2: Add the same keys to `ja.json`**

Add under `inventory` (Japanese):

```json
"addInventory": "在庫を追加",
"addModalTitle": "在庫を追加",
"addModalSubtitle": "カードの追加方法を選択します。確定するまで保存されません。",
"methodScan": "ウォレットをスキャン",
"methodScanDesc": "アドレスからオンチェーンの鑑定済み保有を取得します。",
"methodCert": "証明書番号で追加",
"methodCsv": "CSVインポート",
"methodCsvDesc": "cert列を含むファイルをアップロードします。",
"methodCertDesc": "証明書番号で鑑定済みカードを1枚検索します。",
"addPanelTitle": "在庫を追加 · {{method}}",
"changeMethod": "方法を変更",
"staged": "確認待ち ({{count}})",
"stagedEmpty": "上でカードを読み込むと、保存前にここで確認できます。",
"stagedDupeInventory": "既に在庫にあります",
"stagedDupeStaged": "既に追加済み",
"removeStaged": "削除",
"confirmAdd": "確定 ({{count}}枚)",
"discard": "破棄",
"confirmSaved": "{{count}}枚を在庫に追加しました。",
"guestConfirmNote": "アカウントに保存するにはサインインしてください。",
"scanAddHint": "ウォレットアドレスを入力して鑑定済み保有を取得します。",
"certAddHint": "鑑定済みの証明書番号を入力してください。",
"csvAddHint": "ヘッダー行にcert列が必要です。",
"provenanceScan": "{{wallet}} からスキャン · {{date}}",
"provenanceCert": "手動で追加 · {{date}}",
"provenanceCsv": "CSVインポート · {{date}}",
"provenanceUnknown": "追加 · {{date}}",
"emptyInventory": "カードがありません — 「在庫を追加」から始めましょう。"
```

- [ ] **Step 3: Add the same keys to `zh-TW.json`**

Add under `inventory` (Traditional Chinese):

```json
"addInventory": "新增庫存",
"addModalTitle": "新增庫存",
"addModalSubtitle": "選擇新增卡片的方式。確認前不會儲存。",
"methodScan": "掃描錢包",
"methodScanDesc": "從地址擷取鏈上鑑定持有。",
"methodCert": "以證書號新增",
"methodCsv": "匯入 CSV",
"methodCsvDesc": "上傳含 cert 欄位的檔案。",
"methodCertDesc": "以證書號查詢單張鑑定卡。",
"addPanelTitle": "新增庫存 · {{method}}",
"changeMethod": "更換方式",
"staged": "待確認 ({{count}})",
"stagedEmpty": "在上方載入卡片，會顯示於此供儲存前確認。",
"stagedDupeInventory": "已在庫存中",
"stagedDupeStaged": "已加入待確認",
"removeStaged": "移除",
"confirmAdd": "確認 ({{count}} 張)",
"discard": "捨棄",
"confirmSaved": "已將 {{count}} 張加入庫存。",
"guestConfirmNote": "登入以儲存到您的帳戶。",
"scanAddHint": "輸入錢包地址以擷取其鑑定持有。",
"certAddHint": "輸入鑑定證書號。",
"csvAddHint": "標題列必須包含 cert 欄位。",
"provenanceScan": "掃描自 {{wallet}} · {{date}}",
"provenanceCert": "手動新增 · {{date}}",
"provenanceCsv": "CSV 匯入 · {{date}}",
"provenanceUnknown": "已新增 · {{date}}",
"emptyInventory": "尚無卡片 — 使用「新增庫存」開始。"
```

- [ ] **Step 4: Verify JSON is valid and client builds**

Run: `node -e "['en','ja','zh-TW'].forEach(l=>require('./client/src/i18n/locales/'+l+'.json'))" && npm --prefix client run build`
Expected: no JSON error; build exits 0.

- [ ] **Step 5: Commit**

```bash
git add client/src/i18n/locales/en.json client/src/i18n/locales/ja.json client/src/i18n/locales/zh-TW.json
git commit -m "i18n: inventory add-flow + provenance keys (en/ja/zh-TW)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Wallet-agnostic inventory load + remove page-wide wallet gate

**Files:**
- Modify: `client/src/pages/Inventory.jsx`

**Interfaces:**
- Consumes: `fetchMeta({ authToken })` (no wallet arg → all rows, Task 2); `fetchSales({ authToken })`.
- Produces: `loadInventory()` — loads all uid rows + sales, sets `items`/`sales`/`salesSummary`. Replaces `loadWalletInventory`. `boundWallet` state is removed.

- [ ] **Step 1: Add `loadInventory` and auto-load on sign-in**

In `Inventory.jsx`, add a wallet-agnostic loader (near `loadMovers`):

```js
const loadInventory = useCallback(async () => {
  if (!user) { setItems([]); setSales([]); setSalesSummary(null); return; }
  setLoading(true);
  setError(null);
  try {
    const token = await getToken();
    if (!token) { setItems([]); return; }
    const [metaRes, salesRes] = await Promise.all([
      fetchMeta({ authToken: token }),
      fetchSales({ authToken: token }).catch(() => ({ sales: [], summary: null })),
    ]);
    setItems(Array.isArray(metaRes?.items) ? metaRes.items : []);
    setSales(Array.isArray(salesRes?.sales) ? salesRes.sales : []);
    setSalesSummary(salesRes?.summary ?? null);
  } catch (err) {
    setError(err?.message ?? t('inventory.loadFailed'));
    setItems([]); setSales([]); setSalesSummary(null);
  } finally {
    setLoading(false);
  }
}, [user, getToken, t]);

useEffect(() => { loadInventory(); }, [loadInventory]);
```

- [ ] **Step 2: Remove `boundWallet`, wallet input state, and the old loaders**

Delete state/functions no longer used: `boundWallet`, `wallet`, `manualCert` (moves into Add panel in Task 6 — keep for now if referenced, else remove), `LAST_WALLET_KEY`, `rememberWallet`, `loadWalletInventory`, `handleLoadSaved`, `normalizeWallet` (keep if Task 6 needs it — it does; retain it). Remove the sign-out effect's `setBoundWallet('')`. Replace `boundWallet`-based guards in `updateStatus`/`saveDetails`/`persistItem` calls with `user` checks only (persist whenever `user` is truthy).

- [ ] **Step 3: Update grid empty-state to be wallet-free**

Replace the inventory-zone head/empty conditionals that reference `boundWallet`:

```jsx
<p className="small">
  {loading ? t('common.loading') : t('inventory.ofCards', { filtered: filtered.length, total: enriched.length })}
  {filter !== 'all' ? ` · ${t('inventory.filter')}: ${filter}` : ''}
</p>
```

and the empty block:

```jsx
{enriched.length === 0 ? (
  <div className="empty">{t('inventory.emptyInventory')}</div>
) : filtered.length === 0 ? (
  <div className="empty">{t('inventory.filterEmpty')}</div>
) : ( /* grid + pagination unchanged */ )}
```

Also simplify the hero sub-line: drop the `boundWallet` block, keep `subtitle`/`subtitleGuest`.

- [ ] **Step 4: Remove the three inline add sections**

Delete the `<section className="panel-grid">` (wallet scan + manual cert forms) and the standalone CSV `<section>`. Keep `handleScan`, `handleManualCert`, `handleCsvFile` logic **for now** — Task 6 refactors them into the Add panel. If leaving them causes unused-var lint noise, comment `// reused by Add panel (Task 6)` above them.

- [ ] **Step 5: Verify client builds and app renders inventory without a wallet**

Run: `npm --prefix client run build`
Expected: exits 0.
Manual: start dev (`npm run dev:server` + `npm run dev:client`), sign in, confirm "Your Inventory" loads saved cards with no wallet entry, and no scan/cert/CSV panels remain.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Inventory.jsx
git commit -m "feat(client): wallet-agnostic inventory load, drop wallet gate

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Add Inventory button + method chooser modal

**Files:**
- Modify: `client/src/pages/Inventory.jsx`

**Interfaces:**
- Produces: `showAddModal` (bool), `addMethod` (`null|'scan'|'cert'|'csv'`). Modal picks a method → sets `addMethod`, closes modal. Add panel (Task 6) renders when `addMethod` is set.

- [ ] **Step 1: Add chooser state and the button**

Add state:

```js
const [showAddModal, setShowAddModal] = useState(false);
const [addMethod, setAddMethod] = useState(null);
```

In the inventory-zone head, next to the filter pills, add:

```jsx
<button type="button" className="btn btn-primary" onClick={() => setShowAddModal(true)}>
  {t('inventory.addInventory')}
</button>
```

- [ ] **Step 2: Render the chooser modal**

Add near the other modals at the bottom of the returned JSX:

```jsx
{showAddModal && (
  <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
      <p className="label">{t('inventory.addModalTitle')}</p>
      <p className="small">{t('inventory.addModalSubtitle')}</p>
      <div className="method-grid">
        {[
          { id: 'scan', title: t('inventory.methodScan'), desc: t('inventory.methodScanDesc') },
          { id: 'cert', title: t('inventory.methodCert'), desc: t('inventory.methodCertDesc') },
          { id: 'csv', title: t('inventory.methodCsv'), desc: t('inventory.methodCsvDesc') },
        ].map((m) => (
          <button
            key={m.id}
            type="button"
            className="method-card"
            onClick={() => { setAddMethod(m.id); setShowAddModal(false); }}
          >
            <strong>{m.title}</strong>
            <span className="small">{m.desc}</span>
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddModal(false)}>
          {t('common.cancel', { defaultValue: 'Cancel' })}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Add minimal styles**

Confirm `.modal-backdrop`/`.modal-card` exist in `client/src/styles.css` (SoldHistoryModal/HoldingDetailModal use them). If `.method-grid`/`.method-card`/`.modal-actions` are absent, add:

```css
.method-grid { display: grid; grid-template-columns: 1fr; gap: 0.6rem; margin: 0.8rem 0; }
.method-card { display: flex; flex-direction: column; gap: 0.2rem; text-align: left; padding: 0.8rem 1rem; border: 1px solid var(--border, rgba(255,255,255,0.12)); border-radius: 12px; background: transparent; cursor: pointer; }
.method-card:hover { border-color: var(--accent, #6c8cff); }
.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.6rem; }
```

- [ ] **Step 4: Verify build and modal behaviour**

Run: `npm --prefix client run build`
Expected: exits 0.
Manual: click **Add inventory** → modal shows 3 cards → picking one closes the modal and sets `addMethod` (Add panel is empty until Task 6).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Inventory.jsx client/src/styles.css
git commit -m "feat(client): add-inventory button + method chooser modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Inline Add panel — method inputs load into a staged list

**Files:**
- Modify: `client/src/pages/Inventory.jsx`

**Interfaces:**
- Consumes: `scanWallet`, `fetchCard`, `parseInventoryCsv`, `normalizeWallet`; provenance keys (Task 3).
- Produces: `staged` (array of item objects with `addedVia`/`sourceWallet`), `stageOne(item)`/`stageMany(list)` (dedupe by cert), `removeStaged(cert)`. Scan-sourced sales captured in `stagedSales`.

- [ ] **Step 1: Add staging state and helpers**

```js
const [staged, setStaged] = useState([]);
const [stagedSales, setStagedSales] = useState([]);
const [stageBusy, setStageBusy] = useState(false);
const [stageError, setStageError] = useState(null);
const [scanAddr, setScanAddr] = useState('');
const [certInput, setCertInput] = useState('');

const savedCerts = useMemo(() => new Set(items.map((i) => String(i.cert || i.id))), [items]);

function stageMany(list) {
  setStaged((prev) => {
    const byCert = new Map(prev.map((r) => [String(r.cert), r]));
    for (const row of list) {
      if (!row?.cert) continue;
      byCert.set(String(row.cert), { ...byCert.get(String(row.cert)), ...row });
    }
    return [...byCert.values()];
  });
}
function removeStaged(cert) {
  setStaged((prev) => prev.filter((r) => String(r.cert) !== String(cert)));
}
function closeAddPanel() {
  setAddMethod(null); setStaged([]); setStagedSales([]);
  setStageError(null); setScanAddr(''); setCertInput('');
}
```

- [ ] **Step 2: Add method loaders that stage instead of persist**

Adapt the existing scan/cert/csv logic to push into `staged` (no `bulkMeta`/`persistItem`). Stamp provenance and `createdAt`:

```js
async function loadScan() {
  const addr = normalizeWallet(scanAddr);
  if (!addr) { setStageError(t('inventory.walletInvalid')); return; }
  setStageBusy(true); setStageError(null);
  try {
    const res = await scanWallet(addr);
    const now = new Date().toISOString();
    const mapped = (res?.holdings ?? []).map((h) => ({
      cert: h.serial || h.tokenId,
      name: h.name ?? null, setName: h.setName ?? null, grade: h.grade ?? null,
      imageUrl: h.imageUrl ?? null,
      priceUsdCents: h.renaissFmv?.priceUsdCents ?? null,
      href: h.renaissFmv?.href ?? null,
      onChainCostUsd: Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null,
      cost: Number.isFinite(h.onChainCostUsd) ? h.onChainCostUsd : null,
      acquireType: h.acquireType ?? null, costSource: h.costSource ?? null,
      status: 'active', qty: 1,
      wallet: addr, addedVia: 'scan', sourceWallet: addr, createdAt: now,
    })).filter((r) => r.cert);
    stageMany(mapped);
    setStagedSales((prev) => [...prev, ...(Array.isArray(res?.sales) ? res.sales.map((s) => ({ ...s, wallet: addr })) : [])]);
  } catch (err) { setStageError(err?.message ?? t('inventory.scanFailed')); }
  finally { setStageBusy(false); }
}

async function loadCert() {
  const cert = certInput.trim();
  if (!cert) return;
  setStageBusy(true); setStageError(null);
  try {
    const res = await fetchCard(cert, { series: true });
    if (!res?.found) { setStageError(t('inventory.certNotFound')); return; }
    stageMany([{
      cert: res.cert, name: res.brief?.name ?? null, setName: res.brief?.setName ?? null,
      grade: res.brief?.gradeLabel ?? res.fmv?.gradeLabel ?? null,
      imageUrl: res.brief?.imageUrl ?? res.brief?.imageUrlThumb ?? null,
      priceUsdCents: res.fmv?.priceUsdCents ?? res.brief?.priceUsdCents ?? null,
      href: res.fmv?.href ?? res.brief?.href ?? null,
      series30d: res.series30d ?? [], returnPct30d: res.returnPct30d ?? null,
      status: 'active', qty: 1, cost: null, costSource: 'manual',
      addedVia: 'cert', createdAt: new Date().toISOString(),
    }]);
    setCertInput('');
  } catch (err) { setStageError(err?.message ?? t('inventory.certFailed')); }
  finally { setStageBusy(false); }
}

function loadCsv(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const { accepted, rejected } = parseInventoryCsv(String(reader.result ?? ''));
    setStageError(rejected.length ? t('inventory.csvResult', { accepted: accepted.length, rejected: rejected.length }) : null);
    const now = new Date().toISOString();
    stageMany(accepted.map((row) => ({ ...row, addedVia: 'csv', createdAt: now })));
  };
  reader.readAsText(file);
}
```

Delete the now-superseded `handleScan`, `handleManualCert`, `handleCsvFile` (and their `busy`/`csvNote` usages if orphaned).

- [ ] **Step 3: Render the Add panel with input + staged list**

Insert above the inventory zone (rendered only when `addMethod` is set):

```jsx
{addMethod && (
  <section className="glass-card add-panel">
    <div className="add-panel-head">
      <p className="label">{t('inventory.addPanelTitle', { method: t(`inventory.method${addMethod[0].toUpperCase()}${addMethod.slice(1)}`) })}</p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowAddModal(true)}>{t('inventory.changeMethod')}</button>
    </div>

    {addMethod === 'scan' && (
      <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
        <input className="input" placeholder={t('inventory.walletPlaceholder')} value={scanAddr} onChange={(e) => setScanAddr(e.target.value)} />
        <button className="btn btn-primary" type="button" disabled={stageBusy || !scanAddr.trim()} onClick={loadScan}>
          {stageBusy ? t('inventory.scanning') : t('inventory.scan')}
        </button>
      </div>
    )}
    {addMethod === 'cert' && (
      <div className="form-row" style={{ gridTemplateColumns: '1fr auto' }}>
        <input className="input" placeholder={t('inventory.certPlaceholder')} value={certInput} onChange={(e) => setCertInput(e.target.value)} />
        <button className="btn btn-primary" type="button" disabled={stageBusy || !certInput.trim()} onClick={loadCert}>
          {stageBusy ? t('inventory.lookingUp') : t('inventory.add')}
        </button>
      </div>
    )}
    {addMethod === 'csv' && (
      <input type="file" accept=".csv,text/csv" onChange={(e) => loadCsv(e.target.files?.[0])} />
    )}
    <p className="small">{t(`inventory.${addMethod}AddHint`)}</p>
    {stageError && <p className="small" style={{ color: 'var(--clear)' }}>{stageError}</p>}

    <p className="label" style={{ marginTop: '0.8rem' }}>{t('inventory.staged', { count: staged.length })}</p>
    {staged.length === 0 ? (
      <div className="empty">{t('inventory.stagedEmpty')}</div>
    ) : (
      <ul className="staged-list">
        {staged.map((r) => {
          const dupe = savedCerts.has(String(r.cert));
          return (
            <li key={r.cert} className="staged-row">
              {r.imageUrl ? <img src={r.imageUrl} alt="" loading="lazy" /> : <div className="thumb-fallback" />}
              <div className="staged-row-body">
                <strong>{r.name || r.cert}</strong>
                <span className="small">{[r.grade, r.setName].filter(Boolean).join(' · ') || r.cert}</span>
                <span className="small">{formatUsd(Number.isFinite(r.priceUsdCents) ? r.priceUsdCents / 100 : null)}</span>
                {dupe && <span className="chip">{t('inventory.stagedDupeInventory')}</span>}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeStaged(r.cert)}>{t('inventory.removeStaged')}</button>
            </li>
          );
        })}
      </ul>
    )}

    {/* Confirm/Discard footer added in Task 7 */}
  </section>
)}
```

- [ ] **Step 4: Add staged-list styles**

In `client/src/styles.css`:

```css
.add-panel-head { display: flex; align-items: center; justify-content: space-between; }
.staged-list { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.staged-row { display: grid; grid-template-columns: 40px 1fr auto; gap: 0.6rem; align-items: center; padding: 0.4rem; border: 1px solid var(--border, rgba(255,255,255,0.1)); border-radius: 10px; }
.staged-row img, .staged-row .thumb-fallback { width: 40px; height: 56px; object-fit: cover; border-radius: 6px; }
.staged-row-body { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; }
```

- [ ] **Step 5: Verify build + manual staging**

Run: `npm --prefix client run build`
Expected: exits 0.
Manual: pick each method, load cards, confirm they appear in the staged list, duplicates show the chip, remove works, "Change method" reopens the chooser without losing staged rows.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/Inventory.jsx client/src/styles.css
git commit -m "feat(client): inline add panel stages cards from scan/cert/csv

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Confirm / Discard — persist staged rows + refresh

**Files:**
- Modify: `client/src/pages/Inventory.jsx`

**Interfaces:**
- Consumes: `staged`, `stagedSales`, `persistBulk`, `bulkSales`, `loadInventory` (Task 4), `withAuth`.
- Produces: `confirmStaged()` — signed-in: `bulkMeta` staged rows (with provenance) + `bulkSales` any `stagedSales`, then `loadInventory()`; guest: merge into local `items`. Then `closeAddPanel()`.

- [ ] **Step 1: Implement confirm**

```js
async function confirmStaged() {
  if (staged.length === 0) return;
  setStageBusy(true); setStageError(null);
  try {
    if (user) {
      await withAuth(async (token) => {
        await persistBulk(staged, token, null); // wallet already on scan rows; cert/csv have none
        if (stagedSales.length) {
          const byWallet = stagedSales.reduce((m, s) => {
            const w = s.wallet || '';
            (m[w] ||= []).push(s); return m;
          }, {});
          for (const [w, rows] of Object.entries(byWallet)) {
            if (w) await bulkSales(rows, w, { authToken: token });
          }
        }
      });
      await loadInventory();
    } else {
      setItems((prev) => {
        const byCert = new Map(prev.map((p) => [String(p.cert || p.id), p]));
        for (const r of staged) byCert.set(String(r.cert), { ...byCert.get(String(r.cert)), ...r });
        return [...byCert.values()];
      });
    }
    setCsvNote(t('inventory.confirmSaved', { count: staged.length }) + (user ? '' : ` ${t('inventory.guestConfirmNote')}`));
    closeAddPanel();
  } catch (err) {
    setStageError(err?.message ?? t('inventory.csvFailed'));
  } finally {
    setStageBusy(false);
  }
}
```

Note: `persistBulk` currently forces `wallet: walletAddr` on every row. Update its signature so a `null` argument leaves each row's own `wallet` intact:

```js
async function persistBulk(list, token, walletAddr) {
  const rows = list.filter((h) => h?.cert).map((h) => ({
    ...h,
    wallet: walletAddr ?? h.wallet ?? null,
    status: h.status || 'active',
    qty: h.qty ?? 1,
  }));
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 100) {
    await bulkMeta(rows.slice(i, i + 100), { authToken: token });
  }
}
```

- [ ] **Step 2: Add the Confirm/Discard footer**

Replace the `{/* Confirm/Discard footer added in Task 7 */}` comment inside the Add panel with:

```jsx
<div className="modal-actions" style={{ marginTop: '0.8rem' }}>
  <button type="button" className="btn btn-ghost btn-sm" onClick={closeAddPanel}>{t('inventory.discard')}</button>
  <button type="button" className="btn btn-primary" disabled={stageBusy || staged.length === 0} onClick={confirmStaged}>
    {t('inventory.confirmAdd', { count: staged.length })}
  </button>
</div>
```

- [ ] **Step 3: Verify build + full round trip**

Run: `npm --prefix client run build`
Expected: exits 0.
Manual (signed in): stage cards via cert + CSV, Confirm → panel closes, "Your Inventory" shows the new cards, reload page → still present (persisted). Discard on a fresh batch → nothing saved. Guest: Confirm merges locally, note shown.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Inventory.jsx
git commit -m "feat(client): confirm staged inventory persists with provenance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Show provenance on cards + in detail modal

**Files:**
- Modify: `client/src/pages/Inventory.jsx` (helper + tile line)
- Modify: `client/src/components/HoldingDetailModal.jsx` (detail line)

**Interfaces:**
- Consumes: item fields `addedVia`, `sourceWallet`, `createdAt`; provenance keys (Task 3).
- Produces: `provenanceLabel(item, t)` — returns a localized source string.

- [ ] **Step 1: Add a shared provenance formatter**

Add near the top of `Inventory.jsx` (exported for reuse by the modal):

```js
export function provenanceLabel(item, t) {
  const date = item?.createdAt ? new Date(item.createdAt).toLocaleDateString() : '';
  const w = item?.sourceWallet ? `${item.sourceWallet.slice(0, 6)}…${item.sourceWallet.slice(-4)}` : '';
  switch (item?.addedVia) {
    case 'scan': return t('inventory.provenanceScan', { wallet: w, date });
    case 'cert': return t('inventory.provenanceCert', { date });
    case 'csv': return t('inventory.provenanceCsv', { date });
    default: return item?.createdAt ? t('inventory.provenanceUnknown', { date }) : '';
  }
}
```

- [ ] **Step 2: Show it in staged rows and (optionally) tiles**

In the staged-row body (Task 6), add under the price line:

```jsx
<span className="small muted">{provenanceLabel(r, t)}</span>
```

- [ ] **Step 3: Show it in the detail modal**

In `HoldingDetailModal.jsx`, import the helper:

```js
import { provenanceLabel } from '../pages/Inventory.jsx';
```

and render near the card header/title area:

```jsx
{provenanceLabel(item, t) && <p className="small muted">{provenanceLabel(item, t)}</p>}
```

- [ ] **Step 4: Verify build + display**

Run: `npm --prefix client run build`
Expected: exits 0.
Manual: staged rows and the detail modal show the correct source line per method; existing rows without `addedVia` show the fallback or nothing.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Inventory.jsx client/src/components/HoldingDetailModal.jsx
git commit -m "feat(client): show inventory provenance in staged list + detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Cleanup pass + final verification

**Files:**
- Modify: `client/src/pages/Inventory.jsx` (remove dead code/keys)
- Modify: `client/src/i18n/locales/{en,ja,zh-TW}.json` (optional: prune orphaned keys)

**Interfaces:** none new.

- [ ] **Step 1: Remove orphaned state and imports**

Grep for and delete anything now unused: `busy`, `csvNote` (if replaced), `showSales` stays, `handleLoadSaved`, `loadWalletInventory`, `LAST_WALLET_KEY`, `rememberWallet`, `onBoard` (keep — still used), unused imports (`putMeta` if unreferenced, etc.). Run: `grep -n "boundWallet\|loadWalletInventory\|handleScan\b\|handleManualCert\|handleCsvFile" client/src/pages/Inventory.jsx` — expect no matches.

- [ ] **Step 2: Full build + server tests**

Run: `npm --prefix client run build && npm --prefix server test`
Expected: client build exits 0; all server tests PASS.

- [ ] **Step 3: End-to-end manual smoke**

Sign in → inventory auto-loads (no wallet). Add inventory → chooser → scan an address → staged list with sales captured → Confirm → cards + realized P&L present after reload. Repeat for cert and CSV. Guest mode: staging + local confirm work, no persistence. Provenance visible everywhere.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(client): remove dead wallet-gate code from inventory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage:** page structure (Task 4/5), modal chooser (Task 5), inline method + staged list (Task 6), Confirm/Discard persist (Task 7), provenance fields + display (Task 1/8), server `GET /meta` change (Task 2), duplicate flagging (Task 6), scan sales on confirm (Task 7), guest local + empty-staging disable (Task 7), load-failure preserves staging (Task 6). All covered.
- **Client tests:** repo has no client unit-test harness (no vitest/jest); client tasks verify via `npm --prefix client run build` + manual driving, per repo convention. Server logic that can be pure (`sanitizeItem`, `selectInventoryItems`) is unit-tested.
- **Type consistency:** `stageMany`/`removeStaged`/`closeAddPanel`/`confirmStaged`/`provenanceLabel`/`loadInventory` names used consistently across tasks; `persistBulk(list, token, null)` signature updated in Task 7 to honor per-row wallet.
