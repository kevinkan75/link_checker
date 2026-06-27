# Local Link Checker Technical Specification

本文件提供給其他專案做技術分析、架構比較或功能重用評估。使用者操作說明請看 [../README.md](../README.md)，開發主線請看 [../ROADMAP.md](../ROADMAP.md)，已完成里程碑請看 [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md)。

## 1. 系統目的

Local Link Checker 是一個本機執行的網站連結檢查工具。核心目標是從起始 URL 掃描同站 HTML 頁面、盤點連結與資源、檢查 HTTP 結果、降低常見誤判，並輸出可供 GUI、Analyzer、CSV 匯出與後續 report diff 使用的 JSON report。

非目標：

- 不繞過 WAF/Bot 防護。
- 不預設啟用 headless browser render。
- 不保存完整 response body。
- 不先導入資料庫、常駐服務或大型分散式架構。

## 2. 主要入口

| 入口 | 檔案 | 用途 |
| --- | --- | --- |
| CLI | `link-checker.mjs` / `check-links.cmd` | 單站掃描、JSON 輸出、命令列診斷。 |
| GUI server | `gui-server.mjs` / `gui.cmd` | 本機 HTTP GUI、工作佇列、log 自動保存。 |
| GUI frontend | `public/index.html`、`public/app.js` | 掃描表單、即時事件、問題連結表格、隊列控制。 |
| External analyzer | `public/analyzer.js` | 分析 `report.json` 或 `external-links.csv` 的外連治理結果。 |
| Report analyzer | `public/report-analyzer.js` | 分析單份 `report.json` 的壞連結與來源頁。 |
| Portable build | `build-portable.ps1` | 打包 Windows portable zip，包含 Node runtime、GUI、docs 與 public assets。 |

## 3. 核心掃描流程

```text
startUrl
  -> fetch HTML page
  -> detect SPA / framework signals
  -> extract HTML attribute links
  -> extract SPA payload literal links
  -> apply optional site link rules
  -> resolve URLs and canonicalize keys
  -> merge into URL inventory
  -> schedule validation by intent and priority
  -> crawl same-origin page-like URLs
  -> confirm same-site 404/410 candidates
  -> build report.json
```

### 3.1 抽取層

抽取層保留低成本策略，不使用完整 DOM parser。主要來源：

- HTML tag attributes，例如 `a[href]`、`img[src]`、`script[src]`、`link[href]`。
- Meta refresh 與簡單 JavaScript redirect literal。
- SPA / Nuxt inline script 中的完整 URL literal。
- SPA / Nuxt inline script 中明確 `/` 開頭 path literal。
- Site link rules 推導出的 CMS route、external URL 與 YouTube URL。

每個來源會標記 `sourceType`：

| sourceType | 意義 |
| --- | --- |
| `html_attribute` | 傳統 HTML tag attribute。 |
| `script_literal` | script payload 中的完整 URL literal。 |
| `spa_payload` | script payload 中的明確 path literal。 |
| `site_rule_derived` | 由 `--site-link-rules` 推導出的 URL。 |

### 3.2 URL inventory

URL inventory 以 canonical key 合併重複 URL 與多個來源頁，避免同一 URL 被重複檢查。每個 inventory item 保存：

- `canonicalUrl`
- `originalUrls`
- `resolvedUrls`
- `representativeUrl`
- `sources`
- `isExternal`
- `linkType`
- validation intent：`shouldCheck`、`shouldCrawl`、`needsStatusCheck`、`needsBodyFetch`
- scheduling flags：`statusValidationScheduled`、`bodyValidationScheduled`
- completion flags：`checked`、`bodyFetched`

Canonical strategy 支援 `safe|moderate|aggressive`，預設 `safe`。

### 3.3 Validation scheduling

Validation queue 使用簡易 priority 排序。目的不是排程系統，而是在同一批候選 URL 中避免 `_nuxt` asset 佔滿檢查預算。

Priority 原則：

