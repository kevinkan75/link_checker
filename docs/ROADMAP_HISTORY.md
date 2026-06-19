# Roadmap History

本文件保存已完成里程碑的詳細設計、驗收矩陣與理由。現行開發主線請看 `../ROADMAP.md`。

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

狀態：已完成。核心已在主掃描完成後、輸出報告前執行同站 `404 / 410` 集中複查；CLI、GUI、Analyzer 與 CSV/JSON 報告皆已接上最小呈現。

已完成項目：

- result model 新增 `confirmation`，保留初次掃描的 `status`、`method`、`checkedAt`、`finalUrl`、`issueType` 與 `sources`。
- `confirmation.outcome` 支援 `recovered`、`confirmed_missing`、`needs_review`。
- 新增 `transientFailure` 與 `needsReview`，供 UI 與後續歷史比對使用。
- 複查候選限制為同站、初次 `404 / 410`、非外連、非 WAF/Bot challenge。
- 複查使用 `GET`、來源頁 `Referer`、純瀏覽器相容 User-Agent、低併發與 `1000-3000ms` jitter。
- 內建全域最多 `100` 筆、每 host 最多 `20` 筆、全域併發 `2`、每 host 併發 `1`。
- CLI 提供 `--confirm-404` 與 `--no-confirm-404`，預設開啟。
- GUI 預設開啟二次確認，並顯示候選、已恢復、需複查、確認不存在統計。
- Analyzer 顯示每筆二次確認狀態，CSV 匯出追加 confirmation 欄位。

驗證紀錄：

- 初次 `404`、二次 `200`，輸出 `confirmation.outcome: "recovered"`。
- 初次 `410`、二次 `410`，輸出 `confirmation.outcome: "confirmed_missing"`。
- 初次 `404`、二次 `429`，輸出 `confirmation.outcome: "needs_review"`，並標示 `transientFailure` / `needsReview`。
- 關閉二次確認時，result 明確輸出 `confirmation.enabled: false`。

`410 Gone` 應用策略：

- `410` 在 HTTP 語意上比 `404` 更明確，代表伺服器宣告資源已永久移除；但 link checker 仍需二次確認，以降低 User-Agent、Referer、HEAD/GET 差異、CDN cache、路由或防護策略造成的誤判。
- 初次 `410`、二次仍為 `404 / 410`，可視為高信心 `confirmed_missing`，治理上優先建議更新或移除連結。
- 初次 `410`、二次為 `2xx / 3xx`，應標示 `recovered`，不可當成確定壞連結。
- 初次 `410`、二次為 `403 / 429 / timeout / protected / network_error`，應標示 `needs_review`，交由人工或後續掃描確認。
- GUI / Analyzer 可先維持 `404 / 410` 合併統計；後續 P5/P6 可用初次狀態碼與 `confirmation.outcome` 做信心排序，例如 `410 + confirmed_missing` 高於 `404 + confirmed_missing`。
- 外連 `410` 在 P4 MVP 先不進入二次確認；後續應等 P5 外連風險規則與 P7 TTL cache 穩定後，再決定是否納入外連複查策略。

原始實作切分：

1. P4a 資料模型先行。
2. P4b 複查管線。
3. P4c CLI / GUI / Analyzer 最小呈現。

以下保留 P4 原始規格，作為後續維護與回歸驗證依據。

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

狀態：已完成。P5a report schema、P5b 最小規則引擎與 P5c Analyzer 最小呈現已落地並通過驗收；下一步進入 P6，不要先做大型 Analyzer 改版。

落地原則：

- 先讓 `report.json` 本身產生一致的外連風險結果，再讓 CLI、GUI 匯出與 Analyzer 讀同一份資料。
- P5 MVP 不改 crawler 主流程，不做 P6 report diff，不引入 stateful cache。
- 現有 `--domain-rules` 維持網域分類用途；治理規則另以獨立規則模型承載，例如後續新增 `--external-risk-rules`。
- `governanceStatus` 第一版維持固定 vocabulary；WAF、bot、rate limit、auth required 等細分類放入 `riskReasons` / `matchedRules`，不要擴張 `governanceStatus`。

P5a 資料模型：

- 在外連項目上新增 `externalRisk`，保留既有 `externalLinks[]` shape 相容。
- `externalRisk` 建議包含 `riskLevel`、`riskReasons`、`governanceStatus`、`matchedRules`、`needsReview`。
- `governanceStatus` 第一版收斂為 `allowed`、`blocked`、`watchlisted`、`unknown`、`needs_review`。
- `riskLevel` 第一版收斂為 `high`、`medium`、`low`、`info`。
- report summary 新增外連風險統計，例如 by risk level、by governance status、by domain。
- 未啟用外連檢查時，仍應對 inventory-only 訊號產生風險，例如短網址、追蹤分析、下載、嵌入內容與重複引用；HTTP redirect / WAF / status 類風險只有在有檢查結果時標示。

