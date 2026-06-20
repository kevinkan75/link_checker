# www.cec.gov.tw 檢測落差改善分析報告

狀態：歷史分析紀錄。P5.5a / P5.5b / P5.5c 已依本報告完成；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，完成紀錄請看 [../ROADMAP_HISTORY.md](../ROADMAP_HISTORY.md)。

## 1. 事件摘要

本次檢測目標為 `https://www.cec.gov.tw/`。檢測結果顯示任務成功完成，但實際輸出不符合預期：工具只爬取 1 個頁面，檢查 37 個 URL，壞連結與外部連結皆為 0。進一步分析後確認，這並不代表網站沒有內容頁或外部連結，而是目前連結抽取策略不適合 Nuxt / SPA 類型網站。

`https://www.cec.gov.tw/` 會轉址到 `https://web.cec.gov.tw/central`。該頁面實際上含有公告、選舉資訊、站內導覽、YouTube 影片與多個政府外部網站連結。但這些內容大多存在於 Nuxt payload 或前端狀態資料中，不是傳統 HTML `<a href="...">` 連結。因此，目前工具只抽到 `_nuxt` 靜態資源，沒有抽到真正有治理價值的內容頁與外部連結。

## 2. 本次檢測結果

檢測資料來源：

- `logs/20260620-114447--www-cec-gov-tw--finished/summary.json`
- `logs/20260620-114447--www-cec-gov-tw--finished/report.json`
- `logs/20260620-114447--www-cec-gov-tw--finished/events.log`

關鍵結果：

| 項目 | 結果 |
| --- | --- |
| 任務狀態 | finished |
| 起始 URL | `https://www.cec.gov.tw` |
| 實際 final URL | `https://web.cec.gov.tw/central` |
| pagesCrawled | 1 |
| urlsChecked | 37 |
| brokenLinks | 0 |
| externalLinks | 0 |
| confirmation candidates | 0 |
| uniqueCanonicalUrls | 36 |

URL 類型分布：

| 類型 | 數量 | 說明 |
| --- | ---: | --- |
| HTML page | 1 | 入口頁，轉址後為 `https://web.cec.gov.tw/central` |
| Nuxt static assets | 36 | `_nuxt/*.css`、`_nuxt/*.js`、SVG、build metadata |

從 `events.log` 可見，首頁完成後，後續幾乎都在檢查：

```text
https://web.cec.gov.tw/_nuxt/*.css
https://web.cec.gov.tw/_nuxt/*.js
https://web.cec.gov.tw/_nuxt/error-img.*.svg
https://web.cec.gov.tw/_nuxt/builds/meta/*.json
```

因此，這次檢測雖然技術上完成，但實際上沒有覆蓋主要內容頁與治理需要關注的外部連結。

## 3. 根因分析

### 3.1 網站型態是 Nuxt / SPA

`www.cec.gov.tw` 屬於 Nuxt / SPA 混合型網站。頁面中可見大量 Nuxt 前端資源與 Nuxt 狀態資料，真正的導覽與內容資料並不一定以一般 HTML anchor 呈現。

這類網站常見特徵：

- 頁面載入大量 `_nuxt` CSS / JS。
- 內容、選單、文章 ID、外部連結存在 script payload 或前端 state。
- 瀏覽器渲染後可見連結，但原始 HTML 中 `<a href>` 不完整。
- 傳統 HTML attribute extractor 會大量抓到 asset，卻漏掉業務連結。

### 3.2 目前抽取器只處理 HTML tag attribute

目前 `link-checker.mjs` 的 `extractLinks()` 主要讀取這類 HTML tag attribute：

- `<a href>`
- `<area href>`
- `<form action>`
- `<link href>`
- `<script src>`
- `<img src>`
- `<source src>`
- `<iframe src>`

這對傳統 HTML 站台有效，但對 Nuxt payload 中的資料無效。

本次網站的實際內容資料包含類似欄位：

- `directPath`
- `linkUrl`
- `articleId`
- `youtubeId`
- 選單與公告資料結構

這些不是 HTML tag attribute，所以目前工具不會把它們轉成可檢查 URL。

### 3.3 靜態資源佔用檢查預算

目前工具會檢查 `<link href>` 和 `<script src>`，因此 `_nuxt` 靜態資源被納入 URL inventory 與 validation queue。

這些檢查不是完全沒有價值，但對治理壞連結而言優先度較低。尤其 `_nuxt` hash 檔名資源通常搭配長 cache TTL 或 immutable cache，檢查它們不應佔用主要 crawl budget，也不應與內容頁、外部連結混在同一個 summary 中。

### 3.4 不是 WAF、深度或頁數設定問題

本次不符合預期並非因為：

