# 開發路線紀錄

## 狀態總覽

目前 P0-P5 已完成，包含 URL inventory、404 / 410 二次確認與外連風險治理 MVP。下一階段先補 P5.5 SPA / Nuxt 站台抽取前置改善，避免 P6 report diff 建立在不完整 report 上；P6 仍是下一個主要項目。P7 cache、P8 incremental scan 與後續 Analyzer 強化都應建立在 P6 之後。

| 階段 | 狀態 | 重點 |
| --- | --- | --- |
| P0 | 已完成 | 單機版服務生命週期、idle shutdown、heartbeat。 |
| P1 | 已完成 | 結果模型、WAF/Bot/CDN 診斷、cache headers。 |
| P2 | 已完成 | URL canonical strategy 與 canonical key integration。 |
| P3 | 已完成 | URL inventory、來源合併、validation intent、validation queue。 |
| P4-0 | 已完成 | 404 / 410 分類與 UI 文案一致化。 |
| P4 | 已完成 | 404 / 410 二次確認 MVP。 |
| P5 | 已完成 | 外連風險規則、治理分類與風險摘要 MVP；CLI/report、GUI 匯出與 Analyzer 驗收通過。 |
| P5.5 | 下一個前置工作 | SPA / Nuxt 偵測、payload link extraction、asset/content 分流；先改善 report 覆蓋率。 |
| P6 | 下一個主要項目 | 兩份 report 歷史比對；只做 report-to-report diff。 |
| P7 | 待規劃 | TTL 檢查快取；晚於 P6。 |
| P8 | 待規劃 | 建立在 history/cache 上的增量掃描；晚於 P6/P7。 |

已完成基線：

- P0-P3：本機服務生命週期、結果模型、canonical key、URL inventory 與 validation queue。
- P4：同站 `404 / 410` 二次確認，輸出 `confirmation`、`transientFailure`、`needsReview`。
- P5：外連 `externalRisk`、治理規則、CSV / summary 與 Analyzer 最小呈現。

近期順序：

1. P5.5 SPA / Nuxt 站台抽取前置改善。
2. P6 report-to-report diff。
3. P7 TTL 檢查快取。
4. P8 增量掃描。
5. P9/P10 Analyzer 與分級排程強化。

下一個工作包：P5.5a SPA detection + strict payload literals

1. 新增 `--spa-links auto|off|strict`，預設 `auto`。
2. 新增 SPA / Nuxt 偵測並寫入 report summary；另在 build report 階段補 `scanQuality` 診斷。
3. 保留現有 `extractLinks()`，另新增 payload / script URL literal extraction。
4. link source 新增 `sourceType`，例如 `html_attribute`、`script_literal`、`spa_payload`。
5. 第一版只抽完整 URL 與明確 `/` 開頭 path；不做站台特定欄位推論。
6. 先不導入預設 headless render；`--render` 保留為後續 opt-in fallback。

後續工作包：P5.5b site link rules + CEC rules

1. 新增 `--site-link-rules <file>`，用於站台特定欄位推論。
2. 支援 `linkUrl`、`youtubeId`、明確 route path 與簡單 template mapping。
3. 建立 `www.cec.gov.tw` 規則範例，處理 `directType`、`directPath`、`articleId`。
4. site rules 產生的 URL 必須標記 `sourceType: "site_rule_derived"`。

後續工作包：P5.5c asset/content split + simple priority

1. 將 `_nuxt` asset 與 content links / external links 分開統計。
2. 新增 asset/content/external/document/media 分類摘要。
3. 新增簡易 validation priority：內容頁與外連優先，文件其次，media / immutable asset 降權。
4. 第一版不導入 binary heap；若需要，以 priority 欄位與排序實作。

後續工作包：P6a report diff

1. 建立 `report-diff.mjs` CLI：`old-report.json` + `new-report.json` -> `diff.json`。
2. 實作 report normalization：新 report 優先 `checked[]`，舊 report fallback `broken[]`，外連獨立使用 `externalLinks[]`。
3. 實作 URL diff summary：新增、移除、變更、新發生問題、已修復、持續存在。
4. 實作 P4/P5 欄位 diff：`confirmation.outcome`、`transientFailure`、`confirmationNeedsReview`、`externalRisk`、`externalRiskNeedsReview`。
5. 先輸出 JSON 與簡短 console summary；GUI / Analyzer 呈現放到後續強化。

## 開發主軸

下一階段應優先聚焦在降低誤判、建立可延伸的檢查資料模型，以及補強治理分析，而不是先擴大爬取範圍或加入大型基礎設施。

