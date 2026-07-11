# KEYS-TODO — 待填真實金鑰清單

> 本檔追蹤 `.env.example` 每個佔位符，供 sprint 結束後手動填回真實值。
> **真實值只進部署平台密鑰庫**（GitHub Actions secrets / Cloud Function env），
> 永不 commit 進本 repo。填完後從本檔勾除或標記 `[已配置於 <位置>]`，不要把
> 真實值貼進本檔。

| 變數 | 佔位符（`.env.example`） | 要填什麼 | 用途 / 影響 |
|---|---|---|---|
| `RENAISS_INDEX_API_KEY` | `REPLACE_ME_RENAISS_INDEX_API_KEY` | Renaiss OS Index partner API key | `getGradedFmv` / `getIndices` / `getIndexDetail` / `getCardFmvSeries` 的認證 header `X-Api-Key`。缺 → `isConfigured()` 回 false，全部查詢 fail-open 回 `null`/空陣列，**不打上游**（無成本風險）。 |
| `RENAISS_INDEX_API_SECRET` | `REPLACE_ME_RENAISS_INDEX_API_SECRET` | 同上 partner key pair 的 secret 半邊 | 認證 header `X-Api-Secret`，與上者成對，缺一即 `isConfigured()` false。 |
| `BSC_RPC_URL` | `https://REPLACE_ME_BSC_RPC_HOST/REPLACE_ME_API_KEY` | BNB Smart Chain RPC endpoint（通常是 Alchemy BSC mainnet URL，內嵌 API key） | `server/services/chainAdapters/bsc/renaissAdapter.js` 的 `fetchHoldings`/`fetchNFTAttributes`（錢包掃描 `/scan`）。缺 → fail-open 回空持倉，不阻擋其他路由。**注意**：這條 URL 本身即含金鑰，整條字串都是機敏值。 |
| `GCP_SERVICE_ACCOUNT_BASE64` | `REPLACE_ME_BASE64_ENCODED_SERVICE_ACCOUNT_JSON` | Dokipoki dev Firebase 專案的 service-account JSON，base64 編碼後整段貼入 | Firebase Admin SDK 初始化（`/meta` 讀寫 `hackathonMerchantInventory/{uid}`）。此金鑰可繞過 `firestore.rules`，**視為高權限機敏資訊**，只進部署密鑰庫。 |
| `VITE_FIREBASE_API_KEY` 等 `VITE_FIREBASE_*` | 見 `client/.env.example` | Firebase console → Project settings → Your apps → Web config | Client Firebase Auth（Google）。**公開值**（非 secret），但未填則 Version B 登入不可用；Version A Dashboard 仍可離線 fail-open。 |

## 非金鑰但需人工協調的項目（不在本檔管轄範圍，記錄於 sprint-plan「Out-of-orchestrator scope」）

- Dokipoki-dev `firebase.json` 加 `/merchant/**` rewrite → 本 app 的 hosting site（需與 Jacker 協調）。
- Firebase Auth authorized domains 加入 `dokipoki-dev.web.app`（登入實際發生在此域）。
- Push 到 `https://github.com/bouob/renaiss-demo` 後，把上表金鑰綁進該 repo 的 GitHub Actions secrets / Cloud Function 環境變數（**不要**直接寫進 repo 任何檔案）。

## 驗證（本 sprint 內已做）

- Grep 全 repo（`git grep`/文字搜尋）確認除 `.env.example` 佔位符字串本身外，找不到任何：
  - base64 大段 blob（service-account JSON 特徵）
  - `0x` 開頭 64-hex 私鑰格式
  - 已填值的 API key（非 `REPLACE_ME_*` 字樣）
