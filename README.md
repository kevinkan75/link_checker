# Local Link Checker

Local Link Checker 是可在本機執行的網站連結檢查工具。它會從指定網址開始讀取 HTML，解析頁面中的連結與資源，繼續檢查同網域頁面，並輸出問題連結、外部連結、診斷摘要與完整 `report.json`。

本文件適合第一次使用者、機關承辦人員與需要快速執行檢查的人閱讀。完整 CLI 參數、規則檔格式與技術細節請參閱 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) 與 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)。

## 目錄

- [工具簡介](#工具簡介)
- [適用情境](#適用情境)
- [快速開始](#快速開始)
- [常見使用情境](#常見使用情境)
- [GUI 使用說明](#gui-使用說明)
- [CLI 基本使用](#cli-基本使用)
- [輸出檔案](#輸出檔案)
- [結果判讀](#結果判讀)
- [常用參數](#常用參數)
- [進階功能](#進階功能)
- [安全邊界與授權](#安全邊界與授權)
- [建立可攜版](#建立可攜版)
- [專案文件](#專案文件)

## 工具簡介

主要功能：

- 同網域頁面檢查、URL inventory 去重、來源頁合併與 canonical key。
- HTTP 狀態、redirect chain、WAF/Bot/CDN 診斷、cache headers 與錯誤分類。
- 同站 `404 / 410` 二次確認，降低暫時性誤判。
- 外部連結清單、網域分類、外部連結治理風險摘要與 CSV / JSON 輸出。
- SPA / Nuxt payload literal 抽取、站台規則推導與 `scanQuality` 診斷。
- GUI 批次佇列、即時進度、問題連結表格與報告下載。

目前版本已支援網站連結檢查、外部連結清單、GUI 批次檢查、報告比對、TTL URL result cache 與主要診斷功能。詳細開發歷程與後續規劃請參閱 [ROADMAP.md](ROADMAP.md)。

## 適用情境

- 一般網站上線前或定期檢查問題連結。
- 政府、學校、公司內部網站需要用本機工具產生檢查紀錄。
- 需要區分真正失效連結、存取被拒、防護阻擋與暫時性網路問題。
- 需要輸出 `broken.csv`、`external-links.csv` 或完整 `report.json` 供後續分析。
- 技術人員需要用 CLI、自動化腳本或規則檔執行進階檢查。

## 快速開始

一般使用者建議優先使用 GUI。

### 使用 GUI

1. 啟動本機 GUI：

   ```powershell
   .\gui.cmd
   ```

2. 開啟瀏覽器並前往：

   ```text
   http://127.0.0.1:8787
   ```

3. 輸入要檢查的網站網址，開始檢查後下載結果檔案。

### 使用 CLI

```powershell
.\check-links.cmd https://example.com
```

或直接使用 Node.js：

```powershell
node .\link-checker.mjs https://example.com
```

## 常見使用情境

| 使用情境 | 建議模式 |
| --- | --- |
| 一般網站檢查 | 使用預設設定 |
| Windows 瀏覽器可開啟，但工具憑證失敗 | 使用 `--system-ca` |
| 網站容易出現 `403`、`429` 或逾時 | 使用 `--conservative` |
| 舊式 TLS 網站無法連線 | 使用 `--legacy-tls` |
| 一次檢查多個網站 | 使用 GUI 佇列功能 |
| 需要規則檔、自動化或完整 JSON | 使用 CLI |

## GUI 使用說明

GUI 適合一般檢查、批次佇列、即時進度與下載報告。

啟動後可輸入網站 URL，設定檢查頁數、深度、全域併發、每 host 併發、請求間隔、逾時、重試次數與語言標頭，也可選擇是否檢查外部連結。

若要批次檢查多個網站，可在「待檢核網站佇列」輸入多個網址，一行一個。按「加入佇列」後再按「開始佇列」，工具會以單機本機佇列檢查；「同時檢查網站數」預設為 `1`，可設定 `1` 到 `5`。政府網站建議使用 `1` 或 `2`，較高併行數可能增加 `403`、`429` 或逾時。

多網站併行檢查時，佇列表格中的執行中網站會提供「監看」按鈕。GUI 會先自動監看第一個執行中的網站；手動點選「監看」後，即時進度、事件紀錄與問題連結表會切換到該網站。

GUI 每次檢查結束後會自動保存記錄檔到 `logs/` 目錄，資料夾命名格式為 `YYYYMMDD-HHMMSS--host--status`。

## CLI 基本使用

CLI 適合自動化、進階參數、規則檔與技術診斷。

```powershell
.\check-links.cmd https://example.com --max-pages 200 --max-depth 8
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --progress
.\check-links.cmd https://example.com --output report.json
```

完整 CLI 參數請參閱 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 輸出檔案

### 一般使用者常用

| 檔案 | 用途 |
| --- | --- |
| `broken.csv` | 問題連結清單，可用 Excel 開啟 |
| `summary.json` | 檢查摘要與主要統計 |
| `report.json` | 完整掃描報告 |

### 技術人員或進階分析使用

| 檔案 | 用途 |
| --- | --- |
| `external-links.csv` | 外部連結清單、分類、風險與來源頁 |
| `external-summary.json` | 外部連結治理摘要 |
| `events.log` | 執行過程事件紀錄 |
| `manifest.json` | 同一次輸出的工具版本、schema 版本、runtime 與檔案清單 |

CLI 使用 `--output <file>` 時會輸出指定的完整 JSON report，並在同目錄建立 `manifest.json`；目前沒有獨立的 CSV / summary 轉換指令，需要這些檔案時請使用 GUI 自動保存。

## 結果判讀

注意：工具回報的問題連結不一定都代表連結已失效。例如 `403`、防護阻擋、逾時或 `429`，可能與網站權限、防護政策或請求頻率有關，建議再以瀏覽器人工確認。

| 類型 | 代表意義 | 建議處理方式 |
| --- | --- | --- |
| `404 / 410` | 頁面或資源不存在 | 優先修正或移除連結 |
| 防護阻擋 | WAF/Bot/CDN 防護層拒絕程式化請求 | 使用瀏覽器人工確認，或與網站管理方協調 |
| 存取被拒 | HTTP `403` | 確認是否需登入、權限、Cookie、Referer 或特定 User-Agent |
| HTTP 錯誤 | 其他 HTTP `400` 以上狀態 | 依狀態碼與來源頁判斷是否修正 |
| 逾時 | 請求未於期限內完成 | 重試或降低併發 |
| 網路錯誤 | DNS、連線、TLS 或權限問題 | 確認網址、憑證與網路環境 |

用語分工：

| 用語 | 定義 |
| --- | --- |
| 問題連結 | 廣義問題，包含 `404`、`410`、`403`、逾時、防護阻擋與網路錯誤 |
| 失效連結 | 狹義問題，主要指 `404`、`410` 或確認不存在的連結 |
| 無效連結 | 對外公告或機關填報時可使用的正式用語 |

`confirmation.outcome` 代表二次確認結論：

- `recovered`：初次為 `404 / 410`，二次確認轉為可正常開啟的 `2xx / 3xx`。
- `confirmed_missing`：二次確認仍為 `404 / 410`。
- `needs_review`：二次確認遇到逾時、`403`、`429`、防護阻擋、網路錯誤或不明結果，建議人工複查。

程式結束代碼：

- `0`：沒有發現失效連結。
- `1`：執行參數或程式錯誤。
- `2`：有發現失效連結。

## 常用參數

### 掃描範圍

| 參數 | 說明 |
| --- | --- |
| `--max-pages <n>` | 最多爬行頁面數 |
| `--max-depth <n>` | 最大爬行深度 |
| `--external` | 也檢查外部網域連結 |
| `--no-confirm-404` | 關閉同站 `404 / 410` 二次確認 |

### 效能與友善檢查

| 參數 | 說明 |
| --- | --- |
| `--global-concurrency <n>` | 全域同時請求數 |
| `--per-host-concurrency <n>` | 每個 host 同時請求數 |
| `--request-delay <s>` | 同一 host 請求間隔秒數 |
| `--conservative` | 使用低併發、隨機延遲與保守請求策略 |

### 相容性

| 參數 | 說明 |
| --- | --- |
| `--system-ca` | 使用作業系統或瀏覽器信任的系統根憑證 |
| `--legacy-tls` | 啟用舊 TLS 相容模式 |
| `--allow-localhost` | 允許可信任的本機 localhost 檢查 |
| `--allow-private-ip` | 允許可信任內網 IP 檢查，不包含 localhost |

### 輸出與診斷

| 參數 | 說明 |
| --- | --- |
| `--progress` | 執行時顯示單行即時狀態 |
| `--verbose` | 逐行顯示爬行、請求、略過與檢查事件 |
| `--output <file>` | 把完整結果輸出成 JSON |
| `--json` | 在 stdout 輸出完整 JSON |

## 進階功能

### Report diff

`report-diff.mjs` 可比對兩份既有 `report.json`，產生差異報告：

```powershell
node .\report-diff.mjs old-report.json new-report.json --output diff.json
```

這個指令只讀取已產生的 report，不重新掃描網站、不重新送 HTTP request，也不改寫原始 report。

### SPA / Nuxt 與 CMS payload

本工具支援 SPA / Nuxt 網站的部分連結抽取。`--spa-links` 預設為 `auto`，偵測到 SPA / Nuxt 訊號或載入 site link rules 時，會從 inline script / payload 抽取明確 URL 與 `/` 開頭 path。

若需設定站台特定規則，請參閱 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) 與 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)。CEC 範例規則位於 [docs/rules/cec-site-link-rules.json](docs/rules/cec-site-link-rules.json)。

### TTL URL result cache

CLI 可用 `--cache` 啟用 persistent TTL URL status-result cache，降低重複檢查成本：

```powershell
.\check-links.cmd https://example.com --cache --cache-ttl-hours 24
```

cache 預設關閉，檔案預設寫到 `.cache/link-check-cache.json`。若需要忽略舊結果並重新檢查，可使用 `--refresh-cache`。P7 cache 只服務不需要 HTML body 的 URL status check；頁面爬行仍會實際抓取 HTML，因此不會跳過連結抽取或 SPA payload 抽取。

### GUI / CLI 功能差異

| 功能 | GUI | CLI |
| --- | --- | --- |
| 檢查單一網站 | 支援 | 支援 |
| 批次檢查多個網站 | 支援 | 可自行搭配腳本 |
| 即時進度 | 支援 | `--progress` |
| 下載報告 | 支援 | `--output` |
| 網域分類規則 | 尚未提供規則檔欄位 | `--domain-rules` |
| 外部連結治理規則 | 尚未提供規則檔欄位 | `--external-risk-rules` |
| SPA / CMS 站台規則 | 尚未提供規則檔欄位 | `--site-link-rules` |
| TTL URL result cache | 不提供表單控制，report 可保存摘要 | `--cache`、`--refresh-cache` |

## 安全邊界與授權

本工具預設阻擋 localhost、private IP、link-local、metadata IP、reserved IP 與非 HTTP(S) scheme；redirect 後也會重新檢查目標。若要檢查可信任的本機或內部網站，請依情境使用 `--allow-localhost` 或 `--allow-private-ip`。

工具不會驗證使用者是否取得掃描授權。使用前請確認已符合網站政策與組織規範。

工具會記錄 start origin 的 `robots.txt`、`scanPolicy` 與 `compliance`，並支援 `--authorized-scan`、`--authorization-note` 與 `--no-robots`。這些欄位只記錄工具行為與使用者宣告，不代表工具已驗證授權；robots.txt path enforcement 仍放在後續 `--respect-robots` 階段。

工具會嘗試降低誤判並保存防護層診斷，但不繞過 WAF/Bot 防護。當結果顯示「Blocked by protection layer」或 GUI 顯示「防護阻擋」時，通常代表網站前方的防護服務拒絕程式化請求，建議用一般瀏覽器人工確認，或請網站管理方允許檢查來源。

## 建立可攜版

產生 Windows 可攜版 zip：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

輸出檔案會放在：

```text
dist\LinkChecker-portable.zip
```

可攜版內含 `runtime\node.exe`，使用者解壓縮後不需要另外安裝 Node.js。

## 專案文件

- [ROADMAP.md](ROADMAP.md)：目前開發主線；P6 report-to-report diff 第一版、P6.5a、P6.5b 與 P7 TTL URL result cache 已完成第一版，後續規劃 P8 incremental scan。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數、規則檔格式與進階使用。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：架構、流程、資料模型與 report schema 技術規格。
- [docs/P7_RELEASE_CLOSURE.md](docs/P7_RELEASE_CLOSURE.md)：P7 TTL URL result cache 發布收尾與驗收紀錄。
- [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)：已完成里程碑、驗收紀錄與設計理由。
- [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性建議採納紀錄。