核心設計方向：

```text
HTML 抽取
  -> SPA / Nuxt payload 抽取與來源標記
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

## 路線細節

### 已完成里程碑摘要

詳細設計與驗收紀錄已移至 [docs/ROADMAP_HISTORY.md](docs/ROADMAP_HISTORY.md)。

#### P0-P3 基礎能力（已完成）

- P0：單機版服務生命週期、idle shutdown、heartbeat、手動 shutdown。
- P1：結果模型補強、cache headers、CDN/WAF/Bot 診斷欄位。
- P2：URL canonical strategy 與 canonical key integration。
- P3：URL inventory、來源合併、validation intent、validation queue。

#### P4. 404 / 410 二次確認 MVP（已完成）

- 同站 `404 / 410` 在主掃描後集中二次確認。
- report 保留初次掃描結果，並新增 `confirmation`、`transientFailure`、`needsReview`。
- CLI、GUI、Analyzer 與 CSV 已接上最小呈現。
- 外連 `404 / 410` 不納入 P4 MVP confirmation 候選。

#### P5. 外連風險規則 MVP（已完成）

- `externalLinks[]` 每筆新增 `externalRisk`。
- 支援 `riskLevel`、`riskReasons`、`governanceStatus`、`matchedRules`、`needsReview`。
- `--external-risk-rules` 支援 allowlist、blocklist、watchlist。
- GUI 自動保存的 `external-links.csv` / `external-summary.json` 與 Analyzer 已支援 P5 欄位。
- P5 驗收通過；P5.5 應先補強 SPA / Nuxt report 覆蓋率，之後 P6 可直接比對 `externalRisk` 與 governance 狀態。

### P5.5. SPA / Nuxt 站台抽取前置改善

狀態：下一個前置工作。先補低成本 SPA 偵測與 payload link extraction，避免 `www.cec.gov.tw` 這類 Nuxt / SPA 站台只掃到 `_nuxt` asset，導致外連治理與後續 report diff 建立在不完整 report 上。

P5.5 評估結論：

- 現有 `extractLinks()` 使用正則掃 HTML tag attribute，對傳統 HTML 有效，但不解析 Nuxt / SPA payload。
- `www.cec.gov.tw` 入口會轉到 `https://web.cec.gov.tw/central`，原始 HTML 中大量導覽、文章、YouTube 與外部政府網站連結藏在 script payload，不是完整 `<a href>`。
- 目前工具會大量抽到 `_nuxt/*.css`、`_nuxt/*.js`、SVG 與 metadata，卻漏掉 payload 中真正的內容頁與外部連結。
- 這不是 WAF、深度或頁數設定問題；應優先改善抽取模型，而不是先導入 headless render。
- P5.5 應保持低風險：保留現有 `extractLinks()`，另加 framework-aware extractor 與診斷欄位。
- 外部建議的 `detectSpaFramework()` 方向可採納，但應拆成「頁面層 SPA 偵測」與「build report 階段 scan quality 診斷」；`asset_dominant_scan` 需等 checked results 完成後才可靠。
- 外部建議的 payload extractor 方向可採納，但 pseudo-code 不可照貼；實作時需修正 `match[0]` / `match[2]` 等細節，並避免 payload link 因 `tag: "script"` 被誤分類為 asset。

P5.5a 範圍：SPA detection + strict payload literals

- 新增 SPA / Nuxt 偵測，偵測 `_nuxt/`、`__NUXT_DATA__`、`window.__NUXT__`、低 `<a href>` 數、高 asset 佔比等訊號。
- report summary 新增 `spaDetection`，輸出 `detected`、`framework`、`signals` 與建議。
- build report 階段新增 `scanQuality` 診斷，例如 `_nuxt` asset 佔比過高、`pagesCrawled` 過低但 URL literal 很多。
- 新增 CLI 開關 `--spa-links auto|off|strict`，預設 `auto`。
- 新增 `extractFrameworkLinks()`，第一版只抽 inline script / payload 中的完整 URL literal 與明確 `/` 開頭 path。
- 每筆 link source 新增 `sourceType`，例如 `html_attribute`、`script_literal`、`spa_payload`。
- `strict` 模式只抽完整 URL 與明確 `/` path，不做站台特定欄位推論。
- payload 抽出的業務連結不能只依 `tag: "script"` 分類；`classifyLinkType()` 與 external summary 應優先參考 `sourceType` 或 derived link type，避免誤列為 asset。
- 保留 `--render` 作為後續 opt-in fallback，不預設啟用。

