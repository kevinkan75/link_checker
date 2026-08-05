# 開發路線圖

更新日期：2026-08-03

本文件只保留目前狀態、近期維護主線、下一步候選與決策邊界。已完成階段與 `v1.0.4` 詳細狀態請看 [docs/archive/CURRENT_STATE_2026-08-03.md](docs/archive/CURRENT_STATE_2026-08-03.md)，更早期里程碑請看 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)。

## 目前狀態

- 最新正式版本：`v1.0.5`。
- 目前沒有阻擋正式版使用的已知 release gate 項目。
- 主 GUI 預設檢查外部連結；CLI 仍維持保守預設，需要 `--external` 才檢查外部連結。
- 三個 GUI 功能頁是「連結檢查」、「外部連結分析」、「報告分析」。
- Portable launcher 目前記錄為 `NotSigned`；散布前仍需以 SHA256 / manifest 驗證 zip。

## 產品邊界

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF 繞過工具或完整治理平台。

目前要守住的方向：

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 讓掃描結果可用 Excel / CSV / JSON / NDJSON 交辦、存查與分析。
- 外部連結治理只做基礎 inventory、risk rules 與可追溯規則來源，不擴張成完整治理平台。

## 近期維護主線

### Release 維護

狀態：持續維護。

- 每次正式 release 都要重新產生 portable package。
- `LinkChecker-portable.zip`、external manifest、package manifest 與 `.sha256` 必須對齊同一個 source commit。
- Release notes 必須列出 source commit、zip SHA256、launcher 簽章狀態、Node runtime 簽章狀態與 smoke test 結果。
- 若 launcher 維持 unsigned，release page 與 portable README 必須清楚說明以 SHA256 / manifest 驗證。

### 文件維護

狀態：持續維護。

- 根 README 面向使用者，保留快速開始、預設值、輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，只保留目前狀態、下一步與延後項目。
- 詳細設計、驗收紀錄與歷史討論放入 `docs/archive/`。
- 新增或移動文件時，同步更新 [docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。

### 使用者體驗小修

狀態：候選。

- 檢查 README、GUI 與 Analyzer 對「待判讀結果」的說法是否一致。
- 補強 `403`、`429`、timeout、TLS 與 WAF 類結果的承辦人友善錯誤訊息。
- 改善 release page 說明，讓使用者更容易知道要下載 zip 並核對 SHA256。
- 持續檢查三個 GUI 頁面的繁中用語與進階設定說明是否一致。

## 下一階段候選

以下項目可作為 `v1.1.x` 或後續 minor 版本候選；不建議塞進 patch release。

| 項目 | 價值 | 注意事項 |
| --- | --- | --- |
| GUI rules URL 輸入欄位 | 讓使用者不必切 CLI 就能載入 site-specific rules | 需設計安全提示、錯誤呈現與權限邊界 |
| 404 / 410 錯誤頁 client-side redirect evidence | 降低「瀏覽器看似可用、HTTP 狀態仍是錯誤」的判讀落差 | 只新增 additive evidence，不覆蓋原始狀態；target 驗證需遵守既有安全邊界，避免外部連結複查成本暴增 |
| Fragment / duplicate anchor 檢查 | 補足頁內品質提醒 | 屬 optional 品質檢查，不應影響壞連結主判讀 |
| 更完整的 release page template | 降低每次發版人工漏項 | 應包含 artifact、SHA256、簽章狀態與 smoke 結果 |
| Report Analyzer 大型檔案體驗改善 | 讓大型 report 的人工檢視更順 | 優先沿用 NDJSON sidecar，不急著改主契約 |
| 更細的 external risk governance 欄位 | 方便外連治理與交辦 | 需避免把工具膨脹成完整治理平台 |

### 404 / 410 client-side redirect evidence 規劃筆記

這是小範圍但重要的候選功能。第一版應掛在既有 `404 / 410` confirmation 階段，作為 additive evidence，而不是新的主掃描流程。

建議範圍：

- 只處理同站 `404 / 410` confirmation candidate。
- 只在二次確認使用 `GET` 且取得 HTML body 時分析。
- 只做靜態 HTML pattern 偵測，不引入 headless browser。
- 優先偵測 `<meta http-equiv="refresh">`、`window.location`、`window.location.href`、`location.assign()`、`location.replace()` 等簡單 client-side redirect。
- redirect target 最多驗證 1 個，並必須沿用既有 URL security policy、timeout、redirect limit 與 SSRF 防護。
- target 驗證結果只作為證據，不覆蓋原始 `status`、`ok`、`issueType` 或 `confirmation.outcome`。

建議 report 欄位可放在 `confirmation.clientRedirectEvidence`，至少包含 `detected`、`source`、`attribute`、`targetUrl`、`targetStatus`、`targetOk` 與 `reason`。若未偵測到，輸出 `detected=false` 與 `reason=no_client_redirect`，避免 GUI 猜測欄位缺漏。

GUI / Report Analyzer 應以承辦人可理解的方式呈現，例如：「此錯誤頁會在瀏覽器端導向其他頁面，但原始 HTTP 狀態仍是 404 / 410，建議確認原連結是否應更新。」若 target 不可確認可用，則標示需要人工確認。

實作可拆成三步：核心 report evidence、GUI / Report Analyzer / CSV 呈現、文件與 fixture 測試。因為會擴充 report schema，應視為 minor 版本候選，不放入 patch release。

## 延後項目

這些項目有價值，但目前不應插入 patch release 或阻擋既有正式版維護。

| 項目 | 延後理由 |
| --- | --- |
| Scheduler / 平台化監控 | 超出本機輔助工具定位 |
| 複雜 suppress rules | 需要更完整治理流程，暫不納入近期版本 |
| 多種技術型 profile presets | 目前保留簡化掃描模式，避免增加操作負擔 |
| Headless render 預設化 | 容易引入速度、資源與 bot protection 問題，需另開設計 |
| `report.json` streaming parser | 已先用 NDJSON sidecar 和「載入更多」降低大型 report 痛點 |
| 集中式規則平台 | 目前只補 schema、trace 與安全載入，不建立多人審核或發布流程 |
| 公開信任 code signing | 對正式對外散布有價值，但需另行評估憑證成本、流程與維護責任 |

## 全域原則

- 掃描邊界：先維持 DOM / HTML / SPA payload / site rules 抽取，不預設引入 headless browser。
- 規則邊界：site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler。
- 外連邊界：保守處理 rate limit、WAF、Bot challenge 與 timeout，並明確標示需要人工確認。
- 安全邊界：預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- 合規邊界：不偽裝 Googlebot，不繞過 CAPTCHA，不把工具定位成 WAF bypass。
- 輸出邊界：`report.json` 是主契約；NDJSON sidecar 是大型資料的輔助入口。
- 版本邊界：patch release 只應包含修正、文件、文案與 release packaging 小修；若改 report schema、CLI 契約或掃描策略，應評估 minor 版本。

## 文件入口

| 主題 | 文件 |
| --- | --- |
| 使用者入口 | [README.md](README.md) |
| CLI 參數與進階用法 | [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) |
| 技術流程與 report schema | [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) |
| Report normalization / diff | [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md) |
| 文件索引 | [docs/README.md](docs/README.md) |
| 目前狀態歷史快照 | [docs/archive/CURRENT_STATE_2026-08-03.md](docs/archive/CURRENT_STATE_2026-08-03.md) |
| 已完成里程碑 | [docs/archive/README.md](docs/archive/README.md) |
