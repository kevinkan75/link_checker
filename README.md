# Local Link Checker

Local Link Checker 是一套在本機執行的網站連結檢查工具，協助政府機關網站承辦人、網站維護人員與稽核人員找出可能失效的連結、需要人工確認的結果、轉址狀況、存取被拒、防護阻擋、逾時與憑證問題，並匯出可交辦或存查的檢查結果。

所有掃描、匯入與輸出都在本機完成；GUI server 只綁定 `127.0.0.1`，不是公開網路服務。

目前正式版本：`v1.3.1`

## 適合誰使用

| 使用者 | 常見目的 |
| --- | --- |
| 政府網站承辦人 | 找出需要修正、移除、更新或交辦確認的連結。 |
| 網站維護人員 | 檢查站內連結、轉址、憑證、逾時與防護阻擋狀況。 |
| 稽核或管理人員 | 匯出檢查結果，保存紀錄並追蹤後續處理。 |

## 可以做什麼

| 你想做的事 | 建議使用 |
| --- | --- |
| 檢查一個網站有哪些連結需要處理 | GUI 的「連結檢查」 |
| 整理外部連結網域、分類與治理狀態 | GUI 的「外部連結分析」 |
| 檢視既有報告中的待判讀結果與來源頁 | GUI 的「報告分析」 |
| 批次執行、指定輸出檔或整合其他流程 | CLI |
| 比對兩次掃描結果 | `report-diff.mjs` |

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

Portable launcher 簽章狀態以 build manifest 為準，可能是未簽或 local self-signed。散布或使用前，請核對 release 頁提供的 `LinkChecker-portable.zip.sha256` 與 build manifest；若可攜資料夾內出現 `LinkChecker-local-code-signing.cer`，那只供內部自簽 launcher 的手動信任流程使用，一般使用者不需要安裝。

### 從原始碼啟動 GUI

在 repo 根目錄執行：

```powershell
.\gui.cmd
```

輸入網站 URL 後按「開始檢查」。完成後，GUI 會在 `logs/` 建立本次掃描資料夾，包含完整報告、CSV、摘要與執行紀錄。

GUI 的「連結檢查」使用較保守的日常掃描設定，並預設檢查外部連結。

### 使用 CLI

一般網站：

```powershell
.\check-links.cmd https://example.com
```

檢查外部連結：

```powershell
.\check-links.cmd https://example.com --external
```

Windows / 政府或內部網站憑證問題：

```powershell
.\check-links.cmd https://example.com --system-ca
```

容易被限流、逾時或阻擋的網站：

```powershell
.\check-links.cmd https://example.com --conservative
```

指定輸出檔：

```powershell
.\check-links.cmd https://example.com --progress --output report.json
```

CLI 預設只檢查站內連結；若要檢查外部連結，需加上 `--external`。完整參數請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 怎麼看檢查結果

先看 GUI 或 `broken.csv` 中的「建議處理」與「是否需人工確認」。工具會依目前取得的證據整理成下列判讀分類；判讀分類是協助承辦人決定下一步，不等同單純的 HTTP 技術狀態。

| 判讀分類 | 常見情況 | 建議處理 |
| --- | --- | --- |
| 需處理 | 已確認不存在、一般明確的轉址失敗、轉址循環或轉址次數過多 | 優先確認來源頁，並修正、移除或更新連結。 |
| 需人工確認 | 本站存取被拒、連線逾時、網路錯誤或防護限制等，目前證據不足以直接判定失效 | 用一般瀏覽器確認是否可正常開啟，再決定是否交辦修正。 |
| 外站限制 | 外部網站可能拒絕或限制工具請求 | 人工確認外站是否可正常開啟；必要時與外站窗口協調。 |
| 可能失效 | 已發現一般 HTTP 或頁面錯誤，但目前尚未取得足夠證據判定為明確失效 | 確認網址、伺服器狀態或頁面是否仍存在。 |
| 已轉址仍可用 | 轉址後最終仍可正常到達 | 通常不需立即處理；若 final URL 穩定，可視情況更新原連結。 |
| 可先忽略 / 正常 | 目前可正常到達 | 通常不需處理。 |
| 頁內品質提醒 | 非明確壞連結，但偵測到頁內內容或品質維護訊號 | 視內容維護需求處理。 |

