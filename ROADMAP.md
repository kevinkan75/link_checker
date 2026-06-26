# 開發路線紀錄

## 一致性結論

P0-P6 已完成，包含本機服務生命週期、URL inventory、404 / 410 二次確認、外連風險治理 MVP、SPA / Nuxt 站台抽取前置改善，以及 report-to-report diff 第一版。

P6.5a 已完成輸出契約基線、redaction、sources 上限、response body limit 與 **Header / Accept-Encoding / Keep-Alive**。P6.5b-1 SSRF / URL security policy 與 P6.5b-2 `runStatus` / partial report 已完成；下一個主線收斂為 P6.5b-3 robots / compliance 記錄。Stage 0 若再發現 GUI/CLI 落差，可穿插小修，但不得改掃描語意或既有 report 主契約。

目前 Roadmap 採納下列分析與評估文件：

- `Local_Link_Checker_分析文件_v5.1.md`：作為架構決策與 Roadmap 邊界。
- `Local_Link_Checker_分析文件_v5.2.md`：作為工程落地補充，補安全、測試、schema、response limit、partial report、profile 與規則治理。
- [docs/P6_5A_ASSESSMENT.md](docs/P6_5A_ASSESSMENT.md)：作為 P6.5a 實作前切分、風險與驗收建議；P6.5a 雖不改掃描語意，但因涉及 report 契約、redaction、body limit 與 Keep-Alive，實作風險以中等看待。
- [docs/P6_5B_ASSESSMENT.md](docs/P6_5B_ASSESSMENT.md)：作為 P6.5b 實作前切分、風險與驗收建議；優先順序以 SSRF / URL security policy 為第一批。

## 階段總覽

| 順序 | 階段 | 狀態 | 主要交付 | 不得混入 |
| ---: | --- | --- | --- | --- |
| 0 | Stage 0 | 已收斂 | README、CSV BOM、GUI/CLI 落差提示、`sourceCount` 說明 | schema、robots、cache、incremental scan、Keep-Alive |
| 1 | P6 前置 | 已完成 | golden fixtures、diff schema 草案、report normalization 原則 | 掃描行為變更 |
| 2 | P6 | 已完成第一版 | 兩份既有 report 產生 `diff.json` | TTL cache、incremental scan、robots enforcement、adaptive backoff |
| 3 | P6.5a | 已完成 | schema/generator、manifest、redaction、response limit、sources 上限、Header / Accept-Encoding / Keep-Alive | robots / compliance 語意 |
| 4 | P6.5b | 進行中 | SSRF 與 partial report 已完成；後續 robots / compliance、Retry-After、WAF schema | WAF/Bot 繞過 |
| 5 | P7 | 待規劃 | TTL URL result cache | page HTML cache 優先化 |
| 6 | P8 | 待規劃 | report diff / cache / scan state 上的增量掃描 | 跳過 HTML inventory 發現的新 URL |
| 7 | P9 | 待規劃 | Analyzer / GUI 大型報告、profile、rules schema、Next.js payload | 空 UI 或未落地的展示層 |
| 8 | P10 | 待規劃 | 治理與分級排程、WAF 協調建議、`--respect-robots` | 常駐 scheduler 優先化 |
| 9 | P11 | 待規劃 | 輔助格式、release / packaging governance | 早於核心契約與誤判降低 |

## 已完成基線

P0-P5.5 詳細設計與驗收紀錄已移至 [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)。

