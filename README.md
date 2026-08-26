# Local Link Checker

Local Link Checker 是一套在本機執行的網站連結檢查工具，協助承辦人、網站維護者與稽核人員找出需要處理的站內壞連結、需要人工確認的外部連結、轉址問題與掃描限制訊號。

所有掃描、匯入與輸出都在本機完成；GUI server 只綁定 `127.0.0.1`，不是公開網路服務。

目前正式版本：`v1.3.1`

v1.3.1 是維護與可靠性 patch release；下列 Static Discovery Resilience 能力源自 v1.3.0：工具仍先執行一般靜態探索；若起始頁未產生額外同站可爬頁面，且使用者未提供明確的 `--sitemap`，工具會嘗試同站慣例路徑 `/sitemap.xml`。接受的 XML sitemap 會沿用既有 sitemap 與 crawler pipeline 建立 seed；若 XML 不存在、無法使用或沒有可用 seed，既有的保守 HTML sitemap fallback 仍可接續。此功能不執行 Browser、headless 或 Dynamic Render，也不代表掃描已完整涵蓋整個網站。

## 適用情境

| 你想做的事 | 建議使用 |
| --- | --- |
| 檢查一個網站有哪些連結需要處理 | GUI 的「連結檢查」 |
| 彙整外部連結網域、分類與治理狀態 | GUI 的「外部連結分析」 |
| 檢視既有報告中的待判讀結果與來源頁 | GUI 的「報告分析」 |
| 需要批次執行、指定輸出檔或整合其他流程 | CLI |
| 需要比對兩次掃描結果 | `report-diff.mjs` |

## 快速開始

### 使用 portable 版本

