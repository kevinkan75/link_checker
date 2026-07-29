# P6 Report Diff and Contract Assessment

This merged archive document consolidates the P6 report diff preflight, implementation analysis, and P6.5a/P6.5b contract, security, reliability, and compliance assessments. The original standalone files were merged to reduce archive fragmentation while preserving their content history.

Merged source scope:

- P6 report diff preflight assessment
- P6 report-to-report diff implementation analysis
- P6.5a output contract, manifest, redaction, body/source limit, and header handling assessment
- P6.5b SSRF, partial report, robots/compliance, Retry-After, and WAF schema assessment

---

## P6 Preflight Assessment

狀態：歷史前置評估。P6 已完成；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，P6 實作分析已併入本文後續章節。

評估日期：2026-06-21

### 結論

P6 前置三項已完成，完成度約 85-90%，足以進入 P6 `report-diff.mjs` 實作。

目前已具備：

- Golden report fixtures。
- `diff.json` schema 草案。
- Report normalization 原則文件。

主要剩餘風險是尚未接上自動化 regression test，也尚未用正式 JSON Schema validator 驗證 sample output。這些不阻塞 P6 開始實作，但應在 P6 實作期間補齊。

### 項目評估

| 項目 | 狀態 | 完成度 | 評估 |
| --- | --- | ---: | --- |
| Golden fixtures | 已完成 | 90% | `fixtures/reports/` 已有 4 組 old/new report pairs、`index.json` 與 README，且所有 JSON 可解析。 |
| Diff schema 草案 | 已完成 | 85% | `schemas/diff.schema.json` 已定義 P6 diff root、summary、URL 變更、外連變更、診斷變更與 warnings。 |
| Report normalization 原則 | 已完成 | 95% | `docs/REPORT_NORMALIZATION.md` 已固定 `checked[]`、`broken[]` fallback、`externalLinks[]` 與 match key 規則。 |

### 已驗證

- `fixtures/reports/*.json` 全部可成功解析。
- `schemas/diff.schema.json` 可成功解析。
- `fixtures/reports/index.json` 記錄 4 組預期 diff signal。
- Roadmap 已將三項 P6 前置標為已處理。

### 尚未完成但不阻塞

- 尚未建立 P6 regression test runner。
- 尚未對 fixture 做逐欄 assertion。
- 尚未用正式 JSON Schema validator 驗證實際 `diff.json` sample output。
- 尚未實作 `report-diff.mjs`。

### 進入 P6 的建議

P6 可以開始實作，建議順序：

1. 實作 report normalization function，依 [../REPORT_NORMALIZATION.md](../REPORT_NORMALIZATION.md) 產生內部 `urlsByKey`、`externalByKey` 與 diagnostics。
2. 用 `fixtures/reports/index.json` 驅動最小 regression test。
3. 實作 diff summary 與 `urlChanges`。
4. 補上 `externalChanges` 與 `diagnosticsChanges`。
5. 產出符合 `schemas/diff.schema.json` 的 `diff.json`。

---

## P6 Implementation Analysis

狀態：歷史實作分析。P6 report-to-report diff 已完成；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，Report normalization 原則請看 [../REPORT_NORMALIZATION.md](../REPORT_NORMALIZATION.md)。

記錄日期：2026-06-21

### 結論

P6 可以開始實作。第一版應聚焦在 CLI、report normalization、diff generation 與 fixtures regression，不碰 GUI / Analyzer，也不改掃描流程。

P6 的核心是純 report-to-report diff：讀兩份既有 `report.json`，產生 `diff.json`。它不重新掃描網站、不重新判斷風險、不導入 cache、incremental scan、robots enforcement 或 adaptive backoff。

### 輸入與輸出

建議 CLI 形式：

```powershell
node .\report-diff.mjs old-report.json new-report.json --output diff.json
```

必要輸入：

- `old-report.json`
- `new-report.json`

必要輸出：

- `diff.json`，shape 依 [../../schemas/diff.schema.json](../../schemas/diff.schema.json)。
- 簡短 console summary，方便 CLI 使用者快速判讀。

### 前置狀態

P6 前置已足夠支援實作：

- `fixtures/reports/`：已有 4 組 golden cases。
- `schemas/diff.schema.json`：已有 diff schema 草案。
- `docs/REPORT_NORMALIZATION.md`：已有 normalization 原則。
- 本文件前段的 P6 preflight 章節：已記錄完成度與剩餘風險。

