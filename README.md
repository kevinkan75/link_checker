# Local Link Checker

Local Link Checker 是可在本機執行的無效連結檢測輔助工具。它會從指定網址開始檢查同網域頁面、盤點外部連結，並輸出待判讀清單、摘要與完整報告。

本工具主要提供政府機關承辦人員、網站窗口與需要快速產生檢查紀錄的人使用。完整 CLI 參數、規則檔格式與技術細節請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) 與 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)。

## 產品定位

本專案定位為本地端、低門檻、輔助型工具。它不是要取代機關既有 CMS、網站維運流程、稽核系統或正式監控平台，而是協助承辦人快速盤點：

- 可能失效的站內連結。
- 需要人工複核的狀態，例如 `403`、`429`、timeout 或防護阻擋。
- 外部連結與來源頁。
- 可交辦、可存查的檢查結果。

掃描結果應作為輔助資訊；工具不會替承辦人做最終判定。後續功能也會以「清楚、保守、可交辦」為優先。

## 快速開始

一般使用者建議優先使用 GUI。

1. 啟動本機 GUI：

   ```powershell
   .\gui.cmd
   ```

2. 開啟瀏覽器：

   ```text
   http://127.0.0.1:8787
   ```

3. 輸入要檢查的網站網址，開始檢查。

4. 檢查完成後下載報告或到 `logs/` 查看自動保存的結果。

CLI 基本用法：

```powershell
.\check-links.cmd https://example.com
```

## 常見情境

| 情境 | 建議 |
| --- | --- |
| 一般網站檢查 | 使用 GUI 預設設定 |
| 一次檢查多個網站 | 使用 GUI 佇列，一行一個網址 |
| 網站容易出現 `403`、`429` 或 timeout | 降低同時檢查數，或使用 CLI `--conservative` |
| Windows 瀏覽器可開，但工具憑證失敗 | 使用 CLI `--system-ca` |
| 舊式 TLS 網站無法連線 | 使用 CLI `--legacy-tls` |
| 需要規則檔、自動化或完整 JSON | 使用 CLI，詳見 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) |

## GUI 使用

GUI 適合一般檢查、批次佇列、即時進度與下載報告。

- 單站檢查：輸入網址後開始檢查。
- 批次檢查：在待檢核網站佇列輸入多個網址，一行一個。
- 監看進度：多網站併行時可切換正在監看的網站。
- 自動保存：每次檢查結束後會保存到 `logs/YYYYMMDD-HHMMSS--host--status/`。

政府網站建議保守使用：同時檢查網站數維持 `1` 或 `2`，避免增加 `403`、`429` 或 timeout。

## 結果判讀

工具會優先用「判讀分類」呈現結果，協助承辦人判斷哪些要處理、哪些要人工確認、哪些只是外站限制或轉址資訊。HTTP 狀態碼仍會保留在明細中，作為技術原因。

| 判讀分類 | 代表意義 | 建議處理 |
| --- | --- | --- |
| 需處理 | 已確認不存在，或轉址最後到錯誤頁 | 優先確認來源頁，並修正或移除連結 |
| 需人工確認 | `403`、`429`、timeout、防護阻擋或不明結果 | 用瀏覽器人工確認是否可正常開啟，再決定是否交辦 |
| 外站限制 | 外部網站拒絕、限流或防護阻擋工具請求 | 人工確認，或與對方網站窗口協調 |
| 可能失效 | 其他 `4xx / 5xx` 或尚未達高信心確認的錯誤 | 確認網址、伺服器狀態或頁面是否仍存在 |
| 已轉址仍可用 | 連結目前可到達，但 final URL 不同 | 可視情況更新原連結 |
| 可先忽略 / 正常 | 正常、允許清單或低風險資訊 | 通常不需處理 |
| 頁內品質提醒 | 頁內錨點或重複 anchor 類提醒 | 視內容維護需求處理 |

用語建議：

