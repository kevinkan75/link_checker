# 開發路線紀錄

## 狀態總覽

- P0 單機版服務生命週期：已完成。
- P1 結果模型補強：已完成。
- P2a URL 正規化策略 MVP：已完成。
- P2b canonical key integration：未完成，必須在 P3 完成後、P7 TTL cache 前處理。
- 下一個主要開發項目：P3c validation intent。

## 開發主軸

下一階段應優先聚焦在降低誤判、建立可延伸的檢查資料模型，以及補強治理分析，而不是先擴大爬取範圍或加入大型基礎設施。

核心設計方向：

```text
HTML 抽取
  -> URL resolve / canonicalize
  -> URL inventory 去重與來源合併
  -> HTTP validator 批次檢查
  -> 結果判讀、快取、歷史比對與報告呈現
```

現有實作已具備全域併發、per-host 併發限制、HEAD/GET fallback、redirect chain、retry 與外連盤點能力；後續開發應在這些能力上整理邊界，而不是重寫成熟的 HTTP 檢查邏輯。

CDN/WAF 處理邊界：

- 工具定位是辨識、降誤報、節流、保留證據與提示人工或站方協調。
- 可採用 WAF/Bot/CDN 感知分類與診斷欄位。
- 不採用繞過防護的策略，例如輪換身分、偽裝搜尋引擎、代理 IP 輪換、解 CAPTCHA 或模擬真人互動。

## 開發順序

### P0. 單機版服務生命週期（已完成）

狀態：已完成並通過 smoke test。portable / exe 啟動模式已具備 idle shutdown、browser heartbeat、GUI 手動關閉服務入口；dev / CLI 模式不預設啟用 idle shutdown。

已完成項目：

- portable / exe 模式 idle shutdown。
- browser heartbeat：GUI 每 `30s` 呼叫 `POST /api/session/heartbeat`。
- GUI 手動關閉本機服務：`POST /api/shutdown`。
- exe 啟動器預設帶入 `--idle-shutdown-ms 300000`。
- idle shutdown 只在無執行中掃描、無停止中任務、queue 未運作，且超過 idle timeout 無 heartbeat 時觸發。
- 關閉前盡量呼叫 `server.close()`，必要時以短暫 timeout 強制結束 process。

### P1. 結果模型補強（已完成）

狀態：已完成並通過本機 smoke test。404 與 Cloudflare-like 403 報告可輸出 P1 欄位與 WAF/Bot 診斷。

已完成欄位：

- 每筆 checked result 新增 `checkedAt`。
- 新增 `canonicalUrl`，明確區分原始 URL 與檢查用 URL。
- 新增 `cacheHeaders`：`cacheControl`、`etag`、`expires`、`lastModified`、`age`、`vary`。
- 新增 `contentLength`。
- 新增 CDN/WAF 診斷欄位：`wafHeaders`、`blockedReason`、`blockedRuleId`、`bodySignature`、`suspectedWaf`、`suspectedBot`。
- 保留既有 `finalUrl`、`redirectChain`、`elapsedMs`、`contentType`、`server`、`diagnosis`。
- `bodySignature` 只保存摘要與特徵，不保存完整 body；包含 `signatureType`、`matchedPatterns`、`bodyHash`、`title` 與 sanitized snippet。
- CSV / JSON / GUI Analyzer 已逐步顯示重要欄位，避免一次塞滿 UI。

理由：

- 能立即改善「不是單純 200/404」的診斷能力。
- 後續 TTL cache 需要 `checkedAt` 與 cache headers。
- CDN/WAF 欄位能讓防護阻擋與真正壞連結分流，避免直接進入修壞連結流程。

### P2. URL 正規化策略（P2a 已完成，P2b 待 P3 後完成）

P2 是 P3 inventory 的 key foundation。性能收益主要來自 P3 的 unique inventory validation；P2 的目標是提供穩定、可測、可配置的 canonical key。

P2a MVP 狀態：已完成。

已完成範圍：

- 新增 `canonicalizeUrl(value, { strategy })`，預設 `safe`。
- 保留 `normalizeUrl()` 作為 safe 相容包裝。
- 新增 CLI 設定入口：`--canonical-strategy safe|moderate|aggressive`，預設 `safe`。
- GUI job API 已可接收 `canonicalStrategy`，但 GUI 先不顯示可見選項。
- report options 已記錄 `canonicalStrategy`。
- result `canonicalUrl` 會依策略輸出。
- `moderate/aggressive` 目前只作為 report canonicalization 與後續驗證用途。
- canonical strategy 不改變實際 fetch URL，也尚未作為 cache/result/inventory key。

預設 safe 策略：