### 建議實作切分

#### 1. `readReport(path)`

職責：

- 讀取 JSON。
- 保留 `startedAt`、`startUrl`、`schemaVersion`、`summary`。
- 沒有 `schemaVersion` 時加入 `legacy_report` warning。
- JSON 解析失敗時以 CLI error 結束，不輸出不完整 diff。

#### 2. `normalizeReport(report, path)`

職責：

- 依 [../REPORT_NORMALIZATION.md](../REPORT_NORMALIZATION.md) 產生內部 normalized report。
- URL 結果優先使用 `checked[]`。
- 缺少 `checked[]` 時 fallback 到 `broken[]`。
- `externalLinks[]` 獨立建立 `externalByKey`。
- match key 優先 `canonicalUrl`，再 fallback `url`。

Normalization 不應重新 canonicalize URL，也不應重新推導風險。

#### 3. `diffUrls(old.urlsByKey, new.urlsByKey)`

職責：

- 產生 `urlChanges`。
- 判斷 `added`、`removed`、`changed`。
- 判斷 `newIssue`、`resolvedIssue`、`persistentIssue`。
- 判斷 `confidenceIncreased`、`confidenceDecreased`。

第一版 URL 比較欄位以 `REPORT_NORMALIZATION.md` 的 Field Comparison 為準。

#### 4. `diffExternal(old.externalByKey, new.externalByKey)`

職責：

- 產生 `externalChanges`。
- 判斷 `added`、`removed`、`changed`。
- 判斷 `riskIncreased`、`riskDecreased`。

Risk order：

```text
info < low < medium < high
```

若 `riskLevel` 缺少，才用 governance status 的保守排序：

```text
allowed < unknown < watchlisted < needs_review < blocked
```

#### 5. `diffDiagnostics(old.diagnostics, new.diagnostics)`

職責：

- 比較 `summary.scanQuality`。
- 比較 `summary.spaDetection`。
- 比較 `summary.checkedByKind`。
- 產生 `diagnosticsChanges`。

P6 只比較既有 summary，不重新計算掃描品質。

#### 6. `buildSummary(diff)`

職責：

- 匯總 schema 要求的 counts。
- 保持 `summary` 欄位名稱與 `schemas/diff.schema.json` 一致。
- 彙整 normalization 與 diff 過程中的 warnings。

### 第一版驗收

使用 `fixtures/reports/index.json` 驗證：

| Fixture | 預期 |
| --- | --- |
| `404-to-200` | `resolvedIssue` |
| `200-to-404` | `newIssue` |
| `needs-review-to-confirmed-missing` | `confidenceIncreased` |
| `external-risk-low-to-high` | `riskIncreased` |

第一版 regression test 至少應檢查：

- CLI 可以產生 `diff.json`。
- 每組 fixture 的預期 signal 存在。
- `diff.json` root 欄位符合 schema 草案的 required fields。
- legacy report 不因缺少 `schemaVersion` 失敗。

### 邊界

P6 不做：

- 不改 `link-checker.mjs`。
- 不改 scan report 格式。
- 不重新送 HTTP request。
- 不重新 canonicalize URL。
- 不把 `broken[]` 與 `checked[]` 合併成新 report。
- 不把外連治理結果回寫到 `checked[]`。
- 不做 GUI / Analyzer 呈現。
- 不導入 TTL cache、incremental scan、robots enforcement 或 adaptive backoff。

### 主要風險

1. `needsReview` 語意混淆  
   P4 confirmation 與 P5 external risk 都可能使用 review 語意。P6 必須拆成 `confirmationNeedsReview` 與 `externalRisk.needsReview`。

2. Legacy report 欄位不足  
   舊 report 可能只有 `broken[]`，沒有 `checked[]`。P6 需要 fallback，但不能推導不存在的欄位。

3. Duplicate key  
   同一 key 重複出現時，第一版採第一筆並輸出 `duplicate_key` warning，不嘗試合併。

4. Schema 尚未正式驗證 sample output  
   P6 實作時應補上最小 validator 或至少建立 deterministic sample assertion。

### 建議落地順序

