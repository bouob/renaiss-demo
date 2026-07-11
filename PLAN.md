# project-renaiss — Renaiss Merchant Copilot（黑客松）

> 建立 2026-07-11。本檔＝實作規劃真相源。
> 策略綱要：`docs/merchant-copilot-outline.md`（逐字）。抽取細節脈絡：Dokipoki `docs/handoff/hackathon-wallet-lookup-plan.md`。

## 定位

**一句話**：Dokipoki 把 Renaiss 市場資料變成商家決策——該推什麼、該留什麼、該出清什麼。

- Renaiss＝市場基礎設施（資產、掛牌、交易、價格訊號）
- Dokipoki＝商家智慧層（把 raw 價格/交易資料轉成 merchandising 行動）

兩版遞進：

- **Version A — Merchant Copilot（MVP，市場端、免登入可用）**：只回答「現在該推哪些卡、為什麼」。市場指數脈絡 + movers 排名 + alpha/相對強度 + promote/clear 建議 + 可解釋理由。**不需要庫存、不需要登入。**
- **Version B — + 輕量庫存層（延伸）**：把同一套邏輯套在店家實際持有的卡上——你的庫存誰該 Push/Hold/Clear。Firebase 登入後以 uid 管理；錢包掃描 / 手動 cert 匯入。

> **為何市場端先做（不是把你在意的庫存降級）**：outline 的四層本身就是相依順序——L2「你的庫存上榜了」、L3 庫存 alpha，**在沒有 L1 市場/指數引擎前根本算不出來**。市場先做＝由下往上建那些訊號所依賴的底層，庫存是疊在上面。

兩個頁面：
- **Dashboard**：市場脈絡（指數、迷你圖、可選近期行情）＋ movers 推薦 ＋（登入後）庫存相關性/上榜
- **Inventory**（Version B）：庫存管理（加入、成本/定價、圖表、RS、建議售價、操作）＋ Push/Hold/Clear

## 硬限制（驅動所有設計）

**Renaiss FMV 用 graded cert 查（`getGradedFmv(cert)`），是「已鑑定卡」的價。**
→ 有 cert 才有 FMV；「加入庫存」= cert 導向：錢包掃描 / 手動輸入 cert / 拍鑑定殼序號（讀 cert，非認卡面）。
→ PokeTrace 搜尋（未鑑定卡身分）拿不到 Renaiss FMV，**不重搬**。
→ ⚠️ **raw（未鑑定）散卡完全不列入**。**已定 graded-only**；raw 定價需另接 PokeTrace（本版不做，列 backlog）。承認缺口：多數店家庫存是 raw 散卡，這是刻意的 hackathon 範圍取捨。
→ **估值範圍＝只給 Renaiss API 有資料的卡**：`getGradedFmv` 回 `found:false` → 標記「無 Renaiss 資料」，**不猜價、不 fallback 其他價源**。
→ **cert 序號＝查找/關聯機制**：手動貼 cert → 解析卡片本身（`getGradedCardBrief`）＋由 cert ±1 找相鄰鑑定卡（`renaissCertAdjacency`）。詳「關聯卡片探索」。

## 產品分層（＝相依順序）

| 層 | 內容 | 用途 |
|---|---|---|
| **L1 市場脈絡** | 指數 tile + sparkline + deltas（可選近期交易 ticker） | 今天是什麼行情 |
| **L2 庫存相關性** | movers ∩ 店家庫存；在庫值得關注的卡 | 把市場連到店家真的能賣的卡 |
| **L3 相對智慧** | alpha badge、庫存 vs 市場圖、超額/落後 | 分辨真強勢 vs 大盤帶動 |
| **L4 商家行動** | Promote / Feature / Hold / Clear | 把訊號變成店家動作 |

Version A ＝ L1 + L3（市場端）+ L4 建議；Version B 加 L2（吃庫存）。

## 關聯卡片探索（cert-based）