- resolve 相對 URL。
- 移除 fragment。
- scheme / host 小寫。
- 移除 default port：`80`、`443`。
- 交由 `URL` 物件處理基本編碼與路徑正規化。
- 不改變 query 順序。
- 不移除 tracking query。
- 不改變尾斜線。
- 不合併 `http` / `https`。

後續可選 moderate 策略：

- query 參數排序。
- 移除空 query。
- 對明確頁面路徑套用尾斜線規則。
- 必須 opt-in，不可預設啟用。

後續可選 aggressive 策略：

- 移除 `utm_*`、`fbclid`、`gclid` 等追蹤參數。
- 自訂 canonical rules。
- 不預設合併 `http` / `https`，除非使用者明確啟用。
- 作為去重、cache 或 validation key 時，必須建立在 P3 inventory 已能保留 `originalUrls`、`resolvedUrls` 與所有 sources 後才可啟用。

P2b canonical key integration：未完成。

完成時機：

- 必須在 P3 inventory 完成後處理。
- 必須在 P7 TTL cache 前完成，避免 cache key 返工。
- 不應在 P3 前把 `canonicalUrl` 改成 `statusCache`、`bodyCache`、`results`、`sources`、`externalLinks` 的 key。
- 不應在 P3 前讓 `moderate/aggressive` 影響實際去重、cache 或 validation key。

P2b 待辦：

- 將 `statusCache`、`bodyCache`、`results`、`sources`、`externalLinks` 對齊 canonical key。
- Validator 使用 inventory item 的 `canonicalUrl` 做 unique validation key。
- 保留 representative fetch URL，避免 canonicalization 改變實際請求目標。
- `moderate/aggressive` 只能在 inventory 已保留 `originalUrls`、`resolvedUrls`、sources 後，用於去重 / cache / validation key。
- 報告呈現「檢查一次，影響 N 個來源」。

理由：

- 去重必須建立在一致的 canonical key 上。
- 過度正規化會造成誤判，尤其是下載、搜尋、API、語系與分頁 URL。
- canonical key 與實際 fetch URL 必須分離，避免 canonicalization 改變實際檢查目標。
- P2 不應單獨導入 aggressive 去重；否則效能提升有限但誤合併風險高。

### P3. URL Inventory 與抽取/驗證分層（P3a/P3b 已完成，P3c 下一步）

將目前 `processPage()` 中「抽取、來源合併、檢查」交織的流程整理成 inventory 導向。

P3 是 P2/P3 中主要的性能最佳化工作：先合併 unique canonical URL，再驗證，避免大型頁面或多頁重複引用造成重複 promise、重複排程與重複請求。

P3a 狀態：已完成。已新增 inventory skeleton、safe canonical inventory key、來源合併與 `summary.inventorySummary` metrics；尚未改動 `checkUrl()` key、`results` key 或實際 fetch 行為。

P3b 狀態：已完成。`processPage()` 會先寫 inventory，再透過 inventory-level scheduled flag 避免相同 safe canonical URL 重複加入 validation checks；仍沿用現有 `checkUrl(resolved)` 與既有 cache/result key。

實作策略：

- 不要一次把整個資料流改成 inventory 架構。
- 先做低風險的 inventory skeleton 與 metrics。
- 保持既有 fetch/cache 行為，再逐步搬移 validation flow。
- P2b canonical key integration 必須等 P3 穩定後再做。

實作切片：

1. P3a inventory skeleton（已完成）：
   - 新增 `this.inventory = new Map()`。
   - 新增 `addInventoryItem(resolvedUrl, source, link, intent)`。
   - 保存 `canonicalUrl`、`originalUrls`、`resolvedUrls`、`representativeUrl`、`sources`。
   - 暫時不改 `checkUrl()` key、不改 `results` key、不改實際 fetch 行為。
   - 在現有 `addSource()` / `addExternalLink()` 附近補 inventory 寫入。
   - report summary 先新增 metrics，可先只輸出 `inventorySummary`，不必輸出完整 inventory array。
2. P3b 抽取 / 合併分層（已完成）：
   - `processPage()` 抽 link 後先寫 inventory。
   - check 前先看 inventory 是否已見過，減少同頁或跨頁 duplicate scheduling。
   - 仍可沿用現有 `checkUrl(resolved)`，避免一次改動底層 map。
3. P3c validation intent：
   - 加入 `needsStatusCheck`、`needsBodyFetch`、`checked`、`bodyFetched`。
   - 支援 status check 升級 body fetch。
   - 避免「先 HEAD / 輕 GET 後，頁面沒有 body 可爬」的問題。