P5b 規則引擎：

- 支援白名單、黑名單與觀察名單。
- 白名單優先於一般分類規則；白名單網域不應因 `cdn`、`social`、`tracking_or_analytics` 等一般分類被升為高風險。
- 黑名單直接產生 `governanceStatus: "blocked"` 與 `riskLevel: "high"`。
- 觀察名單產生 `governanceStatus: "watchlisted"` 並標示 `needsReview: true`。
- 標示短網址、社群、追蹤分析、CDN、下載、嵌入內容等類型。
- 標示跨 host redirect、長 redirect chain、redirect to error。
- 將現有 `protected`、`access_denied`、`429` 等結果轉成治理訊號；細分類如 `blocked_waf`、`blocked_bot`、`rate_limited`、`auth_required`、`access_denied` 放入 `riskReasons` 或 `matchedRules`。
- 針對 `text/html` 回應偵測 challenge / CAPTCHA / bot verification / WAF block page 特徵。
- 針對 `200` 但具明確 challenge 特徵的 HTML 標示 `suspected_false_positive`，不得只靠 body 過短單獨判定。
- 保存 CDN/WAF 診斷證據：provider、matched headers、matched body patterns、blocked reason；body hash 可列為後續強化，不列入 MVP 必要項。
- 標示外部連結是否有多頁重複引用。
- 報告提供 `riskLevel` 與 `riskReasons`。

P5c 呈現：

- GUI / Analyzer 以 report 內建 `externalRisk` 篩選外連風險；舊 report 沒有 `externalRisk` 時，Analyzer 才 fallback 到現有 client-side 規則。
- Analyzer 顯示高風險外連、需人工確認、重複引用外連與高風險網域排行。
- CSV 追加 `riskLevel`、`riskReasons`、`governanceStatus`、`matchedRules`、`sourceCount`。
- `external-summary.json` 補上 risk level、governance status 與高風險網域摘要。

P5 MVP 驗收範圍：

- 每筆 `externalLinks[]` 都有 `externalRisk`。
- `summary` 有外連風險統計：by risk level、by governance status、by domain。
- GUI 自動保存的 `external-links.csv` 與 `external-summary.json` 包含外連風險欄位。
- Analyzer 可篩選 report 內建風險，並保留舊 report fallback。
- 不做 P6 歷史 diff、不做長期 cache、不大改掃描流程。

P5 評估結論：

- P5 MVP 已達成並通過驗收，可進入 P6 report diff。
- P5a/P5b/P5c 已涵蓋 report schema、最小治理規則、CSV / summary 與 Analyzer 最小呈現。
- CLI/report fixture、HTTP external fixture、GUI API + logs fixture、Analyzer fallback fixture 與手動視覺驗收均已通過。
- GUI 主頁尚未提供 `--external-risk-rules` 輸入欄位；MVP 可接受 CLI / 程式化 API 先可用，若 GUI 使用者也需要治理規則，應列為後續小修。
- 目前治理規則只支援 domain-based matching，尚未支援 URL pattern、path、tag/source 條件。
- P6 可直接比對 `externalRisk` 與 governance 狀態。

P5 驗收矩陣：

- 白名單網域應標為 `allowed`，不因一般分類規則升為高風險。
- 黑名單網域應標為 `blocked` 且 `riskLevel: "high"`。
- 觀察名單網域應標為 `watchlisted` 並進入需檢視摘要。
- 短網址與追蹤分析 URL 應產生對應 `riskReasons`。
- 外連 redirect to error 應同時保留 redirect 證據與外連風險原因。
- WAF/Bot/CDN 類結果應進 `externalRisk.riskReasons` 與需人工確認摘要，不直接混入一般 broken link 修復流程。
- Analyzer 載入新 report 時應使用 report 內建 `externalRisk`；載入舊 report 或舊 CSV 時 fallback 不應中斷。
- `external-links.csv` 應包含 `riskLevel`、`riskReasons`、`governanceStatus`、`matchedRules`、`sourceCount`，且可用 Excel 開啟。

理由：

- 政府或大型內容站不只需要 broken link，也需要外連治理。
- 這可以重用現有 domain rules 與 external link inventory。
- WAF/Bot/CDN 分類應走掃描策略調整、白名單協調或人工確認流程，不應直接列為 broken。
