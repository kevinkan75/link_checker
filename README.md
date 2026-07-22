# Local Link Checker

Local Link Checker 是一套本機執行的網站連結檢查工具，主要用來協助承辦人或維護者找出站內壞連結、需要人工確認的外部連結、轉址問題與掃描限制訊號。工具提供 GUI、CLI、Report Analyzer 與 External Link Analyzer；所有掃描與輸出都在本機完成。

目前主 GUI 的預設行為會檢查外部連結。CLI 仍維持保守預設，需加上 `--external` 才會檢查外部連結。

## 快速開始

啟動 GUI：

```powershell
.\gui.cmd
```

開啟瀏覽器：

```text
http://127.0.0.1:8787
```

輸入網站 URL 後按「開始檢查」。完成後，GUI 會在 `logs/` 建立本次掃描資料夾，包含完整 report、CSV、NDJSON sidecar 與執行紀錄。

CLI 基本用法：

```powershell
.\check-links.cmd https://example.com
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --progress --output report.json
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

## GUI 預設值

主 GUI 使用較保守的日常掃描設定：

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

報告會把技術結果翻譯成較容易交辦的分類：

| 分類 | 說明 |
| --- | --- |
| `action_required` | 明確需要處理，例如確認不存在的 `404 / 410` 或 redirect 失效 |
| `needs_review` | 需要人工確認，例如 `403`、`429`、timeout、TLS 或網路錯誤 |
| `external_limited` | 外部網站可能限制工具請求，建議人工確認 |
| `likely_problem` | 可能失效但仍需判斷情境 |
| `redirect_ok` | 已轉址但最終仍可用 |
| `ok` | 可先忽略或正常 |
| `page_quality_notice` | 頁內品質提醒，保留給 optional 檢查 |

這些分類會出現在 `report.json`、GUI、Report Analyzer 與 `broken.csv`，方便篩選、交辦與存查。

## 安全與邊界

- 預設只允許 HTTP(S)，並阻擋 localhost、private IP、link-local、metadata 與 reserved IP。
- 若需掃描內部網站，可在確認授權後使用 `--allow-localhost` 或 `--allow-private-ip`。
- 輸出層預設會遮罩敏感 query value。
- `robots.txt` 與掃描授權資訊會寫入 report 的 compliance metadata。
- 工具不會繞過 WAF、Bot challenge 或 CAPTCHA；這類結果會標成需要人工確認。
- GUI server 綁定 `127.0.0.1`，不是公開網路服務。

## Portable Build

建立 Windows portable zip：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

輸出位於 `dist/`：

```text
dist\LinkChecker-portable.zip
dist\LinkChecker-portable.build-manifest.json
dist\LinkChecker-portable.zip.sha256
```

Portable 版本包含 bundled Node runtime、GUI launcher、CLI scripts、文件與 public assets。`Start Link Checker.exe` 目前使用 local self-signed certificate，Windows SmartScreen 可能提示未知發行者；正式散布前若需要更順暢的使用者體驗，應評估公開 code signing。

## 文件索引

- [ROADMAP.md](ROADMAP.md)：目前狀態、近期主線、release gate 與延後項目。
- [docs/README.md](docs/README.md)：文件總索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：CLI 參數與範例。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：核心流程、report schema、GUI API 與技術契約。
- [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 評估與驗收紀錄。
- [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)：已完成里程碑的詳細歷史。
- [docs/archive/README.md](docs/archive/README.md)：歸檔文件索引。
