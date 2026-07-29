# P7 Cache Assessment and Release

This merged archive document consolidates the P7 TTL URL result cache evaluation and release closure notes. The original standalone files were merged to keep archive navigation smaller while preserving the implementation and validation record.

Merged source scope:

- P7 TTL URL result cache evaluation
- P7 release closure, validation record, and P8 handoff notes

---

## P7 TTL URL Result Cache Evaluation

狀態：歷史實作前評估。P7 已完成並合併主線；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，技術規格請看 [../TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md)。

本文件記錄 P7：TTL URL result cache 的實作前評估。P7 目標是降低重複 URL 狀態檢查成本，但不改變頁面發現、HTML 抽取與 report 主契約的基本語意。

### 結論

P7 可以進入實作，但第一版應採保守 MVP：

- 只做跨執行的 URL status / result TTL cache。
- 不做 page HTML cache。
- 不做 incremental scan。
- 不讓 cache 命中取代需要 HTML body 的頁面抓取。
- 先以 CLI 與 report summary 為主要交付，GUI 表單控制可延後到 P9。

主要理由是目前 `LinkChecker` 已有單次執行內的 `statusCache` 與 `bodyCache`，P7 可以沿用這個切點擴成 persistent TTL cache；但若把 page body 也納入第一版，會碰到 URL discovery、SPA payload extraction、source tracking 與 P8 incremental scan 的邊界，風險明顯升高。

### 現有基線

評估時現有測試全數通過：

- `test-report-diff.mjs`
- `test-p65a-output-contract.mjs`
- `test-p65a-redaction.mjs`
- `test-p65a-limits.mjs`
- `test-p65a-network.mjs`
- `test-p65b-security-policy.mjs`
- `test-p65b-robots-compliance.mjs`
- `test-p65b-retry-after.mjs`
- `test-p65b-run-status.mjs`
- `test-p65b-waf-signature.mjs`

這表示 P7 可建立在 P6/P6.5a/P6.5b 已穩定的輸出契約、安全策略、robots / compliance、Retry-After 與 WAF diagnostics 上。

### MVP 範圍

第一版建議交付：

- cache file：`.cache/link-check-cache.json`
- CLI：
  - `--cache`
  - `--cache-file <file>`
  - `--cache-ttl-hours <n>`
  - `--no-cache`
  - `--refresh-cache`
- report `options` 記錄 cache 設定。
- report `summary.cache` 記錄：
  - `enabled`
  - `file`
  - `hits`
  - `misses`
  - `expired`
  - `refreshed`
  - `written`
  - `bypassed`
  - `errors`
- cache value 保存 status check result，不保存完整 response body。
- `requireBody: true` 的頁面 fetch 不使用 persistent status hit 取代 request。

### 不納入 P7 第一版

- page HTML cache。
- incremental scan / changed-only。
- sitemap lastmod 排程。
- adaptive backoff 完整策略。
- GUI cache 設定表單。
- cache 資料庫或多檔 shard。
- full response body 保存。

### 實作切點

目前最自然的實作位置在 `link-checker.mjs`：

- `LinkChecker` constructor：初始化 cache options、統計與 cache store。
- `checkUrl(url, { requireBody })`：在 `requireBody: false` 且 cache enabled 時讀寫 persistent TTL cache。
- `fetchWithCache(url, requireBody)`：保留現有 request、fallback 與 reporter 流程。
- `buildReport()`：輸出 `options` 與 `summary.cache`。
- `parseArgs()` / `printHelp()` / `printSummary()`：加入 CLI 與摘要顯示。

不要把 persistent cache 放到 `fetchUrl()` 內部，因為 `fetchUrl()` 是較底層 request wrapper，缺少 inventory、report summary、cache policy 與 source 語意。

### Cache Key

cache key 不應只用 URL。至少應包含：

- `canonicalUrl`
- `canonicalStrategy`
- method policy：`HEAD` / `GET` / `preferGet`
- userAgent hash
- `acceptLanguage`
- referer mode
- `checkExternal`
- robots policy mode / status
- security policy：
  - `blockPrivateIp`
  - `allowLocalhost`
  - `allowPrivateIp`
- relevant request policy：
  - `maxRedirects`
  - `longRedirectThreshold`
  - `legacyTls`
  - `systemCa`

`timeoutMs` 與 `retryCount` 是否納入 key 可在實作時決定。若不納入，需在文件中說明 cache result 代表「最近一次結果」，不保證相同 retry policy。

### Redaction 與敏感資料

P6.5a 已將 redaction 定位在輸出層；實際 request URL 與 canonical key 不使用遮罩後 URL。P7 需補一個明確決策：

- cache key 不應使用遮罩後 URL，避免不同實際 URL 被錯誤合併。
- cache file 不應保存敏感 query value 的明文展示欄位。
- 若 cache 需要保存 original URL，應保存 hash 或經 redaction 的 display value。
- cache entry 可保存 `canonicalUrlHash` 與 `displayUrl`，避免把敏感 query value 當作可讀資料落盤。

### TTL 策略

