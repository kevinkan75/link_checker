# 開發路線紀錄

## 狀態總覽

目前 404 / 410 二次確認 MVP 已落地，下一階段應進入外連風險規則與治理分析功能。

| 階段 | 狀態 | 重點 |
| --- | --- | --- |
| P0 | 已完成 | 單機版服務生命週期、idle shutdown、heartbeat。 |
| P1 | 已完成 | 結果模型、WAF/Bot/CDN 診斷、cache headers。 |
| P2 | 已完成 | URL canonical strategy 與 canonical key integration。 |
| P3 | 已完成 | URL inventory、來源合併、validation intent、validation queue。 |
| P4-0 | 已完成 | 404 / 410 分類與 UI 文案一致化。 |
| P4 | 已完成 | 404 / 410 二次確認 MVP。 |

近期順序：

1. P5 外連風險規則。
2. P6 歷史比對。
3. P7 TTL 檢查快取。
4. P8 增量掃描。

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

### P2. URL 正規化策略（P2a/P2b 已完成）

P2 提供穩定、可測、可配置的 canonical key，並已和 P3 inventory / cache / report join 對齊。

已完成能力：

- 新增 `canonicalizeUrl(value, { strategy })`，預設 `safe`。
- 保留 `normalizeUrl()` 作為 safe 相容包裝。
- 新增 CLI 設定入口：`--canonical-strategy safe|moderate|aggressive`，預設 `safe`。
- GUI job API 已可接收 `canonicalStrategy`，但 GUI 先不顯示可見選項。
- report options 已記錄 `canonicalStrategy`。
- result `canonicalUrl` 會依策略輸出。
- `statusCache`、`bodyCache`、`results`、`sources`、`externalLinks` 與 inventory 已使用 canonical key。
- Validator 使用 inventory item 的 `canonicalUrl` 做 unique validation key。
- 保留 representative fetch URL，canonical strategy 不改變實際請求目標。
- report 可呈現「檢查一次，影響 N 個來源」。

Canonical strategy：

| Strategy | 行為 | 使用建議 |
| --- | --- | --- |
| `safe` | resolve 相對 URL、移除 fragment、scheme/host 小寫、移除 default port。保留 query 順序、tracking query、尾斜線與 http/https 差異。 | 預設策略，低誤合併風險。 |
| `moderate` | 在 safe 基礎上排序 query、移除空 query、對明確頁面路徑套用尾斜線規則。 | 可 opt-in 用於內容站常見重複 URL。 |
| `aggressive` | 在 moderate 基礎上移除 `utm_*`、`fbclid`、`gclid` 等追蹤參數。 | 高風險 opt-in；不預設啟用。 |

理由：

- 去重必須建立在一致的 canonical key 上。
- 過度正規化會造成誤判，尤其是下載、搜尋、API、語系與分頁 URL。
- canonical key 與實際 fetch URL 必須分離，避免 canonicalization 改變實際檢查目標。
- P2 不應單獨導入 aggressive 去重；否則效能提升有限但誤合併風險高。

### P3. URL Inventory 與抽取/驗證分層（P3a/P3b/P3c/P3d 已完成）

P3 將 `processPage()` 中交織的抽取、來源合併與檢查流程整理成 inventory 導向。它是 P2/P3 的主要性能基礎：先合併 unique canonical URL，再驗證，降低大型頁面或跨頁重複引用造成的 promise、排程與請求壓力。

已完成能力：

- 建立 `inventory`：以 canonical URL 合併 `originalUrls`、`resolvedUrls`、`representativeUrl` 與所有 `sources`。
- `processPage()` 抽 link 後先寫 inventory，再依 inventory state 排程 validation。
- 相同 canonical URL 不重複加入 status validation queue，並累計 `validationSkippedByInventory`。
- validation intent 拆成 status/body 兩條狀態，支援先 status check、後續升級 body fetch。
- validation queue 已取代每頁內大量 `Promise.all(checks)`；crawler completion 會等待 queue drain。
- report summary 新增 `inventorySummary`，舊 report 主要 shape 保持相容。

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

Inventory metrics：

- `urlsDiscovered`
- `uniqueCanonicalUrls`
- `duplicateUrlReferences`
- `sourcesMerged`
- `validationSkippedByInventory`
- `statusCacheHits`
- `bodyCacheHits`
- `inventoryMergeRatio`

保留邊界：