1. 外連
2. 內容頁
3. 一般頁面
4. 文件下載
5. unknown
6. media
7. asset
8. immutable asset / `_nuxt` asset

第一版用陣列排序，不使用 binary heap。掃描量變大時可升級資料結構。

## 4. HTTP 與誤判降低策略

### 4.1 Host scheduler

工具同時使用全域 concurrency 與 per-host concurrency。Host scheduler 會套用：

- 每 host 併發限制。
- 固定 request delay。
- 隨機 request delay 範圍。
- 全域 limiter。

### 4.2 Request policy

主要策略：

- 預設先用 `HEAD` 或輕量檢查，再依結果 fallback。
- 可用 `--prefer-get` 偏好 GET。
- 同站資源會帶來源頁 `Referer`，降低圖片、PDF、CSS 等資源誤判。
- 檔案下載 API 若 `HEAD` 回 `403/404/405/501/5xx`，會改用 `GET` 確認。
- redirect 由工具手動追蹤，保存 chain 與 issue labels。
- 支援 `--system-ca` 與 `--legacy-tls` 處理 Windows trust store 或舊 TLS 站點。

### 4.3 404 / 410 confirmation

主掃描後會集中複查同站 `404 / 410` 候選。Confirmation 不覆蓋初次結果，而是寫入 `confirmation` 欄位。

主要欄位：

- `enabled`
- `candidate`
- `checked`
- `status`
- `ok`
- `finalUrl`
- `method`
- `referer`
- `elapsedMs`
- `outcome`: `recovered | confirmed_missing | needs_review`
- `reason`

衍生欄位：

- `transientFailure`
- `needsReview`

## 5. SPA / Nuxt 與 site link rules

### 5.1 SPA detection

Report summary 會輸出 `spaDetection`，包含：

- `detected`
- `framework`
- `pagesDetected`
- `signals`
- `stats.htmlLength`
- `stats.anchorCount`
- `stats.urlLiteralCount`
- `recommendation`

常見 signals 包含 Nuxt asset、Nuxt payload、低 anchor count、大量 URL literal 等。

### 5.2 SPA links mode

`--spa-links` 支援：

| 模式 | 行為 |
| --- | --- |
| `auto` | 預設。偵測到 SPA 訊號或有 site rules 時抽取 payload links。 |
| `off` | 關閉 SPA payload 抽取，回到舊行為。 |
| `strict` | 只抽完整 URL 與明確 `/` path，不套用站台規則推論。 |

### 5.3 Site link rules

`--site-link-rules <file-or-url>` 用於站台或 CMS 特定欄位推導，避免把站台規則硬寫進 crawler。

規則模型：

```json
{
  "fields": {
    "externalUrl": ["linkUrl", "url"],
    "youtubeId": ["youtubeId"],
    "routePath": ["routePath", "path"]
  },
  "routeMappings": [
    {
      "name": "article",
      "when": { "articleId": "*" },
      "template": "/central/article/{articleId}"
    }
  ]
}
```

目前支援：

- 完整外部 URL 欄位。
- YouTube ID 轉 YouTube watch URL。
- `/` 開頭 route path。
- 簡單 template mapping。
- JSON object fragment 與唯一 field-pair fallback。

## 6. 外連治理風險

外連會進入 `externalLinks[]`，並依網域分類與治理規則產生 `externalRisk`。

### 6.1 Domain category rules

`--domain-rules <file-or-url>` 載入分類規則，例如政府、合作單位、社群、CDN、tracking、shortener 等。

### 6.2 External risk rules

`--external-risk-rules <file-or-url>` 支援：

- allowlist
- blocklist
- watchlist
- rules array

`externalRisk` 欄位：

- `riskLevel`: `high | medium | low | info`
- `riskReasons`
- `governanceStatus`: `allowed | blocked | watchlisted | unknown | needs_review`
- `matchedRules`
- `needsReview`

## 7. Report JSON 契約

Report root：

