# project-renaiss — Merchant Copilot（黑客松）

> Dokipoki 把 Renaiss 市場資料變成商家決策：該推什麼、該留什麼、該出清什麼。

## 狀態（2026-07-11）

**Version A（市場端 MVP）已可跑殼**：`/wall` + `/movers` + Dashboard。  
**Version B（庫存層）已接線**：`/scan` `/card` `/related` `/meta` + Inventory 頁。  
真實資料需填 `docs/KEYS-TODO.md` 內金鑰；無 key 時 fail-open 空資料，不 500。

真相源：[`PLAN.md`](./PLAN.md)

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

API base：`/merchant/api/**`（獨立 `merchantApi` function，不併 Dokipoki `api`）。

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
| GET/PUT | `/merchant/api/meta` | 庫存 metadata（Firebase Auth） |
| POST | `/merchant/api/meta/bulk` | CSV 匯入後端 |

## 機敏資訊

資料夾內不得有任何 key/secret。只放 `.env.example`。詳 `PLAN.md` / `docs/KEYS-TODO.md`。

## CI / 部署（`bouob/renaiss-demo`）

| 觸發 | 行為 |
|------|------|
| PR / push | **build**：server `node --check` + client `npm run build`（注入 `VITE_*` secrets） |
| push `main` | **deploy**：`merchantApi` function + Hosting **preview channel** `merchant-preview`（**不蓋** live hosting） |
| workflow_dispatch + `deploy_live_hosting` | 才部署 live Hosting（若 SA 專案是 Dokipoki-dev 會動到該專案 hosting，慎用） |

Secrets 名稱見 GitHub repo settings（與 `.env.example` 對齊）。  
Preview URL 在 Actions log / Job Summary；路徑 **`/merchant/`**。
