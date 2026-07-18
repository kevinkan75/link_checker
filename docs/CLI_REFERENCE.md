# CLI Reference

本文件保存 Local Link Checker 的完整 CLI 參數、規則檔格式與進階用法。第一次使用請先閱讀根目錄 [README.md](../README.md)。

## 基本指令

```powershell
.\check-links.cmd https://example.com
node .\link-checker.mjs https://example.com
```

常見組合：

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
.\check-links.cmd https://example.com --redact-query-keys ticket,caseId
.\check-links.cmd https://example.com --max-html-bytes 5242880 --max-sources-per-url 50
.\check-links.cmd https://example.com --cache --cache-ttl-hours 24
```

## 參數總覽

### 掃描範圍

| 參數 | 說明 |
| --- | --- |
| `--max-pages <n>` | 最多爬行幾個同網域頁面，預設 `100` |
| `--max-depth <n>` | 從起始頁往下爬行的最大深度，預設 `2` |
| `--external` | 也檢查外部網域連結；預設只檢查站內連結並略過外部連結 |
| `--confirm-404` / `--no-confirm-404` | 是否在主掃描後集中複查同站 `404 / 410`，預設開啟 |
| `--canonical-strategy <safe|moderate|aggressive>` | 設定報告中 `canonicalUrl` 的正規化策略，預設 `safe`；不改變實際請求 URL |

### 併發、延遲與重試

| 參數 | 說明 |
| --- | --- |
| `--concurrency <n>` | 全域同時請求數，預設 `12` |
| `--global-concurrency <n>` | 同 `--concurrency` |
| `--per-host-concurrency <n>` | 每個 host 的同時請求數，預設 `4` |
| `--request-delay-ms <n>` | 同一 host 兩次請求的最小間隔毫秒數，預設 `500` |
| `--request-delay <s>` | 同一 host 兩次請求的最小間隔秒數，例如 `1.5` |
| `--request-delay-min-ms <n>` / `--request-delay-max-ms <n>` | 啟用隨機請求前延遲，單位毫秒 |
| `--request-delay-min <s>` / `--request-delay-max <s>` | 啟用隨機請求前延遲，單位秒 |
| `--timeout <ms>` | 單一請求逾時毫秒數，預設 `15000` |
| `--timeout-seconds <n>` | 單一請求逾時秒數 |
| `--retry-count <n>` | 暫時性錯誤的重試次數，預設 `2` |
| `--retry-after-max-ms <n>` | `429 / 503` 帶 `Retry-After` 時，單一 host cooldown 的等待上限，預設 `30000` |

### Redirect

| 參數 | 說明 |
| --- | --- |
| `--max-redirects <n>` | 最多跟隨幾次 HTTP redirect，預設 `10`，可設 `0` 到 `20` |
| `--long-redirect-threshold <n>` | redirect 次數超過此值時標示為轉址鏈過長，預設 `3` |

### Header 與請求策略

| 參數 | 說明 |
| --- | --- |
| `--accept-language <value>` | 送出的語言標頭，預設 `zh-TW,zh;q=0.9,en;q=0.8` |
| `--user-agent <value>` | 送出的 User-Agent；預設使用瀏覽器相容字串並包含 `LocalLinkChecker/1.0` 識別 |
| `--no-keep-alive` | 送出 `Connection: close` 並停用 legacy HTTP agent keep-alive；預設 Keep-Alive 開啟 |
| `--conservative` | 套用低併發、隨機延遲、偏好 `GET` 與外部連結 `Referer` 的保守檢查設定 |
| `--prefer-get` | 使用輕量 `GET` 檢查，不先嘗試 `HEAD` |
| `--external-referer` | 檢查外部連結時也送出來源頁作為 `Referer` |

### 安全與授權

| 參數 | 說明 |
| --- | --- |
| `--block-private-ip` | 阻擋 localhost、private、link-local、metadata 與 reserved IP，預設開啟 |
| `--allow-localhost` | 允許 localhost / loopback 目標，只建議用於可信任的本機掃描 |
| `--allow-private-ip` | 允許內網/private IP 目標，但不包含 localhost，metadata service IP 仍會阻擋 |
| `--authorized-scan` | 記錄使用者宣告已取得掃描授權；工具不驗證授權 |
| `--authorization-note <text>` | 把授權背景或內部工單備註寫入 report 的 `compliance` |
| `--no-robots` | 不讀取 start origin 的 `robots.txt` audit metadata |

### 相容性

| 參數 | 說明 |
| --- | --- |
| `--legacy-tls` | 允許舊 TLS cipher，用於弱 DH 參數造成握手失敗的舊站 |
| `--system-ca` | 使用作業系統或瀏覽器信任的系統根憑證 |

### 規則檔與 SPA / CMS

| 參數 | 說明 |
| --- | --- |
| `--domain-rules <file-or-url>` | 載入網域分類規則 JSON，可用本機檔案或 URL |
| `--external-risk-rules <file-or-url>` | 載入外部連結治理規則 JSON |
| `--site-link-rules <file-or-url>` | 載入 SPA/CMS payload 欄位推導規則 |
| `--spa-links <auto|off|strict>` | 從 SPA / Nuxt inline payload 抽取明確 URL 與 `/` 開頭 path，預設 `auto` |

### Redaction、body 與 sources 上限

| 參數 | 說明 |
| --- | --- |
| `--redact-sensitive-query` / `--no-redact-sensitive-query` | 輸出檔是否遮罩高風險 query value，預設開啟 |
| `--redact-query-keys <list>` | 額外遮罩的 query key，以逗號分隔 |
| `--max-html-bytes <n>` | HTML/body 抽取最多讀取 bytes，預設 `5242880` |
| `--max-body-preview-bytes <n>` | HTTP error HTML 診斷 preview 最多讀取 bytes，預設 `4096` |
| `--max-download-probe-bytes <n>` | 不需要 body 的下載/媒體 probe 最多 drain bytes，預設 `65536` |
| `--max-sources-per-url <n>` | 每個 URL 輸出最多保存幾筆來源，預設 `50`；完整數量仍保留在 `sourceCount` |
| `--protection-body-hash` | 在 protection body signature 中輸出 SHA-256 `bodyHash`；預設關閉 |

### P7 TTL cache

| 參數 | 說明 |
| --- | --- |
| `--cache` | 啟用 persistent TTL URL status-result cache；預設關閉 |
| `--cache-file <file>` | 指定 cache 檔案路徑，預設 `.cache/link-check-cache.json` |
| `--cache-ttl-hours <n>` | 成功結果的 TTL 小時數，預設 `24`；`404 / 410`、`429`、`5xx` 等會使用較短 TTL |
| `--refresh-cache` | 忽略既有 cache entry，重新檢查並回寫新結果；會自動啟用 cache |
| `--no-cache` | 停用 persistent cache |

P7 cache 只服務不需要 body 的 URL status check。頁面爬行需要 `requireBody: true` 時仍會實際抓取 HTML body，因此不會因 cache 命中而跳過 HTML link extraction、SPA payload extraction 或 site link rules。

Cache file 是本機效能最佳化資料，不是正式 report。cache key 使用實際 canonical URL 的 hash 與 policy fingerprint；落盤展示值會強制遮罩敏感 query value，即使輸出 redaction 被停用也一樣。

### P8a 增量掃描 state

| 參數 | 說明 |
| --- | --- |
| `--incremental` | 啟用 P8a 增量分類與 scan state；第一版不跳過 status validation，也不復用舊結果 |
| `--baseline-report <file>` | 使用既有 `report.json` 作為一次性 baseline；會自動啟用 `--incremental` |
| `--state-file <file>` | 指定 scan state 檔案路徑，預設 `.cache/link-check-state.json` |
| `--no-incremental-state-write` | 讀取 baseline/state 並輸出 summary，但不回寫新的 scan state |
| `--changed-only` | 啟用保守 result reuse；仍會完整爬頁建立本次 inventory，只復用穩定已知 URL 的 status result |
| `--sitemap <url-or-file>` | 讀取 sitemap `urlset` 或 `sitemapindex`，輸出 `summary.incremental.sitemap`；會保守 seed same-origin、page-like URL，且仍保留 HTML discovery |
| `--sitemap-max-urls <n>` | sitemap 摘要最多記錄的 URL 數，預設 `50000`；超過會截斷並在 summary warnings 記錄 |

P8a 只影響 URL status validation 的分類與優先順序。頁面 crawl 仍會實際抓取 HTML body 並建立本次 inventory，因此不會因 baseline report 或 state 而跳過 HTML link extraction、SPA payload extraction 或 site link rules。

Report 會輸出 `summary.incremental`，包含 `new`、`known`、`previousError`、`policyMismatch`、`ttlExpired`、`unstableRedirect`、`disappeared`、`priority`、`reuse` 與 `reused`。未使用 `--changed-only` 時 `reused` 固定為 `0`。

P8b 會把 `new`、`previousError`、`policyMismatch`、`ttlExpired` 與 `unstableRedirect` 排在穩定已知 URL 前面，但仍會檢查所有已排入 validation queue 的 URL。

P8c 的 `--changed-only` 只復用 `known` 且符合 policy match、TTL valid、非 previous error、非 unstable redirect 的 status result。`requireBody: true` 的頁面 crawl 不會復用舊結果。

P8d 的 `--sitemap` 會自動啟用 incremental summary，支援本地檔案、`file://` 與 HTTP(S) sitemap。HTTP(S) sitemap 讀取會走既有 URL security policy；遠端 sitemap index 只會讀 same-origin HTTP(S) child sitemap，不會讀取 `file://` child。

