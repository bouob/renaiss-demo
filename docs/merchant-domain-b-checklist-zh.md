# 方案 B 後台操作清單（可直接照做）

完整說明見 `merchant-domain-b-setup.md`。

---

## A. Firebase Console（專案 `dokipoki-dev`）

### A1. 新增 Hosting site

1. 開 https://console.firebase.google.com/  
2. 選專案 **`dokipoki-dev`**  
3. 左欄 **Build → Hosting**  
4. **Add another site**  
5. Site ID 填：`merchant-dokipoki-dev` → 建立  

### A2. 自訂網域掛到「新 site」

1. Hosting 點進 **`merchant-dokipoki-dev`**（不要點 default 主站）  
2. **Custom domains → Add custom domain**  
3. 網域：`merchant.dokipoki.app`  
4. 依畫面完成驗證  
5. **抄下 Firebase 要求的 DNS 記錄**  

### A3. 從主站 site 拔掉同網域（若有）

1. Hosting → **default / 主站 site**  
2. Custom domains 若有 `merchant.dokipoki.app` → **Remove**  
3. 避免兩個 site 搶同一個網域  

### A4. Authentication 授權網域

1. **Build → Authentication → Settings**  
2. 分頁 **Authorized domains**  
3. **Add domain**：`merchant.dokipoki.app`  
4. 確認仍有：`dokipoki-dev.web.app`、`localhost`  

---

## B. DNS（網域供應商 / Cloudflare）

1. 開 `dokipoki.app` 的 DNS 管理  
2. 找到 `merchant` 這筆（現在多半是 CNAME → `dokipoki-dev.web.app`）  
3. **改成 Firebase「新 site」畫面指示的記錄**（以 Console 為準）  
4. 等狀態變成 **Connected**（含 SSL）  

> 未改 DNS 前：即使建了新 site，瀏覽器仍可能打到舊的 default site。

---

## C. Cloud Function CORS（Google Cloud / Firebase）

1. 開 https://console.cloud.google.com/ → 專案 **`dokipoki-dev`**  
2. **Cloud Functions** 或 **Cloud Run** → 找 **`merchantApi`**（`asia-east1`）  
3. 編輯環境變數：  

```text
CORS_ORIGIN=https://merchant.dokipoki.app,https://dokipoki-dev.web.app
```

4. 儲存並讓服務重新部署一版  

---

## D. 開發側（DNS / site 就緒後再說）

程式 repo 已備：

- `docs/merchant-domain-b-setup.md` — 完整說明  
- `firebase.merchant-site.json` — 新 site 用 hosting 設定（`base: '/'` 建置）  

部署指令（**等你核准 + Console 建好 site 後**）：

```bash
# 概念：Merchant 以根路徑建置後，只 deploy 到新 site
firebase deploy --only hosting --project dokipoki-dev \
  # 實際以 firebase.json 內 "site": "merchant-dokipoki-dev" 為準
```

**不要**用「只含 Merchant 的 public」去蓋 default 主站。

---

## E. 完成後請回報

- [ ] 新 site `merchant-dokipoki-dev` 已建立  
- [ ] `merchant.dokipoki.app` 已掛在**新 site**（default 上已移除）  
- [ ] DNS / SSL = Connected  
- [ ] Auth authorized domains 已加 `merchant.dokipoki.app`  
- [ ] `CORS_ORIGIN` 已更新  

回報後再改程式：`base: '/'`、關 hostRedirect bounce、CI deploy 到新 site。

---

## F. 驗收

| URL | 期望 |
|-----|------|
| https://merchant.dokipoki.app/ | Merchant（不是主站 title） |
| https://merchant.dokipoki.app/inventory | 庫存頁 |
| https://dokipoki-dev.web.app/ | 主站不變 |
| https://dokipoki-dev.web.app/merchant/ | 可選：path 版仍可用 |

---

## 常見錯誤

| 現象 | 原因 |
|------|------|
| 根路徑仍是 Dokipoki | 網域還掛在 default site，或 DNS 未切到新 site |
| 登入失敗 | Auth 未加 `merchant.dokipoki.app` |
| API CORS error | `merchantApi` 的 `CORS_ORIGIN` 未含新網域 |
| 白屏 / assets 404 | 還用 `base: '/merchant/'` 卻 deploy 在根站（需改 base 後再 deploy） |
