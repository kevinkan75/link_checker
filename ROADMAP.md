# 開發路線紀錄

## 狀態總覽

目前 P0-P5 已完成，包含本機服務生命週期、URL inventory、404 / 410 二次確認與外連風險治理 MVP。下一步不是直接進 P6 diff，而是先完成 P5.5 SPA / Nuxt 站台抽取前置改善，避免 P6 report diff 建立在不完整 report 上。

核心順序：

1. P5.5a：SPA detection + strict payload literals。
2. P5.5b：site link rules + CEC rules。
3. P5.5c：asset/content split + simple priority。
4. P6：report-to-report diff。
5. P7：TTL cache。
6. P8：incremental scan。
7. P9/P10：Analyzer 與分級排程強化。

| 階段 | 狀態 | 目的 |
| --- | --- | --- |
| P0 | 已完成 | 單機版服務生命週期、idle shutdown、heartbeat。 |
| P1 | 已完成 | 結果模型、WAF/Bot/CDN 診斷、cache headers。 |
| P2 | 已完成 | URL canonical strategy 與 canonical key integration。 |
| P3 | 已完成 | URL inventory、來源合併、validation intent、validation queue。 |
| P4 | 已完成 | 404 / 410 二次確認 MVP。 |
| P5 | 已完成 | 外連風險規則、治理分類與風險摘要 MVP。 |
| P5.5a | 下一個工作包 | 偵測 SPA / Nuxt，抽 strict payload URL/path literals。 |
| P5.5b | 待 P5.5a 後 | 用 site rules 處理 CEC CMS 欄位與站台特定連結。 |
| P5.5c | 待 P5.5b 後 | 分流 asset/content/external，加入簡易 priority。 |
| P6 | 下一個主要項目 | 兩份 report 歷史比對，只做 report-to-report diff。 |
| P7 | 待規劃 | TTL 檢查快取，晚於 P6。 |
| P8 | 待規劃 | 建立在 history/cache 上的增量掃描，晚於 P6/P7。 |

## 開發主軸

下一階段應優先提升 report 覆蓋率與資料品質，再做歷史比對、快取與增量掃描。不要先擴大爬取範圍，也不要先導入大型基礎設施。

```text
HTML 抽取
  -> SPA / Nuxt payload 抽取與來源標記
  -> URL resolve / canonicalize
  -> URL inventory 去重與來源合併
  -> HTTP validator 批次檢查
  -> 結果判讀、快取、歷史比對與報告呈現
```

已確認的工程邊界：

- 保留現有 `extractLinks()`，不要重寫成完整 DOM parser。
- SPA payload extraction 以低成本、可回退為原則。
- 站台特定欄位透過 `--site-link-rules`，不硬寫在核心 crawler。
- Headless render 只作 opt-in fallback，不預設啟用。
- CDN/WAF/Bot 處理定位是辨識、降誤報、節流、保存證據與提示人工協調，不做繞過防護。

參考文件：

- [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)
- [docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md)
- [docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md)

## 已完成基線

P0-P3 詳細設計與驗收紀錄已移至 [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)。

已完成能力摘要：

- P0：portable / exe 模式 idle shutdown、browser heartbeat、手動 shutdown。
- P1：`checkedAt`、`canonicalUrl`、cache headers、CDN/WAF/Bot 診斷欄位。
- P2：`safe|moderate|aggressive` canonical strategy 與 canonical key integration。
- P3：URL inventory、來源合併、validation intent、validation queue。
- P4：同站 `404 / 410` 二次確認，輸出 `confirmation`、`transientFailure`、`needsReview`。
- P5：`externalRisk`、治理規則、CSV / summary 與 Analyzer 最小呈現。

## P5.5 Active Work：SPA / Nuxt 站台抽取

### 背景

`www.cec.gov.tw` 會轉址到 `https://web.cec.gov.tw/central`。這類 Nuxt / SPA 站台的導覽、文章、YouTube 與外部政府網站連結大量藏在 script payload，不是完整 `<a href>`。目前工具會抽到大量 `_nuxt/*.css`、`_nuxt/*.js`、SVG 與 metadata，卻漏掉真正有治理價值的內容頁與外連。

這不是 WAF、深度或頁數設定問題。正確修法是改善抽取模型與 report 診斷。

### P5.5a：SPA Detection + Strict Payload Literals

目的：先讓 report 能辨識「這次掃描可能漏掉 SPA payload 連結」，並抽取明確 URL / path literal。

交付項：

1. 新增 `--spa-links auto|off|strict`，預設 `auto`。
2. 新增頁面層 `spaDetection`，偵測 `_nuxt/`、`__NUXT_DATA__`、`window.__NUXT__`、低 `<a href>` 數等訊號。
3. 在 build report 階段新增 `scanQuality`，判斷 `_nuxt` asset 佔比過高、`pagesCrawled` 過低但 URL literal 很多等掃描品質風險。
4. 新增 `extractFrameworkLinks()`，第一版只抽 inline script / payload 中的完整 URL literal 與明確 `/` 開頭 path。
5. 每筆 link source 新增 `sourceType`，例如 `html_attribute`、`script_literal`、`spa_payload`。
6. `strict` 模式只抽完整 URL 與明確 `/` path，不做站台特定欄位推論。