- `maxPages` 太低：設定為 100。
- `maxDepth` 太低：設定為 2。
- 被 WAF / Bot 擋下：首頁與靜態資源多為 HTTP 200，且 report 未標示 `suspectedWaf` 或 `suspectedBot`。
- 網站沒有外連：原始頁面資料中實際存在政府外站、YouTube、資料庫等外部連結。

核心問題是抽取模型沒有涵蓋 SPA framework payload。

## 4. 影響

這類網站若繼續用目前抽取策略，會產生以下問題：

- `pagesCrawled` 偏低，容易誤以為網站很小。
- `externalLinks` 可能錯誤為 0。
- 大量檢查 `_nuxt` 靜態資源，降低檢查效率。
- 壞連結治理摘要失真。
- P5 外連風險治理無法發揮作用，因為外連沒有被 inventoried。
- 後續 P6 report diff 也會基於不完整資料產生低價值 diff。

## 5. 改善方向

### 5.1 新增 SPA / framework 偵測

建議預設啟用低成本偵測，不改變掃描行為，只在 report 中標示可能需要 SPA payload extraction。

偵測訊號可包含：

- HTML 中存在 `_nuxt/`。
- HTML 中存在 `__NUXT_DATA__` 或 `window.__NUXT__`。
- HTML 很大但 `<a href>` 很少。
- checked URL 中 `_nuxt` asset 佔比過高。
- `pagesCrawled` 很低，但 HTML 中存在大量 URL-like string。

報表可新增診斷：

```json
{
  "spaDetection": {
    "detected": true,
    "framework": "nuxt",
    "signals": ["nuxt_assets", "nuxt_payload", "asset_dominant_scan"],
    "recommendation": "Enable or keep SPA payload link extraction."
  }
}
```

### 5.2 新增 payload link extraction

建議新增 `extractFrameworkLinks(html, pageUrl)`，在既有 `extractLinks()` 之後執行，負責從 script payload 或 framework 狀態資料中抽取 URL。

第一版可支援：

- 完整 URL literal：`https://...`、`http://...`
- 站內 path：`/central/menu/7`、`/central/article/34`
- 常見欄位：`linkUrl`
- YouTube ID：可標記為 video reference，或轉成 `https://www.youtube.com/watch?v=...`

對於 `directPath`、`directType`、`articleId` 這類站台或 CMS 特定欄位，不建議硬寫死在核心邏輯。應透過可配置規則處理。

### 5.3 新增 site link rules

針對政府 CMS 或特定 Nuxt 站台，可新增可選規則檔：

```text
--site-link-rules <file>
```

規則可描述：

- 哪些欄位代表外部 URL。
- 哪些欄位代表站內文章 ID。
- `directType` 與 `directPath` 如何轉換為 URL。
- YouTube ID 如何轉成可檢查連結。

範例概念：

```json
{
  "fields": {
    "externalUrl": ["linkUrl", "url"],
    "routePath": ["directPath"],
    "youtubeId": ["youtubeId"]
  },
  "routeMappings": [
    {
      "when": { "directType": 101 },
      "template": "/central/menu/{directPath}"
    },
    {
      "when": { "field": "articleId" },
      "template": "/central/article/{articleId}"
    }
  ]
}
```

### 5.4 URL 分類與優先順序

建議將 URL 分成以下類型，並調整檢查優先序：

| 分類 | 優先度 | 說明 |
| --- | --- | --- |
| `page_route` | 高 | 站內內容頁、文章、選單頁 |
| `external_link` | 高 | 外部治理與風險分類目標 |
| `document` | 中 | PDF、DOC、XLS 等文件 |
| `media` | 低 | 圖片、影片、音訊 |
| `asset` | 低 | CSS、JS、font、hash asset |
| `api` | 視情況 | API endpoint，不一定適合一般連結檢查 |

這樣可以避免 `_nuxt` asset 佔滿檢查量，也能讓 summary 更符合使用者期待。

### 5.5 靜態資源分流

建議 report summary 區分：

- `pagesChecked`
- `contentLinksChecked`
- `externalLinksChecked`
- `documentsChecked`
- `assetsChecked`

而不是只用單一 `urlsChecked` 表示所有 URL。

對 `_nuxt` hash asset 可採以下策略：

- 預設仍 inventoried。
- 降低檢查優先度。
- summary 中獨立統計。
- 若後續 P7 cache 完成，給予較長 TTL。
- 可提供選項跳過 immutable asset 檢查。

### 5.6 Headless render 作為 fallback

不建議第一階段直接預設使用 Playwright 或 headless browser。

原因：

