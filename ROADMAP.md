# 開發路線圖

本文件是 Local Link Checker 的主線導航。它用來回答三件事：

1. 現在做到哪裡。
2. 下一步做什麼。
3. 哪些方向暫時不要做，避免偏離本地輔助工具定位。

已完成里程碑的細節請看 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)，技術規格請看 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)，2026-07-18 完整專案評估請看 [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md)。

## 目前狀態

- P0-P8 已完成第一版。
- P9a 已於 2026-07-17 驗收通過；不要再把 P9a-1 當成下一個起點。
- P9b-1 到 P9b-4 已完成第一版，包含 GUI log artifacts、NDJSON sidecar、GUI complete payload 瘦身、大檔提示、列表「載入更多」與 NDJSON 匯入。
- P9c-1 Rules Schema 已完成第一版，包含 `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json` 與 `test-p9c1-rules-schema.mjs`。
- 目前下一個主線是 P9c-2：Rules 追溯欄位與 rules URL 載入安全化。
- 產品定位已校準為本地端、低門檻、輔助型工具，主要提供政府機關承辦人員使用，不取代 CMS、維運流程、稽核系統或正式監控平台。

## 產品定位護欄

Local Link Checker 的目標是讓承辦人能在本機輸入網址、保守掃描、下載可讀且可交辦的檢查結果。後續規劃必須符合以下原則：

- GUI 優先，CLI 保留進階用途即可。
- 結果應協助判讀，不替承辦人做不可逆或過度自動化的結論。
- `403`、`429`、WAF、timeout、外站限制等結果應標示需人工確認，不直接視為明確壞連結。
- 輸出應適合交辦與存查，CSV / Excel 友善欄位比平台化 dashboard 更重要。
- 預設掃描應保守，避免造成機關網站或外部網站壓力。
- 避免常駐 scheduler、平台化監控、取代既有維運工具、過度自動化決策，以及會增加承辦人操作負擔的複雜規則系統。
- 可借鏡 W3C Link Checker 的 fragment / anchor 檢查、duplicate anchor 檢查與保守 request policy，但不以取代 W3C 或建立大型治理平台為目標。

## 近期主線

### 1. P9c-2：Rules 追溯與載入安全

**狀態：** 下一個實作主線  
**目標：** 讓 report 能追溯使用了哪些 rules，並讓 rules URL 載入套用與主掃描一致的安全邊界。

建議交付：

- `rulesVersion` 或 rules fingerprint。
- rules source metadata，例如 source path / URL、loadedAt、content hash、rule counts、load warnings。
- rules URL 載入安全化：URL security policy、redirect 檢查、timeout、content length / body size limit、清楚錯誤訊息。
- 回歸測試：local file rules metadata、rules URL blocked cases、rules fingerprint 穩定性、既有 P9c-1 schema regression。

不納入：

- GUI rules URL 表單。
- profile presets。
- Next.js `__NEXT_DATA__` 專用 parser。
- 大型重構 crawler。

### 2. 報告判讀與交辦友善

**狀態：** P9c-2 後優先評估  
**目標：** 讓承辦人更容易判斷哪些要修、哪些要人工確認、哪些只是外站限制或已知轉址。

建議交付：

- 更清楚的結果分級：明確壞連結、可能失效、需人工確認、外站限制、已轉址但仍可用、頁內跳轉失效。
- CSV / Excel 交辦友善欄位：來源頁、問題網址、問題類型、建議處理、是否需人工確認。
- GUI 摘要用業務語言呈現，不要求使用者理解所有 HTTP / WAF 細節。

### 3. 頁內連結品質檢查

**狀態：** P9c-2 後優先評估  
**目標：** 借鏡 W3C Link Checker，補足一般 HTTP status 看不出的頁面內部連結問題。

建議交付：

- Fragment / anchor 檢查：頁面存在但 `#fragment` 目標不存在時，標示為「頁內跳轉失效」。
- Duplicate anchor 檢查：同頁重複 `id` 或 anchor name 時，標示為「頁面品質提醒」。

呈現原則：

- 不與明確 404 壞連結混在一起。
- 優先作為可修復提醒，避免產生過度警報。

### 4. GUI 一鍵模式簡化

**狀態：** 後續評估  
**目標：** 用少量、安全、容易理解的模式取代過多參數。

候選模式：

- 一般檢查。
- 保守檢查。
- 外部連結盤點。