```js
{
  schemaVersion,
  generator,
  startedAt,
  completedAt,
  runStatus,
  startUrl,
  options,
  scanPolicy,
  compliance,
  summary,
  broken,
  checked,
  externalLinks
}
```

P6.5b-1 起，scan report 使用 `schemaVersion: "1.2.0"`，`generator.name` 為 `link-checker.mjs`。`1.1.0` 代表 P6.5a 輸出契約、redaction 與 body/source limit 基線；`1.2.0` 起加入 URL security policy、P6.5b-2 `runStatus`、P6.5b-3 robots / compliance 記錄、P6.5b-4 host diagnostics 與 P6.5b-5 protection signature schema。最低契約草案位於 `schemas/report.schema.json`。

P6.5b-2 起，report root 會輸出 `completedAt` 與 `runStatus`。`runStatus.status` 只允許 `complete`、`partial`、`failed`：正常結束為 `complete`，GUI stop / queue stop 為 `partial` 並標記 `stoppedByUser` 與 `stopReason`，runtime / validation error 為 `failed` 並記錄 `failureReason`。Analyzer 與 `report-diff.mjs` 讀到 `partial` 或 `failed` 時必須顯示 warning；舊 report 沒有 `runStatus` 時視為 legacy complete。

P6.5b-3 起，scan report 會輸出 `summary.robotsTxt`、root `scanPolicy` 與 root `compliance`。工具會在掃描前讀取 start origin 的 `/robots.txt` 並記錄狀態、HTTP status、Crawl-delay、Allow / Disallow rule count、Sitemap 與全站 Disallow；`--no-robots` 會停用這個讀取。`scanPolicy.robotsTxt.mode` 目前為 `record_only` 或 `disabled`，`pathEnforcement=false`，因此不會依 Disallow 跳過 URL。`--authorized-scan` 與 `--authorization-note` 只記錄使用者宣告，`compliance.disclaimer` 明確表示工具不驗證授權。

P6.5b-4 起，429 / 503 response 若帶 `Retry-After`，工具會解析秒數或 HTTP-date，並依 `retryAfterMaxMs` 設定 per-host cooldown；預設上限為 `30000` ms。cooldown 只套用到同一 host，不阻塞其他 host。`summary.hostDiagnostics` 會彙整各 host 的 403、429、protected、suspected WAF/Bot、Retry-After cooldown 與 block-rate warning，`report-diff.mjs` 也會比較 `summary.hostDiagnostics`。

P6.5b-5 起，防護層診斷會收斂到 `checked[].protection` / `broken[].protection`，穩定保存 `provider`、`headerEvidence`、`bodySignatureRuleIds`、`blockedReason`、`blockedRuleId`、`suspectedWaf` 與 `suspectedBot`。`bodySignature` 預設只保存 rule id、title 與 sanitized snippet，不保存完整 body，也不預設保存 `bodyHash`；只有 CLI `--protection-body-hash` 或等效 options opt-in 時才輸出 SHA-256 `bodyHash`，且 `compliance.bodyHashEnabled=true`。WAF/Bot body signature 命中時，即使 HTTP status 是 404/410，也分類為 `protected`，避免被當成一般 missing link。

### 7.1 options

`options` 記錄本次掃描的主要輸入與行為設定：

- crawl limits：`maxPages`、`maxDepth`
- concurrency：`concurrency`、`perHostConcurrency`
- delay：`requestDelayMs`、`requestDelayMinMs`、`requestDelayMaxMs`
- HTTP：`timeoutMs`、`retryCount`、`maxRedirects`、`userAgent`、`acceptLanguage`
- behavior：`checkExternal`、`preferGet`、`externalReferer`、`conservativeMode`
- compatibility：`canonicalStrategy`、`legacyTls`、`systemCa`
- security：`blockPrivateIp`、`allowLocalhost`、`allowPrivateIp`
- confirmation：`confirm404`、confirmation limits and delays
- rules：`domainCategoryRulesSource`、`externalRiskRulesSource`、`siteLinkRulesSource`
- SPA：`spaLinks`
- output safety：`redactSensitiveQuery`、`redactQueryKeys`
- output limits：`maxHtmlBytes`、`maxBodyPreviewBytes`、`maxDownloadProbeBytes`、`maxSourcesPerUrl`
- network：`keepAlive`、`maxSockets`、`maxFreeSockets`、`keepAliveMsecs`