- 成本高、速度慢。
- 需要額外 runtime。
- 對 CI / portable 版本會增加部署複雜度。
- 可能觸發部分站台防護。
- 對這次案例而言，payload extraction 已能解決大部分問題。

建議只在使用者明確開啟時使用：

```text
--render
--render-timeout-ms <n>
--render-max-pages <n>
```

## 6. 啟動開關建議

建議把功能分成三層，不要用單一開關控制所有 SPA 能力。

### 6.1 SPA 偵測

建議預設開啟，無需開關或只提供關閉選項。

```text
--no-spa-detect
```

理由：偵測成本低，不會增加網路請求，也不會改變檢查結果，只提供診斷訊號。

### 6.2 SPA payload 抽取

建議使用模式型開關：

```text
--spa-links <auto|off|strict>
```

語意：

| 模式 | 說明 |
| --- | --- |
| `auto` | 預設。偵測到 Nuxt / SPA 訊號時，嘗試抽取 payload 中的 URL 與 path。 |
| `off` | 完全關閉 payload / script link extraction。 |
| `strict` | 只抽明確 URL 或明確 `/` 開頭 path，不做站台特定欄位推論。 |

建議預設為 `auto`。

### 6.3 站台特定規則

建議明確 opt-in：

```text
--site-link-rules <file>
```

理由：`directPath`、`directType`、`articleId` 等欄位不是 Nuxt 標準，而是站台資料結構。透過規則檔處理，比硬寫在核心 crawler 更安全。

### 6.4 Headless render

必須預設關閉：

```text
--render
```

理由：高成本、高依賴、高風險，應作為 fallback，不作為預設行為。

## 7. 實作順序紀錄

### P6 前已完成的低風險改善

這次問題會影響 report diff 的資料品質，因此已在 P6 report diff 前補上最小 SPA 診斷與 payload 抽取。

完成順序已整理為 P5.5a / P5.5b / P5.5c，並全部排在 P6 report diff 前：

1. P5.5a：新增 SPA / Nuxt 偵測、`--spa-links auto|off|strict`、strict payload URL/path literal extraction、`sourceType`。
2. P5.5b：新增 `--site-link-rules <file>`，並針對 `www.cec.gov.tw` 補一份規則範例，處理 `linkUrl`、`youtubeId`、`directType`、`directPath`、`articleId`。
3. P5.5c：將 `_nuxt` asset 與 content / external / document / media 分開統計，並加入簡易 priority。
4. P6：開始 report-to-report diff。

### 後續強化

1. 視掃描量將目前簡易 priority 排序升級為更完整的 priority queue。
2. 新增 asset skip / asset defer 策略。
3. 支援更多 framework payload，例如 Next.js `__NEXT_DATA__`。
4. 視需要加入 `--render` fallback。

## 8. 驗收紀錄

針對 `www.cec.gov.tw`，P5.5 分階段驗收重點：

- P5.5a 後，report 能輸出 `spaDetection` 與 `scanQuality`，指出 Nuxt / SPA 訊號與 asset-dominant 掃描風險。
- P5.5a 後，`--spa-links off` 可回到舊行為；`--spa-links strict` 不做站台特定推論，只抽明確 URL/path。
- P5.5a 後，source 中可看出連結來自 `html_attribute`、`script_literal` 或 `spa_payload`。
- P5.5b 後，`externalLinks` 不再是 0，report 能列出 `https://db.cec.gov.tw`、YouTube、`gov.tw`、其他政府外站等外部連結。
- P5.5b 後，站內 CMS route 能透過 site rules 轉成可爬 URL，`pagesCrawled` 不再只有 1。
- P5.5c 後，`_nuxt` asset 不再佔 checked URL 的絕大多數，或至少在 summary 中被獨立標示。
- P5.5c 後，summary 能分開呈現內容頁、外連、文件、媒體與靜態資源。

## 9. 結論紀錄

本次 `www.cec.gov.tw` 檢測不如預期的主要原因是網站型態已從傳統 HTML 轉為 Nuxt / SPA，而目前工具仍以 HTML tag attribute 抽取為主。這造成工具大量檢查 `_nuxt` 靜態資源，卻漏掉 payload 中真正的站內頁面與外部連結。

已採取低成本、可控的改善，並保留 headless render 作為後續 fallback：

1. 預設啟用 SPA 偵測。
2. 以 `--spa-links auto|off|strict` 控制 strict payload literal 抽取。
3. 用 `--site-link-rules` 處理站台特定欄位，且已排在 P6 前完成。
4. 將 asset 與內容/外連分流統計，並補簡易 priority。
5. 將 headless render 保留為明確 opt-in fallback。

這樣可以提升 Nuxt / SPA 政府網站的檢測覆蓋率，同時避免把高成本瀏覽器渲染變成預設負擔。
