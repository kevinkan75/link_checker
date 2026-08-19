# P12-2A XML Sitemap Fallback Record

本文件是 P12-2A 的單一演進紀錄，涵蓋規劃、設計鎖定、實作、診斷、測試與完成驗證。使用者與技術契約說明分別以根 README、CLI reference 與 technical spec 為準。

## 1. Background

v1.2.0 已完成 P12-1 HTML Sitemap Fallback Phase 1。當起始頁完成一般靜態探索後，沒有額外可爬行的同站頁面時，P12-1 會嘗試最多 6 個受限的 HTML 網站導覽候選，再把可用候選交回既有頁面佇列與掃描流程。

P8d 已提供另一條成熟路徑：使用者透過 `--sitemap` 明確指定 XML sitemap 後，工具可載入 `urlset` 或 `sitemapindex`、套用安全與同源限制、建立 sitemap seed，並交由一般 crawler 處理。P12-2A 的目標不是建立新的 XML parser 或 crawler，而是在符合嚴格條件時，自動嘗試唯一的慣例來源 `/sitemap.xml`，並重用 P8d。

## 2. Confirmed TYCG real-site evidence

本機證據檔為 `logs/report-sitemap-explicit.json`。它受 `.gitignore` 的 `logs/` 規則保護，只是本機驗證證據，不得加入 Git、移入 `docs/` 或 `tests/`、修改 `.gitignore`，也不得刪除。

驗證目標與設定：

| 項目 | 值 |
| --- | --- |
| 起始 URL | `https://travel.tycg.gov.tw/` |
| 明確 sitemap | `https://travel.tycg.gov.tw/sitemap.xml` |
| `maxPages` | `50` |
| `maxDepth` | `2` |

P8d 實際結果：

| 項目 | 值 |
| --- | --- |
| sitemap status / type | `ok` / `urlset` |
| sitemap URL / `lastmod` | `207` / `207` |
| seed attempted / seeded | `207` / `49` |
| seed ignored | `158`（`already_queued_or_crawled: 1`、`max_pages: 157`） |
| `pagesCrawled` | `50` |
| `urlsChecked` | `1448` |
| `urlsDiscovered` | `3441` |
| `uniqueCanonicalUrls` | `1548` |

結論：`EXISTING_P8D_WITH_TYCG_SITEMAP = PASS`。現有 XML `urlset` parsing、sitemap seed 與 seed 後的一般頁面掃描均可用；主要限制來自 `maxPages`。缺少的行為只有：空的初始站內 frontier 自動找到 `<origin>/sitemap.xml`，再交給既有 P8d pipeline。

## 3. Problem definition

目前 `--sitemap` 的處理發生在 page workers 啟動前；是否出現空的初始 frontier，則要等起始頁完成 HTML、SPA payload 與 site link rules 探索後才能判定。兩者之間尚無自動銜接。

P12-2A 要補上的流程是：

```text
normal static discovery
-> empty initial same-origin frontier
-> no explicit --sitemap
-> try exactly <start-origin>/sitemap.xml
-> existing P8d sitemap ingestion
-> existing P8d seed pipeline
-> normal crawler
```

若 XML sitemap 不存在、不支援、無法安全使用或未形成可用 seed：

```text
-> existing P12-1 HTML sitemap fallback
```

自動 probe 不是一般頁面連結，不應把 `/sitemap.xml` 當 HTML crawl page，也不應讓失敗的 probe 進入一般 `checked` / `broken` 結果。

## 4. P12-2A scope

只有同時符合以下條件時才可嘗試：

1. `options.sitemap` 為空，表示使用者沒有提供 `--sitemap`。
2. 正在處理 depth 0 的起始頁。
3. 起始頁已完成既有正常靜態 extraction。
4. `crawlEnqueuedFromPage === 0`，表示沒有排入任何額外 same-origin crawlable page。
5. `maxDepth >= 1`。
6. `maxPages` 仍有可用額度。

唯一候選固定為：

```text
<start-origin>/sitemap.xml
```