- P0：portable / exe 模式 idle shutdown、browser heartbeat、手動 shutdown。
- P1：`checkedAt`、`canonicalUrl`、cache headers、CDN/WAF/Bot 診斷欄位。
- P2：`safe|moderate|aggressive` canonical strategy 與 canonical key integration。
- P3：URL inventory、來源合併、validation intent、validation queue。
- P4：同站 `404 / 410` 二次確認，輸出 `confirmation`、`transientFailure`、`needsReview`。
- P5：`externalRisk`、治理規則、CSV / summary 與 Analyzer 最小呈現。
- P5.5a：SPA / Nuxt 偵測、`scanQuality`、strict payload URL/path literal 抽取與 `sourceType`。
- P5.5b：`--site-link-rules`、CEC 規則範例、CMS 欄位推導與 `site_rule_derived`。
- P5.5c：內容/外連/文件/媒體/asset 分流統計與簡易 validation priority。
- P6：`report-diff.mjs` 第一版，支援 URL、external risk 與 summary diagnostics 的 report-to-report diff，並以 5 組 fixtures 驗收。
- P6.5a-1：scan report `schemaVersion` / `generator`、`schemas/report.schema.json`、CLI / GUI `manifest.json`。
- P6.5a-2：輸出層 sensitive query redaction，套用於 report、CSV、events log、manifest 與 GUI 保存檔。
- P6.5a-3：`maxSourcesPerUrl`、`sourcesTruncated`、`bodyBytesRead` / `bodyTruncated` 與 body byte limit。
- P6.5a-4：Accept header 分流、gzip / deflate、`--no-keep-alive` 與 per-host concurrency 驗證。
- Packaging 小修：portable 打包流程已在 `build-portable.ps1` 中加入本機自簽 Authenticode 步驟，並匯出 `LinkChecker-local-code-signing.cer` 供內部手動信任匯入；此為 local self-signed，不等同正式公開信任 code signing。

## 全域原則

### 掃描邊界

- 保留現有 `extractLinks()`，不要重寫成完整 DOM parser。
- SPA payload extraction 以低成本、可回退為原則。
- 站台特定欄位透過 `--site-link-rules`，不硬寫在核心 crawler。
- Headless render 只作 opt-in fallback，不預設啟用。
- `report.json` 是正式主契約；NDJSON 只能作大型報告輔助輸出，不取代主格式。
- P6 只讀既有 report，不重新掃描、不重新判斷風險、不引入資料庫、不導入 cache 或 incremental scan。

### 安全與合規

- CDN/WAF/Bot 處理定位是辨識、降誤報、節流、保存證據與提示人工協調，不做繞過防護。
- robots.txt、授權掃描與 compliance 只能記錄工具行為與使用者宣告，不代表工具驗證授權。
- 本機工具也需有安全邊界；預設不得請求 localhost、metadata IP、private IP 或 blocked scheme，除非明確開啟相容模式。
- report、CSV 與 logs 應避免輸出敏感 query value；實際 request 與 canonical key 的處理需和顯示遮罩分層。

### 輸出與版本

- 日常輸出檔名保持穩定，避免腳本、GUI 與使用者流程每次都要追新檔名。
- 版本資訊放在 JSON 內容與每次輸出的 `manifest.json`。只有 release / package 產物才採檔名版本化。
- CSV 不新增每列版本欄位；需要追溯工具、schema、runtime 與輸出清單時，以同目錄 manifest 為準。
- `diff.json` 與 scan report 都已輸出 `schemaVersion` / `generator`；版本追溯以內容欄位與 `manifest.json` 為準。

## 採納決策與落點

### v5.1 採納

| 建議 | 決策 | 落點 |
| --- | --- | --- |
| P6 純 report diff | 採納 | P6 只讀兩份既有 report 並輸出 diff，不改掃描行為。 |
| P6.5 拆成 P6.5a / P6.5b | 採納 | 低風險穩定性與語意性改動分開。 |
| Stage 0 小修 | 採納但不得拖住 P6 | 只限文件、CSV BOM、GUI/CLI 落差提示、sources 顯示。 |
| `schemaVersion` / `generator` | 採納 | P6.5a；`report-diff.mjs` 必須能讀沒有 schemaVersion 的舊 report。 |
| robots.txt 與 `--authorized-scan` | 採納但保守 | P6.5b；只記錄宣告與工具策略，不替使用者斷言授權。 |
| Keep-Alive | 採納但需驗證 | P6.5a；不得突破 global / per-host concurrency。 |
| Accept / Accept-Encoding 分流 | 採納 | P6.5a；`br` 需確認 client 支援後再啟用。 |
| bodyHash diagnostics opt-in | 需調整現況 | P6.5b；避免正式 report 預設保存內容指紋。 |
| Bloom Filter、NDJSON 主格式、自動 adaptive backoff | 暫不採用 | 只能作後續 opt-in 或輔助功能。 |

### v5.2 採納