P8d 會對同時存在於 current inventory 與 sitemap 的 URL 加入 priority signal：`lastmod` 較 state 中前次值新時提高 priority，未變時降低 priority；仍不會因 sitemap 跳過檢查。

P8d 會保守 seed sitemap URL：只 seed same-origin、page-like URL，受 `maxDepth`、`maxPages` 與 `--sitemap-max-urls` 控制。Seeded URL 仍會實際抓 HTML body，並用本次 HTML discovery 建立 inventory / sources；sitemap 不會取代本輪 HTML discovery。

### 輸出與診斷

| 參數 | 說明 |
| --- | --- |
| `--progress` | 執行時顯示單行即時狀態 |
| `--verbose` | 逐行顯示爬行、請求、略過與檢查結果事件 |
| `--output <file>` | 把完整結果輸出成 JSON |
| `--json` | 在畫面上輸出完整 JSON；不會顯示進度或詳細事件，以避免破壞 JSON 輸出 |

## 規則檔格式

P9c-1 起，三種規則檔都有對應 schema 作為公開契約與測試依據：

| 規則檔 | Schema |
| --- | --- |
| Domain rules | `schemas/domain-rules.schema.json` |
| External risk rules | `schemas/external-risk-rules.schema.json` |
| Site link rules | `schemas/site-link-rules.schema.json` |