候選數固定為 1。候選必須使用 `startOrigin` 建構，不做語系、路徑前綴或 hostname 推測。成功載入後，必須沿用 `loadSitemapTree()`、`readSitemapSource()`、`parseSitemapXml()`、`getSitemapSeedDecision()` 與一般 page queue / inventory / report 流程。

## 5. Explicit non-goals

P12-2A 不包含：

- robots.txt 宣告的 `Sitemap:` 自動探索。
- `/sitemap_index.xml`、`/sitemap-index.xml`、`/wp-sitemap.xml` 或其他猜測。
- 語系 sitemap、`/zh-tw` 或特定 hostname 特例。
- 起始 URL 本身是 sitemap 的特殊處理。
- limited-discovery warning、外部 429 判讀、GUI 或 launcher 變更。
- Dynamic Render、Browser、Playwright 或 headless browser。
- 新 crawler、新 XML parser、第二套 sitemap seed pipeline。
- report schema 重設計。

## 6. Invariants

未來實作必須維持：

- 明確 `--sitemap` 優先；存在時不執行慣例 XML auto probe。
- `options.sitemap` 只表示使用者明確提供的值，不得用自動候選冒充。
- 自動 `/sitemap.xml` 不得啟用 `options.incremental`、incremental state、state-file write，或改變 explicit `--sitemap` 的既有 incremental 行為。
- XML 載入與 parsing 只走既有 P8d 函式。
- HTTP(S) 來源與 redirect 仍走既有 URL security policy、SSRF 檢查與 request scheduler。
- 自動候選 redirect 的 final URL 必須通過既有 `isCrawlOrigin()`；不得建立第二套 origin policy，也不得改變 explicit `--sitemap` redirect 語意。
- sitemap index child 保留既有 same-origin HTTP(S) 限制。
- seed 保留 same-origin、page-like、`maxDepth`、`maxPages` 與 `sitemapMaxUrls` 限制。
- seed URL 仍透過一般 inventory、sources、page queue、body fetch 與 report pipeline。
- `/sitemap.xml` probe 不作為普通 HTML 頁面排入 page queue。
- 404、無效 XML、安全阻擋或其他未採用 probe 不得污染一般 broken-link 結果。
- XML fallback 未採用時，P12-1 HTML fallback 仍可接續執行。

## 7. Implementation gates

### P12-2A.1 code-path audit

