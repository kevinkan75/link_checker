# 開發路線圖

更新日期：2026-07-29

本文件只保留目前狀態、近期方向、延後項目與決策邊界。已完成里程碑的詳細紀錄請看 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)，歷史版 README / ROADMAP 快照請看 `docs/archive/*_2026-07-22_PRE_DOCS_REFRESH.md`。

## 目前狀態

- 最新正式版本：`v1.0.3`。
- GitHub Release：已建立 `v1.0.3 Portable`，並上傳 portable zip、build manifest、zip SHA256 與 release notes。
- Source commit 與 portable zip SHA256 以 GitHub Release 上傳的 build manifest 與 `.sha256` 檔為準。
- P0-P11 release gate 已完成；目前沒有阻擋正式版使用的已知 release gate 項目。
- 主 GUI 預設會檢查外部連結；CLI 仍維持保守預設，需要 `--external` 才檢查外部連結。
- 主 GUI 三個功能頁切換按鈕已改為繁中：「連結檢查」、「外部連結分析」、「報告分析」。
- Portable launcher 目前在本機 build 中記錄為 `NotSigned`；release notes、portable README 與 manifest 已明確標示，散布前應以 SHA256 / manifest 驗證 zip。

## v1.0.3 Release 摘要

`v1.0.3` 是 patch release，沒有改變掃描邏輯、CLI 參數、GUI API、report schema 或輸出契約。

本次 release 重點：

- 同步 portable package 內的 README / ROADMAP 到最新文件狀態。
- 將 `PORTABLE-README.txt` 改為繁中，降低中文使用者解壓縮後的理解成本。
- 延續 portable build 對 launcher 簽章狀態的明確記錄；若本機自簽不可用，會以 unsigned launcher 完成 build 並寫入 README / manifest。
- 完成 portable manifest、zip SHA256、package file hash 與 GUI smoke 檢查。

## 產品定位

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF 繞過工具或完整治理平台。

目前最重要的產品目標：

- 讓承辦人快速知道哪些連結需要處理、哪些需要人工確認、哪些可先忽略。
- 讓掃描結果可用 Excel / CSV / JSON / NDJSON 交辦、存查與分析。
- 讓外部連結治理有基礎 inventory、risk rules 與可追溯規則來源。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。

## 近期維護主線

### Release 維護

狀態：持續維護。

原則：

- 每次正式 release 都要重新產生 portable package。
- `LinkChecker-portable.zip`、external manifest、package manifest 與 `.sha256` 必須對齊同一個 source commit。
- Release notes 必須列出 source commit、zip SHA256、launcher 簽章狀態、Node runtime 簽章狀態與 smoke test 結果。
- 若 launcher 維持 unsigned，release page 與 portable README 必須清楚說明以 SHA256 / manifest 驗證。

### 文件維護

狀態：持續維護。

原則：

- 根 README 面向使用者，保留快速開始、預設值、輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，保留目前狀態、下一步與延後項目。
- 詳細設計、驗收紀錄與歷史討論放入 `docs/archive/`。
- `docs/README.md` 作為文件入口，新增文件時同步更新索引。

### 使用者體驗小修

狀態：候選。

可優先考慮：

- 檢查三個 GUI 頁面的中文用語是否一致。
- 檢查 README、GUI 與 Analyzer 對「待判讀結果」的說法是否一致。
- 補強錯誤訊息的承辦人友善程度，尤其是 `403`、`429`、timeout、TLS 與 WAF 類結果。
- 改善 release page 說明，讓使用者更容易知道要下載 zip 並核對 SHA256。

## 下一階段候選

以下項目可作為 `v1.1.x` 或後續 minor 版本候選；不建議塞進 patch release。

| 項目 | 價值 | 注意事項 |
| --- | --- | --- |
| GUI rules URL 輸入欄位 | 讓使用者不必切 CLI 就能載入 site-specific rules | 需設計安全提示、錯誤呈現與權限邊界 |
| Fragment / duplicate anchor 檢查 | 可補足頁內品質提醒 | 屬 optional 品質檢查，不應影響壞連結主判讀 |
| 更完整的 release page template | 降低每次發版人工漏項 | 應包含 artifact、SHA256、簽章狀態與 smoke 結果 |
| Report Analyzer 大型檔案體驗改善 | 讓大型 report 的人工檢視更順 | 優先沿用 NDJSON sidecar，不急著改主契約 |
| 更細的 external risk governance 欄位 | 方便外連治理與交辦 | 需避免把工具膨脹成完整治理平台 |