| 建議 | 決策 | 落點 |
| --- | --- | --- |
| SSRF / private IP / metadata IP 防護 | 採納，高優先 | P6.5b；request 前 DNS resolve 後檢查，redirect 後也套用。 |
| URL query redaction | 採納，高優先 | P6.5a；report、CSV、logs 預設遮罩高風險 query value。 |
| Response size / body preview / download probe limit | 採納，高優先 | P6.5a；避免大型 response 完整讀入記憶體。 |
| Partial report / runStatus | 採納，中高優先 | P6.5b；停止、中斷、錯誤都需明確標記 partial。 |
| Golden fixtures 與 regression tests | 採納，高優先 | P6 前置；支援 diff 開發，不改掃描行為。 |
| JSON Schema / TypeScript 型別 | 採納，高優先 | P6 前置與 P6.5a；先建立 report / diff schema 草案。 |
| Retry-After / host cooldown | 採納但保持基礎版 | P6.5b 或 P7 前置；不等同完整 adaptive backoff。 |
| Rules schema / rulesVersion / 載入安全 | 採納，中優先 | P9；HTTP 載入規則檔同樣套 SSRF 防護。 |
| Profile 與 configured/effective values | 採納，中優先 | P9；profile 展開結果寫入 `report.options`。 |
| 產出檔版本策略 | 採納，高優先 | P6.5a；穩定檔名、內容版本化、每次輸出建立 manifest。 |
| SBOM、dependency audit、正式 code signing | 後續評估 | P11 release / packaging；local self-signed portable launcher 已先以 packaging 小修完成。 |

### 落點修正

v5.2 提到 Stage 0 可含 Header、Keep-Alive、sources 上限、body 釋放；本專案維持 Stage 0 只放文件與輸出相容性小修。Header、Keep-Alive、response size limit、redaction、source truncate 放 P6.5a；SSRF、Retry-After、partial report、robots / compliance 放 P6.5b。

## 近期工作

### Stage 0

狀態：文件與輸出相容性小修已收斂；後續若發現新的 GUI/CLI 落差，再以小修補齊。Stage 0 不得改變掃描語意、report 主契約或 P6 範圍。

已處理：

1. README 已補 GUI/CLI 功能差異、WAF/robots/人工確認限制與多網站監看提示。
2. GUI 自動輸出的 `broken.csv`、`external-links.csv` 已包含 UTF-8 BOM，方便 Excel 直接開啟中文。
3. README 已用 GUI/CLI 差異表標示 CLI 已有但 GUI 尚未提供的選項，例如 `--external-risk-rules`、`--site-link-rules`、`--spa-links`。
4. README 已說明 `sourceCount` / `sourcesTruncated` 語意；輸出 sources 上限已在 P6.5a-3 完成。

Stage 0 不得納入 `schemaVersion`、robots.txt、compliance、Keep-Alive、cache、incremental scan，也不得改變 `checked[]`、`broken[]`、`externalLinks[]` 既有欄位語意。

### P6 前置

這些項目支援 P6 開發，不改掃描行為：

已處理：

1. 建立 `fixtures/reports/` golden cases：`404 -> 200`、`200 -> 404`、`needs_review -> confirmed_missing`、`externalRisk low -> high`、`scanQuality suspicious -> ok`。
2. 建立 `schemas/diff.schema.json` 草案，約束 P6 diff 輸出必要欄位。
3. 建立 [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md)：優先 `checked[]`，舊 report fallback `broken[]`，外連使用 `externalLinks[]`。

結果：前置項目已支援並完成 P6 第一版；現行 regression runner 以 `fixtures/reports/index.json` 驗證 5 組 expected signals。原始進入 P6 評估保留於 [docs/P6_PREFLIGHT_ASSESSMENT.md](docs/P6_PREFLIGHT_ASSESSMENT.md)。

## P6：Report-to-Report Diff

狀態：第一版已完成。

實作分析已記錄於 [docs/P6_IMPLEMENTATION_ANALYSIS.md](docs/P6_IMPLEMENTATION_ANALYSIS.md)。

交付項：