| 稽核項目 | 現有位置與行為 |
| --- | --- |
| A. CLI parsing / explicit storage | `link-checker.mjs` `parseArgs()` 約 8193 行：`--sitemap` 寫入 `options.sitemap`、啟用 incremental，並記入 `explicitOptions`。建構子約 569 行再次正規化。 |
| B. Sitemap input loader | `LinkChecker.loadSitemapInput()` 約 814 行，只在 `this.options.sitemap` 有值時呼叫 `loadSitemapTree()`。 |
| C. HTTP / local handling | `readSitemapSource()` 約 3162 行；HTTP(S) 呼叫 `fetchUrl()`，本機路徑與 `file://` 使用 `readFile()`。 |
| D. `urlset` parsing | `parseSitemapXml()` 約 3247 行，解析 `url`、`loc`、`lastmod` 並依 `maxUrls` 截斷。 |
| E. `sitemapindex` parsing | `parseSitemapXml()` 約 3224 行，解析 child entries；`loadSitemapTree()` 約 3108 行逐一載入 child。 |
| F. Child constraints | `normalizeSitemapIndexMaxChildren()` 與 `loadSitemapTree()` 限制 child 數；`getSitemapChildIgnoreReason()` 約 3304 行拒絕遠端 root 的非 HTTP child、跨 `startOrigin` child 與無效 URL。 |
| G. Same-origin | child 由 `getSitemapChildIgnoreReason()` 管制；seed 由 `getSitemapSeedDecision()` 約 887 行以 `sameOrigin(url, this.startUrl)` 管制。 |
| H. URL security / SSRF | `readSitemapSource()` 將 `checker.securityPolicy` 傳入 `fetchUrl()`；`fetchUrlOnce()` 約 4598 行會在初始 URL 與每次 redirect 前呼叫 `evaluateUrlSecurity()`。 |
| I. `sitemapMaxUrls` | `loadSitemapTree()` 約 3082 行正規化上限；root 與 child parsing 都把剩餘額度傳入 `parseSitemapXml()`。 |
| J. Crawl seed conversion | `seedSitemapPages()` 約 844 行建立 `sourceType: "sitemap"` 的 source / inventory item，再以 depth 1 呼叫 `enqueuePage()`。 |
| K. `maxDepth` | `getSitemapSeedDecision()` 在 `maxDepth < 1` 時拒絕 seed；seed depth 固定為 1。 |
| L. `maxPages` | 同一 decision 以 `queuedPages.size >= maxPages` 拒絕；一般 `processPage()` 也以 `crawledPages.size >= maxPages` 防止超量。 |
| M. Inventory / provenance | `seedSitemapPages()` 約 861-882 行呼叫 `addSource()`、`addInventoryItem()` 與 `enqueuePage()`；目前 `sitemapSource` 直接取 `this.options.sitemap`。 |
| N. Start-page sequence | 建構子約 607 行先把 start URL 以 depth 0 放入 queue；`run()` 約 703 行先處理 robots / incremental / explicit sitemap，再 seed，最後啟動 workers。 |
| O. Static discovery completion | `processPage()` 約 1306 行抓 body、執行 `extractPageLinks()`，逐一建立 source / inventory / validation / page queue。 |
| P. Empty-frontier decision | `processPage()` 以 `crawlEnqueuedFromPage` 計數；約 1387 行在 start URL、depth 0 且計數為 0 時判定。 |
| Q. P12-1 fallback | `tryHtmlSitemapFallback()` 約 1419 行；先檢查 `maxDepth` / `maxPages`，再 probe 最多 6 個候選，採用後以 depth 1 進一般 queue。失敗 probe 由 `discardHtmlSitemapProbe()` 移除 cache/result。 |
| R. Ordering | explicit sitemap load -> explicit sitemap seed -> workers -> start-page crawl / normal discovery -> P12-1 empty-frontier fallback。Start URL 原先在 queue 首位，explicit seeds 隨後加入。 |

### P12-2A.2 locked integration and ordering

最小安全位置鎖定為 `LinkChecker.processPage()` 內現有的起始頁 depth-0 空 frontier 分支，並放在 `tryHtmlSitemapFallback()` 之前。這裡同時具備已完成正常 discovery、`crawlEnqueuedFromPage === 0`、explicit-option 狀態、目前 queue / budget 與 P12-1 接續點。

順序鎖定如下：

```text
normal static discovery
-> frontier present
-> no fallback

normal static discovery
-> empty frontier
-> automatic XML sitemap fallback
-> urlsSeeded > 0
-> stop fallback chain

normal static discovery
-> empty frontier
-> automatic XML sitemap fallback
-> unavailable / unsupported / urlsSeeded = 0
-> existing P12-1 HTML sitemap fallback
```

Explicit `--sitemap` 維持既有 pre-worker load / seed 路徑，並抑制 conventional XML auto probe。既有 P12-1 HTML fallback 本身不在此設計鎖中改寫。

### Locked effective-source refactor

`options.sitemap` 永遠只保存 explicit user input。不得把 auto-discovered URL 指派給 `this.options.sitemap`，也不得因此修改 report 的 `options.sitemap`。

內部必須使用獨立的 effective-source descriptor；精確命名可在實作時依現有風格決定，但語意鎖定為：

```text
{
  source: <URL or file>,
  provenance: "explicit" | "auto_conventional"
}
```

最小 refactor 邊界：

- `loadSitemapInput()` 可保留為 explicit-option wrapper。
- 新的共用內部 loader 接受 effective descriptor，並只呼叫既有 `loadSitemapTree()` / `readSitemapSource()` / `parseSitemapXml()`。
- Explicit wrapper 維持目前的 warning/error 與 incremental 行為。
- Auto coordinator 使用同一 loader，但採 quiet failure policy。
- `seedSitemapPages()` 或其最小共用核心改為接受 effective descriptor / loaded result，不再以 `options.sitemap` 是否存在作為唯一執行條件。
- Sitemap source / inventory 的 `sitemapSource` 必須取 effective descriptor 的 `source`。
- Seed decision 必須繼續呼叫既有 `getSitemapSeedDecision()`；不得複製其 same-origin、page-like、depth、page-budget 或 duplicate 邏輯。