1. 建立 `report-diff.mjs` CLI skeleton。
2. 實作 report loading 與 normalization。
3. 用 fixtures 建立最小 regression runner。
4. 實作 `urlChanges` 與 summary。
5. 補 `externalChanges`。
6. 補 `diagnosticsChanges`。
7. 對齊 `schemas/diff.schema.json`。
8. 更新 README 的 P6 使用方式。

---

## P6.5a Assessment

本文件原為 P6.5a 實作前評估，現已回填完成狀態；最新主線請以 [../../ROADMAP.md](../../ROADMAP.md) 為準。

本文件記錄 P6.5a 實作前評估。P6.5a 名義上是低風險穩定性修補，範圍不引入 robots / compliance 語意，也不改掃描結果來源；但實作會觸及 report 契約、輸出脫敏、response body 讀取與 connection pool，因此整體風險應視為中等，需拆小批次落地。

### 結論

採納 P6.5a 作為下一個主線，但不得一次合併所有交付項。建議拆成四個批次：

1. 契約與輸出版本化。
2. 輸出安全與相容性。
3. 來源數上限與 body limit。
4. Header / Accept-Encoding / Keep-Alive。

每批次都應保持日常輸出檔名穩定，並避免改變現有 URL discovery、canonical key、確認流程與外連治理判斷。

### 現況

- P6 diff 已有 `schemaVersion` / `generator`，且能把缺少 `schemaVersion` 的舊 report 視為 legacy。
- P6.5a-1 已讓 scan report root 加入 `schemaVersion` / `generator`。
- P6.5a-2 已加入輸出層 URL query redaction，預設套用於 report、CSV、events log、manifest 與 GUI 保存檔。
- P6.5a-3 已加入 `maxSourcesPerUrl` 與 body byte limit，避免 sources 與大型 response 無限制膨脹。
- P6.5a-4 已加入 Accept header 分流、`gzip` / `deflate`、`--no-keep-alive` 與 per-host concurrency 驗證。
- `schemas/` 目前已有 `diff.schema.json` 與 P6.5a-1 的 `report.schema.json` 草案。
- GUI 會保存 `summary.json`、`report.json`、`broken.csv`、`external-links.csv`、`external-summary.json`、`events.log`、`README.txt` 與 `manifest.json`。
- CSV 目前已輸出 UTF-8 BOM，P6.5a 需補回歸測試而非重做格式。
- response body 已有 capped reader；後續仍可依實測調整預設 bytes。

### 建議切分

#### P6.5a-1：契約與輸出版本化

狀態：已完成第一版。

交付：

- scan report root 已新增 `schemaVersion` / `generator`。
- 已新增 `schemas/report.schema.json` 草案，先約束 root、options、summary、checked、broken、externalLinks 的最低契約。
- CLI / GUI 已產出同目錄 `manifest.json`，記錄工具版本、schema versions、generatedAt、startUrl、optionsProfile、runtimeVersion 與 generated files。
- 保持 `report.json`、`summary.json`、`external-summary.json`、`diff.json` 檔名穩定。

驗收：

- 舊 report 仍可被 `report-diff.mjs` normalization 讀取。
- 新 report 可被 `report-diff.mjs` 讀取且不產生 legacy warning。
- GUI 與 CLI 產出的 manifest 欄位一致。
- `diff.json` 既有 schema / generator 行為不退化。

#### P6.5a-2：輸出安全與相容性

狀態：已完成第一版。

交付：

- 已建立集中式 URL query redaction helper。
- 預設遮罩 token、session、auth、password、email、jwt、signature、api_key 等高風險 query value。
- redaction 已套用於 report、CSV、events log、manifest 與 GUI 保存檔。
- 實際 request URL、canonical key 與比對邏輯不使用遮罩後 URL。
- 已補 CSV BOM 與 redaction 回歸測試。

驗收：

- report、CSV、events log 不輸出未遮罩的高風險 query value。
- 同一 URL 的實際請求與 canonicalization 不因 redaction 改變。
- Excel 可直接開啟 `broken.csv` 與 `external-links.csv` 中文內容。

#### P6.5a-3：sources 上限與 body limit

狀態：已完成第一版。

交付：