## 已完成階段總覽

| 階段 | 狀態 | 重點 | 主要紀錄 |
| --- | --- | --- | --- |
| P0-P5.5 | 已完成 | 基礎掃描、URL inventory、404 / 410 二次確認、外連風險、SPA / Nuxt 抽取 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| P6 / P6.5 | 已完成 | report-to-report diff、輸出契約、redaction、body/source limit、SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | [docs/archive/P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md](docs/archive/P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md) |
| P7 | 已完成 | TTL URL result cache、驗收紀錄與 P8 銜接 | [docs/archive/P7_CACHE_ASSESSMENT_AND_RELEASE.md](docs/archive/P7_CACHE_ASSESSMENT_AND_RELEASE.md) |
| P8 | 已完成 | incremental scan、sitemap seed、changed-only result reuse | [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| P9 | 已驗收 | GUI / Analyzer 改善、NDJSON sidecar、rules schema、rules trace 與 rules URL 安全載入 | [docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md](docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md) |
| P10 | 已完成 | 判讀分類、交辦欄位、GUI / Analyzer 語言同步 | [README.md](README.md)、[docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) |
| P11 | 已完成 | release gate、portable build、manifest / checksum、GUI smoke、release notes | `dist/v1.0.3-notes.md` |

## 延後項目

這些項目有價值，但目前不應插入 patch release 或阻擋既有正式版維護：

| 項目 | 延後理由 |
| --- | --- |
| Scheduler / 平台化監控 | 超出本機輔助工具定位 |
| 複雜 suppress rules | 需要更完整治理流程，暫不納入近期版本 |
| 多種技術型 profile presets | 目前保留簡化掃描模式，避免增加操作負擔 |
| Headless render 預設化 | 容易引入速度、資源與 bot protection 問題，需另開設計 |
| `report.json` streaming parser | P9b 已先用 NDJSON sidecar 和「載入更多」降低大型 report 痛點 |
| 集中式規則平台 | P9c 只補 schema、trace 與安全載入，不建立多人審核或發布流程 |
| 公開信任 code signing | 對正式對外散布有價值，但需另行評估憑證成本、流程與維護責任 |

## 全域原則

### 掃描邊界

- 先維持 DOM / HTML / SPA payload / site rules 抽取，不預設引入 headless browser。
- Site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler。
- 外部連結檢查要保守處理 rate limit、WAF、Bot challenge 與 timeout，並明確標示需要人工確認。

### 安全與合規

- 預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- rules URL 載入需沿用主掃描同等安全邊界。
- 不偽裝 Googlebot，不繞過 CAPTCHA，不把工具定位成 WAF bypass。
- Report、CSV、events log 與 manifest 應持續遮罩敏感 query value。

### 輸出與版本

- `report.json` 是主契約；NDJSON sidecar 是大型資料的輔助入口。
- CSV 欄位優先服務 Excel 篩選、交辦與人工複核。
- 每次 GUI 輸出應保留 `manifest.json`，記錄工具版本、schema、runtime 與輸出檔清單。
- Portable release 必須檢查 manifest、checksum、bundled runtime 與來源 commit 是否對齊。
- Patch release 只應包含修正、文件、文案與 release packaging 小修；若改 report schema、CLI 契約或掃描策略，應評估 minor 版本。

## 細部規格索引

| 主題 | 文件 |
| --- | --- |
| 使用者入口 | [README.md](README.md) |
| CLI 參數 | [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) |
| 技術流程與 report schema | [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) |
| Report normalization / diff | [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md) |
| 文件索引 | [docs/README.md](docs/README.md) |
| 已完成里程碑 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| 2026-07-18 專案評估 | [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md) |
| P9 GUI / Analyzer 評估 | [docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md](docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md) |