不急著做：

- 大量技術型 profile，例如完整 `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` 展開。
- 把所有 CLI 參數搬進 GUI。

## 階段總覽

| 階段 | 狀態 | 重點 | 下一步 |
| --- | --- | --- | --- |
| Stage 0 | 已收斂 | README、CSV BOM、GUI/CLI 落差提示、`sourceCount` 說明 | 僅保留必要文件或小修 |
| P6 | 已完成 | report-to-report diff | 後續呈現放 P9 / Analyzer |
| P6.5a | 已完成 | 輸出契約、manifest、redaction、body/source limit、Header / Keep-Alive | 無 |
| P6.5b | 已完成 | SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | 無 |
| P7 | 已完成第一版 | TTL URL result cache | 僅保留 P9/P10 呈現整合 |
| P8 | 已完成第一版 | incremental scan、sitemap seed、changed-only result reuse | GUI state 管理延後 |
| P9a | 已驗收 | GUI 易用性、手機可讀性、匯入流程 | 不再是下一個起點 |
| P9b | 已完成第一版 | 大型報告處理、NDJSON sidecar、Analyzer 載入更多 | 不取代 `report.json` 主契約 |
| P9c-1 | 已完成第一版 | Rules Schema | 下一步 P9c-2 |
| P9c-2 | 下一個主線 | Rules 追溯與 rules URL 載入安全 | 優先實作 |
| P10 | 待規劃 | 輔助型分級、人工複核、整站檢測策略小步強化 | P9c-2 後評估 |
| P11 | 後續評估 | 輔助格式、release / packaging governance | P10 後評估 |

## 已完成里程碑索引