P5.5b 範圍：site link rules + CEC rules

- 新增 `--site-link-rules <file>`，用於站台特定欄位推論，例如 `directPath`、`directType`、`articleId`、`youtubeId`。
- 第一版支援 `externalUrl` 欄位、`youtubeId` 欄位、明確 route path 與簡單 template mapping。
- 針對 `www.cec.gov.tw` 建立 site link rules 範例，將 `linkUrl`、YouTube ID、`directType` / `directPath` 與 `articleId` 轉成可檢查 URL。
- site rules 產生的 URL 必須標記 `sourceType: "site_rule_derived"`，方便排查誤抽與後續 diff。
- CEC 的站內頁多來自 CMS 欄位，不一定是明確 `/central/...` path；因此 P5.5b 應排在 P6 前，不宜延後太久。

P5.5c 範圍：asset/content split + simple priority

- 將 `_nuxt` asset 與內容頁、外連、文件、媒體分開統計，避免單一 `urlsChecked` 誤導使用者。
- summary / report 可新增 `pagesChecked`、`contentLinksChecked`、`externalLinksChecked`、`documentsChecked`、`assetsChecked` 等分流欄位。
- 新增簡易 validation priority：內容頁與外連優先，文件其次，media / immutable asset 降權。
- 若要排序，優先在抽出的 links / enqueue 階段降低 asset 優先度；不要只在 validation queue 末端排序，否則仍可能讓 asset 先佔滿 inventory 與 budget。
- 第一版用 priority 欄位與排序即可，後續掃描量變大再評估 binary heap。
- 視需要支援 immutable asset defer / skip，但不得影響內容頁與外連治理結果。

P5.5 後續擴充：

- 視需要支援 Next.js `__NEXT_DATA__` 等其他 framework payload。

P5.5 不納入：

- 不重寫 `extractLinks()` 為完整 DOM parser。
- 不把 `directPath`、`directType`、`articleId` 等站台欄位硬寫在核心 crawler。
- 不預設啟用 Playwright / headless render。
- 不先做完整 binary heap priority queue；若需要，第一版以簡單 priority 欄位與排序即可。
- 不在未偵測到 SPA 訊號時武斷宣稱「標準 HTML 掃描完全足夠」；report 只能說明未偵測到明顯 SPA 訊號。

P5.5 驗收矩陣：

- P5.5a 後，report 應能輸出 `spaDetection` 與 `scanQuality`，指出 Nuxt / SPA 訊號與 asset-dominant 掃描風險。
- P5.5a 後，`--spa-links strict` 應只抽完整 URL / 明確 `/` path；`--spa-links off` 可回到舊行為。
- `sourceType` 可指出連結來自 `html_attribute`、`script_literal` 或 `spa_payload`。
- P5.5b 後，對 `www.cec.gov.tw` 的 `externalLinks` 不應為 0，report 應能列出 payload / site rules 中的 `https://db.cec.gov.tw`、YouTube、`gov.tw` 與其他政府外站連結。
- P5.5b 後，對 `www.cec.gov.tw` 的站內 CMS route 應能透過 site rules 轉成可爬 URL，`pagesCrawled` 不應停在 1。
- P5.5c 後，`_nuxt` asset 不再佔 checked URL 的絕大多數，或至少在 summary 中被獨立標示。
- P5.5c 後，summary 能分開呈現內容頁、外連、文件、媒體與靜態資源。

參考文件：

- [docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](docs/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md)
- [docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](docs/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md)

### P6. 歷史比對

先做「兩份 report 比對」，再做完整 stateful incremental scan。

狀態：下一個主要項目，但排在 P5.5 之後。P6 只做 report-to-report diff，不引入常駐資料庫、cache 或增量掃描。

P6 評估結論：

- P6 的 schema 條件已具備，因 P4 confirmation 與 P5 externalRisk 已提供足夠穩定的 report schema；實作順序仍排在 P5.5 report 覆蓋率改善後。
- 第一版應做獨立 diff 工具，輸入兩份 `report.json`，輸出 JSON diff 與簡短 console summary。
- 不重新掃描、不重新判斷風險、不引入資料庫；P7 cache 與 P8 incremental scan 應維持後置。
- 新 report 優先用 `checked[]` 建立站內 URL index；舊 report 若沒有 `checked[]`，fallback 到 `broken[]`。
- 外連應從 `externalLinks[]` 建立獨立 index，不混入站內 broken repair 流程。
- 比對 key 優先使用 `canonicalUrl`，缺欄位時 fallback 到 `url`，以支援舊 report。
- `needsReview` 在 P4/P5 語意不同；P6 呈現時應拆開 `confirmationNeedsReview` 與 `externalRiskNeedsReview`，不要只合併成單一布林。