### Locked incremental boundary

`AUTO_SITEMAP_DOES_NOT_ENABLE_INCREMENTAL = YES`

自動 `/sitemap.xml` 不得：

- 把 `options.incremental` 設為 `true`。
- 啟用 incremental state 讀寫。
- 造成 state-file write。
- 讓 `options.sitemap` 或 explicit-options 記錄看起來像使用者提供了 `--sitemap`。

如果使用者原本就透過其他 explicit option 啟用 incremental，該既有模式照常運作；auto sitemap 不能成為啟用原因。Explicit `--sitemap` 自動啟用 incremental 的既有行為不變。

### Locked acceptance and quiet-failure semantics

Auto conventional sitemap 只有在既有 parser 成功處理 supported sitemap，且既有 seed logic 實際產生 `urlsSeeded > 0` 時才是 `accepted`。Supported parse 但沒有可用 seed，不足以解除 empty frontier，必須以 `no_usable_seed` 接續 P12-1。

Explicit `--sitemap` 的 read/parse error 與 incremental warning 行為完全不變。Auto failure 則屬正常 discovery fallback：

- 不加入一般 broken-link result。
- 不保留 ordinary checked-result probe。
- `/sitemap.xml` 不存在時不加入 `sitemap_read_failed` incremental warning。
- 不停止 scan。
- failure reason 只記入 `summary.discoveryFallback.xmlSitemap`，再接續 HTML fallback。
- Auto sitemap 即使成功 parse，只要 seed 為 0，就不提交 `effectiveSitemap`、`sitemapEntries`、sitemap hash/seed、inventory、source 或 page queue 狀態；`no_usable_seed` 只記在 XML discovery diagnostic，不視為 incremental warning。

### Locked redirect policy

Auto candidate 起點固定為 `${this.startOrigin}/sitemap.xml`。HTTP request 與每次 redirect 繼續沿用現有 URL security / SSRF 檢查；此外，auto mode 必須以既有 `isCrawlOrigin(finalUrl)` 驗證 effective final URL。若 final URL 不在既有 crawl-origin boundary，auto candidate 不採用並接續 P12-1。

不得建立新的 origin policy，也不得改變 explicit `--sitemap` 的 redirect 語意。共用 sitemap-source result 可增加僅供內部使用的 `finalUrl` metadata，讓 auto coordinator 完成這項檢查。

### Locked report diagnostic

Report schema 維持 `1.3.0`。`summary.discoveryFallback.htmlSitemap` 保持 backward compatible；auto provenance 不得寫入 `options.sitemap`，也不要求 incremental mode。

新增 additive `summary.discoveryFallback.xmlSitemap`，最小欄位鎖定為：

```text
status
reason
attempted
candidateLimit
candidatesTried
accepted
acceptedUrl
sitemapType
urlsDiscovered
urlsSeeded
```

初始值鎖定為：

```text
status = "not_evaluated"
reason = null
attempted = false
candidateLimit = 1
candidatesTried = 0
accepted = false
acceptedUrl = null
sitemapType = null
urlsDiscovered = 0
urlsSeeded = 0
```

欄位語意：

- `acceptedUrl` 是通過 redirect 與 `isCrawlOrigin()` 檢查的 effective final URL；未採用時為 `null`。
- `sitemapType` 使用既有 parser type；未取得可解析內容時為 `null`，unsupported XML 可保留 `unknown`。
- `urlsDiscovered` 是既有 loader 在 `sitemapMaxUrls`、index child 與 parsing 限制後得到的 entry 數。
- `urlsSeeded` 是既有 seed summary 實際成功排入一般 page queue 的數量。
- `attempted` 在符合 eligibility 並開始 auto probe 時設為 `true`；唯一候選開始請求時 `candidatesTried = 1`。

Terminal status / reason mapping 鎖定如下：