| 階段 | 完成摘要 | 詳細紀錄 |
| --- | --- | --- |
| P0-P5.5 | 本機工具、URL inventory、`404 / 410` 二次確認、外部連結治理、SPA / Nuxt 抽取改善 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| P6 | report diff 第一版，支援 URL、external risk 與 summary diagnostics 比對 | [docs/archive/P6_IMPLEMENTATION_ANALYSIS.md](docs/archive/P6_IMPLEMENTATION_ANALYSIS.md) |
| P6.5a | 輸出契約、manifest、redaction、sources/body limit、Header / Keep-Alive | [docs/archive/P6_5A_ASSESSMENT.md](docs/archive/P6_5A_ASSESSMENT.md) |
| P6.5b | SSRF、partial report、robots / compliance、Retry-After / host diagnostics、WAF signature schema | [docs/archive/P6_5B_ASSESSMENT.md](docs/archive/P6_5B_ASSESSMENT.md) |
| P7 | TTL URL result cache、CLI 參數、report `summary.cache`、回歸測試與發布收尾 | [docs/archive/P7_RELEASE_CLOSURE.md](docs/archive/P7_RELEASE_CLOSURE.md) |
| P8 | incremental scan、sitemap 保守 seed、changed-only result reuse、GUI / Analyzer 呈現 | [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| P9a / P9b | GUI 易用性、大型報告處理、NDJSON 輔助輸出、Analyzer 匯入與分批載入 | [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md) |
| 2026-07-18 評估 | 專案健康度、產品定位、P9c-2 建議、延後項目重新排序 | [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md) |
| Release security 小修 | portable `.cmd` 使用 bundled runtime、build manifest、SHA256、localhost-only、自簽說明 | [docs/archive/RELEASE_SECURITY_ASSESSMENT.md](docs/archive/RELEASE_SECURITY_ASSESSMENT.md) |

## 延後項目

這些項目不是否定價值，而是目前不應插到 P9c-2 前面，也不應偏離本地輔助工具定位。

| 項目 | 延後原因 |
| --- | --- |
| 完整重構 crawler | 目前核心行為穩定；只應在需要維護時小步抽出 rules loader、security policy、report builder 等邊界清楚的模組 |
| `report.json` streaming parser | P9b 已先用 NDJSON sidecar 與「載入更多」降低大型報告痛點；等真的常遇到瀏覽器無法載入再做 |
| CLI sidecar 邊跑邊 append | 對承辦人價值不直接，且會牽涉 partial output、manifest 一致性與中斷恢復 |
| GUI rules URL 表單 | 需等 P9c-2 rules URL 載入安全化完成後再開放 |
| 複雜 profile presets | 先用少量 GUI 一鍵模式；避免承辦人需要理解過多技術 profile |
| Next.js `__NEXT_DATA__` 專用 parser | 保持 opt-in / rules-driven，不把站台特定邏輯硬寫回 crawler |
| Headless render 預設化 | 成本高、容易觸發 bot protection，只能作進階 fallback |
| 常駐 scheduler / 平台化監控 | 偏離本地輔助工具定位，也可能與機關既有工具重疊 |
| 複雜 suppress rules / 自動治理流程 | 對承辦人操作負擔高；可先用人工複核分類與交辦欄位降低噪音 |

## 全域原則

### 掃描邊界

- 保留現有 `extractLinks()` 方向，不以第一刀重寫成完整 DOM / browser crawler。
- SPA payload extraction 以低成本、可回退為原則。
- 站台特定欄位透過 `--site-link-rules`，不硬寫在核心 crawler。
- Headless render 只作 opt-in fallback，不預設啟用。
- `report.json` 是正式主契約；NDJSON 只能作大型報告輔助輸出，不取代主格式。

### 安全與合規

- CDN/WAF/Bot 處理定位是辨識、降誤報、節流、保存證據與提示人工協調，不做繞過防護。
- robots.txt、授權掃描與 compliance 只記錄工具行為與使用者宣告，不代表工具驗證授權。
- 本機工具也需有安全邊界；預設不得請求 localhost、metadata IP、private IP 或 blocked scheme，除非明確開啟相容模式。
- report、CSV 與 logs 應避免輸出敏感 query value。
- rules URL 載入應補齊主掃描同等安全邊界，這是 P9c-2 的重要部分。

### 輸出與版本

- 日常輸出檔名保持穩定，避免腳本、GUI 與使用者流程每次都要追新檔名。
- 版本資訊放在 JSON 內容與每次輸出的 `manifest.json`。
- 只有 release / package 產物才採檔名版本化。
- CSV 不新增每列版本欄位；需要追溯工具、schema、runtime 與輸出清單時，以同目錄 manifest 為準。

## 暫不納入近期主線

| 類別 | 暫不納入項目 |
| --- | --- |
| 防護繞過 | 不輪換 User-Agent、不偽裝 Googlebot、不使用代理 IP 輪換、不解 CAPTCHA、不模擬真人互動 |
| TLS | 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用 `--system-ca` 或 `--legacy-tls` |
| 架構 | 不導入 PostgreSQL、server-client 架構、eGov 登入或常駐 Windows Service |
| 掃描策略 | 不預設 aggressive canonicalization、不做泛用 404 重試、不用 body 過短單獨判斷 false positive |
| 輸出格式 | 不預設替日常輸出檔名加版本號，不在 CSV 每列加入 schema / app version |

## 細部規格索引

| 類別 | 細項 | 落點 | 狀態 |
| --- | --- | --- | --- |
| schema version | `1.0.0` 舊 report、`1.1.0` 輸出契約、`1.2.0` security / runStatus / robots / host diagnostics / protection | P6.5a / P6.5b | 已完成 |
| output manifest | 每次輸出建立 `manifest.json` | P6.5a | 已完成 |
| normalization | `load report -> detect schemaVersion -> normalize to internal ReportModel` | P6 / P9b | 已完成第一版 |
| security CLI | `--block-private-ip`、`--allow-private-ip`、`--allow-localhost` | P6.5b | 已完成 |
| redaction CLI | `--redact-sensitive-query`、`--no-redact-sensitive-query`、`--redact-query-keys <list>` | P6.5a | 已完成 |
| body / source limit CLI | `--max-html-bytes`、`--max-body-preview-bytes`、`--max-download-probe-bytes`、`--max-sources-per-url` | P6.5a | 已完成 |
| rules governance | `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json` | P9c | P9c-1 已完成 |
| rules tracing | `rulesVersion`、rules fingerprint、source metadata、load warnings | P9c-2 | 下一步 |
| report interpretation | 人工複核分類、頁內跳轉失效、交辦友善欄位 | P10 | 待規劃 |
| release | package manifest、Node runtime version、smoke test、dependency audit、license summary、SBOM、checksum / signing | P11 | 後續評估 |

## 參考文件

- [README.md](README.md)：使用入口、產品定位與快速開始。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數與規則檔格式。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：技術規格。
- [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 評估與紀錄。
- [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md)：完整專案評估與產品定位校準。
- [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性採納紀錄。