1. 從 [v1.3.1 Portable](https://github.com/kevinkan75/link_checker/releases/download/v1.3.1/LinkChecker-portable.zip) 下載 `LinkChecker-portable.zip`。
2. 解壓縮整個資料夾。
3. 執行 `Start Link Checker.exe`，或在資料夾內執行：

```powershell
.\gui.cmd
```

瀏覽器會開啟本機 GUI。若沒有自動開啟，可手動前往：

```text
http://127.0.0.1:8787
```

注意：portable launcher 簽章狀態以 build manifest 為準，可能是未簽或 local self-signed。散布或使用前，請核對 release 頁提供的 `LinkChecker-portable.zip.sha256` 與 build manifest；若可攜資料夾內出現 `LinkChecker-local-code-signing.cer`，那只供內部自簽 launcher 的手動信任流程使用，一般使用者不需要安裝。

### 從原始碼啟動

在 repo 根目錄執行：

```powershell
.\gui.cmd
```

輸入網站 URL 後按「開始檢查」。完成後，GUI 會在 `logs/` 建立本次掃描資料夾，包含 report、CSV、NDJSON sidecar 與事件紀錄。

## GUI 功能

### 連結檢查

輸入網站 URL 後執行檢查。主 GUI 使用較保守的日常掃描設定，並預設檢查外部連結。

常用預設值：

| 設定 | 預設 |
| --- | --- |
| 檢查外部連結 | 開啟 |
| 最多頁面 | `300` |
| 最大深度 | `3` |
| 全站總併發 | `6` |
| 單一 host 併發 | `2` |
| 每 host 固定間隔 | `1000ms` |
| 404 / 410 二次確認 | 開啟 |
| robots.txt 讀取 | 開啟 |

若網站容易出現 `403`、`429` 或 timeout，可切換到「更保守」掃描模式，或降低單一 host 併發並增加隨機延遲。

### 外部連結分析

匯入 GUI 輸出的外連清單，整理外部網域、風險分類與治理狀態。

建議選檔順序：

1. 一般情境：選 `external-links.csv`。
2. 大型資料：選 `external-links.ndjson`。
3. 需要完整報告來源：選 `report.json`。

「風險規則與白名單」是可選進階設定。一般分析可以略過；只有要補充舊資料、未分類外連，或把已知可信任網域排除時才需要設定。

預設外連分類只提供基本提示，例如短網址、追蹤分析、社群、CDN、地圖與 webmail。它不是完整惡意網站資料庫；若要判讀 malware、phishing、blocklist、watchlist 或機關自訂白名單，請載入分類規則或外部風險規則。

不知道分類規則檔格式時，可從 [docs/rules/basic-domain-rules.template.json](docs/rules/basic-domain-rules.template.json) 複製一份後替換成自己的網域。

外部表單、嵌入內容、短網址、追蹤分析與異常轉址會優先提示人工檢視；若某個網域在白名單內但本次檢查仍出現錯誤或防護限制，畫面會顯示「白名單需檢視」。

分析頁會把風險原因分成治理規則、內容分類、HTTP 狀態、轉址與防護限制，協助 TA 先看規則命中，再看網址用途與本次檢查狀態。

### 報告分析

匯入 `report.json` 或 `broken.ndjson`，整理待判讀清單、處理建議、來源頁與問題網域排行。

大型 report 建議優先用 `broken.ndjson` 匯入，以降低瀏覽器一次載入完整 JSON 的壓力。

## CLI 基本用法

CLI 預設只檢查站內連結；若要檢查外部連結，需加上 `--external`。

```powershell
.\check-links.cmd https://example.com
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --progress --output report.json
```

常見相容模式：

```powershell
.\check-links.cmd https://example.com --conservative
.\check-links.cmd https://example.com --system-ca
```

完整 CLI 參數、cache、incremental、sitemap 與 rules 說明請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 輸出檔案

GUI 每次掃描會在 `logs/YYYYMMDD-HHMMSS--host--status/` 產生輸出。

| 檔案 | 用途 |
| --- | --- |
| `report.json` | 完整掃描報告，也是主要資料契約 |
| `broken.csv` | 可用 Excel 開啟的待處理 / 待確認連結清單 |
| `external-links.csv` | 外部連結清單與治理欄位 |
| `summary.json` | GUI 摘要資料 |
| `manifest.json` | 輸出檔、工具版本與環境摘要 |
| `checked.ndjson` | 已檢查 URL sidecar，供大型資料輔助使用 |
| `broken.ndjson` | 壞連結 sidecar，可匯入報告分析 |
| `external-links.ndjson` | 外部連結 sidecar，可匯入外部連結分析 |
| `external-summary.json` | 外部連結網域與風險摘要 |
| `events.log` | 掃描事件紀錄 |

一般交辦優先看 `broken.csv` 與 `external-links.csv`；需要完整追溯時再看 `report.json`、`manifest.json` 與 sidecar。

## 結果判讀

工具會把技術結果整理成較容易交辦的分類。GUI 與 Report Analyzer 會把需要承辦人處理或確認的項目稱為「待判讀結果」。

| 判讀分類 | 代表意義 | 建議處理 |
| --- | --- | --- |
| `action_required` | 明確需要處理，例如確認不存在的 `404 / 410` 或 redirect 失效 | 優先修正、移除或更新來源頁連結 |
| `needs_review` | 需要人工確認，例如 `403`、`429`、timeout、TLS 或網路錯誤 | 用瀏覽器人工確認，再決定是否交辦 |
| `external_limited` | 外部網站可能限制工具請求 | 人工確認外站是否可開，必要時與外站窗口確認 |
| `likely_problem` | 可能失效但仍需判斷情境 | 檢查網址、伺服器狀態或內容是否仍有效 |
| `redirect_ok` | 已轉址但最終仍可用 | 可視需要更新成 final URL |
| `ok` | 可先忽略或正常 | 通常不需處理 |
| `page_quality_notice` | 頁內品質提醒，保留給 optional 檢查 | 視內容維護需求處理 |

提醒：`403`、`429`、timeout、WAF、Bot challenge 或 TLS 類結果不一定代表連結壞掉，通常需要人工確認。

注意：若掃描結果未發現壞連結，只代表本次已探索並成功檢查到的連結未發現明確問題，不代表整個網站已完整涵蓋；重要頁面及未被探索到的內容仍建議人工確認。

### 404 / 410 與瀏覽器端導向

有些網站的錯誤頁會先回傳 HTTP `404 / 410`，再用瀏覽器端導向把使用者帶到其他頁面。這種情況下，工具仍會保留原始 HTTP 狀態與二次確認結果，不會直接改判成正常連結。

若報告或 GUI 顯示「瀏覽器端導向」：

- 導向目標可開啟：代表原連結的錯誤頁會把瀏覽器導到其他頁，建議確認來源頁是否應改成新的目標網址。
- 導向目標是外部網站：工具只記錄目標，不自動檢查外部導向目標，建議人工確認是否可開啟。
- 導向目標仍失敗、逾時或被防護限制：建議人工確認後再決定是否修正或交辦。

這個提示是輔助證據，不會覆蓋 `404 / 410` 的原始判讀。

## 安全與邊界

- 預設只允許 HTTP(S)，並阻擋 localhost、private IP、link-local、metadata 與 reserved IP。
- 若需掃描內部網站，可在確認授權後使用 `--allow-localhost` 或 `--allow-private-ip`。
- 輸出層預設會遮罩敏感 query value。
- `robots.txt` 與掃描授權資訊會寫入 report 的 compliance metadata。
- 工具不會繞過 WAF、Bot challenge 或 CAPTCHA；這類結果會標成需要人工確認。
- GUI server 綁定 `127.0.0.1`，不是公開網路服務。
- Portable package 不安裝 service、不寫入開機啟動、不連接遠端控制伺服器。

## 文件索引

- [ROADMAP.md](ROADMAP.md)：目前狀態、近期維護主線、下一階段候選與延後項目。
- [docs/README.md](docs/README.md)：文件總索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：CLI 參數、cache、incremental、sitemap 與 rules。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：核心流程、report schema、GUI API 與技術契約。
- [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md)：report-to-report diff 與 normalization 設計。
- [docs/archive/README.md](docs/archive/README.md)：歷史評估、驗收紀錄與舊版文件快照。