- representative fetch URL 與 canonical key 必須分離。
- `homepageFallback`、`getResolutionFallbackUrls()`、`normalizationFallback` 必須保留，不可被 inventory 去重吃掉。
- GUI / Analyzer / CSV 仍依賴 `broken[].sources` 與 `externalLinks[]`，report shape 不可突然大改。
- `aggressive` canonicalization 仍應維持 opt-in，避免不同資源被錯誤合併。

驗證矩陣：

- fragment duplicate：`/a#one`、`/a#two`。
- 多頁引用同一 URL，inventory metrics 能顯示合併。
- 同 URL 多 source 能保留所有來源。
- query order duplicate：`?b=2&a=1`、`?a=1&b=2` 在 `moderate` 策略下合併。
- externalLinks canonical join 能對回 checked result。
- broken report canonical join 能保留所有 sources。
- fallback URL 成功時仍保留 `normalizationFallback`。
- 起始頁 body fetch 不被 status check 覆蓋。
- 舊 report Analyzer 不壞。

理由：

- 同一外部 URL 在多個頁面出現時，只檢查一次。
- 能清楚呈現「檢查一次、影響 N 個頁面」。
- 這是 TTL cache、歷史比對、增量掃描與分級排程的共同基礎。
- P3 的 queue/backpressure 才是真正改善大型站台效能的主體。
- inventory 必須保留原始 URL 與所有來源，才能安全支撐後續 moderate/aggressive canonicalization。

### P4-0. 404 / 410 分類與文案一致化（已完成）

狀態：已完成。核心 report、GUI server、主 GUI 與 README 已同步將 `404 / 410` 視為「不存在」分類；Analyzer 原本已支援 `404/410` 判讀。

P4-0 是 P4 的前置 gate，不是獨立大型功能。它只處理分類語意與文案一致性，讓後續 P4a/P4b 不必一邊做二次確認、一邊修正 `404/410` 基礎分類。

必要性：

- `HTTP 410 Gone` 代表資源已永久移除，對 link checker 來說應和 `404 Not Found` 一樣歸為「不存在」。
- 如果 P4 用 `issueType === "not_found"` 找二次確認候選 URL，`410` 不應被漏掉。
- Analyzer 已能將 `404/410` 視為 `not_found`，但核心報告、GUI server 與主 GUI 仍需對齊，否則同一份 report 在不同畫面會出現分類不一致。

優先處理：

- 核心分類、GUI server 與主 GUI 都應將 `404` 與 `410` 歸為 `not_found`。
- UI 篩選、標籤與摘要文案不應只寫 `404`；建議改為 `404 / 410` 或「不存在」。
- Analyzer 已能將 `404/410` 視為 `not_found`，但仍應和主報告與 GUI 文案對齊。
- README 的結果判讀應同步說明 `404 / 410` 都代表頁面或資源不存在。

不納入 P4-0：

- 不做 confirmation pipeline。
- 不改 retry 策略。
- 不重構既有 source referer GET、homepage fallback 或 normalization fallback。
- 不納入外連風險規則。
- 不先擴充 Analyzer 大型 UI。

驗證矩陣：

- 本機測試頁連到 `410 Gone` 時，`broken[].issueType` 應為 `not_found`。
- `summary.brokenByType.not_found` 應包含 `404` 與 `410`。
- GUI 即時統計、報告表格與 Analyzer 匯入同一份 report 時分類一致。

理由：

- P4 明確處理 `404 / 410`，分類語意必須先穩定。
- 若 410 仍落在 `http_error`，P4 的候選 URL、統計與 UI 會出現不一致。
- P4-0 成本低、風險低，適合獨立成 P4 前第一個小 commit。

### P4. 404 / 410 二次確認 MVP

這是降低誤判的第一個 user-facing 功能，應建立在 P1-P3 後實作，讓 confirmation 結果可以乾淨掛到 result model。

優先順序：

1. P4a 資料模型先行。
2. P4b 複查管線。
3. P4c CLI / GUI / Analyzer 最小呈現。

P4a 資料模型：

