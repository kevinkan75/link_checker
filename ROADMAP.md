# 開發路線圖

更新日期：2026-07-22

本文件只保留目前狀態、近期主線與決策邊界。已完成里程碑的細節請看 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)，舊版 README / ROADMAP 已歸檔於 `docs/archive/*_2026-07-22_PRE_DOCS_REFRESH.md`。

## 目前狀態

- P0-P8 已完成第一版，包含基礎掃描、report diff、輸出契約、安全基線、TTL cache、incremental scan 與 sitemap seed。
- P9 已於 2026-07-18 整體驗收，包含 GUI 易用性、大型 report 處理、NDJSON sidecar、Analyzer 匯入與 rules schema / trace / URL 安全載入。
- P10 核心收尾已完成，包含報告判讀分類、交辦友善 CSV 欄位、GUI / Report Analyzer 判讀語言同步。
- P10d 頁內 fragment / duplicate anchor 檢查維持 optional，不阻擋正式版 release gate。
- P11 release gate 已完成 P11a-P11e 的主要檢查紀錄；P11f 仍需在最新文件與程式變更後重跑最終對齊檢查。
- 2026-07-22 已將主 GUI「檢查外部連結」改為預設勾選；CLI 預設仍保守，需要 `--external` 才檢查外部連結。

## 產品定位

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF 繞過工具或完整治理平台。

目前最重要的產品目標：

- 讓承辦人快速知道哪些連結需要處理、哪些需要人工確認、哪些可先忽略。
- 讓掃描結果可用 Excel / CSV / JSON / NDJSON 交辦、存查與分析。
- 讓外部連結治理有基礎 inventory、risk rules 與可追溯規則來源。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。

## 近期主線

### P11f：最終 Release Gate

狀態：待執行。

目標：在最新程式與文件變更後，確認測試、portable artifact、manifest、checksum、文件與 release notes 全部對齊，決定是否可標正式版。

建議檢查：

- 全部 `test-*.mjs` 通過。
- 主要 `.mjs` 與 `public/*.js` 語法檢查通過。
- GUI smoke test 通過：啟動、掃描、下載 report、Report Analyzer 匯入、External Link Analyzer 匯入。
- Portable package 重新建立，並確認 bundled runtime、launcher、localhost-only、manual shutdown 與 idle shutdown。
- `LinkChecker-portable.zip`、external manifest、package manifest 與 `.sha256` 對齊同一個 source commit。
- README、ROADMAP、docs index、CLI reference、technical spec 與 release notes 沒有互相矛盾。
- 自簽 launcher / SmartScreen 限制已清楚記錄。

### 文件維護

狀態：進行中。

原則：

- 根 README 面向使用者，保留快速開始、預設值、輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，保留目前狀態、下一步與延後項目。
- 詳細設計、驗收紀錄與歷史討論放入 `docs/archive/`。
- `docs/README.md` 作為文件入口，不再堆疊大量狀態流水帳。

## 已完成階段總覽

| 階段 | 狀態 | 重點 | 主要紀錄 |
| --- | --- | --- | --- |
| P0-P5.5 | 已完成 | 基礎掃描、URL inventory、404 / 410 二次確認、外連風險、SPA / Nuxt 抽取 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| P6 | 已完成 | report-to-report diff | [docs/archive/P6_IMPLEMENTATION_ANALYSIS.md](docs/archive/P6_IMPLEMENTATION_ANALYSIS.md) |
| P6.5a | 已完成 | 輸出契約、manifest、redaction、body/source limit、Header / Keep-Alive | [docs/archive/P6_5A_ASSESSMENT.md](docs/archive/P6_5A_ASSESSMENT.md) |
| P6.5b | 已完成 | SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | [docs/archive/P6_5B_ASSESSMENT.md](docs/archive/P6_5B_ASSESSMENT.md) |
| P7 | 已完成 | TTL URL result cache | [docs/archive/P7_RELEASE_CLOSURE.md](docs/archive/P7_RELEASE_CLOSURE.md) |
| P8 | 已完成 | incremental scan、sitemap seed、changed-only result reuse | [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| P9 | 已驗收 | GUI / Analyzer 改善、NDJSON sidecar、rules schema、rules trace 與 rules URL 安全載入 | [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md) |
| P10 | 已完成核心收尾 | 判讀分類、交辦欄位、GUI / Analyzer 語言同步 | 根 README 與 technical spec |
| P11a-P11e | 已完成主要檢查 | 測試 gate、GUI smoke、portable build、manifest / checksum、文件與 notes | 舊版 ROADMAP 歸檔快照 |

## 延後項目

這些項目有價值，但目前不應插入正式版 release gate：

| 項目 | 延後理由 |
| --- | --- |
| Fragment / duplicate anchor 檢查 | P10d optional；屬於頁內品質提醒，不應阻擋目前 release gate |
| Scheduler / 平台化監控 | 超出本機輔助工具定位 |
| GUI rules URL 輸入欄位 | 核心 rules URL 安全載入已完成；GUI 表單仍需額外 UX 與錯誤呈現設計 |
| 複雜 suppress rules | 需要更完整治理流程，暫不納入正式版前 |
| 多種技術型 profile presets | 目前保留簡化掃描模式，避免增加操作負擔 |
| Headless render 預設化 | 容易引入速度、資源與 bot protection 問題，需另開設計 |
| `report.json` streaming parser | P9b 已先用 NDJSON sidecar 和「載入更多」降低大型 report 痛點 |
| 集中式規則平台 | P9c 只補 schema、trace 與安全載入，不建立多人審核或發布流程 |

## 全域原則

### 掃描邊界

- 先維持 DOM / HTML / SPA payload / site rules 抽取，不預設引入 headless browser。
- Site-specific 邏輯應放在 `--site-link-rules`，不要硬寫進 crawler。
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

## 細部規格索引

| 主題 | 文件 |
| --- | --- |
| CLI 參數 | [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) |
| 技術流程與 report schema | [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) |
| 文件索引 | [docs/README.md](docs/README.md) |
| 已完成里程碑 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| 2026-07-18 專案評估 | [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md) |
| P9 GUI / Analyzer 評估 | [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md) |
