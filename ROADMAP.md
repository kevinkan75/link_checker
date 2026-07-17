# 開發路線圖

本文件說明 Local Link Checker 各階段開發狀態、已完成階段補充與後續規劃。已完成階段的詳細紀錄請參閱 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)，技術規格請參閱 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)。

## 目前狀態摘要

- P0-P8 已完成第一版。
- 目前下一個主線為 P9：GUI 易用性與 Analyzer 改善。
- P6 已完成 report-to-report diff 第一版。
- P6.5a 已完成輸出契約、manifest、redaction、body/source limit、Header / Accept-Encoding 與 Keep-Alive。
- P6.5b 已完成 SSRF、`runStatus`、robots / compliance、Retry-After / host diagnostics 與 WAF signature schema。
- P7 已完成 persistent TTL URL result cache、CLI 參數、report `summary.cache`、回歸測試與發布收尾。
- P8 已完成增量掃描第一版、sitemap 保守 seed、reused result 呈現與文件收尾；GUI 啟用入口 / state 管理延後。
- 後續 Stage 0 僅允許文件或 GUI/CLI 落差小修，不得改變掃描語意或既有 report 主契約。

## 階段命名說明

- Stage 0：不改變掃描語意或 report 主契約的小修階段。
- P：主要開發階段，例如 P6、P7。
- P6.5a / P6.5b：介於 P6 與 P7 之間的穩定性、安全與稽查語意修補階段。

本文件所稱「report 主契約」，是指 `report.json` 的主要資料結構與欄位語意。除特定階段明確規劃外，不應任意更改既有欄位語意，以避免破壞 GUI、Analyzer、diff 與既有使用流程。

「不改掃描語意」是指不改變既有 URL 發現、請求、分類、錯誤判定與報告欄位解讀方式。

## 階段總覽

| 順序 | 階段 | 狀態 | 主要交付 | 下一步 | 排除範圍 |
| ---: | --- | --- | --- | --- | --- |
| 0 | Stage 0 | 已收斂 | README、CSV BOM、GUI/CLI 落差提示、`sourceCount` 說明 | 僅保留必要小修 | schema、robots、cache、incremental scan、Keep-Alive |
| 1 | P6 前置 | 已完成 | golden fixtures、diff schema 草案、report normalization 原則 | 無 | 掃描行為變更 |
| 2 | P6 | 已完成第一版 | 兩份既有 report 產生 `diff.json` | 後續呈現放 P9 | TTL cache、incremental scan、robots enforcement、adaptive backoff |
| 3 | P6.5a | 已完成 | schema/generator、manifest、redaction、response limit、sources 上限、Header / Accept-Encoding / Keep-Alive | 無 | robots / compliance 語意 |
| 4 | P6.5b | 已完成 | SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | 無 | WAF/Bot 繞過 |
| 5 | P7 | 已完成第一版 | TTL URL result cache | 後續僅保留 P9/P10 整合呈現 | page HTML cache 優先化 |
| 6 | P8 | 已完成第一版 | report diff / cache / scan state 上的增量掃描；P8a-P8e 已完成第一版，已合併 main | GUI 啟用入口與 state 管理移交 P9 / P10 評估 | 跳過 HTML inventory 發現的新 URL；GUI state 管理 |
| 7 | P9 | 待規劃 | GUI 易用性、Analyzer / GUI 大型報告、profile、rules schema、Next.js payload | 先拆 GUI / 大型報告 / profile-rules 三組 | 空 UI 或未落地的展示層 |
| 8 | P10 | 待規劃 | 治理與分級排程、WAF 協調建議、`--respect-robots` | P9 後設計 | 常駐 scheduler 優先化 |
| 9 | P11 | 待規劃 | 輔助格式、release / packaging governance | P10 後評估 | 早於核心契約與誤判降低 |

## 狀態用語

| 狀態 | 定義 |
| --- | --- |
| 已完成 | 已完成實作與基本驗收 |
| 已完成第一版 | 已可使用，但後續仍可能擴充呈現或整合 |
| 已收斂 | 不再主動擴充，僅保留必要小修 |
| 待規劃 | 尚未進入實作，需補設計與驗收條件 |
| 後續評估 | 暫不排入近期主線 |

## 已完成階段補充

### P7：TTL 檢查快取

**狀態：** 已完成第一版

**目標：** 對可驗證的 URL result 建立 TTL cache，降低重複檢查成本；不先處理 page HTML cache。  
**實作前評估：** [docs/archive/P7_CACHE_EVALUATION.md](docs/archive/P7_CACHE_EVALUATION.md)。

**發布收尾：** [docs/archive/P7_RELEASE_CLOSURE.md](docs/archive/P7_RELEASE_CLOSURE.md)。