1. `report-diff.mjs` CLI：`old-report.json` + `new-report.json` -> `diff.json`。
2. Report normalization：新 report 優先 `checked[]`，舊 report fallback `broken[]`，外連獨立使用 `externalLinks[]`。
3. URL diff summary：新增、移除、變更、新發生問題、已修復、持續存在。
4. P4/P5 欄位 diff：`confirmation.outcome`、`confirmationNeedsReview`、`transientFailure`、`externalRisk.riskLevel`、`externalRisk.governanceStatus`、`externalRisk.riskReasons`、`externalRisk.matchedRules`、`externalRisk.needsReview`。
5. P5.5 diagnostics diff：`scanQuality`、`spaDetection` 與 `checkedByKind` 摘要變化。
6. JSON 輸出與簡短 console summary；GUI / Analyzer 呈現放 P9。

比對 key：

- 優先使用 `canonicalUrl`。
- 缺欄位時 fallback 到 `url`，以支援舊 report。
- `needsReview` 在 P4/P5 語意不同，呈現時拆成 `confirmationNeedsReview` 與 `externalRiskNeedsReview`。

第一版比較欄位：

- `ok`
- `status`
- `issueType`
- `classification`
- `finalUrl`
- `redirected`
- `redirectCount`
- `redirectType`
- `redirectIssues`
- `confirmation.outcome`
- `confirmationNeedsReview`
- `transientFailure`
- `externalRisk.riskLevel`
- `externalRisk.governanceStatus`
- `externalRisk.riskReasons`
- `externalRisk.matchedRules`
- `externalRisk.needsReview`

第一版 summary diagnostics：

- `summary.scanQuality.status`
- `summary.scanQuality.warnings`
- `summary.scanQuality.assetRatio`
- `summary.scanQuality.nuxtAssetRatio`
- `summary.checkedByKind`
- `summary.spaDetection.detected`
- `summary.spaDetection.framework`
- `summary.spaDetection.signals`

狀態判定：

- `newIssue`
- `resolvedIssue`
- `persistentIssue`
- `changed`
- `riskIncreased`
- `riskDecreased`
- `confidenceIncreased`
- `confidenceDecreased`

驗收：

- 同一 canonical URL 從 `404` 變 `200` 應標示已修復。
- 同一 canonical URL 從 `200` 變 `404/410` 應標示新發生問題。
- `confirmation.outcome` 從 `needs_review` 變 `confirmed_missing` 應標示信心提高。
- 外連風險從 `low` 變 `high` 應進入治理摘要。
- `scanQuality` 從 `suspicious` 變 `ok` 或 warning 消失時，應在 diagnostics summary 顯示掃描品質改善。
- 來源頁移除但 URL 仍在其他頁存在時，不應誤判 URL 完全移除。
- 讀到 partial report 時，diff 應顯示 warning；P6 不需產生 partial report，但需能辨識後續 schema。

細分實作順序：

1. P6.1 CLI skeleton：已完成。新增 `report-diff.mjs`，支援 `old-report.json`、`new-report.json`、`--output diff.json`、`--help`，先輸出空的合法 root shape，不做實際 diff。
2. P6.2 Report loading / normalization：已完成。實作 `readReport()` 與 `normalizeReport()`，支援 legacy report warning、UTF-8 BOM JSON、`checked[]`、`broken[]` fallback、`externalLinks[]`、duplicate key warning 與 diagnostics extraction。
3. P6.3 Fixture regression runner：已完成。新增 `test-report-diff.mjs`，用 `fixtures/reports/index.json` 跑 5 組 golden cases；檢查 CLI 可輸出、warnings 合理、root required fields、change item shape、summary counts 與所有 expected signals。
4. P6.4 URL diff：已完成。實作 `added`、`removed`、`changed`、`newIssue`、`resolvedIssue`、`persistentIssue`、`confidenceIncreased`、`confidenceDecreased`；驗收 `404-to-200`、`200-to-404`、`needs-review-to-confirmed-missing`。
5. P6.5 External diff：已完成。實作 `externalChanges`、`riskIncreased`、`riskDecreased`；以 `info < low < medium < high` 判斷風險升降，risk 缺少時才 fallback governance order；驗收 `external-risk-low-to-high`。
6. P6.6 Diagnostics diff：已完成。只比較既有 `summary.scanQuality`、`summary.spaDetection`、`summary.checkedByKind`，不重新計算、不回頭掃描。
7. P6.7 Schema alignment / output polish：已完成。對齊 `schemas/diff.schema.json`，補 summary counts、deterministic ordering、console summary，並加入最低限度 required-field assertions；暫不引入外部 JSON Schema validator。
8. P6.8 README / Roadmap update：已完成。README 加 P6 使用方式；Roadmap 更新 P6 第一版完成狀態與後續限制。