| 條件 | `status` | `reason` | 其他要求 |
| --- | --- | --- | --- |
| 初始，尚未判定 | `not_evaluated` | `null` | 使用上列初始值 |
| 正常 frontier 存在 | `not_needed` | `normal_frontier_present` | 不 probe，`attempted=false` |
| explicit sitemap 存在 | `not_needed` | `explicit_sitemap` | 不 probe，explicit path 不變 |
| `maxDepth < 1` | `skipped` | `max_depth` | 不 probe |
| `maxPages` 無剩餘額度 | `skipped` | `max_pages` | 不 probe |
| 已確認 empty frontier 並開始 probe | `attempted`（暫態） | `empty_initial_frontier` | `attempted=true`，請求開始後 `candidatesTried=1` |
| Supported parse 且 `urlsSeeded > 0` | `accepted` | `empty_initial_frontier` | `accepted=true`，停止 fallback chain |
| 404、request/security failure | `not_found` | `fetch_failed` | quiet failure，接續 HTML fallback |
| Parser 無法辨識 supported sitemap | `not_found` | `unsupported_sitemap` | 接續 HTML fallback |
| Supported sitemap 但 `urlsSeeded = 0` | `not_found` | `no_usable_seed` | 接續 HTML fallback |
| Redirect final URL 不在 crawl-origin boundary | `not_found` | `fetch_failed` | 不公開 raw redirect error，接續 HTML fallback |

Reason precedence 鎖定為：先判定 `explicit_sitemap`；沒有 explicit source 時，起始頁完成 discovery 後先判定 `normal_frontier_present`；只有 empty frontier 才依序判定 `max_depth`、`max_pages`，最後進入唯一候選的 probe。如此同一輪不會同時以 frontier 與 budget reason 表示 auto fallback 結果。

Allowed terminal `status` 僅為 `not_evaluated`、`not_needed`、`skipped`、`accepted`、`not_found`；實際 probe 期間另使用暫態 `attempted`。最低必要 reason 集合為 `normal_frontier_present`、`explicit_sitemap`、`max_depth`、`max_pages`、`empty_initial_frontier`、`fetch_failed`、`unsupported_sitemap`、`no_usable_seed`。

現行 schema 的 root 與 `summary` 均允許 additional properties，因此這項 additive diagnostic 不需要 schema bump。

### Locked future test surface

未來 focused implementation coverage 鎖定如下；本階段不新增測試：

A. 正常 frontier 存在：XML auto probe 不執行。

B. Explicit `--sitemap`：既有 explicit path 不變，XML auto probe 不執行。

C. Empty frontier + valid `/sitemap.xml` + usable seeds：`accepted`、`urlsSeeded > 0`，HTML fallback 不執行。

D. `/sitemap.xml` 404：無 result pollution，HTML fallback 接續。

E. Unsupported / invalid sitemap：安全拒絕，HTML fallback 接續。

F. Valid sitemap 但 zero usable seeds：`no_usable_seed`，HTML fallback 接續。

G. `maxDepth = 0`：XML fallback `skipped/max_depth`，不繞過 budget。

H. `maxPages` exhausted：XML fallback `skipped/max_pages`，不繞過 budget。

I. Cross-origin sitemap `loc`：既有 seed filtering 保持不變。

J. Auto sitemap redirect outside crawl-origin：auto candidate 拒絕，HTML fallback 接續。

K. Auto sitemap 不啟用 incremental mode 或 state write。

L. `test-p8-sitemap.mjs` 既有 explicit P8d tests 全部 PASS。

M. `test-p12-html-sitemap-fallback.mjs` 既有 P12-1 tests 全部 PASS。

現有可重用函式仍包括 `test-p8-sitemap.mjs` 的 urlset、sitemapindex、remote child、max URL、seed 與 depth/filter 案例，以及 `test-p12-html-sitemap-fallback.mjs` 的 frontier、probe cleanup、same-origin、budget 與一般 crawler 接續案例。

## 8. Acceptance criteria

P12-2A 完成時必須證明：