建議第一版採分級 TTL，而不是只有單一 TTL：

| 結果類型 | 建議 TTL | 理由 |
| --- | ---: | --- |
| `200 / 204 / 3xx` | `--cache-ttl-hours`，預設 24 小時 | 穩定成功結果可降低重複成本 |
| `404 / 410` | 2-6 小時 | 避免長時間保留暫時發布、路由或 CDN 誤判 |
| `403 / protected / suspectedWaf / suspectedBot` | 15-60 分鐘 | 防護策略可能快速變化 |
| `429` | 15-60 分鐘 | rate limit 是短期狀態 |
| `5xx` | 15-60 分鐘 | 伺服器錯誤多半是暫時性 |
| `timeout / network_error` | 第一版可不快取，或最多 15 分鐘 | 避免保留網路瞬斷 |
| `security_blocked` | 可快取 | key 必須包含 security policy |

`--refresh-cache` 應忽略既有 cache entry，實際 request 後回寫新結果。

### 主要風險

#### 1. Cache 命中造成 URL discovery 減少

若 `requireBody: true` 的頁面 fetch 被 persistent status cache 命中取代，掃描器會拿不到 HTML body，導致 `extractLinks()`、SPA payload extraction、site link rules 與 inventory 都少資料。

處理方式：

- Persistent TTL cache 第一版只服務 `requireBody: false`。
- 頁面 crawl 仍需實際 GET body。
- 若同一 URL 先有 status cache hit，後續需要 body 時仍必須補抓 body。

#### 2. Cache key 太粗造成誤命中

不同 User-Agent、Accept-Language、referer mode、security policy 或 robots policy 可能得到不同結果。

處理方式：

- cache key 必須包含 policy fingerprint。
- report summary 顯示 cache policy version。
- cache file 保存 `cacheSchemaVersion`。

#### 3. 暫時性失敗被保存太久

`429`、timeout、`5xx` 與 WAF/Bot challenge 不應和穩定成功結果同 TTL。

處理方式：

- 依 result classification / issueType / status 決定 TTL。
- 暫時性失敗短 TTL 或不快取。

#### 4. Redaction 與落盤資料界線

cache 是本機落盤資料，不能因為不是 report 就忽略敏感 query value。

處理方式：

- 不保存未遮罩 display URL。
- key 使用 hash 或結構化 fingerprint。
- cache file schema 明確標示不屬於正式 report，但仍遵守敏感資料最小化。

### 驗收測試

建議新增 `test-p7-cache.mjs`，至少覆蓋：

- 第二次掃描同 URL 命中 cache，測試 server request count 不增加。
- `--refresh-cache` 忽略舊 cache 並回寫新結果。
- expired entry 不命中。
- userAgent 改變時不命中。
- acceptLanguage 改變時不命中。
- security policy 改變時不命中。
- robots policy 改變時不命中或產生不同 key。
- `404/410` TTL 短於 `200/204/3xx`。
- `429/5xx/timeout` 不長期命中。
- `requireBody: true` 不因 status cache 命中而跳過 HTML link extraction。
- report `summary.cache` 統計正確。
- cache file 不保存敏感 query value 明文展示欄位。

### 建議分階段

P7 建議分成三個小階段推進，避免一次實作時把 page HTML cache、GUI 控制或 P8 incremental scan 一起拉進範圍。

#### P7a：規格與測試骨架

目標是先固定 cache 行為與防回歸網，不先改掃描主流程。

交付：

- 補 `docs/TECHNICAL_SPEC.md` 的 cache schema、cache key policy、TTL policy 與 redaction / 落盤資料邊界。
- 補 `test-p7-cache.mjs` 的測試骨架與主要 fixtures。
- 明確記錄 `requireBody: true` 不走 persistent status cache。
- 明確記錄 GUI cache 控制延後，不屬於 P7a。

驗收：

- 新測試可以先以 pending / fixture shape 或最小可執行案例建立，但不得破壞現有 P6/P6.5 測試。
- P7a 完成後，實作範圍仍不包含 cache store 寫入正式流程。

#### P7b：CLI 與核心 cache

目標是完成真正可用的 persistent URL result cache，但只服務 `requireBody: false` 的 status check。

交付：

- CLI options：`--cache`、`--cache-file <file>`、`--cache-ttl-hours <n>`、`--no-cache`、`--refresh-cache`。
- cache store：load、lookup、write、expired prune、error handling。
- cache key fingerprint：canonical URL、method policy、UA hash、accept language、referer mode、robots policy、security policy 與必要 request policy。
- `checkUrl(... requireBody: false)` 接入 lookup / miss / refresh / write。
- `requireBody: true` 永遠保留實際 body fetch。

驗收：

- 第二次掃描同一 status URL 可命中 cache。
- policy 改變時不誤命中。
- expired entry 不命中。
- `--refresh-cache` 會略過舊 entry 並回寫新結果。

#### P7c：report、文件與收斂

目標是讓 cache 行為可追溯，並完成使用者可見契約。

交付：