- 已新增 `maxSourcesPerUrl`，保留 `sourceCount`，超過上限時輸出 `sourcesTruncated=true`。
- 已新增 `maxHtmlBytes`、`maxBodyPreviewBytes`、`maxDownloadProbeBytes`。
- 超過上限時會輸出 `bodyTruncated` / `bodyBytesRead`。
- HTML 抽取、diagnostic body、download probe 已改成有 byte cap 的讀取路徑。
- response body 抽取或診斷完成後會及早釋放或取消。

驗收：

- 同一 canonical URL 來源超過上限時，`sourceCount` 保持完整數量，`sources` 只保留上限內資料，`sourcesTruncated=true`。
- 大型 HTML / PDF / media 不會被完整讀入記憶體。
- HTML 被截斷時 report 有明確 truncated 標記。
- WAF / Bot 診斷仍能使用 preview，不保存完整 body。

#### P6.5a-4：Header / Accept-Encoding / Keep-Alive

狀態：已完成第一版。

交付：

- Accept header 已依 request intent 分流：page-like 使用 document request Accept，asset/media/document 使用 `*/*`。
- Accept-Encoding 已啟用並測試 `gzip` / `deflate`；`br` 暫不啟用。
- Keep-Alive connection pool 受 global concurrency 與 per-host concurrency 約束。
- 已提供 `--no-keep-alive` 回退，並在 report options / manifest 記錄 effective 設定。

驗收：

- 壓縮 HTML 仍能正常抽取連結。
- 啟用 Keep-Alive 後，同一 host in-flight request 不超過 `perHostConcurrency`。
- `--no-keep-alive` 可回復非 keep-alive 行為。
- legacy TLS 路徑不因 keep-alive 或 encoding 改動失效。

### 風險評估

| 項目 | 風險 | 原因 | 控制方式 |
| --- | --- | --- | --- |
| report schema / generator | 低 | 主要是新增 root metadata | 保持舊欄位語意與 legacy fallback |
| manifest | 低 | 新增旁路輸出，不改 report 主體 | CLI / GUI 共用 manifest builder |
| CSV BOM | 低 | 現況已有 BOM | 補測試即可 |
| `maxSourcesPerUrl` | 中低 | 會改 `sources` 陣列長度 | 保留 `sourceCount` 與 `sourcesTruncated` |
| URL redaction | 中 | 容易誤傷 request URL 或 canonical key | 僅在輸出序列化層套用 |
| body limit | 中高 | 會改 fetch body 讀取路徑 | 先導入 capped reader 與 fixture server 測試 |
| Accept-Encoding | 中 | runtime 行為與 legacy TLS 路徑需驗證 | 先 gzip / deflate，br 延後或 gated |
| Keep-Alive | 中高 | 可能影響併發、釋放與 timeout | 保留 `--no-keep-alive`，測 per-host limit |

### 不納入 P6.5a

- robots path enforcement。
- `--authorized-scan` 與 compliance 語意。
- SSRF / private IP / metadata IP 防護。
- WAF signature schema 擴充。
- Retry-After / host cooldown。
- partial report / runStatus。
- TTL cache、incremental scan、NDJSON 主格式、Bloom Filter、headless render。

以上項目維持落在 P6.5b 或後續階段，避免 P6.5a 同時改變輸出契約、網路安全策略與掃描語意。

### 實作順序建議

1. 先做 `schemaVersion` / `generator` / `report.schema.json` / `manifest.json`，建立可追溯輸出基線。
2. 再做 redaction 與 CSV / events log 測試，確認敏感 query 不外洩且 request 不受影響。
3. 接著做 `maxSourcesPerUrl`，因為它能降低報告尺寸且不需碰 fetch。
4. 最後做 body limit、Accept-Encoding 與 Keep-Alive，並用本機測試 server 驗證壓縮、截斷、釋放與 per-host concurrency。

### 最低測試清單

- legacy report diff 測試。
- 新 report diff 測試。
- report root shape 測試。
- manifest generated files 測試。
- sensitive query redaction 測試。
- actual request URL not redacted 測試。
- CSV BOM 測試。
- `maxSourcesPerUrl` / `sourcesTruncated` 測試。
- large body truncated 測試。
- gzip / deflate HTML extraction 測試。
- Keep-Alive per-host concurrency 測試。

---

## P6.5b Assessment

本文件原為 P6.5b 實作前評估，現已回填完成狀態；最新主線請以 [../../ROADMAP.md](../../ROADMAP.md) 為準。