實作與驗證：

- `report-diff.mjs`：CLI、normalization 與 diff implementation。
- `test-report-diff.mjs`：fixture regression runner。
- `fixtures/reports/index.json`：5 組 expected signals。
- `schemas/diff.schema.json`：第一版 diff output contract。

不納入 P6：

- TTL cache、incremental scan、sitemap lastmod。
- robots path enforcement、`--authorized-scan`、`--respect-robots`。
- NDJSON 主格式、Bloom Filter、headless render。
- 自動 adaptive backoff 或任何會改變掃描結果來源的策略。

## P6.5a：低風險穩定性修補

狀態：已完成；P6.5a-1、P6.5a-2、P6.5a-3、P6.5a-4 均已完成。此階段改善輸出相容性與網路層穩定性，但不引入 robots / compliance 語意。

實作前評估見 [docs/P6_5A_ASSESSMENT.md](docs/P6_5A_ASSESSMENT.md)。執行時需拆成契約/manifest、redaction/CSV、sources/body limit、Header/Keep-Alive 四批；不得一次混合所有交付項。

已完成：

1. `schemaVersion` / `generator`：scan report root 已新增欄位；舊 report 仍視為 legacy / `1.0.0`。
2. `schemas/report.schema.json` 草案：已約束 root、options、summary、checked、broken、externalLinks 的最低契約。
3. 產出檔版本策略：`report.json`、`summary.json`、`external-summary.json`、`diff.json` 以內容欄位記錄 schema / generator；日常檔名不加版本號。
4. `manifest.json`：CLI / GUI 每次輸出已記錄 `toolVersion`、`schemaVersions`、`generatedAt`、`startUrl`、`optionsProfile`、`runtimeVersion` 與 generated files。
5. URL query redaction：report、CSV、events log、manifest 與 GUI 保存檔預設遮罩高風險 query value；實際 request 不受遮罩影響。
6. CSV BOM 回歸測試：維持 `broken.csv`、`external-links.csv` 可用 Excel 直接開啟中文。
7. `maxSourcesPerUrl`：輸出保留有限來源，並輸出完整 `sourceCount` 與 `sourcesTruncated`。
8. Response size limit：加入 `maxHtmlBytes`、`maxBodyPreviewBytes`、`maxDownloadProbeBytes`，並輸出 `bodyTruncated` / `bodyBytesRead`。
9. response body 及早釋放：抽取、診斷或 probe 完成後不保留完整 body。
10. Accept header 分流：page-like 使用 document request Accept，asset/media/document 使用 `*/*`。
11. Accept-Encoding：實測並啟用 `gzip` / `deflate`，暫不啟用 `br`。
12. Keep-Alive connection pool：受 global concurrency 與 per-host concurrency 約束，提供 `--no-keep-alive` 回退，並記錄 effective 設定。

驗收：

- 啟用 Accept-Encoding 後，壓縮 HTML 仍可正常抽取連結。
- 啟用 Keep-Alive 後，同一 host in-flight request 不超過 `perHostConcurrency`。

## P6.5b：稽查語意與誤判降低

狀態：進行中；P6.5b-1 與 P6.5b-2 已完成。實作前評估見 [docs/P6_5B_ASSESSMENT.md](docs/P6_5B_ASSESSMENT.md)。此階段會新增 report 語意、掃描安全邊界與合規紀錄，需同步更新 CLI、GUI 顯示與 Analyzer fallback。

建議切分：

1. P6.5b-1 SSRF / URL security policy：已完成；預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與 blocked scheme；request 前 DNS resolve 後檢查，redirect 後也重新檢查。
2. P6.5b-2 `runStatus` / partial report：已完成；GUI stop、queue stop、執行期錯誤會標記 `partial`、`stoppedByUser` 或 `failed`，且 Analyzer / diff 會提示非完整結果。
3. P6.5b-3 robots / compliance 記錄：`summary.robotsTxt`、`scanPolicy`、`compliance` root 欄位、`--authorized-scan` / `--authorization-note` / `--no-robots`；只記錄使用者宣告與工具策略，不驗證授權。
4. P6.5b-4 Retry-After / host diagnostics：尊重 429 / 503 的 `Retry-After`，但設定等待上限，且不阻塞其他 host；提供高 403 / 429 / suspected WAF 比例提示。
5. P6.5b-5 WAF signature schema 收斂：保存 provider、header evidence、body signature rule id，不保存完整 body；bodyHash 預設關閉，僅 diagnostics opt-in 可啟用。