P6.5a-2 起，report、CSV、events log 與 manifest 中的 URL 顯示值會依 `redactQueryKeys` 遮罩敏感 query value。此遮罩只作用於輸出層，實際 request URL、inventory key 與 fetch cache 不使用遮罩後 URL。

P6.5a-4 起，request `Accept` 依 URL intent 分流：page-like 使用 document request Accept，asset/media/document 使用 `*/*`。`Accept-Encoding` 啟用 `gzip` / `deflate`，`br` 暫不啟用。Keep-Alive 預設開啟，仍由 global concurrency 與 `perHostConcurrency` 控制併發；`--no-keep-alive` 會送出 `Connection: close` 並停用 legacy HTTP agent keep-alive。

P6.5b-1 起，URL security policy 預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與非 HTTP(S) scheme。一般 hostname 在 request 前會先 DNS resolve 後檢查，redirect 目標也會重新檢查。可信任本機掃描可用 `--allow-localhost`，內網相容情境可用 `--allow-private-ip`；兩者互不隱含，metadata service IP 仍會阻擋。被阻擋的 result 使用 `classification: "security_blocked"`，並在 result `securityPolicy` 中記錄原因、hostname、address 與 address type。

### 7.2 summary

Core summary：

- `pagesCrawled`
- `urlsChecked`
- `brokenLinks`
- `brokenByType`
- `redirects`
- `redirectByType`
- `skippedExternal`

External summary：

- `externalLinks`
- `externalDomains`
- `externalByType`
- `externalByCategory`
- `externalRiskByLevel`
- `externalRiskByGovernanceStatus`
- `externalRiskByDomain`

Confirmation summary：

- `confirmation.enabled`
- `confirmation.candidates`
- `confirmation.checked`
- `confirmation.recovered`
- `confirmation.confirmed_missing`
- `confirmation.needs_review`
- `confirmation.skipped`

Inventory summary：

- `urlsDiscovered`
- `uniqueCanonicalUrls`
- `duplicateUrlReferences`
- `sourcesMerged`
- `validationSkippedByInventory`
- `statusCacheHits`
- `bodyCacheHits`
- `inventoryMergeRatio`

P5.5 diagnostics：

- `pagesChecked`
- `contentLinksChecked`
- `externalLinksChecked`
- `documentsChecked`
- `mediaLinksChecked`
- `assetsChecked`
- `nuxtAssetsChecked`
- `checkedByKind`
- `spaDetection`
- `scanQuality`

### 7.3 checked[]

每筆 checked result 代表一個 canonical URL 的檢查結果。常見欄位：

- URL：`url`、`canonicalUrl`、`normalizedFrom`、`finalUrl`
- request：`checkedAt`、`method`、`finalMethod`、`requestReferer`
- response：`ok`、`status`、`contentType`、`contentLength`、`bodyBytesRead`、`bodyTruncated`
- cache：`cacheHeaders`
- redirect：`redirected`、`redirectCount`、`redirectChain`、`redirectType`、`redirectIssues`、`redirectLabels`
- protection：`wafHeaders`、`blockedReason`、`blockedRuleId`、`suspectedWaf`、`suspectedBot`
- diagnosis：`classification`、`issueType`、`diagnosis`
- retry：`attempts`
- confirmation：`confirmation`、`transientFailure`、`needsReview`

### 7.4 broken[]

`broken[]` 是 `checked[]` 中 `ok !== true` 的子集，並補上 `sourceCount`、`sourcesTruncated` 與截斷後的 `sources`。它是 UI / CSV 的主要壞連結入口。