本文件記錄 P6.5b 實作前評估。P6.5b 的主軸是稽查語意、掃描安全邊界與誤判降低，會新增 report 欄位與 CLI / GUI / Analyzer fallback 行為。相較 P6.5a，P6.5b 風險更高，必須拆批實作，避免同時改動 security policy、robots / compliance、partial report 與 host retry 行為。

### 結論

採納 P6.5b 作為下一個主線，但不得一次合併所有交付項。建議拆成五個批次：

1. SSRF / URL security policy。
2. `runStatus` / partial report。
3. robots / compliance 記錄。
4. Retry-After / host diagnostics。
5. WAF signature schema 收斂。

優先順序以安全邊界為先。SSRF / private IP / metadata IP 防護應先於 robots、partial report 與 Retry-After，因為它會影響所有 request 路徑，也會成為後續遠端 rules 載入安全的共用基礎。

### 現況

- P6.5a 已完成輸出契約、redaction、sources/body limit 與 Header / Keep-Alive。
- P6.5b-1 已完成 SSRF / URL security policy、redirect 後重檢、CLI fallback 與 security policy report 欄位。
- WAF / Bot 診斷已有基礎欄位：`protection`、`suspectedWaf`、`suspectedBot`、body pattern 與 header evidence。
- 404 confirmation 已避開 `protected` / suspected WAF / Bot 結果，避免把防護頁誤判為一般 404。
- README 已明確說明目前只記錄 robots / compliance，不執行 robots.txt path enforcement，也不驗證使用者授權。
- P6.5b-2 已完成 `runStatus` / partial report，scan report 會正式產生 `runStatus`，diff 與 Report Analyzer 會提示 partial / failed report。
- P6.5b-3 已完成 robots / compliance 記錄，scan report 會正式產生 `summary.robotsTxt`、`scanPolicy` 與 `compliance`。
- P6.5b-4 已完成 Retry-After / host diagnostics，scan report 會正式產生 `summary.hostDiagnostics`。
- P6.5b-5 已完成 WAF signature schema 收斂，scan report 會正式產生穩定的 `protection` evidence，且 bodyHash 預設關閉。

### 建議切分

#### P6.5b-1：SSRF / URL security policy

狀態：已完成第一版。

交付：

- 已預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與 blocked scheme。
- 已在 request 前對 hostname 做 DNS resolve 後檢查。
- 已在 redirect 後重新檢查 target URL 與 resolved IP。
- CLI 已提供 `--block-private-ip` 預設開啟、`--allow-localhost`、`--allow-private-ip`。
- report 已記錄 `securityPolicy` 與 per-result security issue labels。

驗收：

- `http://127.0.0.1`、`http://localhost`、`http://169.254.169.254` 預設不請求。
- public hostname 解析到 private IP 時預設不請求。
- `--allow-localhost` 不得自動允許所有 private IP；`--allow-private-ip` 不得自動允許 localhost。
- redirect 到 private IP、metadata IP 或 blocked scheme 時停止 follow 並標記 security issue。
- IPv6 loopback、link-local、unique local 與 IPv4-mapped IPv6 需納入測試。

#### P6.5b-2：runStatus / partial report（已完成）

優先級：高。

交付：

- report root 已新增 `runStatus`，支援 `complete`、`partial`、`failed`。
- GUI stop、queue stop、runtime error 會保存帶狀態的 report。
- report 記錄 `stoppedByUser`、`stopReason`、`failureReason`、`completedAt` 等最小狀態欄位。
- Analyzer / diff 讀到 partial / failed report 時顯示 warning，不當成完整掃描。

驗收：

- GUI stop 後能保存 report，且 `runStatus.status=partial`。
- runtime error report 不應被 Analyzer / diff 誤判為完整結果。
- 舊 report 沒有 `runStatus` 時仍可讀，並視為 legacy complete。

#### P6.5b-3：robots / compliance 記錄（已完成）

優先級：高，但需保守。

交付：

