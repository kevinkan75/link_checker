# Local Link Checker

這是一個可在本機執行的網站無效連結檢查工具。它會從指定網址開始讀取 HTML，解析頁面中的連結與資源，繼續爬行同網域頁面，並回報 HTTP 400 以上或連線失敗的連結。

## 目錄

- [功能摘要](#功能摘要)
- [使用方式](#使用方式)
- [快速選擇](#快速選擇)
- [圖形介面](#圖形介面)
- [常用參數](#常用參數)
- [SPA / Nuxt 與 CMS payload](#spa--nuxt-與-cms-payload)
- [執行狀態](#執行狀態)
- [相容性模式](#相容性模式)
- [友善檢查設定](#友善檢查設定)
- [Redirect 判讀](#redirect-判讀)
- [結果判讀](#結果判讀)
- [建立可攜版](#建立可攜版)
- [專案文件](#專案文件)
- [注意事項](#注意事項)

## 功能摘要

- 同網域爬行、URL inventory 去重、來源頁合併與 canonical key。
- HTTP 狀態、redirect chain、WAF/Bot/CDN 診斷、cache headers 與錯誤分類。
- 同站 `404 / 410` 二次確認，降低暫時性誤判。
- 外連 inventory、網域分類、外連治理風險摘要與 CSV / JSON 輸出。
- SPA / Nuxt payload literal 抽取、站台規則推導與 `scanQuality` 診斷。
- 內容頁、外連、文件、媒體、asset、`_nuxt` asset 分流統計與簡易 validation priority。

## 使用方式

```powershell
.\check-links.cmd https://example.com
```

或直接使用 Node.js：

```powershell
node .\link-checker.mjs https://example.com
```

## 快速選擇

一般網站先用基本指令即可：

```powershell
.\check-links.cmd https://example.com
```

政府機關、公司內部或 Windows 瀏覽器可開啟但 Node 憑證失敗的網站，使用系統憑證：

```powershell
.\check-links.cmd https://example.com --system-ca
```

容易被限流、挑戰或阻擋的網站，使用保守模式降低請求強度：

```powershell
.\check-links.cmd https://example.com --conservative
```

舊式 TLS 伺服器出現 `ERR_SSL_DH_KEY_TOO_SMALL` 時，才啟用舊 TLS 相容模式：

```powershell
.\check-links.cmd https://example.com --legacy-tls
```

需要一次檢查多個網站時，建議使用 GUI 的「待檢核網站佇列」。

## 圖形介面

啟動本機 GUI：

```powershell
.\gui.cmd
```

開啟瀏覽器並前往：

```text
http://127.0.0.1:8787
```

GUI 可以輸入網站 URL、設定檢查頁數、深度、全域併發、每 host 併發、請求間隔、逾時、重試次數與語言標頭，選擇是否檢查外部連結，查看即時進度、瀏覽問題連結表格，並下載 JSON 報告。

若要批次檢查多個網站，可在「待檢核網站佇列」輸入多個網址，一行一個。按「加入佇列」後再按「開始佇列」，工具會以單機本機佇列檢查；「同時檢查網站數」預設為 `1`，可設定 `1` 到 `5`。政府網站建議使用 `1` 或 `2`，較高併行數可能增加 `403`、`429` 或逾時。完成後可在佇列表格點「查看」載入該站報告。

多網站併行檢查時，佇列表格中的執行中網站會提供「監看」按鈕。GUI 會先自動監看第一個執行中的網站；手動點選「監看」後，即時進度、事件紀錄與問題連結表會切換到該網站，後續輪詢不會自動切回其他網站。

GUI 每次檢查結束後會自動保存記錄檔到 `logs/` 目錄，資料夾命名格式為 `YYYYMMDD-HHMMSS--host--status`。內容包含完整 `report.json`、摘要 `summary.json`、可用 Excel 開啟的 `broken.csv`，以及檢查過程 `events.log`。

## 常用參數

```powershell
.\check-links.cmd https://example.com --max-pages 200 --max-depth 8
.\check-links.cmd https://example.com --global-concurrency 20 --per-host-concurrency 4
.\check-links.cmd https://example.com --request-delay 1.5 --retry-count 2
.\check-links.cmd https://example.com --per-host-concurrency 3 --request-delay-min 0.3 --request-delay-max 1
.\check-links.cmd https://example.com --max-redirects 10 --long-redirect-threshold 3
.\check-links.cmd https://example.com --external
.\check-links.cmd https://example.com --no-confirm-404
.\check-links.cmd https://example.com --spa-links strict
.\check-links.cmd https://www.cec.gov.tw --site-link-rules docs\rules\cec-site-link-rules.json
.\check-links.cmd https://example.com --progress
.\check-links.cmd https://example.com --verbose
.\check-links.cmd https://example.com --output report.json
.\check-links.cmd https://example.com --domain-rules rules.json
```

- `--max-pages <n>`：最多爬行幾個同網域頁面，預設 `100`。
- `--max-depth <n>`：從起始頁往下爬行的最大深度，預設 `2`。
- `--concurrency <n>`：全域同時請求數，預設 `12`。
- `--global-concurrency <n>`：同 `--concurrency`。
- `--per-host-concurrency <n>`：每個 host 的同時請求數，預設 `4`。
- `--request-delay-ms <n>`：同一 host 兩次請求的最小間隔毫秒數，預設 `500`。
- `--request-delay <s>`：同一 host 兩次請求的最小間隔秒數，例如 `1.5`。
- `--request-delay-min-ms <n>` / `--request-delay-max-ms <n>`：啟用隨機請求前延遲，例如 `300` 到 `1000` 毫秒。
- `--request-delay-min <s>` / `--request-delay-max <s>`：以秒設定隨機請求前延遲，例如 `0.3` 到 `1` 秒。
- `--timeout <ms>`：單一請求逾時毫秒數，預設 `15000`。
- `--timeout-seconds <n>`：單一請求逾時秒數。
- `--retry-count <n>`：暫時性錯誤的重試次數，預設 `2`。
- `--max-redirects <n>`：最多跟隨幾次 HTTP redirect，預設 `10`，可設 `0` 到 `20`。
- `--long-redirect-threshold <n>`：redirect 次數超過此值時標示為轉址鏈過長，預設 `3`。
- `--accept-language <value>`：送出的語言標頭，預設 `zh-TW,zh;q=0.9,en;q=0.8`。
- `--user-agent <value>`：送出的 User-Agent。預設使用瀏覽器相容字串並包含 `LocalLinkChecker/1.0` 識別。
- `--domain-rules <file-or-url>`：載入網域分類規則 JSON，可用本機檔案或 URL。
- `--external-risk-rules <file-or-url>`：載入外連治理規則 JSON，可用白名單、黑名單與觀察名單調整 `externalRisk`。
- `--site-link-rules <file-or-url>`：載入 SPA/CMS payload 欄位推導規則，例如從 `linkUrl`、`youtubeId` 或站台 route 欄位產生可檢查 URL。
- `--canonical-strategy <safe|moderate|aggressive>`：設定報告中 `canonicalUrl` 的正規化策略，預設 `safe`；此設定不改變實際請求 URL。
- `--spa-links <auto|off|strict>`：從 SPA / Nuxt inline payload 抽取明確 URL 與 `/` 開頭 path，預設 `auto`；`off` 可回到舊行為，`strict` 只做 literal 抽取。
- `--external`：也檢查外部網域連結；預設只檢查站內連結並略過外部連結。
- `--confirm-404` / `--no-confirm-404`：是否在主掃描後集中複查同站 `404 / 410`。預設開啟；關閉時 report 仍會標示 confirmation 未啟用。
- `--conservative`：套用低併發、隨機延遲、偏好 `GET` 與外部連結 `Referer` 的保守檢查設定。
- `--prefer-get`：使用輕量 `GET` 檢查，不先嘗試 `HEAD`。
- `--external-referer`：檢查外部連結時也送出來源頁作為 `Referer`。
- `--legacy-tls`：允許舊 TLS cipher，用於弱 DH 參數造成握手失敗的舊站。
- `--system-ca`：使用作業系統或瀏覽器信任的系統根憑證。
- `--progress`：執行時顯示單行即時狀態。
- `--verbose`：逐行顯示爬行、請求、略過與檢查結果事件。
- `--output <file>`：把完整結果輸出成 JSON。
- `--json`：在畫面上輸出完整 JSON。

`--domain-rules` 的 JSON 格式如下：

```json
[
  {
    "category": "政府機關",
    "domains": ["gov.tw", "example.gov.tw"]
  },
  {
    "category": "合作單位",
    "domains": ["partner.example.com"]
  }
]
```

`--external-risk-rules` 的 JSON 格式如下：

```json
{
  "allowlist": [
    "trusted-cdn.example.com",
    { "id": "partner", "domains": ["partner.example.com"], "label": "合作單位" }
  ],
  "blocklist": [
    "blocked.example.net"
  ],
  "watchlist": [
    { "id": "campaign-sites", "domains": ["campaign.example.org"] }
  ]
}
```

也可以使用 `rules` 陣列：

```json
{
  "rules": [
    { "action": "allow", "domains": ["trusted.example.com"] },
    { "action": "block", "domains": ["blocked.example.net"] },
    { "action": "watch", "domains": ["review.example.org"] }
  ]
}
```

`--site-link-rules` 的 JSON 格式如下：

```json
{
  "fields": {
    "externalUrl": ["linkUrl", "url"],
    "youtubeId": ["youtubeId"],
    "routePath": ["routePath", "path"]
  },
  "routeMappings": [
    {
      "name": "article",
      "when": { "articleId": "*" },
      "template": "/central/article/{articleId}"
    }
  ]
}
```

`fields.externalUrl` 會把欄位值視為完整 URL，`fields.youtubeId` 會轉成 YouTube watch URL，`fields.routePath` 會把 `/` 開頭路徑轉成站內 URL。`routeMappings` 可依 payload 欄位條件產生站台路由，`when` 支援精確比對與 `"*"` 非空值比對。

## SPA / Nuxt 與 CMS payload

`--spa-links` 預設為 `auto`，偵測到 SPA / Nuxt 訊號或載入 site link rules 時，會從 inline script / payload 抽取明確 URL 與 `/` 開頭 path。`--spa-links off` 可回到舊行為；`--spa-links strict` 只抽 literal URL/path，不套用站台特定規則推導。

針對 `directType`、`directPath`、`articleId`、`youtubeId` 這類站台或 CMS 欄位，使用 `--site-link-rules` 載入規則檔，不把站台邏輯硬寫進 crawler。CEC 範例規則位於：

```text
docs\rules\cec-site-link-rules.json
```

JSON report 會保留來源類型，例如 `html_attribute`、`script_literal`、`spa_payload`、`site_rule_derived`。summary 也會輸出 `spaDetection`、`scanQuality` 與 `checkedByKind`，用來判斷這次掃描是否被 `_nuxt` asset 或其他靜態資源主導。

## 執行狀態

需要掌握檢查進度時，可以使用：

```powershell
.\check-links.cmd https://example.com --progress
```

進度列會顯示已爬頁面數、待爬佇列、已檢查 URL 數、目前請求數、問題連結數、略過外部連結數與已執行時間。

需要追查每個事件時，可以使用：

```powershell
.\check-links.cmd https://example.com --verbose
```

也可以一起使用：

```powershell
.\check-links.cmd https://example.com --progress --verbose
```

## 相容性模式

### 保守模式

容易限流、挑戰或阻擋自動化檢查的網站，可以使用保守模式：

```powershell
.\check-links.cmd https://example.com --conservative
```

此模式會把全域併發降到 `3`、每 host 併發降到 `1`、加入 `2-5s` 隨機請求延遲、把暫時性錯誤重試降到 `1`，並使用瀏覽器相容 User-Agent、偏好輕量 `GET` 檢查、對外部連結送出來源頁 `Referer`。

也可以逐項開啟相同行為：

```powershell
.\check-links.cmd https://example.com --prefer-get --external-referer --concurrency 3 --per-host-concurrency 1 --request-delay-min 2 --request-delay-max 5 --retry-count 1
```

### 舊 TLS 相容模式

部分舊伺服器在瀏覽器或 `curl` 可以開啟，但 Node/OpenSSL 會因 `ERR_SSL_DH_KEY_TOO_SMALL` 失敗。只有遇到這類 TLS 握手錯誤時才啟用：

```powershell
.\check-links.cmd https://example.com --legacy-tls
```

此模式會降低檢查程序的 TLS cipher 安全等級，只建議用在原本無法完成 TLS 握手的舊站。

### 系統憑證相容模式

部分 Windows 信任的政府或內部網站，在 Node 中可能因 `UNABLE_TO_VERIFY_LEAF_SIGNATURE` 失敗，原因是 Node 無法建立與作業系統或瀏覽器相同的憑證鏈。這類網站可使用系統憑證模式：

```powershell
.\check-links.cmd https://example.com --system-ca
```

支援動態設定憑證的 Node 版本可在執行時啟用系統憑證；不支援時，CLI 會改用 `--use-system-ca` 重新啟動。GUI 可針對需要的檢查勾選 `System CA`，也可以用 `.\gui.cmd --system-ca` 啟動，讓 GUI 一開始就載入系統根憑證。

使用 `--json` 時不會顯示進度或詳細事件，以避免破壞 JSON 輸出。

## 友善檢查設定

工具預設採用適合一般網站的檢查方式：

- 全域最多 `12` 個請求。
- 每個 host 最多 `4` 個請求。
- 同一 host 兩次請求至少間隔 `500ms`。
- 暫時性錯誤最多重試 `2` 次。
- 預設送出 `Accept-Language: zh-TW,zh;q=0.9,en;q=0.8`。

若網站容易限流或阻擋自動化檢查，建議直接使用 [保守模式](#保守模式)，再視需要個別調整併發、延遲、User-Agent、`GET` 檢查與 `Referer` 設定。

重試只會用在逾時、部分網路錯誤、`429`、`500`、`502`、`503`、`504`。`404 / 410` 與已判定為防護阻擋的結果不會重試。

部分檔案下載 API 可能對 `HEAD` 回傳錯誤，但 `GET` 實際可取得檔案。工具會在 `HEAD` 回傳 `403`、`404`、`405`、`501` 或伺服器錯誤時改用 `GET` 確認，避免把可下載的 PDF、檔案資源誤判為失效。

若 `GET` 仍回傳 `403 Forbidden`，且沒有防護層特徵，報告會記為 `access_denied`。這代表伺服器拒絕目前工具請求，可能與權限、登入、Cookie、Referer、User-Agent、地區或網站政策有關；GUI 會獨立顯示為「存取被拒」，不再混入一般 HTTP 錯誤。

若起始網址是網站根目錄 `/`，但根目錄回傳 `403 Forbidden`，工具會額外嘗試同站的 `/Default.aspx`。這可處理部分 ASP.NET 政府網站實際首頁位於 `Default.aspx`、但根目錄對程式化請求回 403 的情況。成功時報告會保留 `homepageFallback: true` 與 `homepageFallbackUrl`。

部分網站的 `HEAD` 與 `GET` redirect 行為不同，例如 `HEAD` 被導到尾端 `/` 路徑後失敗，但一般瀏覽器 `GET` 原網址可正常開啟。工具會在 `HEAD` 出現 redirect error、redirect loop 或 too many redirects 時改用 `GET` 原網址確認。

部分網站會依 User-Agent 套用不同 redirect 規則。工具預設使用瀏覽器相容 User-Agent，避免只因 `LocalLinkChecker/1.0` 這類非瀏覽器 UA 被導到錯誤頁；仍可用 `--user-agent` 明確覆蓋。

檢查同站圖片、CSS、PDF 等頁面資源時，工具會帶上來源頁作為 `Referer`，模擬瀏覽器載入資源的行為。這可避免部分網站對沒有 `Referer` 的圖片請求回傳 `404`，造成可讀取資源被誤判。

若同站資源的 `HEAD` 回 `404`，工具會用帶 `Referer` 的 `GET` 再確認一次。JSON 報告中的 `requestReferer` 可用來確認該次檢查實際送出的來源頁。

主掃描完成後，工具預設會集中複查同站 `404 / 410`。這個階段使用純瀏覽器相容 User-Agent、`GET`、來源頁 `Referer`、低併發與隨機延遲；外部連結不納入第一版二次確認。二次確認結果會寫入每筆 result 的 `confirmation`，不會覆蓋初次掃描的 `status`、`method`、`checkedAt`、`finalUrl`、`issueType` 與 `sources`。

工具會尊重 HTML 的 `<base href="...">`。若頁面是無副檔名的路由，例如 `/About/FormerMinisters`，且相對資源用 `img/file.jpg` 這類寫法，工具在標準 URL 解析得到 `404` 時，會再依序嘗試站台根目錄 `/img/file.jpg` 與路由目錄 `/About/FormerMinisters/img/file.jpg`，避免因 URL 正規化差異誤判。

## Redirect 判讀

工具會手動追蹤 HTTP redirect，並在報告中保存：

- `redirected`：是否發生轉址。
- `redirectCount`：轉址次數。
- `redirectType`：永久、暫時或混合轉址。
- `redirectIssues`：跨 host、過長、轉址後錯誤、轉址循環等提醒或錯誤。
- `redirectChain`：每一步 `from / status / to`。

不直接算失效，只列為提醒：

- `permanent_redirect`：`301`、`308`。
- `temporary_redirect`：`302`、`303`、`307`。
- `mixed_redirect`：同一 chain 同時有永久與暫時轉址。
- `cross_host_redirect`：最終 host 與原始 host 不同。
- `long_redirect_chain`：轉址次數超過 `--long-redirect-threshold`。

會算入失效連結：

- `redirect_to_error`：轉址後最終 HTTP 狀態為 `400` 以上。
- `too_many_redirects`：超過 `--max-redirects`。
- `redirect_loop`：redirect chain 中 URL 重複。

## 結果判讀

工具會列出：

- 爬行頁面數
- 檢查 URL 數
- 檢查 URL 分流統計：內容頁、外連、文件、媒體與靜態資源；JSON summary 會包含 `pagesChecked`、`contentLinksChecked`、`externalLinksChecked`、`documentsChecked`、`mediaLinksChecked`、`assetsChecked`、`nuxtAssetsChecked` 與 `checkedByKind`
- 問題連結數
- 問題連結分類統計
- 每個問題連結的 HTTP 狀態或錯誤訊息
- 問題連結是在哪些頁面與標籤屬性中發現
- 若網站回應像 Cloudflare、Akamai、Imperva、Sucuri 等防護頁，會標示為被防護層阻擋
- 同站 `404 / 410` 的二次確認統計：已恢復、需複查、確認不存在

問題連結分類包含：

- `404 / 410`：頁面或資源不存在；`410 Gone` 代表伺服器明確表示資源已永久移除。
- `防護阻擋`：Cloudflare、Akamai、Imperva、Sucuri 等防護層拒絕程式化請求。
- `存取被拒`：HTTP 403，伺服器拒絕目前工具請求，通常需要人工確認。
- `HTTP 錯誤`：除了 404 / 410、防護阻擋與存取被拒以外的 HTTP 400 以上狀態。
- `逾時`：請求超過設定時間沒有完成。
- `網路錯誤`：DNS、連線拒絕、權限阻擋等未取得 HTTP 回應的錯誤。
- `其他`：無法歸入上述類型的錯誤。

`confirmation.outcome` 代表二次確認結論：

- `recovered`：初次為 `404 / 410`，二次確認轉為可正常開啟的 `2xx / 3xx`。
- `confirmed_missing`：二次確認仍為 `404 / 410`。
- `needs_review`：二次確認遇到逾時、`403`、`429`、防護阻擋、網路錯誤或不明結果，建議人工複查。

程式結束代碼：

- `0`：沒有發現失效連結
- `1`：執行參數或程式錯誤
- `2`：有發現失效連結

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

- [ROADMAP.md](ROADMAP.md)：目前開發主線；下一個主要項目是 P6 report-to-report diff。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：架構、流程、資料模型與 report schema 技術規格。
- [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)：已完成里程碑、驗收紀錄與設計理由。
- [docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md)：CEC / Nuxt 掃描問題分析與 P5.5 改善來源。
- [docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md)：SPA payload extraction 設計筆記。
- [docs/rules/cec-site-link-rules.json](docs/rules/cec-site-link-rules.json)：CEC site link rules 範例。

## 注意事項

部分網站會阻擋自動化請求，可能導致 `403` 或逾時。這種情況不一定代表網站真的有壞連結，需要再用瀏覽器確認。

當結果顯示「Blocked by protection layer」或 GUI 顯示「防護阻擋」時，通常代表網站前方的防護服務拒絕程式化請求。這不一定是連結失效，建議用一般瀏覽器人工確認，或請網站管理方允許檢查來源。