- 唯一自動候選是 `<start-origin>/sitemap.xml`。
- 只有 no explicit sitemap + empty initial frontier + remaining budget 才 probe。
- 只有既有 P8d parser 成功且既有 seed policy 產生 `urlsSeeded > 0` 才接受候選。
- `urlset`、`sitemapindex`、child 限制、安全政策、same-origin、`sitemapMaxUrls`、`maxDepth` 與 `maxPages` 沒有分叉或繞過。
- `options.sitemap` 仍只代表 explicit input，auto provenance 可被辨識。
- Auto sitemap 不改變 incremental mode 或 state write。
- Auto redirect final URL 仍須符合既有 `isCrawlOrigin()`。
- 404、無效 XML 與安全拒絕不產生一般 broken-link finding。
- XML 未採用時，既有 P12-1 HTML fallback 仍可運作。
- explicit P8d 與 P12-1 既有回歸測試全部通過。
- 不引入 Dynamic Render、Browser、Playwright、GUI、launcher 或新依賴。

## 9. Version decision

`PRODUCT_VERSION_TARGET = v1.3.0`

理由：P12-2A 會改變預設 discovery strategy；即使沒有新增 CLI 參數，未提供 `--sitemap` 的掃描也可能自動取得更多頁面，因此不是單純修補版本。

`REPORT_SCHEMA_VERSION = 1.3.0`

`REPORT_SCHEMA_CHANGE_REQUIRED = NO`：鎖定的 additive discovery diagnostic 符合現行 permissive schema。本階段不修改任何版本檔案。

## 10. Current status

```text
P12-1 = COMPLETE
P12-2A = COMPLETE
P12_2A_1_READ_ONLY_CODE_AUDIT = COMPLETE / PASS
P12_2A_2_MINIMAL_DESIGN_LOCK = COMPLETE / PASS
P12_2A_2_DESIGN_REVIEW = COMPLETE / PASS
P12_2A_3_CORE_IMPLEMENTATION = COMPLETE / PASS
P12_2A_4_DIAGNOSTICS = COMPLETE / PASS
P12_2A_5_FOCUSED_TESTS = COMPLETE / PASS
P12_2A_6_FULL_REGRESSION = COMPLETE / 30 OF 30 PASS
P12_2A_7_TYCG_REAL_SITE_VALIDATION = COMPLETE / PASS
P12_2A_8_READ_ONLY_FINAL_AUDIT = COMPLETE / PASS
SOURCE_MODIFICATION = COMPLETE
VERSION_BUMP = COMPLETE / PENDING REVIEW / v1.3.0
MERGE = COMPLETE
RELEASE = NOT AUTHORIZED
NEXT_GATE = V1_3_0_RELEASE_PREP_A_REVIEW
```

`UNRESOLVED_QUESTIONS = NONE`

## 11. Completion evidence

- P12-2A.1 code audit、P12-2A.2 design lock/review、P12-2A.3 core implementation、P12-2A.4 diagnostics、P12-2A.5 focused tests 與 P12-2A.8 final audit 均已接受。
- P12-2A.6 完整 root regression：`30 / 30 PASS`。
- Implementation commit：`20e86b9697ec8b3f9b1e2c6dea964e1ad6f7eeb8`；main integration：complete。
- Release target：`v1.3.0`；report schema 維持 `1.3.0`。
- P12-2A.7 TYCG real-site validation 從 `https://travel.tycg.gov.tw/` 啟動，未提供 `--sitemap`；同站 `/sitemap.xml` 被接受為 `urlset`，`urlsDiscovered > 0`、`urlsSeeded > 0`、`pagesCrawled > 1`，XML 接受後 HTML fallback 為 `not_needed / xml_sitemap_accepted`。
- 該次 live-site observation 為 `urlsDiscovered = 207`、`urlsSeeded = 49`、`pagesCrawled = 50`；這些值會隨外部網站內容與掃描時點變動，只是歷史驗證證據，不是產品契約。

Deferred scope 保持不變：`P12-2B` robots-advertised sitemap、`P12-2C` direct sitemap start、`P12-3` limited-discovery warning、`MAINT-1` external 429 interpretation 與 Dynamic Render 均未納入 P12-2A，狀態為 deferred。
