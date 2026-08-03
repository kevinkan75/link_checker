# Local Link Checker

Local Link Checker 是一套本機執行的網站連結檢查工具，協助承辦人、網站維護者與稽核人員找出站內壞連結、需要人工確認的外部連結、轉址問題與掃描限制訊號。

工具提供三個 GUI 功能頁：

- 連結檢查：輸入網站 URL，執行即時連結檢查。
- 外部連結分析：匯入外連清單，做網域彙整、風險分類與治理檢視。
- 報告分析：匯入 report 或 broken.ndjson，整理待判讀清單、處理建議、來源頁與問題網域排行。

所有掃描與輸出都在本機完成；GUI server 只綁定 `127.0.0.1`。

## 目前版本

最新正式版本：`v1.0.4`

GitHub Release（發布時建立）：
[v1.0.4 Portable](https://github.com/kevinkan75/link_checker/releases/tag/v1.0.4)

`v1.0.4` 是 patch release，重點是改善 Report Analyzer 的人工檢視流程與承辦人友善文案，並整理文件歸檔。此版本沒有改變掃描邏輯、CLI 參數、GUI API、report schema 或輸出契約。

Release artifact：

| 檔案 | 用途 |
| --- | --- |
| `LinkChecker-portable.zip` | Windows portable package |
| `LinkChecker-portable.build-manifest.json` | release metadata、source commit、zip hash、runtime 與簽章狀態 |
| `LinkChecker-portable.zip.sha256` | zip SHA256 |
| `v1.0.4-notes.md` | release notes |

Portable zip SHA256 以 GitHub Release 上傳的 `LinkChecker-portable.zip.sha256` 與 `LinkChecker-portable.build-manifest.json` 為準。

注意：此 portable build 的 `Start Link Checker.exe` 記錄為 `NotSigned`，因為本機自簽不可用。散布或使用前請核對 zip SHA256 與 build manifest。

## 快速開始

### 使用 portable 版本

1. 從 [GitHub Release](https://github.com/kevinkan75/link_checker/releases/tag/v1.0.4) 下載 `LinkChecker-portable.zip`。
2. 解壓縮整個資料夾。
3. 執行 `Start Link Checker.exe`，或在資料夾內執行：

```powershell
.\gui.cmd
```

瀏覽器會開啟本機 GUI。若沒有自動開啟，可手動前往：

```text
http://127.0.0.1:8787
```

### 從原始碼啟動

在 repo 根目錄執行：

```powershell
.\gui.cmd
```

輸入網站 URL 後按「開始檢查」。完成後，GUI 會在 `logs/` 建立本次掃描資料夾，包含完整 report、CSV、NDJSON sidecar 與事件紀錄。

## GUI 預設值

主 GUI 使用較保守的日常掃描設定，並預設檢查外部連結。

| 設定 | 預設 |
| --- | --- |
| 檢查外部連結 | 開啟 |
| 最多頁面 | `300` |
| 最大深度 | `3` |
| 全站總併發 | `6` |
| 單一 host 併發 | `2` |
| 每 host 固定間隔 | `1000ms` |
| 404 / 410 二次確認 | 開啟 |
| 外部連結帶 Referer | 關閉 |
| robots.txt 讀取 | 開啟 |
| 使用 Windows 憑證 | 關閉 |

若網站容易出現 `403`、`429` 或 timeout，可切換到「更保守」掃描模式，或降低單一 host 併發並增加隨機延遲。

## CLI 基本用法

CLI 預設較保守，只檢查站內連結；若要檢查外部連結，需加上 `--external`。

```powershell
.\check-links.cmd https://example.com
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --progress --output report.json
```

常見進階用法：

```powershell
.\check-links.cmd https://example.com --conservative
.\check-links.cmd https://example.com --system-ca
.\check-links.cmd https://example.com --cache --cache-ttl-hours 24
.\check-links.cmd https://example.com --sitemap https://example.com/sitemap.xml --incremental
```

完整 CLI 參數請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 主要功能

- 站內頁面爬取與 URL 狀態檢查。
- 外部連結盤點與風險分類。
- `404 / 410` 二次確認，降低暫時性誤判。
- `403 / 429 / WAF / Bot / timeout` 等結果的人讀判讀分類。
- SPA / Nuxt payload 與 site link rules 抽取。
- Report diff、TTL cache、incremental scan 與 sitemap seed。
- GUI 即時進度、掃描佇列、Report Analyzer、External Link Analyzer。
- CSV / NDJSON / JSON 輸出，方便 Excel、稽核與後續分析。

## 輸出檔案

GUI 每次掃描會在 `logs/YYYYMMDD-HHMMSS--host--status/` 產生輸出：

| 檔案 | 用途 |
| --- | --- |
| `report.json` | 完整掃描報告與主契約 |
| `summary.json` | GUI 摘要資料 |
| `broken.csv` | 可用 Excel 開啟的交辦友善壞連結清單 |
| `external-links.csv` | 外部連結清單與治理欄位 |
| `checked.ndjson` | 已檢查 URL sidecar |
| `broken.ndjson` | 壞連結 sidecar |
| `external-links.ndjson` | 外部連結 sidecar |
| `external-summary.json` | 外部連結網域與風險摘要 |
| `events.log` | 掃描事件紀錄 |
| `manifest.json` | 輸出檔、版本與環境摘要 |

大型 report 建議優先用 NDJSON sidecar 匯入 Analyzer，以降低瀏覽器一次載入完整 JSON 的壓力。

## 判讀分類

報告會把技術結果翻譯成較容易交辦的分類。GUI 與 Report Analyzer 會把需要承辦人處理或確認的項目稱為「待判讀結果」。

| 判讀分類 | 代表意義 | 建議處理 |
| --- | --- | --- |
| `action_required` | 明確需要處理，例如確認不存在的 `404 / 410` 或 redirect 失效 | 優先修正、移除或更新來源頁連結 |
| `needs_review` | 需要人工確認，例如 `403`、`429`、timeout、TLS 或網路錯誤 | 用瀏覽器人工確認，再決定是否交辦 |
| `external_limited` | 外部網站可能限制工具請求 | 人工確認外站是否可開，必要時與外站窗口確認 |
| `likely_problem` | 可能失效但仍需判斷情境 | 檢查網址、伺服器狀態或內容是否仍有效 |
| `redirect_ok` | 已轉址但最終仍可用 | 可視需要更新成 final URL |
| `ok` | 可先忽略或正常 | 通常不需處理 |
| `page_quality_notice` | 頁內品質提醒，保留給 optional 檢查 | 視內容維護需求處理 |

這些分類會出現在 `report.json`、GUI、Report Analyzer 與 `broken.csv`，方便篩選、交辦與存查。

## 安全與邊界

- 預設只允許 HTTP(S)，並阻擋 localhost、private IP、link-local、metadata 與 reserved IP。
- 若需掃描內部網站，可在確認授權後使用 `--allow-localhost` 或 `--allow-private-ip`。
- 輸出層預設會遮罩敏感 query value。
- `robots.txt` 與掃描授權資訊會寫入 report 的 compliance metadata。
- 工具不會繞過 WAF、Bot challenge 或 CAPTCHA；這類結果會標成需要人工確認。
- GUI server 綁定 `127.0.0.1`，不是公開網路服務。
- Portable package 不安裝 service、不寫入開機啟動、不連接遠端控制伺服器。

## 建立 portable package

從原始碼建立 Windows portable zip：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

輸出位於 `dist/`：

```text
dist\LinkChecker-portable.zip
dist\LinkChecker-portable.build-manifest.json
dist\LinkChecker-portable.zip.sha256
dist\LinkChecker-portable\BUILD-MANIFEST.json
dist\LinkChecker-portable\PORTABLE-README.txt
```

Release 前至少確認：

- external manifest 的 `build.gitCommit` 等於要發佈的 source commit。
- zip 實際 SHA256、`.zip.sha256` 與 manifest 內的 zip SHA256 一致。
- package manifest 內每個 bundled file 的 SHA256 都能驗證。
- `runtime\node.exe` Authenticode 狀態為 `Valid`。
- `Start Link Checker.exe` 的簽章狀態已清楚記錄；若為 `NotSigned`，release notes 與 portable README 必須明確提示。

## 文件索引

- [ROADMAP.md](ROADMAP.md)：目前狀態、近期維護主線、下一階段候選與延後項目。
- [docs/README.md](docs/README.md)：文件總索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：CLI 參數與範例。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：核心流程、report schema、GUI API 與技術契約。
- [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md)：report-to-report diff 與 normalization 設計。
- [docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md](docs/archive/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 評估與驗收紀錄。
- [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)：已完成里程碑的詳細歷史。
- [docs/archive/README.md](docs/archive/README.md)：歸檔文件索引。