- **只服務 graded cert**，散卡不列入。cert → 卡片本身（`getGradedCardBrief`）＋ cert ±1 相鄰鑑定卡（`renaissCertAdjacency`：PSA/CGC/BGS ±1 → `getGradedCardBrief`）。
- **⚠️ gating 必須（同 Dokipoki adjacent-cert 的 ownership-gate 理由）**：任意 cert 查詢會耗盡共用 quota/breaker、癱瘓 `getGradedFmv`。→ 僅限**庫存內 / 已掃描的 cert**，或至少 IP-rate-limit；非持有 cert fail-open 空結果、不打上游。
- 路由 `GET /related/:cert`（gated）；lazy 展開才查；只快取真空結果（暫時性 null 不快取，守 both-success-only）。

## 合併：衝突與調整（outline ↔ PLAN）

> 方向高度一致（都是 merchant intelligence layer）。以下為對照後的實質調整，**兩項標「待裁決」可否決**。

1. **【已套用｜MVP 順序翻轉】** outline 明示「Version A first」。原 PLAN 把錢包掃描/庫存排 P1（最高風險：成本 gate、同步掃描時序），現改**市場端先行**（P1 指數、P2 movers 引擎），庫存/掃描移到 P3+。理由＝相依順序（見定位）＋風險後置。**待裁決**：若你堅持庫存先做可否決，但市場端是庫存訊號的地基。
2. **【已定｜raw vs graded＝graded-only】** outline 庫存欄位含「grade or raw state」；本版 FMV 只吃 graded cert → raw 卡無法定價。**決定 graded-only**（demo 用 10 置頂 + 錢包掃描皆 graded NFT，足夠）。承認缺口：多數店家庫存是 raw，raw 定價需 PokeTrace，列 backlog。
3. **【已調整｜MVP gate 前移】** advisor：index payload 豐富度是 MVP 成敗關鍵，非 P2 細節。拿到 key 後**先驗**（見待驗證 #1），再寫 movers 引擎：
   - `topMovers`/`constituents` 是否**每卡帶 7d/30d change**？若無 → 每卡 `getCardFmvSeries` 從 P5 移進 P2 關鍵路徑（~50 卡 fan-out，同一條要限流的路）。
   - 是否有**流動性/交易活躍**訊號？若無 → movers 退化成 delta+alpha 排名（thin-market 懲罰/信心那半做不出來，需優雅降級）。
4. **【已調整｜scoring 引擎可選】** outline movers 提到 momentum/liquidity；標為「optionally」。MVP 用簡單 7d/30d delta + alpha + 流動性門檻即可，**不強制搬** Dokipoki `server/scoring/`（要進階再搬）。
5. **【對齊】** 近期交易 ticker＝demo enhancer（非核心，排 P6）；scan-to-FMV＝intake 步驟＝我們的 cert 讀取（非 Dokipoki 已緩做的 by-image SSE pipeline）；「持倉上榜/組合 vs 市場」＝collector→merchant 換主詞，無需重寫。
6. **【additive】** 庫存輸入加 CSV 匯入、quantity 欄位（graded 唯一 cert 多為 1）。

## 鎖定決策

| 議題 | 決定 |
|---|---|
| 後端 | 全新精簡 Express（同步、無 Cloud Tasks/webhook），複製 Renaiss 純邏輯，不接 prod |
| 價源 | `getGradedFmv(cert)`＋指數 API，`hackathonCardCache` 快取（免每次打上游） |
| DB | 沿用 **Dokipoki dev Firebase 專案**（Firestore），collections 前綴 `hackathon*` 隔離；全走 server Admin SDK（免動 firestore.rules） |
| 登入 | Firebase Auth（Google）；**Version A 免登入可用**，登入只 gate Version B 庫存層；inventory key = uid |
| 庫存加入 | (A) 錢包掃描為主 + 手動 cert 補；cert 導向；不搬 PokeTrace 搜尋/Gemini 認卡 |
| 購入成本 | 鏈上優先 + 手動補（覆蓋率低則翻 manual-first，見 gate；已後置到 P5） |
| 定價/目標/停損/狀態 | 手動，存 `hackathonMerchantInventory`（key = uid） |
| 商品訊號 | 抽 `merchantCopilot`（純 client），吃 alpha 分 Push/Hold/Clear |
| raw 卡 | **graded-only（已定）**；raw 定價需 PokeTrace，本版不做，列 backlog |
| 部署 | `dokipoki-dev.web.app/merchant`；自訂域 `merchant.dokipoki.app`→導向；Vite `base:/merchant/`；前端偵測 hostname 自動導向（見部署段） |