- `summary.robotsTxt` 已記錄 start origin robots.txt 狀態、Crawl-delay、全站 Disallow、Allow / Disallow rule count 與 Sitemap。
- `scanPolicy` 已記錄 robots fetch 結果、是否停用 robots 記錄、是否僅 record-only。
- report root 已新增 `compliance`，記錄 purpose、scope、authorizedScanDeclared、robotsTxtPolicy、responseBodyStored、bodyHashEnabled 與授權免責說明。
- CLI 與 GUI 已提供 `--authorized-scan` / 授權宣告、`--authorization-note` / 授權備註、`--no-robots` / 不抓 robots.txt。

驗收：

- robots.txt 不存在或讀取失敗時掃描不中斷，report 有明確 `scanPolicy`。
- 未帶 `--authorized-scan` 時，report 不得宣稱已授權。
- external host 不套用同站授權 override 語意。
- 全站 Disallow 且無 Crawl-delay 時，最低降頻為 `effectiveDelayMs >= 2000`、`effectivePerHostConcurrency <= 1`。

#### P6.5b-4：Retry-After / host diagnostics（已完成）

優先級：中高。

交付：

- 429 / 503 時已解析 `Retry-After` 秒數與 HTTP-date。
- 已設定 `retryAfterMaxMs` host cooldown 上限，避免掃描長時間卡住。
- cooldown 只影響該 host，不阻塞其他 host。
- report summary 已增加 `hostDiagnostics`，包含高 403 / 429 / suspected WAF/Bot 比例提示與 Retry-After cooldown 記錄。

驗收：

- `Retry-After` 不得讓掃描超過設定等待上限。
- 一個 host cooldown 時，其他 host 仍可繼續檢查。
- block-rate diagnostics 不得自動觸發 aggressive retry。

#### P6.5b-5：WAF signature schema 收斂（已完成）

優先級：中。

交付：

- 已將現有 `protection` / body signature / WAF header evidence 收斂成穩定 report schema。
- 已保存 provider、header evidence、body signature rule id，不保存完整 body。
- bodyHash 預設關閉，僅 `--protection-body-hash` / options opt-in 可啟用。
- WAF body signature 命中時，不會被歸入一般 404。

驗收：

- WAF / Bot body signature 命中時 classification 不落入一般 `not_found`。（P6.5b-5 已完成）
- `bodyHashEnabled=false` 是預設。（P6.5b-5 已完成）
- report 不保存完整 challenge body。

### 風險評估

| 項目 | 風險 | 原因 | 控制方式 |
| --- | --- | --- | --- |
| SSRF / DNS resolve | 高 | IPv4、IPv6、IDN、redirect 與 DNS rebinding 邊界複雜 | 先做本機 fixture server 與逐欄 assertion |
| partial report | 中高 | 會牽動 GUI stop、Analyzer 與 diff normalization | 先建立最小 `runStatus` 契約 |
| robots / compliance | 中高 | 容易被誤寫成工具已驗證授權 | 只記錄使用者宣告與工具策略 |
| Retry-After | 中 | 過長等待會拖慢掃描 | 設等待上限且 per-host 生效 |
| WAF schema | 中 | 現有診斷已有欄位，需避免破壞相容性 | 以新增 schema 欄位為主，不重命名既有欄位 |

### 不納入 P6.5b

- robots path enforcement / `--respect-robots` 的嚴格 Disallow 路徑跳過。
- TTL URL result cache。
- incremental scan。
- adaptive backoff 完整策略。
- WAF/Bot 繞過、輪換 User-Agent、代理 IP 輪換、解 CAPTCHA 或模擬真人互動。
- 遠端 rules governance 的完整 schema；但 SSRF 基礎可供 P9 重用。

### 最低測試清單

- blocked scheme 測試。
- localhost / private IP / metadata IP 阻擋測試。
- public hostname resolve 到 private IP 測試。
- redirect 到 blocked target 測試。
- IPv6 loopback / link-local / unique local 測試。
- GUI stop partial report 測試。（P6.5b-2 已完成核心 runStatus 覆蓋）
- diff / Analyzer partial report warning 測試。（P6.5b-2 已完成）
- robots missing / fetch error / full disallow 測試。（P6.5b-3 已完成核心覆蓋）
- `--authorized-scan` 宣告欄位測試。（P6.5b-3 已完成）
- `Retry-After` capped wait 測試。（P6.5b-4 已完成）
- host cooldown 不阻塞其他 host 測試。（P6.5b-4 已完成）
- WAF signature classification 測試。（P6.5b-5 已完成）