實作注意：

- 外部建議的 payload pseudo-code 不可照貼，需修正 `match[0]` / `match[2]` 等細節。
- payload 抽出的業務連結不能只因 `tag: "script"` 被分類為 asset；`classifyLinkType()` 與 external summary 應優先參考 `sourceType` 或 derived link type。
- `asset_dominant_scan` 需等 checked results 完成後才可靠，應放在 build report 階段。

驗收：

- report 能輸出 `spaDetection` 與 `scanQuality`。
- `--spa-links off` 可回到舊行為。
- `--spa-links strict` 只抽完整 URL / 明確 `/` path。
- source 可看出 `html_attribute`、`script_literal` 或 `spa_payload`。

### P5.5b：Site Link Rules + CEC Rules

目的：處理 CEC 這類 CMS payload 欄位。只做 literal extraction 不一定能讓 `pagesCrawled` 增加，因為站內頁常由 `directType`、`directPath`、`articleId` 等欄位推導。

交付項：

1. 新增 `--site-link-rules <file>`。
2. 第一版支援 `externalUrl` 欄位、`youtubeId` 欄位、明確 route path 與簡單 template mapping。
3. 建立 `www.cec.gov.tw` 規則範例，處理 `linkUrl`、YouTube ID、`directType` / `directPath` 與 `articleId`。
4. site rules 產生的 URL 標記 `sourceType: "site_rule_derived"`。

驗收：

- 對 `www.cec.gov.tw`，`externalLinks` 不應為 0。
- report 能列出 payload / site rules 中的 `https://db.cec.gov.tw`、YouTube、`gov.tw` 與其他政府外站。
- 站內 CMS route 能透過 site rules 轉成可爬 URL，`pagesCrawled` 不應停在 1。

### P5.5c：Asset/Content Split + Simple Priority

目的：避免 `_nuxt` asset 佔滿檢查預算與 summary 解讀空間。

交付項：

1. 將 `_nuxt` asset 與內容頁、外連、文件、媒體分開統計。
2. summary / report 可新增 `pagesChecked`、`contentLinksChecked`、`externalLinksChecked`、`documentsChecked`、`assetsChecked`。
3. 新增簡易 validation priority：內容頁與外連優先，文件其次，media / immutable asset 降權。
4. 第一版用 priority 欄位與排序即可，後續掃描量變大再評估 binary heap。

驗收：

- `_nuxt` asset 不再佔 checked URL 的絕大多數，或至少在 summary 中被獨立標示。
- summary 能分開呈現內容頁、外連、文件、媒體與靜態資源。
- priority 不得影響內容頁與外連治理結果。

## P6：Report-to-Report Diff

狀態：下一個主要項目，但排在 P5.5 之後。P6 不重新掃描網站、不重新判斷風險、不引入資料庫、不導入 cache 或 incremental scan。

P6a 交付項：

1. 建立 `report-diff.mjs` CLI：`old-report.json` + `new-report.json` -> `diff.json`。
2. 實作 report normalization：新 report 優先 `checked[]`，舊 report fallback `broken[]`，外連獨立使用 `externalLinks[]`。
3. 實作 URL diff summary：新增、移除、變更、新發生問題、已修復、持續存在。
4. 實作 P4/P5 欄位 diff：`confirmation.outcome`、`transientFailure`、`confirmationNeedsReview`、`externalRisk`、`externalRiskNeedsReview`。
5. 先輸出 JSON 與簡短 console summary；GUI / Analyzer 呈現放到後續強化。

比對 key：

- 優先使用 `canonicalUrl`。
- 缺欄位時 fallback 到 `url`，以支援舊 report。
- `needsReview` 在 P4/P5 語意不同，呈現時拆成 `confirmationNeedsReview` 與 `externalRiskNeedsReview`。

第一版比較欄位：

- `ok`
- `status`
- `issueType`
- `classification`
- `finalUrl`
- `redirected`
- `redirectCount`
- `redirectType`
- `redirectIssues`
- `confirmation.outcome`
- `needsReview`
- `transientFailure`
- `externalRisk.riskLevel`
- `externalRisk.governanceStatus`
- `externalRisk.riskReasons`

狀態判定：

- `newIssue`
- `resolvedIssue`
- `persistentIssue`
- `changed`
- `riskIncreased`
- `riskDecreased`
- `confidenceIncreased`
- `confidenceDecreased`

驗收：

- 同一 canonical URL 從 `404` 變 `200` 應標示已修復。
- 同一 canonical URL 從 `200` 變 `404/410` 應標示新發生問題。
- `confirmation.outcome` 從 `needs_review` 變 `confirmed_missing` 應標示信心提高。
- 外連風險從 `low` 變 `high` 應進入治理摘要。
- 來源頁移除但 URL 仍在其他頁存在時，不應誤判 URL 完全移除。

## P7：TTL 檢查快取

狀態：P6 後實作。P7 只處理可驗證的 URL result 快取，不先處理 page HTML cache。

建議 cache file：