完整報告仍會保留對應的判讀分類，例如 `action_required`、`needs_review`、`external_limited`、`likely_problem`、`redirect_ok`、`ok` 與 `page_quality_notice`。一般使用者不需要先理解這些代碼；需要追查欄位定義時再看 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)。

若掃描結果沒有發現壞連結，只代表本次已探索並成功檢查到的連結沒有明確問題，不代表整個網站每一個頁面與每一個動態產生的連結都已完整涵蓋。重要頁面仍建議人工抽查。

## 常見情況怎麼處理

### 工具無法確認不等於連結失效

若結果顯示防護阻擋、存取被拒、連線逾時、網路錯誤或需要人工確認，表示工具目前沒有取得足夠證據，不宜直接視為網站壞連結。

建議先用一般瀏覽器人工確認。若一般瀏覽器可開啟，但工具仍被拒絕、限流或擋下，可能是網站防護政策造成；必要時請網站管理方確認是否允許此類檢查來源。工具不會繞過防護系統、Bot challenge 或 CAPTCHA。

### 404 / 410 二次確認

工具會對部分同站直接回傳 `404 / 410`，以及部分轉址後最終為 `404 / 410` 的結果進行二次確認，目的是降低暫時性錯誤造成的誤判。常見結果：

| 結果 | 意義 | 建議處理 |
| --- | --- | --- |
| 已恢復 | 再確認時連結可開啟 | 可先保留，必要時觀察是否不穩定。 |
| 確認不存在 | 再確認後仍是不存在 | 優先修正、移除或更新來源頁連結。 |
| 需要人工確認 | 再確認時逾時、被拒絕或被防護阻擋 | 用一般瀏覽器確認後再決定是否交辦。 |

### 轉址結果

一般轉址不一定是錯誤。若轉址後仍可開啟，通常不代表連結失效，可以視需要把來源頁更新成最終網址。

需要優先處理的轉址狀況包括：

- 轉址後已確認最終頁面不存在，或屬其他明確錯誤。
- 轉址循環。
- 轉址次數過多。

若轉址後的最終回應顯示 WAF、Bot challenge、存取限制或其他防護證據，表示工具可能受到網站防護機制限制；在沒有「確認不存在」等正式證據前，應先人工確認，不宜僅因 `redirect_to_error` 就直接判定連結失效。

有些網站的錯誤頁會先回傳 HTTP `404 / 410`，再用瀏覽器端導向把使用者帶到其他頁。這種提示是輔助證據，不會覆蓋原始 `404 / 410` 與二次確認結果；建議確認來源頁是否應改成新的目標網址。

### 憑證、逾時與防護限制

| 情況 | 可嘗試的方式 |
| --- | --- |
| Windows 信任的政府或內部網站，在工具中出現憑證鏈錯誤 | 使用 `--system-ca`。 |
| 舊伺服器 TLS 握手失敗 | 只有確認是舊 TLS 問題時才使用 `--legacy-tls`。 |
| 網站容易限流、逾時或阻擋自動檢查 | 使用 `--conservative`，或降低單一 host 併發並增加延遲。 |
| 外部網站回 `403`、`429`、timeout 或防護阻擋 | 先人工確認，不要直接判定外部連結失效。 |

## 常用設定

| 需求 | GUI / CLI 做法 |
| --- | --- |
| 調整最多檢查頁數 | GUI 修改「最多頁面」；CLI 使用 `--max-pages <n>`。 |
| 調整掃描深度 | GUI 修改「最大深度」；CLI 使用 `--max-depth <n>`。 |
| 檢查外部連結 | GUI 預設開啟；CLI 使用 `--external`。 |
| 顯示執行進度 | CLI 使用 `--progress`。 |
| 指定報告輸出位置 | CLI 使用 `--output <file>`。 |
| 降低限流或阻擋風險 | CLI 使用 `--conservative`。 |
| 使用 Windows / 系統信任憑證 | CLI 或 GUI 啟動時使用 `--system-ca`。 |