驗收：

- robots.txt 不存在或讀取失敗時，掃描不中斷且 report 有明確 `scanPolicy`。
- `http://127.0.0.1`、`http://localhost`、`http://169.254.169.254` 預設不請求。
- public hostname 解析到 private IP 時預設不請求；`--allow-localhost` 不得自動允許所有 private IP，`--allow-private-ip` 也不得自動允許 localhost。
- redirect 到 private IP、metadata IP 或 blocked scheme 時停止 follow 並標記 security issue。
- 429 / 503 的 `Retry-After` 不得讓掃描長時間卡住，也不得阻塞其他 host。
- GUI stop 後保存 partial report，且不得被 Analyzer / diff 誤判為完整結果。（P6.5b-2 已完成）
- 全站 Disallow 且無 Crawl-delay 時，最低降頻為 `effectiveDelayMs >= 2000`、`effectivePerHostConcurrency <= 1`。
- 未帶 `--authorized-scan` 時，report 不得宣稱已授權。
- external host 不套用同站授權 override 語意。
- WAF body signature 命中時，不應被歸入一般 404。
- `bodyHashEnabled=false` 必須是預設。

## P7：TTL 檢查快取

狀態：P6 與必要的 P6.5 穩定性修補後實作。P7 只處理可驗證的 URL result 快取，不先處理 page HTML cache。

建議 cache file：

```text
.cache/link-check-cache.json
```

cache key 應包含：

- `canonicalUrl`
- method policy
- userAgent hash
- accept language
- referer mode
- robots policy

cache value 應包含：

- result
- checkedAt
- expiresAt
- stableCount
- lastStatus
- lastFinalUrl

TTL 原則：

- 穩定 `200/204/3xx`：24 小時到 7 天。
- `404/410`：6 到 24 小時。
- `429/502/503/504/timeout`：5 到 30 分鐘。
- `blocked_waf/blocked_bot/rate_limited`：短 TTL 或不快取。
- `access_denied/auth_required`：短 TTL 或依站點規則決定是否快取。

CLI 可新增：

- `--cache`
- `--cache-file <file>`
- `--cache-ttl-hours <n>`
- `--no-cache`
- `--refresh-cache`

驗收：

- 相同 canonical key、method policy、UA hash、語言與 referer mode 時可命中 cache。
- `404/410` 快取 TTL 應短於穩定 `200/204/3xx`。
- `429/timeout/5xx` 應短 TTL，避免長時間保留暫時性失敗。
- `--refresh-cache` 應忽略既有 cache 並回寫新結果。
- report summary 顯示 cache hit / miss / expired / refreshed。

## P8：增量掃描

狀態：P6/P7 後實作。P8 依賴 report diff、scan state 與 TTL cache，不應提前做。

scan state 草案：

```js
{
  pages: {
    pageUrl: {
      contentHash,
      links: []
    }
  },
  urls: {
    canonicalUrl: {
      sources,
      sourceCount,
      firstSeenAt,
      lastSeenAt,
      lastCheckedAt
    }
  }
}
```

行為：

- 優先檢查新頁面。
- 優先檢查 HTML hash 改變的頁面。
- 優先檢查新出現的 URL。
- 優先檢查上次錯誤或 retryable 的 URL。
- 跳過 TTL 未過期且穩定的 URL。
- sitemap lastmod 只影響排序，不排除 HTML inventory 發現的 URL。

CLI 可新增：

- `--incremental`
- `--state-file <file>`
- `--changed-only`
- `--sitemap <url-or-file>`

驗收：

- 新頁面與 hash 改變頁面應被優先掃描。
- 未變更頁面中的穩定 URL 若 TTL 未過期，應可跳過。
- 上次為 `needs_review`、timeout、redirect error 或 high risk 的 URL 應優先複查。
- changed-only 模式仍保留完整 summary，不只輸出 delta。