4. P3d validation queue：
   - 用 validation queue 取代每頁內大量 `Promise.all(checks)`。
   - 控制大型頁面的 promise / backpressure。
   - 這一步才會明顯改善大型站台效能。
5. P2b canonical key integration：
   - P3 穩定後才把 `statusCache`、`bodyCache`、`results`、`sources`、`externalLinks` 對齊 canonical key。
   - 這一步必須在 P7 TTL cache 前完成。

共用資料模型：

```js
{
  canonicalUrl,
  originalUrls: [],
  resolvedUrls: [],
  representativeUrl,
  sources: [
    {
      page,
      tag,
      attribute,
      text,
      rawValue,
      resolvedUrl
    }
  ],
  isExternal,
  linkType,
  categories,
  shouldCheck,
  shouldCrawl,
  needsStatusCheck,
  needsBodyFetch,
  checked,
  bodyFetched
}
```

最終目標：

- 抽出 HTML link extraction 階段。
- 抽出 URL resolve / canonicalize 階段。
- 新增 inventory map：`Map<canonicalUrl, inventoryItem>`。
- 將相同 canonical URL 的 sources 合併。
- Validator 只接收 unique URL 或 inventory item。
- 報告保留每個 URL 的所有出現位置。
- 分離 crawl queue 與 validation queue：
  - crawl queue 負責抓頁面與抽取 HTML。
  - inventory queue 負責合併 URL、分類、決定 check/crawl intent。
  - validation queue 負責檢查 unique inventory item。
- 用 validation queue 取代每頁內大量 `Promise.all(checks)`，降低大型頁面產生的 promise 與排程壓力。
- 新增 validation intent：同一 canonical URL 若先做 status check、後續又需要 body，必須能升級為 body fetch，不可漏爬頁面。
- 建立 representative URL 選擇規則：
  - 優先第一個 resolved URL。
  - 優先非 fallback URL。
  - 同站 crawl 情境優先同站 URL。
  - fallback 成功時保留 `normalizedFrom` / `normalizationFallback` 證據。
- 明確處理既有 `homepageFallback`、`getResolutionFallbackUrls()` 與 inventory 的關係，避免降低誤判邏輯被去重吃掉。
- 報告新增 inventory / performance metrics：
  - `urlsDiscovered`
  - `uniqueCanonicalUrls`
  - `duplicateUrlReferences`
  - `sourcesMerged`
  - `validationSkippedByInventory`
  - `statusCacheHits`
  - `bodyCacheHits`
  - `inventoryMergeRatio`
- Analyzer / GUI 必須相容沒有 inventory 與新 summary 欄位的舊 report。

P3 前置風險控制：

- 不在 P3a 就把 cache/result key 改成 `canonicalUrl`。
- 不在 P3a 就讓 `moderate/aggressive` 影響去重、cache 或 validation key。
- `homepageFallback`、`getResolutionFallbackUrls()`、`normalizationFallback` 必須保留，不可被 inventory 去重吃掉。
- GUI / Analyzer / CSV 目前依賴 `broken[].sources` 與 `externalLinks[]`，report shape 不可突然大改。

驗證矩陣：

- fragment duplicate：`/a#one`、`/a#two`。
- 多頁引用同一 URL，inventory metrics 能顯示合併。
- 同 URL 多 source 能保留所有來源。
- fallback URL 成功時仍保留 `normalizationFallback`。
- 起始頁 body fetch 不被 status check 覆蓋。
- 舊 report Analyzer 不壞。

理由：

- 同一外部 URL 在多個頁面出現時，只檢查一次。
- 能清楚呈現「檢查一次、影響 N 個頁面」。
- 這是 TTL cache、歷史比對、增量掃描與分級排程的共同基礎。
- P3 的 queue/backpressure 才是真正改善大型站台效能的主體。
- inventory 必須保留原始 URL 與所有來源，才能安全支撐後續 moderate/aggressive canonicalization。

### P4. 404 / 410 二次確認 MVP

這是降低誤判的第一個 user-facing 功能，應建立在 P1-P3 後實作，讓 confirmation 結果可以乾淨掛到 result model。

