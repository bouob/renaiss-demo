# project-renaiss — Merchant Copilot

> Dokipoki 把 Renaiss 市場資料變成商家決策：該推什麼、該留什麼、該出清什麼。  
> Live path（dev）：https://dokipoki-dev.web.app/merchant/  
> 根站方案 B：https://merchant.dokipoki.app/（multi-site，見 domain checklist）

## 狀態（2026-07-12）

**Version A（市場端 MVP）已接上 Dashboard 頁**：前端頁面入口是 `/`，由 client 呼叫 `/wall`、`/movers`、`/ticker` API。  
**Version B（庫存層）已接線**：前端頁面入口是 `/inventory`，對應 `/scan` `/card` `/related` `/meta` API。  
真實資料需填 `docs/KEYS-TODO.md` 內金鑰；市場資料相關路由在缺 key 時多為 fail-open 空資料，但 `/meta` 在缺少 Firebase Admin 設定時會回 `503 store_unavailable`。

真相源：[`PLAN.md`](./PLAN.md)

---

## Product overview (EN)

Merchant Copilot is a merchant-facing card shop intelligence layer on Renaiss market data — not a marketplace.

Two-page workflow:

- **Dashboard** — market index, sparkline / 7d·30d deltas, top constituents, ticker pulse, **Movers** with promote / hold / clear + auto-rotate gallery
- **Inventory** — wallet scan (pack-cost prefill), manual cert / CSV, wallet-scoped persistence (`hackathonMerchantInventory/{uid}`), cost / PnL / 30d detail

Signals convert alpha vs the Renaiss OS Index into **Promote / Hold / Clear**. Price attribution and card deep-links open Renaiss OS Index (same family as Dokipoki Renaiss holdings).

---

## 啟動

```bash
# server
cd server
npm install
# 複製 ../.env.example → ../.env 後填 key（可選）
npm run dev          # http://localhost:3101  /merchant/api/health

# client
cd client
npm install
npm run dev          # http://localhost:5174/merchant/
```

API base：

- path 掛載：`/merchant/api/**`
- 根站 multi-site：`/api/**` 與 `/merchant/api/**`（同一 `merchantApi` function）

前端頁面：

- `/` → Dashboard
- `/inventory` → Inventory

## 路由

| Method | Path | 說明 |
|--------|------|------|
| GET | `/merchant/api/health` | liveness |
| GET | `/merchant/api/wall` | L1 指數 + sparkline + top10（1h cache） |
| GET | `/merchant/api/movers` | movers + alpha + promote/hold/clear |
| GET | `/merchant/api/ticker` | 近期銷售 pulse（P6） |
| GET | `/merchant/api/card/:cert` | 單卡 FMV/brief（`?series=1` 含 30d） |
| GET | `/merchant/api/related/:cert` | ±1 鄰卡（ownership/scan gate） |
| POST | `/merchant/api/scan` | 錢包掃描（IP rate limit） |
| GET/PUT | `/merchant/api/meta` | 庫存 metadata（Firebase Auth，`?wallet=`） |
| POST | `/merchant/api/meta/bulk` | CSV 匯入後端 |

## 建置模式

```bash
npm run build:path   # base=/merchant/ → dokipoki-dev path 掛載
npm run build:root   # base=/         → merchant-dokipoki-dev 根站
```

根站 deploy 指令：`scripts/deploy-merchant-site.md`  
Console checklist：`docs/merchant-domain-b-checklist-zh.md`

## 機敏資訊

資料夾內不得有任何 key/secret。只放 `.env.example`。詳 `PLAN.md` / `docs/KEYS-TODO.md`。

## CI / 部署（`bouob/renaiss-demo`）

| 觸發 | 行為 |
|------|------|
| PR / push | **build**：server `node --check` + client `npm run build`（注入 `VITE_*` secrets） |
| push `main` | **deploy**：`merchantApi` + Hosting **preview channel** `merchant-preview`（**不蓋** live default hosting） |
| workflow_dispatch + `deploy_live_hosting` | 才部署 live Hosting（慎用） |
| Dokipoki `Deploy to Dev` | clone 本 repo → `base=/merchant/` → `dokipoki-dev.web.app/merchant/` |

Secrets 見 GitHub repo settings（與 `.env.example` 對齊）。