**已完成決策：**

1. P6.5b report 欄位已穩定。
2. cache 落盤展示值強制套用 sensitive query redaction。
3. cache key 已包含 security policy、robots policy 與 request policy fingerprint。
4. GUI 第一版不新增 cache 表單；report 會保留 `summary.cache`。
5. 已建立 `test-p7-cache.mjs` 與 cache regression fixtures。
6. 已完成 P7 發布收尾，後續 cache 呈現與進階 GUI 整合移交 P9/P10。

**實作分段：**

- P7a：已完成規格與測試骨架，固定 cache schema、key policy、TTL policy 與 redaction 邊界。
- P7b：已完成 CLI 與核心 cache，接入 `requireBody: false` 的 URL status check，不碰 page HTML cache。
- P7c：已完成 report、文件與收斂，補 `summary.cache`、CLI 文件與完整回歸測試。

**主要交付：**

- cache file：`.cache/link-check-cache.json`。
- cache key：canonical URL hash、method policy、userAgent hash、accept language、referer mode、robots policy、security policy、request policy。
- cache value：result、`checkedAt`、`expiresAt`、`ttlCategory`、`lastStatus`、`lastFinalUrlHash`。
- CLI：`--cache`、`--cache-file <file>`、`--cache-ttl-hours <n>`、`--no-cache`、`--refresh-cache`。
- report summary：cache hit / miss / expired / refreshed / written / bypassed / errors。

**驗收重點（已通過）：**

- 相同 canonical key、method policy、UA hash、語言與 referer mode 時可命中 cache。
- `404/410` 快取 TTL 應短於穩定 `200/204/3xx`。
- `429/timeout/5xx` 應短 TTL，避免長時間保留暫時性失敗。
- `--refresh-cache` 應忽略既有 cache 並回寫新結果。
- report summary 顯示 cache hit / miss / expired / refreshed / written / bypassed / errors。

**不納入本階段：**

- page HTML cache。
- incremental scan。
- sitemap lastmod 排程。
- adaptive backoff 完整策略。

## P8 收尾紀錄

### P8：增量掃描

**狀態：** 已完成第一版，已合併 `main`（P8a/P8b/P8c/P8d/P8e 已完成）  
**依賴關係：** P8 建立在 P7 TTL 檢查快取之上；第一版已完成最小 scan state、priority、changed-only / result reuse、sitemap 與呈現收尾。  
**分析與驗收紀錄：** [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md)。

**目標：** 依據 report diff、scan state 與 TTL cache 優先檢查新頁面、變更頁面、新 URL 與上次錯誤 URL。  
**主要交付：** `--incremental`、`--baseline-report <file>`、`--state-file <file>`、`--changed-only`、`--sitemap <url-or-file>`。

**建議切分：** P8a baseline/state loader + 最小 scan state（已完成）、P8b incremental priority（已完成）、P8c changed-only/reuse（已完成）、P8d sitemap 讀取、priority signal 與保守 seed（已完成）、P8e-1 GUI / Report Analyzer 最小呈現（已完成）、P8e-2 文件與 CLI 文案收尾（已完成）。GUI 啟用入口 / state 管理延後到 P9 / P10 評估。
**驗收重點：** changed-only 模式仍保留完整 summary，不只輸出 delta。  
**排除範圍：** 不因 sitemap 或 state 跳過 HTML inventory 發現的新 URL；P8e 不新增 GUI state 管理頁、手填 state path、policy fingerprint 顯示或 GUI changed-only 主操作。

## 後續階段規劃

### P9a：GUI 易用性與 Analyzer 改善

**狀態：** P9a-1 / P9a-2 / P9a-3 / P9a-4 已完成第一版  
**目標：** 修正手機版水平溢出，簡化 Link Checker 初始狀態，讓匯入型頁面形成清楚的選檔、分析、匯出流程。  
**實作前評估：** [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md)。  
**主要交付：** 一般使用者視角的 GUI 易讀性基線與 Analyzer 呈現改善。  
**第一優先：** 修正主 GUI 進度語意，將 URL 檢測進度與頁面探索狀態分開呈現（已完成第一版）。  
**已完成補充：** P9a-2 已改善主 GUI、External Link Analyzer 與 Report Analyzer 的待命空狀態與第一屏提示。  
**已完成補充：** P9a-3 已修正三個 GUI 在手機寬度下的整頁水平溢出風險，並將表格捲動限制在容器內。  
**已完成補充：** P9a-4 已讓 External Link Analyzer 與 Report Analyzer 形成清楚的選檔、分析/載入、匯出流程。  
**驗收重點：** 不新增空 UI；每個畫面改善都需有可用流程；不改掃描語意或 `report.json` 主契約。