### 7.5 externalLinks[]

每筆 external link 包含：

- identity：`url`、`canonicalUrl`、`hostname`、`registrableDomain`
- classification：`type`、`categories`、`categorySources`
- `sources`
- `sourcesTruncated`
- optional checked result fields：`checked`、`status`、`ok`、`method`、`checkedAt`、`finalUrl`
- redirect / protection / issue fields
- `externalRisk`
- `sourceCount`

## 8. GUI Server API

GUI server 是本機 HTTP server，不是遠端服務。主要 API：

| Method | Path | 用途 |
| --- | --- | --- |
| `POST` | `/api/session/heartbeat` | GUI heartbeat，支援 idle shutdown 判斷。 |
| `POST` | `/api/shutdown` | 手動關閉本機服務。 |
| `POST` | `/api/jobs` | 建立單站掃描 job。 |
| `GET` | `/api/jobs/:id/events` | Server-Sent Events 即時事件。 |
| `GET` | `/api/jobs/:id/report` | 取得完整 report。 |
| `GET` | `/api/jobs/:id/status` | 取得 job 狀態。 |
| `POST` | `/api/jobs/:id/stop` | 停止 job。 |
| `GET` | `/api/queue` | 取得多站佇列狀態。 |
| `POST` | `/api/queue/items` | 加入佇列。 |
| `POST` | `/api/queue/start` | 啟動佇列。 |
| `POST` | `/api/queue/stop` | 停止佇列。 |
| `GET` | `/api/queue/items/:id/report` | 取得佇列項目的 report。 |

GUI 完成後會保存：

- `summary.json`
- `report.json`
- `broken.csv`
- `events.log`
- `external-links.csv`
- `external-summary.json`
- `manifest.json`

CLI 使用 `--output <file>` 時會寫出指定 report，並在同目錄建立 `manifest.json`。

## 9. Exit Codes

| Exit code | 意義 |
| --- | --- |
| `0` | 沒有失效連結。 |
| `1` | 參數或程式錯誤。 |
| `2` | 有失效連結。 |

## 10. 可重用設計點

其他專案可參考或重用的設計：

- URL inventory 分層：抽取、canonical key、validation intent 分離。
- Report-first 架構：先讓 JSON report 成為穩定契約，再讓 GUI / Analyzer / CSV 讀同一份資料。
- Confirmation model：保留初次結果與二次確認結果，不覆蓋證據。
- External governance model：把分類、治理狀態、風險原因和 matched rules 分開。
- SPA extraction mode：`auto|off|strict`，讓功能可回退且可診斷。
- Site link rules：站台特定邏輯外部化，不污染核心 crawler。
- Scan quality diagnostics：把掃描覆蓋率風險寫入 report，而不是只靠人看 logs。
- Asset/content priority：在不跳過資源的前提下，先降低 asset 主導掃描的風險。

## 11. 已知限制與後續項目

不阻塞目前主線，但需要保留追蹤：

- GUI 尚未提供 `--external-risk-rules` 輸入欄位。
- 外連治理規則尚未支援 URL pattern、path、tag/source 條件。
- 外連 `410` 是否納入二次確認需等 TTL cache 穩定後評估。
- CDN/WAF body hash 診斷可後續補強。
- Asset skip / asset defer 應建立在 P7/P8 cache 與 incremental scan 之後。
- 可增加更多 framework payload 支援，例如 Next.js `__NEXT_DATA__`。
- `--render` headless fallback 應保持 opt-in。
- 大量 URL 場景可將簡易排序升級為 binary heap / 完整 priority queue。

## 12. Release / Packaging

Portable package 由 `build-portable.ps1` 產生：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

Package 包含：

- CLI / GUI scripts
- `link-checker.mjs`
- `gui-server.mjs`
- public frontend assets
- bundled `runtime\node.exe`
- `README.md`
- `ROADMAP.md`
- `docs/`
- `Start Link Checker.exe`