- 以使用者可勾選的設定提供，GUI 預設開啟。
- CLI 對應提供 `--confirm-404` 與 `--no-confirm-404`。
- 執行時機放在主掃描完成後、輸出報告前，作為集中複查階段。
- 第一版只針對同站 `404/410` 複查，外部連結先不納入。
- 複查使用 `GET`，帶來源頁 `Referer` 與瀏覽器相容 User-Agent。
- User-Agent 策略：一般掃描保留瀏覽器相容 UA 加工具識別；404 二次確認與保守模式使用純瀏覽器相容 UA；不使用或冒充 Googlebot UA。
- 複查請求使用核心瀏覽器式 headers：`User-Agent`、`Accept`、`Accept-Language`、`Referer`；不預設手動加入 `Cache-Control: no-cache` 或強制覆蓋 `Accept-Encoding`。
- 內建低速策略：每筆前加入 `1000-3000ms` jitter，全域複查併發 `2`，每 host 併發 `1`。
- 第一版限制全域最多複查 `100` 筆、每 host 最多複查 `20` 筆，避免大量 404 拖慢報告產出。
- 報告保留初次結果，新增 `confirmation`、`transientFailure`、`needsReview` 等欄位。
- Analyzer 顯示是否啟用二次確認，以及「二次確認後已恢復 / 需複查 / 確認不存在」等狀態。
- 若初次結果已明確判定為 WAF/Bot challenge，不進入 aggressive retry；應標示 `blocked_waf` / `blocked_bot` 或 `needsReview`。

理由：

- 直接降低「掃描當下回 404、瀏覽器或稍後重試為 200」的誤判。
- 條件式複查比泛用重試更可控，也不會拖慢整體掃描。

### P5. 外連風險規則

建立在既有外連盤點、網域分類與 URL inventory 上，補足治理分析。

- 支援白名單、黑名單與觀察名單。
- 標示短網址、社群、追蹤分析、CDN、下載、嵌入內容等類型。
- 標示跨 host redirect、長 redirect chain、redirect to error。
- 將現有 `protected` 細分為 `blocked_waf`、`blocked_bot`、`rate_limited`、`auth_required` 與 `access_denied` 等治理狀態。
- 針對 `text/html` 回應偵測 challenge / CAPTCHA / bot verification / WAF block page 特徵。
- 針對 `200` 但具明確 challenge 特徵的 HTML 標示 `suspected_false_positive`，不得只靠 body 過短單獨判定。
- 保存 CDN/WAF 診斷證據：provider、matched headers、matched body patterns、blocked reason、body hash。
- 標示外部連結是否有多頁重複引用。
- 報告提供 `riskLevel` 與 `riskReasons`。
- GUI / Analyzer 以分類篩選外連風險。

理由：

- 政府或大型內容站不只需要 broken link，也需要外連治理。
- 這可以重用現有 domain rules 與 external link inventory。
- WAF/Bot/CDN 分類應走掃描策略調整、白名單協調或人工確認流程，不應直接列為 broken。

### P6. 歷史比對

先做「兩份 report 比對」，再做完整 stateful incremental scan。

第一階段：

- 比對兩份 `report.json`。
- 顯示新增 URL、移除 URL、狀態改變、final URL 改變、redirect chain 改變。
- 顯示問題是否新發生、已修復、持續存在。

第二階段：

- 保存 scan state：

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

理由：

- 歷史比對比單次掃描更符合治理需求。
- 先用 report diff 可快速落地，不必一開始就設計完整資料庫。

### P7. TTL 檢查快取

在 result model、inventory 與 P2b canonical key integration 穩定後加入持久化快取，避免大型內容庫每次全站重打外部 URL。

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

理由：

- 大型站台與外部連結檢查需要控制頻率。
- 快取必須晚於 P1、P2b、P3，否則 key 與 result schema 容易返工。

### P8. 增量掃描

建立在 scan state 與 TTL cache 上，只優先檢查變更範圍。

- 優先檢查新頁面。
- 優先檢查 HTML hash 改變的頁面。
- 優先檢查新出現的 URL。
- 優先檢查上次錯誤或 retryable 的 URL。
- 跳過 TTL 未過期且穩定的 URL。

CLI 可新增：

- `--incremental`
- `--state-file <file>`
- `--changed-only`

理由：

- 增量掃描需要 inventory、history 與 cache 三者支撐。
- 若太早做，會被目前混合式流程卡住。

### P9. Analyzer 呈現

Analyzer 應在底層資料與規則結果穩定後補強，避免先做空 UI。

- 顯示二次確認結果。
- 顯示外連風險分類與治理摘要。
- 顯示歷史比對：新增、移除、修復、惡化、持續存在。
- 顯示 cache 命中、TTL、上次檢查時間。
- 顯示高重複引用 URL 與影響頁面數。
- 顯示 redirect chain 詳細資訊。

理由：

- Analyzer 的價值來自穩定資料模型與規則結果。
- UI 應跟著治理問題設計，而不是單純堆欄位。

### P10. 分級排程

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

理由：

- 分級排程需要歷史、快取與穩定狀態。
- 先輸出「建議下次檢查時間」比直接做常駐排程更務實。

### P11. 輔助功能

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