```text
.cache/link-check-cache.json
```

cache key 應包含：

- `canonicalUrl`
- method policy
- userAgent hash
- accept language
- referer mode

cache value 應包含：

- result
- checkedAt
- expiresAt
- stableCount
- lastStatus
- lastFinalUrl

建議 TTL：

- 穩定 `200/204/3xx`：24 小時到 7 天。
- `404/410`：6 到 24 小時。
- `429/502/503/504/timeout`：5 到 30 分鐘。
- `blocked_waf/blocked_bot/rate_limited`：短 TTL 或不快取。
- `access_denied/auth_required`：短 TTL 或依站點規則決定是否快取。

CLI 可新增：

- `--cache`
- `--cache-file <file>`
- `--cache-ttl-hours <n>`
- `--no-cache`
- `--refresh-cache`

驗收：

- 相同 canonical key、method policy、UA hash、語言與 referer mode 時可命中 cache。
- `404/410` 快取 TTL 應短於穩定 `200/204/3xx`。
- `429/timeout/5xx` 應短 TTL，避免長時間保留暫時性失敗。
- `blocked_waf/blocked_bot/rate_limited` 應短 TTL 或不快取。
- `--refresh-cache` 應忽略既有 cache 並回寫新結果。

## P8：增量掃描

狀態：P6/P7 後實作。P8 依賴 report diff、scan state 與 TTL cache，不應提前做。

scan state 草案：

```js
{
  pages: {
    pageUrl: {
      contentHash,
      links: []
    }
  },
  urls: {
    canonicalUrl: {
      sources,
      firstSeenAt,
      lastSeenAt,
      lastCheckedAt
    }
  }
}
```

行為：

- 優先檢查新頁面。
- 優先檢查 HTML hash 改變的頁面。
- 優先檢查新出現的 URL。
- 優先檢查上次錯誤或 retryable 的 URL。
- 跳過 TTL 未過期且穩定的 URL。

CLI 可新增：

- `--incremental`
- `--state-file <file>`
- `--changed-only`

驗收：

- 新頁面與 hash 改變頁面應被優先掃描。
- 未變更頁面中的穩定 URL 若 TTL 未過期，應可跳過。
- 上次為 `needs_review`、timeout、redirect error 或 high risk 的 URL 應優先複查。
- 增量掃描 report 仍需保留完整可讀摘要，不能只輸出 delta。

## P9：Analyzer 後續強化

P5 已完成二次確認與外連風險最小呈現；P9 只做 P6/P7/P8 之後的 Analyzer 強化，避免先做空 UI。

後續強化：

- 顯示歷史比對：新增、移除、修復、惡化、持續存在。
- 顯示 cache 命中、TTL、上次檢查時間。
- 顯示高重複引用 URL 與影響頁面數。
- 顯示 redirect chain 詳細資訊。

## P10：分級排程

先設計排程建議，不急著做完整常駐 scheduler。

每個 URL 或 page 可計算：

```js
{
  priority: "high" | "normal" | "low",
  suggestedIntervalHours,
  reason
}
```

建議規則：

- 首頁、導覽列、站內頁：高頻。
- 站內圖片、CSS、JS：中頻。
- 外部連結：低頻。
- 上次錯誤、redirect error、timeout：高頻複查。
- `429` 或疑似 WAF/Bot 擋下：降低併發、延長 delay，避免密集重試。
- 外部站可加入每網域每分鐘與每路徑每分鐘限制；這應建立在 P7/P8 的快取與狀態資料後。
- 穩定 200 多次：降低頻率。

## P11：輔助功能

這些功能有價值，但優先度低於誤判降低、資料模型、外連治理、歷史比對與快取。

- sitemap 支援。
- robots.txt 讀取與尊重策略。
- HTML / Excel 報表輸出。
- 環境變數設定。
- 更多匯入/匯出格式。

## 暫不納入近期主線

- 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用既有 `--system-ca` 與 `--legacy-tls`。
- 不先導入 AI 分類、動態 JS 渲染、PostgreSQL、server-client 或 eGov 登入。
- 不做泛用 404 重試；404 二次確認應採條件式策略，避免拖慢整體掃描。
- 不以追蹤瀏覽器 process 作為關閉服務的主要機制；`Process.Start(url)` 無法可靠代表使用者是否仍開著該頁籤。
- 不把單機版改成常駐 Windows Service；目前需求是可預期地收尾本機工具，而不是背景服務化。
- 不預設啟用 aggressive URL canonicalization 作為去重、cache 或 validation key；避免把實際不同的資源錯誤合併。
- 不做輪換 User-Agent、偽裝 Googlebot、代理 IP 輪換、解 CAPTCHA、模擬真人互動或其他繞過 WAF/Bot 防護的策略。
- 不把 `200` 且 body 過短單獨判定為 `suspected_false_positive`；必須搭配 content-type、標頭、title 或 challenge pattern。
- 不對明確 WAF/Bot challenge 做多次 aggressive retry；這類結果應保存證據並提示調整掃描策略或與站方協調。
- 不保存完整 response body 作為診斷欄位，避免報告包含登入頁、錯誤頁或防護頁中的敏感內容。