- report `options` 加入 cache 設定。
- report `summary.cache` 加入 hit / miss / expired / refreshed / written / bypassed / errors。
- `printSummary()` 顯示 cache 摘要。
- 補 `CLI_REFERENCE.md`、README 或相關使用說明。
- 完整回歸測試。

驗收：

- `report.json` 可追溯 cache 是否啟用、使用哪個 cache file、命中與回寫統計。
- 現有 P6/P6.5 測試與 P7 cache 測試全數通過。
- GUI 不需要新增 cache 表單；若讀到 report summary，可自然保存於 job report。

### 建議實作順序

1. 補 `docs/TECHNICAL_SPEC.md` 的 P7 cache schema 與 key policy。
2. 新增 cache options normalization 與 CLI parsing。
3. 新增 cache store 讀寫：load、lookup、write、prune expired。
4. 在 `checkUrl(... requireBody: false)` 接入 lookup / miss / refresh / write。
5. 補 report `options` 與 `summary.cache`。
6. 補 `printHelp()`、`printSummary()`。
7. 新增 `test-p7-cache.mjs`。
8. 跑完整現有測試與 P7 新測試。

### 開放決策

- `--cache` 預設是否開啟：建議第一版預設關閉，避免改變使用者對「每次掃描都重新確認」的直覺。
- 預設 TTL：建議成功結果 24 小時，暫時性失敗短 TTL。
- cache file 是否納入 GUI job log：建議不納入每次 log 目錄，使用全域 `.cache/link-check-cache.json`。
- GUI 是否顯示 cache hit / miss：建議延後到 P9，只先在 report summary 保留資料。

---

## P7 Release Closure

狀態：歷史發布收尾紀錄。P7 已完成並合併主線；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，技術規格請看 [../TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md)。

本文件記錄 P7：persistent TTL URL result cache 的發布收尾狀態。P7 第一版已完成並可作為 P8 incremental scan 的基線。

### 發布狀態

- 狀態：已完成第一版並完成發布收尾。
- 分支：`codex/release-v0.14.0-p7`
- 發布日期：2026-07-15
- 主要交付：跨執行的 URL status-result TTL cache、CLI 參數、report cache summary、技術規格與回歸測試。

### 使用者可見變更

- 新增 `--cache`，啟用 persistent TTL URL status-result cache。
- 新增 `--cache-file <file>`，可指定 cache 檔案路徑，預設 `.cache/link-check-cache.json`。
- 新增 `--cache-ttl-hours <n>`，設定成功結果的 TTL，預設 `24` 小時。
- 新增 `--refresh-cache`，忽略既有 cache entry，重新檢查並回寫新結果。
- 新增 `--no-cache`，停用 persistent cache。
- `report.json` 會在 `options` 與 `summary.cache` 中記錄 cache 設定、命中、miss、expired、refreshed、written、bypassed 與 errors。

### 發布邊界

P7 cache 是本機效能最佳化資料，不是正式 report，也不改變掃描語意。

- `--cache` 預設關閉，使用者需明確啟用。
- cache 只服務不需要 HTML body 的 URL status check。
- 頁面爬行需要 `requireBody: true` 時仍會實際抓取 HTML body。
- cache 命中不得跳過 HTML link extraction、SPA payload extraction、site link rules 或 inventory 建立。
- cache file 不保存完整 response body。
- cache file 的展示 URL 會強制遮罩敏感 query value，即使 report redaction 被停用也一樣。
- GUI 第一版不新增 cache 控制表單；GUI 保存的 report 會自然包含 `summary.cache`。

### 驗收結果

發布收尾時已執行完整本機測試，全部通過：

- `test-p65a-limits.mjs`
- `test-p65a-network.mjs`
- `test-p65a-output-contract.mjs`
- `test-p65a-redaction.mjs`
- `test-p65b-retry-after.mjs`
- `test-p65b-robots-compliance.mjs`
- `test-p65b-run-status.mjs`
- `test-p65b-security-policy.mjs`
- `test-p65b-waf-signature.mjs`
- `test-p7-cache.mjs`
- `test-report-diff.mjs`

P7 cache 測試覆蓋：

- 第二次 status check 命中 cache 並避免重複 request。
- `--refresh-cache` 會略過舊 entry 並回寫新結果。
- expired entry 不命中。
- User-Agent、Accept-Language、security policy 與 robots policy 改變時不誤命中。
- `requireBody: true` 不因 status cache 命中而跳過 HTML body fetch。
- `summary.cache` 統計與 cache file redaction 行為符合契約。

### P8 交接條件

P8 可在此基線上設計 incremental scan，但不得假設 P7 已保存 page HTML body 或完整 URL discovery state。

P8 第一個建議切入點：

1. 定義 scan state 檔案格式。
2. 設計 `--incremental`、`--state-file <file>`、`--changed-only` 與 `--sitemap <url-or-file>`。
3. 先以 report diff、scan state 與 P7 status cache 建立優先檢查策略。
4. changed-only 模式仍需保留完整 summary，不只輸出 delta。
5. 不得因 sitemap 或 state 跳過本次 HTML inventory 發現的新 URL。
