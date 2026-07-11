# 方案 B：`https://merchant.dokipoki.app/` = Merchant 根站

> 目標：開 `merchant.dokipoki.app` **根路徑**就是 Merchant Copilot（不是主站 Dokipoki）。  
> 前提：同一 Firebase **單一 site** 做不到「兩個網域各有不同根內容」→ 必須 **Hosting multi-site**。

---

## 0. 現況（檢查結果）

| 項目 | 狀態 |
|------|------|
| DNS | `merchant.dokipoki.app` **CNAME → `dokipoki-dev.web.app`** |
| 實際掛載 | 與主站 **同一個** Hosting site（共用 public 樹） |
| 根 `/` | 目前是 **Dokipoki 主站** |
| `/merchant/` | 目前是 Merchant（path 掛載） |

---

## 1. Firebase Console — 建第二個 Hosting site

1. 開 [Firebase Console](https://console.firebase.google.com/)  
2. 專案選 **`dokipoki-dev`**（dev；不要選 prod `okipoki-ab0c5`，除非你要 prod）  
3. 左選單 **Build → Hosting**  
4. 若只有一個 site：點 **Add another site**（或「新增網站」）  
5. Site ID 建議（全小寫、可含連字）：  
   - **`merchant-dokipoki-dev`**  
   （之後 deploy 會用這個 id）  
6. 建立完成後，Hosting 頁應看到 **兩個 site**：  
   - 既有 default（主站，約 `dokipoki-dev`）  
   - 新建 `merchant-dokipoki-dev`  

---

## 2. 自訂網域改掛到新 site（關鍵）

> 現在 CNAME 指到 `dokipoki-dev.web.app` = **default site**。  
> 方案 B 要讓 `merchant.dokipoki.app` 掛在 **新 site**，不要掛在 default。

### 2a. 在新 site 加網域

1. Hosting → 點進 **`merchant-dokipoki-dev`**（新 site）  
2. **Custom domains** → **Add custom domain**  
3. 輸入：`merchant.dokipoki.app`  
4. 依畫面完成 **所有權驗證**（若已驗證過同 project，可能較快）  
5. 記下 Firebase 給的 **DNS 記錄**（通常是 A 或 CNAME 指到 Firebase Hosting）

### 2b. 從舊 site 移除（若還掛在 default）

1. Hosting → **default site**（主站那個）  
2. Custom domains 若仍列出 `merchant.dokipoki.app` → **Remove / 斷開**  
3. 避免同一網域掛兩個 site 衝突  

### 2c. DNS（網域供應商 / Cloudflare 等）

依 Firebase 新 site 指示更新，常見兩種：

**CNAME（常見）**

| Type | Name | Target |
|------|------|--------|
| CNAME | `merchant` | Firebase 提供的 host（例如 `ghs.googlehosted.com` 或畫面上寫的值） |

**注意：**  
- 若 Firebase 要求改成 **A 記錄**，以 Console 當下顯示為準。  
- 改完後等 SSL 狀態變 **Connected**（可能數分鐘～數小時）。

### 2d. 確認

瀏覽器開：

- `https://merchant.dokipoki.app/`  
  - multi-site + 正確 deploy 後 → 應是 **Merchant**（title 類似 `Merchant · Dokipoki`）  
  - 若仍是主站 → 網域還掛在 default site，或 DNS 未切換完成  

---

## 3. Firebase Auth — Authorized domains

登入（Inventory Google）若在 `merchant.dokipoki.app` 發生：

1. 同一專案 **`dokipoki-dev`**  
2. **Build → Authentication → Settings → Authorized domains**  
3. **Add domain**：`merchant.dokipoki.app`  
4. 保留：`dokipoki-dev.web.app`、`localhost`  

未加此 domain 時：在 merchant 網域登入會失敗或 redirect 異常。

---

## 4. Cloud Function / CORS（後端）

`merchantApi` 已在 `dokipoki-dev`（asia-east1）。

### 4a. 建議環境變數

在 **Google Cloud Console** 或 Firebase Functions 設定：

| 變數 | 建議值 |
|------|--------|
| `CORS_ORIGIN` | `https://merchant.dokipoki.app,https://dokipoki-dev.web.app` |
| （其餘） | 既有 RENAISS / BSC / GCP SA 等 |

路徑：

1. [Cloud Console](https://console.cloud.google.com/) → 專案 `dokipoki-dev`  
2. **Cloud Functions**（或 Cloud Run，gen2 可能顯示為 Run service）  
3. 找到 **`merchantApi`**（region `asia-east1`）  
4. **Edit → Runtime / Variables** → 設 `CORS_ORIGIN`  
5. Deploy 新版 revision  

若暫時用 `CORS_ORIGIN=*` 可先通，正式建議改成明確 origin 列表。

### 4b. Hosting rewrite（新 site）

新 site 的 `firebase.json` hosting 應類似：

- `public`：Merchant 建置產物（**根路徑**，`base: '/'`）  
- rewrite：`/merchant/api/**` **或** `/api/**` → function `merchantApi`  
- SPA：`**` → `/index.html`  

（程式 repo 已備 `firebase.merchant-site.json` 範本，見下節。）

---

## 5. 程式 / CI（開發側，deploy 前）

| 項目 | 說明 |
|------|------|
| Vite `base` | 根站要用 **`/`**（path 站才用 `/merchant/`） |
| React Router | 根站 `basename` 空或 `/` |
| `hostRedirect` | multi-site 就緒後 **不要** 再踢到 dokipoki-dev |
| Deploy target | `firebase deploy --only hosting:merchant --project dokipoki-dev`（名稱依 `.firebaserc` targets） |
| **禁止** | 對 default site 只丟 Merchant public（會蓋掉主站） |

主站 `dokipoki-dev.web.app/merchant` path 掛載可繼續保留（Dokipoki deploy-dev 合併），與 merchant 根站 **並存**。

---

## 6. 建議操作順序（給 Jacker / 有 Console 的人）

```text
1. Firebase → dokipoki-dev → Hosting → Add site → merchant-dokipoki-dev
2. 新 site → Add custom domain → merchant.dokipoki.app
3. 若 default site 也有此 domain → 先 Remove
4. DNS 依新 site 指示更新，等 SSL Connected
5. Authentication → Authorized domains → 加 merchant.dokipoki.app
6. merchantApi → CORS_ORIGIN 含 https://merchant.dokipoki.app
7. 用 merchant 專用 firebase 設定 deploy hosting 到新 site（base=/）
8. 驗證：
   - https://merchant.dokipoki.app/          → Merchant
   - https://merchant.dokipoki.app/inventory → Inventory
   - https://dokipoki-dev.web.app/           → 主站（不受影響）
   - https://dokipoki-dev.web.app/merchant/  → 可選保留 path 版 Merchant
```

---

## 7. 驗收指令（完成後）

```bash
# 應為 Merchant title，不是 Dokipoki 主站
curl -s https://merchant.dokipoki.app/ | head
# 或瀏覽器看 <title>Merchant · Dokipoki</title>

# API（依 rewrite 路徑二選一）
curl -s https://merchant.dokipoki.app/api/health
# 或
curl -s https://merchant.dokipoki.app/merchant/api/health
```

---

## 8. 若暫時做不到 multi-site（退路）

| 方案 | URL | 後台 |
|------|-----|------|
| 維持 path | `https://merchant.dokipoki.app/merchant/` | 不需第二 site |
| B-lite | 根 `/` 前端轉 `/merchant/` | 同 site + 小改 client |

---

## 9. 聯絡窗口

- DNS / 自訂網域 / 第二 site：Jacker（Firebase + 網域供應商）  
- 程式 base / deploy target / hostRedirect：開發（`project-renaiss`）  
- Auth authorized domains：Firebase 專案 Owner/Editor  