P6 MVP 範圍：

- 比對兩份 `report.json`。
- 顯示新增 URL、移除 URL、狀態改變、final URL 改變、redirect chain 改變。
- 顯示問題是否新發生、已修復、持續存在。
- 比對 `confirmation.outcome`、`needsReview`、`transientFailure` 與外連風險狀態。
- 輸出建議包含 `summary`、`added`、`removed`、`changed`、`newIssues`、`resolvedIssues`、`persistentIssues`、`externalRiskChanges`。
- 第一版 CLI 入口建議為 `node report-diff.mjs old-report.json new-report.json --output diff.json`。
- 比較欄位第一版收斂為 `ok`、`status`、`issueType`、`classification`、`finalUrl`、`redirected`、`redirectCount`、`redirectType`、`redirectIssues`、`confirmation.outcome`、`needsReview`、`transientFailure`、`externalRisk.riskLevel`、`externalRisk.governanceStatus`、`externalRisk.riskReasons`。
- 狀態判定第一版收斂為 `newIssue`、`resolvedIssue`、`persistentIssue`、`changed`、`riskIncreased`、`riskDecreased`、`confidenceIncreased`、`confidenceDecreased`。

P6 不納入：

- 不重新掃描網站。
- 不建立常駐資料庫。
- 不導入 TTL cache。
- 不做 incremental scan。
- 不先做大型 GUI / Analyzer 改版。

P6 後續 scan state 草案：

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

P6 驗收矩陣：

- 同一 canonical URL 從 `404` 變 `200` 應標示已修復。
- 同一 canonical URL 從 `200` 變 `404/410` 應標示新發生問題。
- `confirmation.outcome` 從 `needs_review` 變 `confirmed_missing` 應標示信心提高。
- 外連風險從 `low` 變 `high` 應進入治理摘要。
- 來源頁移除但 URL 仍在其他頁存在時，不應誤判 URL 完全移除。

理由：

- 歷史比對比單次掃描更符合治理需求。
- 先用 report diff 可快速落地，不必一開始就設計完整資料庫。

### P7. TTL 檢查快取

在 result model、inventory 與 P2b canonical key integration 穩定後加入持久化快取，避免大型內容庫每次全站重打外部 URL。

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

P7 驗收矩陣：

- 相同 canonical key、method policy、UA hash、語言與 referer mode 時可命中 cache。
- `404/410` 快取 TTL 應短於穩定 `200/204/3xx`。
- `429/timeout/5xx` 應短 TTL，避免長時間保留暫時性失敗。
- `blocked_waf/blocked_bot/rate_limited` 應短 TTL 或不快取。
- `--refresh-cache` 應忽略既有 cache 並回寫新結果。

理由：

- 大型站台與外部連結檢查需要控制頻率。
- 快取必須晚於 P1、P2b、P3，否則 key 與 result schema 容易返工。

### P8. 增量掃描

建立在 scan state 與 TTL cache 上，只優先檢查變更範圍。

狀態：P6/P7 後實作。P8 依賴 report diff、scan state 與 TTL cache，不應提前做。

- 優先檢查新頁面。
- 優先檢查 HTML hash 改變的頁面。
- 優先檢查新出現的 URL。
- 優先檢查上次錯誤或 retryable 的 URL。
- 跳過 TTL 未過期且穩定的 URL。

CLI 可新增：

- `--incremental`
- `--state-file <file>`
- `--changed-only`

P8 驗收矩陣：

- 新頁面與 hash 改變頁面應被優先掃描。
- 未變更頁面中的穩定 URL 若 TTL 未過期，應可跳過。
- 上次為 `needs_review`、timeout、redirect error 或 high risk 的 URL 應優先複查。
- 增量掃描 report 仍需保留完整可讀摘要，不能只輸出 delta。

理由：

- 增量掃描需要 inventory、history 與 cache 三者支撐。
- 若太早做，會被目前混合式流程卡住。

### P9. Analyzer 後續強化

P5c 已完成外連風險最小呈現；P9 只做 P6/P7/P8 之後的 Analyzer 強化，避免先做空 UI 或重複 P5c。

已具備：

- 顯示二次確認結果。
- 顯示外連風險分類與治理摘要。

後續強化：

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