## 架構

```
project-renaiss/
├─ client/  Vite+React（base=/merchant/；hostname=merchant.dokipoki.app→自動導向 /merchant；無 Privy；Firebase Auth 僅 gate 庫存層）
│   ├─ pages/Dashboard.jsx   L1 市場脈絡 + movers 推薦 (+ 登入後 L2)
│   ├─ pages/Inventory.jsx   L2/L4 庫存 + Push/Hold/Clear（Version B）
│   ├─ lib/merchantCopilot.js  抽自 Dokipoki（決策桶，純函式）
│   └─ lib/  localizedName / priceDisplay / cardLabels（複製）
├─ server/  thin Express（同步）
│   ├─ routes/wall.js     GET /wall（1h 快取）→ 指數 tile + sparkline + deltas + 10 置頂  [P1]
│   ├─ routes/movers.js   GET /movers → movers 排名 + alpha + promote/clear + 理由        [P2, Version A 核心]
│   ├─ routes/card.js     GET /card/:cert → 單卡 FMV + 30d（手動加入用）
│   ├─ routes/related.js  GET /related/:cert（gated）→ cert→卡片 + 相鄰 ±1 關聯卡
│   ├─ routes/scan.js     POST /scan（IP rate limit）→ 持有 + metadata + FMV + 成本        [P3]
│   └─ routes/meta.js     GET/PUT /meta（uid from auth）→ 成本/定價/目標/停損/狀態
└─ Firestore（Dokipoki dev 專案, Admin SDK, hackathon* 前綴）
     hackathonMerchantInventory/{uid}/items/{cert}   cost/listPrice/qty/target/stop/status
     hackathonCardCache/{cert}                        metadata + FMV + 30d（快取層）
     hackathonFeed/current                            指數/movers 快照（1h）
```

## 部署 / 網域

- **服務位置**：`dokipoki-dev.web.app/merchant`（掛在 Dokipoki dev Firebase Hosting 的 `/merchant` 路徑）。
- **自訂網域**：`merchant.dokipoki.app`（Jacker 已設）→ 導向 `dokipoki-dev.web.app`。
- **前端規則（MUST）**：偵測 `window.location.hostname === 'merchant.dokipoki.app'` → 自動導向 `https://dokipoki-dev.web.app/merchant`（保留後續 path / query）。
- **Vite**：`base: '/merchant/'`；React Router `basename="/merchant"`。
- **API 路徑**：`/merchant/api/**` → 獨立 `merchantApi` function（**不併進** Dokipoki 既有 `api` function，維持精簡邊界與 maxInstances 假設）。
- **⚠️ 待與 Jacker / Dokipoki repo 協調（非 renaiss-demo 單方可完成）**：`/merchant/**` 由 dokipoki-dev hosting 如何供給——(a) Dokipoki dev `firebase.json` 加 rewrite 指向本 app 的 hosting site；或 (b) 本 app build 資產放進 dokipoki-dev hosting `/merchant`。兩者都要動 dokipoki-dev 專案設定。
- Firebase Auth authorized domains 需含 `dokipoki-dev.web.app`（登入實際發生在此域，非 merchant.dokipoki.app）。

## 複製自 Dokipoki（keep-set）

