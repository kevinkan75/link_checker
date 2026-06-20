# SPA Link Extraction Implementation Notes

## 1. 需求目標

本文件整理針對 Nuxt / SPA 類型網站的下一步改善需求，重點包含：

- 說明目前 `extractLinks()` 的核心邏輯。
- 將 SPA payload 抽取具體化到 pseudo-code / 接近可落地層級。
- 將簡易 priority queue 具體化到可評估的實作方向。
- 判斷現階段應優先落實的工作項目。

## 2. 現有 `extractLinks()` 核心邏輯

目前 `extractLinks()` 位於 `link-checker.mjs`。

目前實作不是 DOM parser，而是使用正則掃 HTML tag：

```js
const tagRegex = /<([a-zA-Z][\w:-]*)(\s[^<>]*?)?>/g;
```

大致流程：

```js
function extractLinks(html, baseUrl) {
  const links = [];

  for each html tag matched by tagRegex:
    tag = lowercased tag name
    attributesToRead = TAG_ATTRIBUTES.get(tag)

    if tag is not supported:
      continue

    attributes = parseAttributes(rawAttributeText)

    for each configured attribute:
      value = attributes.get(attribute)

      if value is empty:
        continue

      if attribute is "srcset":
        parseSrcset(value)
        push each src candidate
      else:
        push { tag, attribute, value }

  metaRefresh = extractMetaRefresh(html, baseUrl)
  if metaRefresh:
    push { tag: "meta", attribute: "http-equiv=refresh", value: metaRefresh }

  for each redirect from extractJavaScriptRedirects(html):
    push { tag: "script", attribute: redirect.attribute, value: redirect.value }

  return links;
}
```

目前優點：

- 快速。
- 無額外 dependency。
- 對傳統 HTML 網站足夠有效。
- 可直接從原始 HTML 抽取常見 link/resource。

目前限制：

- 不理解 Nuxt / SPA payload。
- 不解析 `__NUXT_DATA__`、`window.__NUXT__`、`__NEXT_DATA__` 等 framework state。
- 不會從 JSON-like script payload 中抽 `linkUrl`、`directPath`、`articleId`、`youtubeId`。
- 容易大量抽到 CSS/JS asset，卻漏掉真正內容頁與外部連結。

## 3. SPA 偵測

SPA 偵測應先做成低成本診斷。第一版可不改變掃描行為，只在 report 中標示可能漏掉 SPA payload link。

Pseudo-code：

```js
function detectSpaFramework(html, checkedUrls = []) {
  const signals = [];

  if (html.includes("/_nuxt/")) {
    signals.push("nuxt_assets");
  }
  if (html.includes("__NUXT_DATA__")) {
    signals.push("nuxt_data");
  }
  if (html.includes("window.__NUXT__")) {
    signals.push("nuxt_window_state");
  }
  if (html.includes("__NEXT_DATA__")) {
    signals.push("next_data");
  }

  const anchorCount = countMatches(html, /<a\b[^>]*\shref\s*=/gi);
  const urlLiteralCount = countMatches(html, /https?:\/\/[^\s"'<>\\]+/gi);

  const nuxtAssetCount = checkedUrls.filter((url) => url.includes("/_nuxt/")).length;
  const assetDominant = checkedUrls.length > 0 && nuxtAssetCount / checkedUrls.length > 0.7;

  if (html.length > 100_000 && anchorCount < 10) {
    signals.push("large_html_low_anchor_count");
  }

  if (urlLiteralCount > anchorCount * 3) {
    signals.push("url_literals_exceed_anchors");
  }

  if (assetDominant) {
    signals.push("asset_dominant_scan");
  }

  return {
    detected: signals.length > 0,
    framework: inferFramework(signals),
    signals,
  };
}

function inferFramework(signals) {
  if (signals.some((signal) => signal.startsWith("nuxt"))) {
    return "nuxt";
  }
  if (signals.some((signal) => signal.startsWith("next"))) {
    return "next";
  }
  return "unknown";
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}
```

Report 可新增：