- 待判讀結果：需要承辦人看過、交辦或存查的結果，包含需處理、需人工確認、外站限制與可能失效。
- 問題連結：舊版廣義用語，可能包含 `404`、`410`、`403`、timeout、防護阻擋與網路錯誤。
- 失效連結：狹義問題，主要指 `404`、`410` 或確認不存在的連結。
- 無效連結：對外公告或機關填報時可使用的正式用語。

`confirmation.outcome` 是同站 `404 / 410` 二次確認結果：

- `recovered`：二次確認後恢復正常。
- `confirmed_missing`：二次確認仍不存在。
- `needs_review`：遇到 timeout、`403`、`429`、防護阻擋或不明結果，建議人工複核。

## 輸出檔案

GUI 會在每次檢查完成後保存一組檔案。

| 檔案 | 用途 |
| --- | --- |
| `broken.csv` | 交辦友善的待判讀清單，可用 Excel 開啟；前段包含判讀分類、建議處理、是否需人工確認、來源頁與問題網址 |
| `summary.json` | 檢查摘要與主要統計 |
| `report.json` | 完整掃描報告 |
| `external-links.csv` | 外部連結清單、分類與來源頁 |
| `events.log` | 執行過程事件紀錄 |
| `manifest.json` | 同一次輸出的工具版本、schema 版本、runtime 與檔案清單 |

大型報告也會保存 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson` 作為輔助格式。`report.json` 仍是正式完整報告。

CLI 使用 `--output <file>` 時會輸出完整 JSON report，並在同目錄建立 `manifest.json`。

## CLI 基本用法

CLI 適合自動化、進階參數、規則檔與技術診斷。

```powershell
.\check-links.cmd https://example.com --max-pages 200 --max-depth 8
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --progress
.\check-links.cmd https://example.com --output report.json
```

常用參數：

| 參數 | 用途 |
| --- | --- |
| `--max-pages <n>` | 最多檢查頁面數 |
| `--max-depth <n>` | 最大檢查深度 |
| `--external` | 也檢查外部網域連結 |
| `--conservative` | 使用保守請求策略 |
| `--system-ca` | 使用系統根憑證 |
| `--legacy-tls` | 啟用舊 TLS 相容模式 |
| `--progress` | 顯示即時狀態 |
| `--output <file>` | 輸出完整 JSON report |

完整參數請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 進階功能

進階功能以 CLI 為主：

- Report diff：比對兩份既有 `report.json`，不重新掃描網站。
- SPA / Nuxt payload 抽取：從部分 inline script / payload 抽取連結。
- Site link rules：針對 CMS 或站台欄位推導連結。
- TTL URL result cache：降低重複 status check 成本。
- Incremental scan：讀取既有 report / state / sitemap，優先重查變更或曾失敗的 URL。

詳細用法請看：

- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)
- [docs/rules/cec-site-link-rules.json](docs/rules/cec-site-link-rules.json)

## 安全邊界與授權

- 本工具預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與非 HTTP(S) scheme。
- redirect 後也會重新檢查目標安全邊界。
- 如需檢查可信任的本機或內部網站，請依情境使用 `--allow-localhost` 或 `--allow-private-ip`。
- 工具不會驗證使用者是否取得掃描授權；使用前請確認符合網站政策與組織規範。
- 工具會記錄 `robots.txt`、`scanPolicy` 與 `compliance`，但這些欄位只記錄工具行為與使用者宣告，不代表工具已驗證授權。
- 工具不繞過 WAF/Bot 防護；遇到防護阻擋時，建議人工確認或與網站管理方協調。

## 建立可攜版

產生 Windows 可攜版 zip：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

輸出檔案：

```text
dist\LinkChecker-portable.zip
```

可攜版內含 `runtime\node.exe`，使用者解壓縮後不需要另外安裝 Node.js。

## 專案文件

- [ROADMAP.md](ROADMAP.md)：目前開發主線、產品定位護欄與近期規劃。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數、規則檔格式與進階使用。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：架構、流程、資料模型與 report schema 技術規格。
- [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md)：完整專案評估與產品定位校準。
- [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)：已完成里程碑、驗收紀錄與設計理由。
- [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性採納紀錄。