| 檔 | 動作 |
|---|---|
| `services/renaissOsIndex.js` | 逐字複製（零 import、保留 quota/breaker） |
| `services/chainAdapters/bsc/renaissAdapter.js` | 抽子集：`fetchHoldings`/`fetchNFTAttributes`/rpc/CU 限流/常數 `CONTRACT`；`adminDb`→null stub；不搬 store/webhook/reconcile（P3 才需要） |
| `routes/renaiss.js` | 只抄 `BLOCKED_WALLET_ADDRESSES` + 地址 regex |
| `client/src/lib/merchantCopilot.js` | 複製（純 client 決策桶） |
| `renaissIndexService.js` | 只抄 `buildPortfolioSeries`/`hrefToSlug` 純函式（算 alpha/30d） |
| `services/renaissCertAdjacency.js` + `renaissAdjacentCertService.js` | 由 cert 找關聯/相鄰卡（±1）；**必須 gating**（限庫存/掃描 cert 或 IP-rate-limit），只快取真空結果 |
| `server/scoring/*`（momentum/liquidity） | **可選**：movers 進階排名。MVP 用簡單 7d/30d delta + alpha + 流動性門檻即可，不強制搬 |

**不搬**：PokeTrace、`cardMatcher`/`cardMatchResolver`、Gemini 認卡、`cardCache`、Cloud Tasks worker、Alchemy webhook、訂閱/tier、Privy。

## 機敏資訊政策（重要）

- **資料夾內不得有任何 key/secret**。`.gitignore` 排除 `.env*`、service-account JSON、任何憑證；repo 只放 `.env.example`（佔位符）。
- 真實值進**部署平台密鑰庫**（GitHub Actions secrets / Vercel / Cloud env）。
- `RENAISS_INDEX_API_KEY/SECRET`、`BSC_RPC_URL`(含 Alchemy key)、`GCP_SERVICE_ACCOUNT_BASE64`(Dokipoki dev) 皆 **server-only**，永不進 client bundle（client 只用 `VITE_` Firebase web config 等公開值）。
- 沿用 dev 專案：service account key 只進 .env/密鑰庫，永不 commit；Admin SDK 繞過 rules → 該 key 嚴格 server-only。

## 待驗證

1. **【MVP gate｜拿到 key 後第一件事，先於 P2】** `indices/pokemon` payload：constituents 筆數、**是否每卡帶 7d/30d change**（無 → 每卡 series 進 P2 關鍵路徑）、**是否有流動性/交易訊號**（無 → movers 降級為 delta+alpha）、topMovers 結構。
2. `getGradedFmv.href → getCardFmvSeries` slug 形狀（每卡 30d 前提）。
3. 小錢包同步掃描秒數（P3；設 timeout + 超大錢包部分結果）。
4. **P5 成本覆蓋率 gate**：demo 錢包實測「鏈上可推導 marketplace 買入價」比例；低則翻 manual-first。
5. demo 錢包/cert：確認手上有持倉好看的 Renaiss 錢包或 cert 清單。

## 分階段（Version A 市場端先行 → Version B 庫存）

**Version A — Merchant Copilot（市場端 MVP，免登入）**
- **P0** scaffold（client+server+env+`.gitignore`/`.env.example`）
- **P1** `/wall`：L1 市場脈絡（指數 tile + sparkline + deltas + 10 置頂），1h 快取 + Dashboard
- **【P2 前先跑待驗證 #1】**
- **P2** `/movers` 引擎：`getIndices` topMovers/constituents → 7d/30d delta + 流動性/信心門檻 + thin-market 懲罰 + alpha（卡報酬 − 指數）→ Top movers + promote/clear 建議 + 可解釋理由（L3+L4）
- **→ P1+P2 ＝ Version A 可 demo**（市場智慧，零庫存零登入，最低風險）

**Version B — 輕量庫存層（延伸）**
- **P3** Firebase Auth（Google）+ 庫存加入（`/scan` 錢包掃描 + 手動 cert，IP rate limit）→ `hackathonMerchantInventory`（uid）
- **P4** 庫存 × movers 交叉（L2 上榜/相關性）+ 成本/定價/損益 + Push/Hold/Clear（merchantCopilot）+ 操作 demo（Promote/下架/售出）
- **P5**（gated 待驗證 #4）每卡 30d 序列 + 鏈上成本推導 + RS 圖 + 庫存 vs 市場圖
- **P6**（可選 demo 增強）近期交易 ticker / 交易歷史 / 建議售價 / CSV 匯入 / storefront mock