CLI 載入仍依既有 normalization 流程執行；schema 用來固定可支援格式，避免文件與實作分歧。P9c-2 起，JSON report 會輸出 root `rulesTrace`，記錄三類 rules 是否啟用、來源、版本、fingerprint、byte size、rule count、載入時間與 warnings。

若規則來源是 URL，載入時會套用 URL security policy、redirect 目標檢查、timeout、content length 與 body size limit。預設會阻擋 localhost、private IP、metadata IP 與不安全 redirect；GUI 目前仍不提供 rules URL 表單。

### Domain rules

`--domain-rules` 的 JSON 格式：

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

Schema: `schemas/domain-rules.schema.json`。

### External risk rules

`--external-risk-rules` 的 JSON 格式：

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

Schema: `schemas/external-risk-rules.schema.json`。

### Site link rules

`--site-link-rules` 的 JSON 格式：

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

Schema: `schemas/site-link-rules.schema.json`。

`fields.externalUrl` 會把欄位值視為完整 URL，`fields.youtubeId` 會轉成 YouTube watch URL，`fields.routePath` 會把 `/` 開頭路徑轉成站內 URL。`routeMappings` 可依 payload 欄位條件產生站台路由，`when` 支援精確比對與 `"*"` 非空值比對。

CEC 範例規則位於：

```text
docs\rules\cec-site-link-rules.json
```

## SPA / Nuxt 與 CMS payload

`--spa-links` 預設為 `auto`，偵測到 SPA / Nuxt 訊號或載入 site link rules 時，會從 inline script / payload 抽取明確 URL 與 `/` 開頭 path。`--spa-links off` 可回到舊行為；`--spa-links strict` 只抽 literal URL/path，不套用站台特定規則推導。

針對 `directType`、`directPath`、`articleId`、`youtubeId` 這類站台或 CMS 欄位，使用 `--site-link-rules` 載入規則檔，不把站台邏輯硬寫進 crawler。

JSON report 會保留來源類型，例如 `html_attribute`、`script_literal`、`spa_payload`、`site_rule_derived`。summary 也會輸出 `spaDetection`、`scanQuality` 與 `checkedByKind`，用來判斷這次掃描是否被 `_nuxt` asset 或其他靜態資源主導。

## Report diff

`report-diff.mjs` 用來比對兩份既有 `report.json`：

```powershell
node .\report-diff.mjs old-report.json new-report.json --output diff.json
```

這個指令只讀取已產生的 report，不重新掃描網站、不重新送 HTTP request，也不改寫原始 report。第一版會輸出：

- URL 狀態變化：新增、移除、變更、新發生問題、已修復、持續存在、信心升降。
- 外部連結治理風險變化：風險升高、風險降低。
- Summary diagnostics 變化：`summary.scanQuality`、`summary.spaDetection`、`summary.checkedByKind`、`summary.hostDiagnostics`。
- Normalization warnings：legacy report、`broken[]` fallback、duplicate key、partial report 等。

## 執行狀態

需要掌握檢查進度時，可以使用：

```powershell
.\check-links.cmd https://example.com --progress
```

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

支援動態設定憑證的 Node 版本可在執行時啟用系統憑證；不支援時，CLI 會改用 `--use-system-ca` 重新啟動。GUI 可針對需要的檢查勾選 `System CA`，也可以用 `.\gui.cmd --system-ca` 啟動，讓 GUI 一開始就載入系統根憑證；此參數可與其他 GUI 啟動參數併用，例如 `.\gui.cmd --port 8788 --system-ca`。

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