```json
{
  "spaDetection": {
    "detected": true,
    "framework": "nuxt",
    "signals": ["nuxt_assets", "large_html_low_anchor_count"],
    "recommendation": "Enable or keep SPA payload link extraction."
  }
}
```

## 4. Payload 抽取

建議不要直接改壞既有 `extractLinks()`，而是新增 framework-aware extractor，再與原本 HTML links 合併。

整合概念：

```js
const htmlLinks = extractLinks(pageResult.body, pageBaseUrl);

const spaLinks = this.options.spaLinks !== "off"
  ? extractFrameworkLinks(pageResult.body, pageBaseUrl, {
      mode: this.options.spaLinks,
      siteLinkRules: this.siteLinkRules,
    })
  : [];

const links = [...htmlLinks, ...spaLinks];
```

建議 link object 新增 `sourceType`：

```js
{
  tag: "script",
  attribute: "payload:url",
  value: "https://db.cec.gov.tw",
  sourceType: "spa_payload"
}
```

### 4.1 Extractor 入口

```js
function extractFrameworkLinks(html, pageUrl, options = {}) {
  const mode = options.mode || "auto";
  const links = [];

  if (mode === "off") {
    return links;
  }

  links.push(...extractUrlLiteralsFromScripts(html));

  if (mode === "auto" || mode === "strict") {
    links.push(...extractPathLiteralsFromScripts(html, pageUrl));
  }

  if (mode === "auto" && options.siteLinkRules) {
    links.push(...extractSiteRuleLinks(html, pageUrl, options.siteLinkRules));
  }

  return dedupeExtractedLinks(links);
}
```

### 4.2 抽完整 URL literal

```js
function extractUrlLiteralsFromScripts(html) {
  const links = [];

  for (const scriptText of extractInlineScriptTexts(html)) {
    const regex = /https?:\/\/[^\s"'<>\\]+/g;

    for (const match of scriptText.matchAll(regex)) {
      const value = cleanupPayloadUrl(match[0]);

      if (!value) {
        continue;
      }

      links.push({
        tag: "script",
        attribute: "payload:url",
        value,
        sourceType: "script_literal",
      });
    }
  }

  return links;
}
```

### 4.3 抽站內 path literal

`strict` 模式只抽明確 `/` 開頭 path，不做站台特定欄位推論。

```js
function extractPathLiteralsFromScripts(html, pageUrl) {
  const links = [];

  for (const scriptText of extractInlineScriptTexts(html)) {
    const regex = /["'](\/[a-zA-Z0-9][^"'<>\\\s]*)["']/g;

    for (const match of scriptText.matchAll(regex)) {
      const rawPath = cleanupPayloadPath(match[1]);

      if (!rawPath || shouldIgnorePayloadPath(rawPath)) {
        continue;
      }

      links.push({
        tag: "script",
        attribute: "payload:path",
        value: new URL(rawPath, pageUrl).toString(),
        sourceType: "spa_payload",
      });
    }
  }

  return links;
}
```

### 4.4 抽 inline script

```js
function extractInlineScriptTexts(html) {
  const scripts = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const attributes = match[1] || "";
    const body = match[2] || "";

    if (/\ssrc\s*=/i.test(attributes)) {
      continue;
    }

    if (!body.trim()) {
      continue;
    }

    scripts.push(body);
  }

  return scripts;
}
```

### 4.5 站台特定規則

`directPath`、`directType`、`articleId`、`youtubeId` 這類欄位不應硬寫死在核心 crawler。建議透過規則檔：

```text
--site-link-rules <file>
```

規則概念：

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

第一版可先只支援：

- `externalUrl` 欄位：值為完整 URL 時直接加入。
- `youtubeId` 欄位：轉為 `https://www.youtube.com/watch?v={youtubeId}`。
- `routePath` 欄位：若值已是 `/` 開頭 path，直接 resolve。

## 5. 簡易 Priority Queue

現階段不需要一開始導入完整 heap。第一版可以先在 validation queue item 上加 `priority`，取 job 前排序。