### P9b：大型報告處理與 NDJSON 輔助輸出

**狀態：** 待規劃  
**目標：** 讓 Analyzer / GUI 可處理大型 report。  
**主要交付：** stream-json 類逐筆處理、GUI 分頁、`checked.ndjson`、`broken.ndjson`、`external-links.ndjson`。  
**排除範圍：** NDJSON 不取代 `report.json` 主格式。

### P9c：Profile、Rules Schema 與 Next.js Payload

**狀態：** 待規劃  
**目標：** 建立 profile 與規則治理，並擴充 Next.js `__NEXT_DATA__` 抽取。  
**主要交付：** `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` profile；rules schema 與 `rulesVersion`。  
**驗收重點：** configured values 與 robots / Retry-After 後的 effective values 需可追溯。

### P10：治理與分級排程

**狀態：** 待規劃  
**目標：** 先做排程建議，不急著做完整常駐 scheduler。  
**主要交付：** URL / page priority、suggested interval、WAF 協調建議、`--respect-robots` path enforcement。  
**排除範圍：** 常駐 Windows Service 或完整 scheduler 優先化。

### P11：輔助功能與 Release

**狀態：** 後續評估  
**目標：** 在核心契約與誤判降低穩定後，補 release / packaging governance。  
**主要交付：** HTML / Excel 報表、portable package manifest、package smoke test、dependency audit、license summary、SBOM、正式公開信任簽章與 checksum 評估。  
**參考文件：** [docs/archive/RELEASE_SECURITY_ASSESSMENT.md](docs/archive/RELEASE_SECURITY_ASSESSMENT.md)。

## 已完成工作摘要

| 階段 | 完成摘要 | 詳細紀錄 |
| --- | --- | --- |
| P0-P5.5 | 完成本機工具、URL inventory、`404 / 410` 二次確認、外部連結治理、SPA / Nuxt 抽取改善 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| P6 | 完成 report-to-report diff 第一版，支援 URL、external risk 與 summary diagnostics 的 report diff | [docs/archive/P6_IMPLEMENTATION_ANALYSIS.md](docs/archive/P6_IMPLEMENTATION_ANALYSIS.md) |
| P6.5a | 完成輸出契約、manifest、redaction、sources/body limit、Header / Accept-Encoding / Keep-Alive | [docs/archive/P6_5A_ASSESSMENT.md](docs/archive/P6_5A_ASSESSMENT.md) |
| P6.5b | 完成 SSRF、partial report、robots / compliance、Retry-After / host diagnostics 與 WAF signature schema | [docs/archive/P6_5B_ASSESSMENT.md](docs/archive/P6_5B_ASSESSMENT.md) |
| P7 | 完成 persistent TTL URL result cache、CLI 參數、report `summary.cache`、回歸測試與發布收尾 | [docs/archive/P7_RELEASE_CLOSURE.md](docs/archive/P7_RELEASE_CLOSURE.md) |
| P8 | 完成 incremental scan 第一版、sitemap 保守 seed、changed-only result reuse、GUI / Analyzer 呈現與文件收尾 | [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| Release security 小修 | portable `.cmd` 嚴格使用 bundled runtime、build manifest、artifact SHA256、localhost-only 說明與 self-signed 限制 | [docs/archive/RELEASE_SECURITY_ASSESSMENT.md](docs/archive/RELEASE_SECURITY_ASSESSMENT.md) |

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
- 版本資訊放在 JSON 內容與每次輸出的 `manifest.json`。
- 只有 release / package 產物才採檔名版本化。
- CSV 不新增每列版本欄位；需要追溯工具、schema、runtime 與輸出清單時，以同目錄 manifest 為準。

## 採納決策摘要

本 Roadmap 已採納 v5.1 與 v5.2 分析文件之主要建議，包括 report diff、P6.5 拆分、`schemaVersion`、redaction、SSRF、`runStatus`、robots / compliance、Retry-After、manifest 與 WAF signature schema。

落點原則：

- P6：純 report diff，只讀兩份既有 report 並輸出 diff，不改掃描行為。
- P6.5a：低風險穩定性與輸出契約，包括 manifest、redaction、response size limit、Header / Keep-Alive。
- P6.5b：稽查語意與誤判降低，包括 SSRF、partial report、robots / compliance、Retry-After 與 WAF schema。
- P9：rules schema、profile 與 GUI / Analyzer 呈現。
- P11：release / packaging governance、SBOM、dependency audit 與正式簽章評估。

README / ROADMAP 易讀性與一致性建議採納紀錄請參閱 [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)。

## 細部規格索引

以下項目已採納但不在 Roadmap 主文展開成完整規格。實作前需回填到 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)、schema 或專門設計文件。