完整 CLI 參數、cache、incremental、sitemap、rules、redaction 與 release 驗證說明請看 [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)。

## 輸出檔案

GUI 每次掃描會在 `logs/YYYYMMDD-HHMMSS--host--status/` 產生輸出。

一般交辦最常用：

| 檔案 | 用途 |
| --- | --- |
| `broken.csv` | 可用 Excel 開啟的待處理 / 待確認連結清單。 |
| `external-links.csv` | 外部連結清單、分類與治理欄位。 |
| `summary.json` | 本次掃描摘要。 |
| `report.json` | 完整掃描結果，也是主要資料來源。 |
| `events.log` | 執行過程紀錄，供追查使用。 |

進階追溯或大型資料可再看：

| 檔案 | 用途 |
| --- | --- |
| `manifest.json` | 輸出檔、工具版本與環境摘要。 |
| `checked.ndjson` | 已檢查 URL sidecar，供大型資料輔助使用。 |
| `broken.ndjson` | 壞連結 sidecar，可匯入報告分析。 |
| `external-links.ndjson` | 外部連結 sidecar，可匯入外部連結分析。 |
| `external-summary.json` | 外部連結網域與風險摘要。 |

一般交辦優先看 `broken.csv` 與 `external-links.csv`；需要完整追溯時再看 `report.json`、`manifest.json` 與 sidecar。

## 外部連結分析與報告分析

### 外部連結分析

匯入 GUI 輸出的外連清單，整理外部網域、分類與治理狀態。

建議選檔順序：

1. 一般情境：選 `external-links.csv`。
2. 大型資料：選 `external-links.ndjson`。
3. 需要完整報告來源：選 `report.json`。

「風險規則與白名單」是可選進階設定。一般分析可以略過；只有要補充舊資料、未分類外連，或把已知可信任網域排除時才需要設定。

預設外連分類只提供基本提示，例如短網址、追蹤分析、社群、CDN、地圖與 webmail。它不是完整惡意網站資料庫；若要判讀 malware、phishing、blocklist、watchlist 或機關自訂白名單，請載入分類規則或外部風險規則。

不知道分類規則檔格式時，可從 [docs/rules/basic-domain-rules.template.json](docs/rules/basic-domain-rules.template.json) 複製一份後替換成自己的網域。

### 報告分析

匯入 `report.json` 或 `broken.ndjson`，整理待判讀清單、處理建議、來源頁與問題網域排行。

大型 report 建議優先用 `broken.ndjson` 匯入，以降低瀏覽器一次載入完整 JSON 的壓力。

## 安全與使用注意事項

- 工具在本機執行，GUI server 只綁定 `127.0.0.1`。
- 預設只允許 HTTP(S)，並阻擋 localhost、private IP、link-local、metadata 與 reserved IP。
- 若需掃描可信任的本機或內部網站，可在確認授權後使用 `--allow-localhost` 或 `--allow-private-ip`；metadata service IP 仍會阻擋。
- 輸出層預設會遮罩敏感 query value。
- `robots.txt` 與掃描授權資訊會寫入 report 的 compliance metadata；工具不驗證授權本身。
- 工具不會繞過 WAF、Bot challenge 或 CAPTCHA；這類結果會標成需要人工確認。
- Portable package 不安裝 service、不寫入開機啟動、不連接遠端控制伺服器。

## 進階使用與技術文件

- [ROADMAP.md](ROADMAP.md)：目前開發狀態、近期工作、後續候選、延後項目與主要決策邊界。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數與進階使用方式。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：架構、掃描流程、資料模型與 report contract。
- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)：專案維護、驗證與 release 慣例。
- [docs/README.md](docs/README.md)：完整文件索引。
- [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md)：report-to-report diff 與 normalization 設計。
- [docs/archive/README.md](docs/archive/README.md)：歷史評估、驗收紀錄與舊版文件快照。