- 報告保留初次結果，不以二次確認結果覆蓋原始掃描證據。
- 在 result 上新增 `confirmation`，至少包含 `enabled`、`checked`、`status`、`ok`、`finalUrl`、`checkedAt`、`method`、`referer`、`elapsedMs`、`outcome`。
- 每個候選 result 都應有 `confirmation`；未啟用或非候選項目也要能明確表達 `enabled: false` 或 `checked: false`，避免 UI 需要猜測欄位缺漏。
- 初次掃描的 `status`、`method`、`checkedAt`、`finalUrl`、`issueType` 與 `sources` 不因二次確認被覆蓋。
- 新增或衍生 `transientFailure` 與 `needsReview`，供 UI 與後續歷史比對使用。
- `confirmation.outcome` 第一版收斂為三類：`confirmed_missing`、`recovered`、`needs_review`。
- `confirmed_missing` 代表二次確認仍為 `404/410`；`recovered` 代表二次確認轉為 `2xx/3xx`；`needs_review` 代表逾時、`429`、`403`、WAF/Bot、網路錯誤或結果不明。

P4b 複查管線：

- 執行時機放在主掃描完成後、輸出報告前，作為集中複查階段。
- 第一版只針對同站 `404/410` 複查，外部連結先不納入。
- 候選 URL 定義：同站、初次結果為 `404/410`、非外連、非 WAF/Bot challenge。
- 候選 URL 以 canonical result 為單位，並保留所有 `sources`；不要對每個 source 重複複查同一 URL。
- 複查使用 `GET`，帶來源頁 `Referer` 與瀏覽器相容 User-Agent。
- User-Agent 策略：一般掃描保留瀏覽器相容 UA 加工具識別；404 二次確認與保守模式使用純瀏覽器相容 UA；不使用或冒充 Googlebot UA。
- 複查請求使用核心瀏覽器式 headers：`User-Agent`、`Accept`、`Accept-Language`、`Referer`；不預設手動加入 `Cache-Control: no-cache` 或強制覆蓋 `Accept-Encoding`。
- 內建低速策略：每筆前加入 `1000-3000ms` jitter，全域複查併發 `2`，每 host 併發 `1`。
- 第一版限制全域最多複查 `100` 筆、每 host 最多複查 `20` 筆，避免大量 404 拖慢報告產出。
- 若使用者停止掃描，confirmation 階段也必須停止，並在已產生的 report 中清楚標示未完成或未複查項目。
- 若初次結果已明確判定為 WAF/Bot challenge，不進入 aggressive retry；應標示 `blocked_waf` / `blocked_bot` 或 `needsReview`。

P4c 使用者入口與呈現：

- 以使用者可勾選的設定提供，GUI 預設開啟。
- CLI 對應提供 `--confirm-404` 與 `--no-confirm-404`。
- CLI 預設策略需明確固定。建議預設開啟，並用 `--no-confirm-404` 關閉；若後續改採預設關閉，roadmap 與 README 必須同步說明。
- report options 記錄是否啟用二次確認與複查限制設定。
- Analyzer 顯示是否啟用二次確認，以及「二次確認後已恢復 / 需複查 / 確認不存在」等狀態。
- GUI 第一版只需顯示二次確認狀態與統計，不先做大型 Analyzer 改版。

與既有 fallback 的邊界：

- 現有 source referer GET、homepage fallback 與 normalization fallback 屬於即時降誤判，不等同 P4 confirmation。
- P4 confirmation 是主掃描後的集中複查，應保留初次結果與二次確認結果兩份證據。
- 不把現有 fallback 欄位混入 `confirmation`；可在 UI 上共同呈現，但資料語意要分開。

P4 驗收矩陣：

- 初次 `404`，二次 `200`，結果應為 `confirmation.outcome: "recovered"`。
- 初次 `410`，二次 `410`，結果應為 `confirmation.outcome: "confirmed_missing"`。
- 初次 `404`，二次 timeout，結果應為 `confirmation.outcome: "needs_review"`，並標示 `transientFailure` 或 `needsReview`。
- 同一 canonical URL 有多個 sources 時，只複查一次，report 仍保留所有 sources。
- 外連 `404/410` 不進入 P4 MVP 的候選清單。
- WAF/Bot challenge 不做 aggressive retry，應進入 `needs_review` 或既有防護分類。
- 達到全域或每 host 複查上限時，未複查項目要能被 UI 區分為 skipped / unchecked，而不是誤判為確認不存在。

理由：

- 直接降低「掃描當下回 404、瀏覽器或稍後重試為 200」的誤判。
- 條件式複查比泛用重試更可控，也不會拖慢整體掃描。
- 先固定資料模型，再補管線與 UI，可避免 P5/P6/P7 依賴的 report schema 反覆返工。

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