| 類別 | 細項 | 落點 | 狀態 |
| --- | --- | --- | --- |
| schema version | `1.0.0` 舊 report、`1.1.0` 輸出契約、`1.2.0` security / runStatus / robots / host diagnostics / protection | P6.5a / P6.5b | 已完成 |
| output versioning | 日常輸出檔名穩定；JSON 使用內容版本欄位；CSV 不新增版本欄位 | P6.5a | 已完成 |
| output manifest | 每次輸出建立 `manifest.json` | P6.5a | 已完成 |
| normalization | `load report -> detect schemaVersion -> normalize to internal ReportModel` | P6 / P9 | P6 已完成，P9 待規劃 |
| robots schema | `summary.robotsTxt` 保留 start origin 語意 | P6.5b | 已完成 |
| scanPolicy / compliance | robots record-only、授權宣告與免責說明 | P6.5b | 已完成 |
| security CLI | `--block-private-ip`、`--allow-private-ip`、`--allow-localhost` | P6.5b | 已完成 |
| redaction CLI | `--redact-sensitive-query`、`--no-redact-sensitive-query`、`--redact-query-keys <list>` | P6.5a | 已完成 |
| body / source limit CLI | `--max-html-bytes`、`--max-body-preview-bytes`、`--max-download-probe-bytes`、`--max-sources-per-url` | P6.5a | 已完成 |
| keep-alive CLI | `--no-keep-alive` 與 effective 設定紀錄 | P6.5a | 已完成 |
| report fields | `securityPolicy`、`redaction`、`bodyLimits`、`runStatus`、`scanPolicy`、`compliance`、`hostDiagnostics`、`protection`、`bodySignature`、`rulesVersion`、`profileExpandedOptions` | P6.5 / P9 | 部分完成 |
| fixtures | `fixtures/reports`、`fixtures/robots`、`fixtures/waf`、`fixtures/html`、`fixtures/csv` | P6 前置 / P6.5 | 部分完成 |
| rules governance | `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json` | P9 | 待規劃 |
| profiles | `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` | P9 | 待規劃 |
| release | package manifest、Node runtime version、smoke test、dependency audit、license summary、SBOM、checksum / signing | P11 | 後續評估 |

## 暫不納入近期主線

### 安全與防護繞過

| 暫不納入項目 | 理由 |
| --- | --- |
| 不使用 `rejectUnauthorized: false` 作為一般功能 | TLS 問題應優先使用 `--system-ca` 與 `--legacy-tls`，避免降低預設安全性 |
| 不做輪換 User-Agent、偽裝 Googlebot、代理 IP 輪換、解 CAPTCHA 或模擬真人互動 | 避免被解讀為繞過 WAF/Bot 防護 |
| 不對明確 WAF/Bot challenge 做多次 aggressive retry | 這類結果應保存證據並提示調整掃描策略或與站方協調 |
| 不保存完整 response body 作為診斷欄位 | 避免報告包含登入頁、錯誤頁或防護頁中的敏感內容 |

### 架構與部署型態

| 暫不納入項目 | 理由 |
| --- | --- |
| 不先導入 PostgreSQL、server-client 架構或 eGov 登入 | 目前主線是本機工具與報告契約穩定 |
| 不把單機版改成常駐 Windows Service | 目前需求是可預期地收尾本機工具，而不是背景服務化 |
| 不以追蹤瀏覽器 process 作為關閉服務的主要機制 | `Process.Start(url)` 無法可靠代表使用者是否仍開著該頁籤 |

### 掃描策略

| 暫不納入項目 | 理由 |
| --- | --- |
| 不預設啟用 aggressive URL canonicalization | 避免把實際不同的資源錯誤合併 |
| 不做泛用 `404` 重試 | `404` 二次確認應採條件式策略，避免拖慢整體掃描 |
| 不把 `200` 且 body 過短單獨判定為 `suspected_false_positive` | 必須搭配 content-type、標頭、title 或 challenge pattern |
| Bloom Filter 不作為預設去重 | 大型站可後續 opt-in，且需標明 false positive risk |

### 輸出格式

| 暫不納入項目 | 理由 |
| --- | --- |
| 不預設替日常輸出檔名加版本號 | 避免腳本、GUI 與使用者流程每次都要追新檔名 |
| 不在 CSV 每列加入 schema / app version | CSV 維持資料交換用途，版本追溯交給 manifest |

## 參考文件

- [README.md](README.md)：使用入口與快速開始。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數與規則檔格式。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：技術規格。
- [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)：已完成里程碑與驗收紀錄。
- [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性採納紀錄。