### 5.1 URL priority 計算

```js
function getUrlPriority(url, link, intent) {
  const parsed = new URL(url);
  const ext = getPathExtension(parsed.pathname);

  if (intent.shouldCrawl && looksLikePage(url)) {
    return 100;
  }

  if (link.sourceType === "spa_payload" && looksLikePage(url)) {
    return 95;
  }

  if (!this.isCrawlOrigin(url)) {
    return 90;
  }

  if (isDocumentExtension(ext)) {
    return 70;
  }

  if (isMediaExtension(ext)) {
    return 40;
  }

  if (isImmutableAsset(url, ext)) {
    return 10;
  }

  return 50;
}
```

### 5.2 Queue item

```js
this.validationQueue.push({
  inventoryEntry,
  url,
  options,
  priority: getUrlPriority.call(this, url, link, intent),
});
```

### 5.3 取出 job

第一版：

```js
this.validationQueue.sort((a, b) => b.priority - a.priority);
const job = this.validationQueue.shift();
```

資料量變大後再改成 binary heap。

## 6. CLI 開關建議

### SPA payload links

```text
--spa-links <auto|off|strict>
```

語意：

| 模式 | 說明 |
| --- | --- |
| `auto` | 預設。偵測到 SPA / Nuxt 訊號時抽取 payload URL，並可套用 site rules。 |
| `off` | 完全關閉 payload / script link extraction。 |
| `strict` | 只抽明確 URL 或 `/` 開頭 path，不做站台特定欄位推論。 |

### Site link rules

```text
--site-link-rules <file>
```

用於站台特定欄位推論，例如 `directType`、`directPath`、`articleId`。

### Render fallback

```text
--render
--render-timeout-ms <n>
--render-max-pages <n>
```

Headless render 成本高，建議預設關閉，只作為 fallback。

## 7. 現階段建議優先順序

採納外部建議後，ROADMAP 已將本工作拆成 P5.5a / P5.5b / P5.5c：

1. P5.5a：SPA 偵測 + strict payload literals。
2. P5.5b：site link rules + CEC rules。
3. P5.5c：asset/content split + simple priority。
4. P6：report-to-report diff。

理由：

- SPA 偵測風險最低，能先讓 report 正確指出「這次掃描可能漏內容」。
- strict payload literal 抽取可先改善明確 URL / path 的覆蓋率，並維持低誤抽風險。
- CEC 的站內內容頁多來自 `directType`、`directPath`、`articleId` 等 CMS 欄位；若不做 site link rules，`pagesCrawled` 不一定會增加，所以 P5.5b 應排在 P6 前。
- Queue 優先順序有價值，但如果還抽不到內容頁，只會更有效率地檢查 `_nuxt` asset，因此排在 P5.5c。

建議第一個可落地工作包：

1. 新增 `--spa-links auto|off|strict` option，預設 `auto`。
2. 新增 `detectSpaFramework()` 並寫入 report summary；`asset_dominant_scan` 這類掃描品質訊號應在 build report 階段判斷。
3. 新增 `extractFrameworkLinks()`，第一版只抽 script 中的完整 URL 與明確 `/` path。
4. link source 加上 `sourceType`。
5. 保持原本 `extractLinks()` 行為不變，降低回歸風險。
6. 避免 payload link 因 `tag: "script"` 被誤分類為 asset；分類應參考 `sourceType` 或 derived link type。

第二個工作包：

1. 新增 `--site-link-rules <file>`。
2. 支援 `linkUrl`、`youtubeId`、明確 route path 與簡單 template mapping。
3. 建立 `www.cec.gov.tw` 規則範例，處理 `directType`、`directPath`、`articleId`。
4. site rules 產生的 URL 標記 `sourceType: "site_rule_derived"`。

第三個工作包：

1. 將 asset/content/external/document/media 分開統計。
2. 新增簡易 priority，內容頁與外連優先，media / immutable asset 降權。
3. 第一版不用 binary heap；若需要，以 priority 欄位與排序即可。