## P9：Analyzer / GUI 大型報告

狀態：P6/P7/P8 後實作。P9 強化呈現、profile 與規則治理，不先做空 UI。

交付項：

- 顯示歷史比對：新增、移除、修復、惡化、持續存在。
- 顯示 cache 命中、TTL、上次檢查時間。
- 顯示高重複引用 URL 與影響頁面數。
- 顯示 redirect chain 詳細資訊。
- 大型 report 讀取：Analyzer 改用 stream-json 類策略逐筆處理 `checked[]`，避免全量載入。
- NDJSON 輔助輸出：可新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`，但不得取代 `report.json`。
- GUI 分頁：大型 report 不一次載入所有 rows。
- GUI profile：`normal`、`government-conservative`、`large-site`、`spa`、`external-governance`。
- 顯示 configured values 與 robots / Retry-After 後的 effective values。
- 規則檔驗證：`domain-rules`、`external-risk-rules`、`site-link-rules` 加入 schema 與 `rulesVersion`。
- 更多 framework payload：補 Next.js `__NEXT_DATA__` 抽取。

## P10：治理與分級排程

狀態：P9 後設計。先做排程建議，不急著做完整常駐 scheduler。

每個 URL 或 page 可計算：

```js
{
  priority: "high" | "normal" | "low",
  suggestedIntervalHours,
  reason
}
```

建議規則：

- 首頁、導覽列、站內頁：高頻。
- 站內圖片、CSS、JS：中頻。
- 外部連結：低頻。
- 上次錯誤、redirect error、timeout：高頻複查。
- `429` 或疑似 WAF/Bot 擋下：降低併發、延長 delay，避免密集重試。
- WAF 白名單建議：依 suspectedWaf host 產生需協調清單，不自動繞過。
- `--respect-robots` path enforcement：嚴格遵守 Disallow 的模式放在 P10 或後續，不混入 P6.5 預設策略。
- 外部站可加入每網域每分鐘與每路徑每分鐘限制；這應建立在 P7/P8 的快取與狀態資料後。
- 穩定 200 多次：降低頻率。

## P11：輔助功能與 Release

狀態：P10 後評估。這些功能有價值，但優先度低於誤判降低、資料模型、外連治理、歷史比對與快取。

交付項：

- HTML / Excel 報表輸出。
- 環境變數設定。
- 更多匯入/匯出格式。
- Portable package manifest。
- Node runtime version 記錄。
- Release / portable package 檔名可帶版本號，並在 package manifest 記錄工具版本、Node runtime version、checksum 與 build metadata。
- Package smoke test。
- Dependency audit。
- License summary。
- SBOM。
- 正式公開信任簽章與 checksum 評估；local self-signed launcher signing 已在 portable build 流程中完成，P11 仍需評估 OV/EV 或代管簽章與 release checksum 策略。

## 細部規格索引

以下項目已採納但不在 Roadmap 主文展開成完整規格。實作前需回填到 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)、schema 或專門設計文件。

| 類別 | 細項 | 落點 |
| --- | --- | --- |
| schema version | `1.0.0` 舊 report、`1.1.0` 新增 `schemaVersion` / `generator` / redaction / body limit / `sourcesTruncated`、`1.2.0` 新增 `securityPolicy` 與 `runStatus`，後續擴充 robots / compliance / protection 結構 | P6.5a / P6.5b |
| output versioning | 日常輸出檔名穩定；`report.json`、`summary.json`、`external-summary.json`、`diff.json` 使用內容版本欄位；CSV 不新增版本欄位 | P6.5a |
| output manifest | 每次輸出建立 `manifest.json`，記錄 `toolVersion`、`schemaVersions`、`generatedAt`、`startUrl`、`optionsProfile`、`runtimeVersion`、generated files | P6.5a |
| normalization | `load report -> detect schemaVersion -> normalize to internal ReportModel`，避免 GUI / Analyzer 散落 fallback 邏輯 | P6 / P9 |
| robots schema | `summary.robotsTxt` 保留 start origin 語意；未來擴充 `externalRobotsTxt` 或 `robotsTxtByScope` | P6.5b |
| scanPolicy | `robots_compliant`、`robots_not_found`、`robots_fetch_error`、`robots_override_authorized`、`robots_disallow_override_without_declaration`、`robots_respected_path_skip`、`robots_disabled` | P6.5b |
| compliance scope | `same_origin`、`same_site`、`same_origin_with_external_validation`、`mixed`、`unknown` | P6.5b |
| security CLI | `--block-private-ip` 預設開啟、`--allow-private-ip`、`--allow-localhost`、metadata IP 永遠阻擋 | P6.5b |
| redaction CLI | `--redact-sensitive-query` 預設開啟、`--no-redact-sensitive-query`、`--redact-query-keys <list>` | P6.5a |
| body / source limit CLI | `--max-html-bytes`、`--max-body-preview-bytes`、`--max-download-probe-bytes`、`--max-sources-per-url` | P6.5a |
| keep-alive CLI | `--no-keep-alive`，並記錄 `keepAlive`、`maxSockets`、`maxFreeSockets`、`keepAliveMsecs` | P6.5a |
| report fields | `securityPolicy`、`redaction`、`bodyLimits`、`runStatus`、`hostDiagnostics`、`rulesVersion`、`profileExpandedOptions` | P6.5 / P9 |
| redirect security labels | `scheme_downgrade_redirect`、`redirect_to_private_ip`、`redirect_to_blocked_scheme`、`redirect_to_metadata_ip` | P6.5b |
| DNS / TLS issue types | `dns_not_found`、`connection_refused`、`timeout`、`tls_error`、`tls_cert_expired` | P6.5b |
| IDN / IPv6 | canonical 比對使用 normalized hostname；security policy 需支援 punycode、`[::1]`、IPv6 unique local / link-local 判斷 | P6.5b |
| fixtures | `fixtures/reports`、`fixtures/robots`、`fixtures/waf`、`fixtures/html`、`fixtures/csv`；避免只用 snapshot，重要欄位逐欄 assertion | P6 前置 / P6.5 |
| types | `types/report.d.ts`、`types/diff.d.ts`、`types/rules.d.ts` 與 JSON Schema 同步維護 | P6.5a / P9 |
| rules governance | `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json`；支援 `rulesVersion`、`name`、`updatedAt` | P9 |
| profiles | `normal`、`government-conservative`、`large-site`、`spa`、`external-governance`；CLI explicit option 可覆蓋 profile default | P9 |
| release | portable package manifest、Node runtime version、package smoke test、dependency audit、license summary、SBOM、正式 checksum / signing 評估；local self-signed portable launcher signing 已完成 | P11 |

## 暫不納入近期主線

- 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用既有 `--system-ca` 與 `--legacy-tls`。
- 不先導入 AI 分類、動態 JS 渲染、PostgreSQL、server-client 或 eGov 登入。
- 不做泛用 404 重試；404 二次確認應採條件式策略，避免拖慢整體掃描。
- 不以追蹤瀏覽器 process 作為關閉服務的主要機制；`Process.Start(url)` 無法可靠代表使用者是否仍開著該頁籤。
- 不把單機版改成常駐 Windows Service；目前需求是可預期地收尾本機工具，而不是背景服務化。
- 不預設啟用 aggressive URL canonicalization 作為去重、cache 或 validation key；避免把實際不同的資源錯誤合併。
- 不做輪換 User-Agent、偽裝 Googlebot、代理 IP 輪換、解 CAPTCHA、模擬真人互動或其他繞過 WAF/Bot 防護的策略。
- 不把 `200` 且 body 過短單獨判定為 `suspected_false_positive`；必須搭配 content-type、標頭、title 或 challenge pattern。
- 不對明確 WAF/Bot challenge 做多次 aggressive retry；這類結果應保存證據並提示調整掃描策略或與站方協調。
- 不保存完整 response body 作為診斷欄位，避免報告包含登入頁、錯誤頁或防護頁中的敏感內容。
- Bloom Filter 不作為預設去重；如未來支援，只能在大型站 opt-in 並標明 false positive risk。
- 不預設替日常輸出檔名加版本號，避免腳本、GUI 與使用者流程每次都要追新檔名。
- 不在 CSV 每列加入 schema / app version；CSV 維持資料交換用途，版本追溯交給 manifest。
