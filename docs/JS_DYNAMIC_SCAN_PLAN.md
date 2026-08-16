# JS Dynamic Scan Plan

狀態：`DEFERRED / PRESERVED`。此文件保留原本「針對依賴 JavaScript 的動態網站提供掃描能力」的規劃方向，但 Dynamic Render 目前不是 main branch 的立即實作項目。

## Current Product Status

```text
DYNAMIC_RENDER_RESEARCH = PRESERVED
DYNAMIC_RENDER_PRODUCT_PRIORITY = DEFERRED
DYNAMIC_RENDER_RELEASE_BLOCKER = NO
CURRENT_PRODUCT_PRIORITY = STATIC_DISCOVERY_RESILIENCE
```

這是產品優先順序決定，不是 Dynamic Render 失敗、放棄、不可行或本質不安全。現有 production 靜態連結檢查流程已支援 Local Link Checker 的主要使用情境；繼續 Browser / network / security work 的工程與維護成本，暫時不符合目前產品需求。

詳細 implementation / security 研究保存在 `feature/js-dynamic-scan`。main branch 只記錄產品層級停止點，不匯入該研究分支的 implementation、tests、dependencies、security evidence 或 task packets。

目前產品開發優先方向是 `STATIC_DISCOVERY_RESILIENCE`：真實網站相容性診斷、低連結產出 / 弱 frontier 偵測、sitemap / seed fallback、HTML site-map / site-navigation discovery 與「掃描覆蓋可能不完整」提示。

Dynamic Render 只有在以下較安全的 static / fallback discovery 仍被實際產品證據證明不足時，才應重新列為 active product candidate：

1. Normal static HTML link extraction.
2. SPA / payload / static-signal extraction.
3. Robots / XML sitemap discovery.
4. Conservative fallback seed discovery.
5. HTML site-map / site-navigation discovery.

AND:

Browser runtime DOM execution demonstrably exposes important additional links that those methods cannot discover.

## 背景

目前工具已支援傳統 HTML 連結抽取、SPA / Nuxt payload literal 抽取、site link rules、sitemap 保守 seed 與 scan quality diagnostics。這些能力能改善部分 SPA / CSR 網站的漏掃問題，但仍有一類網站的主要連結只會在瀏覽器執行 JavaScript 後出現在 DOM 中，例如：

- 前端路由或 API 載入後才產生 `<a href>`。
- 選單、列表、分頁、文章卡片由 client-side render 建立。
- 原始 HTML 只含 framework shell，沒有可抽取的內容連結。

因此，若未來符合上述 resume criteria，才應重新評估可選的動態掃描模式，讓使用者在明確需要時能取得瀏覽器渲染後的連結。

## 目標

- 提供 opt-in 的 JS 動態網站掃描能力，不改變預設掃描的速度與安全邊界。
- 從渲染後 DOM 抽取連結，補足靜態 HTML 與 SPA payload extraction 的盲點。
- 在 report 中清楚標記哪些連結來自動態渲染證據，避免 GUI / Analyzer 猜測。
- 在 GUI 提供易懂狀態提示，讓使用者知道目前是一般掃描、偵測到動態網站，或已啟用動態掃描。
- 保留既有 timeout、redirect limit、SSRF 防護、rate limit、localhost-only GUI 與合規邊界。

## 非目標

- 不預設啟用 headless browser。
- 不偽裝 Googlebot 或其他搜尋引擎。
- 不繞過 CAPTCHA、登入牆、WAF 或 bot protection。
- 不自動點擊任意按鈕、送出表單或執行具副作用的操作。
- 不把工具擴張成完整瀏覽器自動化測試平台。
- 不保存完整頁面截圖、完整 DOM dump 或 response body，除非後續另行設計隱私與容量策略。

## 建議分階段

### Phase 0：偵測與提示

目的：先讓工具能判斷「這個網站可能需要動態掃描」，但不啟動瀏覽器。

範圍：

- 擴充現有 `spaDetection` / `scanQuality` 訊號。
- 偵測低 anchor count、高 script ratio、framework shell、client-side route hints、API-driven content hints。
- 在 GUI URL 輸入區或掃描結果區提示「此網站可能需要動態掃描」。
- Report 只新增診斷訊號，不新增 headless 結果。

驗收：

- 傳統 HTML 網站不被過度提示。
- SPA / CSR 網站會出現可理解的提醒。
- 不改變既有 URL discovery 與 checked[] 結果。

### Phase 1：Headless render spike

目的：建立最小可行的 opt-in 渲染流程，驗證技術成本與掃描收益。

範圍：

- 新增 CLI opt-in 參數，例如 `--dynamic-render` 或 `--render-links`。
- 僅對 same-origin page-like URL 啟用渲染。
- 每頁使用短 timeout 與固定等待策略，避免長時間卡住。
- 抽取渲染後 DOM 中的 `a[href]`、`area[href]`、`link[href]` 等低風險連結。
- 將來源標記為新的 source type，例如 `dynamic_dom`。
- 遇到 browser 啟動失敗、timeout、blocked / challenge 時，寫入 report 診斷，不中斷整體掃描。

驗收：

- 在典型 CSR 測試 fixture 中，動態 DOM 連結能進入 URL inventory。
- 預設不啟用時，掃描結果與現行行為一致。
- 啟用後不會突破 same-origin、private IP、localhost、metadata IP 等安全限制。
- timeout 頁面會正常收斂，不造成 GUI 永久停在掃描中。

### Phase 2：GUI opt-in 與狀態呈現

目的：讓非技術使用者知道何時需要開啟，以及開啟後目前在做什麼。

範圍：

- 在 GUI 進階設定加入動態掃描開關。
- 在 URL 輸入附近放置簡短提示，說明「部分網站需要動態掃描才看得到頁面中的連結」。
- 掃描狀態區顯示動態渲染進度，例如已嘗試頁數、timeout 頁數、成功抽取頁數。
- Report Analyzer 顯示「動態渲染取得」的來源標籤與診斷摘要。

驗收：

- 使用者能在不讀 CLI 文件的情況下理解何時啟用。
- 啟用與未啟用的差異能在 report / GUI 中追溯。
- 文案不承諾「完整掃描所有 JS 網站」，只說明可改善部分依賴 JS 的網站。

### Phase 3：穩定化與限制調整

目的：在 MVP 後降低誤判、資源消耗與卡住風險。

範圍：

- 增加 per-host render concurrency limit。
- 增加 render budget，例如最大渲染頁數、最大渲染時間、每頁最大新增連結數。
- 將 dynamic render 納入 scan quality diagnostics。
- 視情況支援 sitemap seed + dynamic render 的保守組合。
- 評估是否需要新的 report schema minor 版本。

驗收：

- 大型網站不會因 dynamic render 造成不可預期的執行時間。
- report 能清楚說明哪些頁面沒有渲染、為什麼沒有渲染。
- GUI 可呈現「已達動態掃描上限」而不是看起來像錯誤。

## Report 契約初稿

若進入實作，建議新增或擴充下列欄位，實際命名需在實作前再確認：

- `summary.dynamicRender.enabled`
- `summary.dynamicRender.attemptedPages`
- `summary.dynamicRender.renderedPages`
- `summary.dynamicRender.timeoutPages`
- `summary.dynamicRender.failedPages`
- `summary.dynamicRender.linksDiscovered`
- `summary.dynamicRender.warnings[]`
- `checked[].sources[].sourceType = "dynamic_dom"`
- `checked[].sources[].rendered = true`

若新增 root-level 契約或新的 `sourceType` 會影響 Analyzer / diff / CSV，應評估 minor release，而不是 patch release。

## 安全與合規邊界

- 所有渲染入口 URL 仍需走既有 URL security policy。
- 渲染後抽出的 URL 仍需 canonicalize、inventory merge 與 validation policy。
- 不執行任意使用者腳本注入。
- 不處理需要登入、CAPTCHA、付款、送出表單或具副作用互動的流程。
- 對 WAF / bot challenge 只記錄診斷，不嘗試繞過。
- GUI server 維持 localhost-only。

## 測試 fixture 建議

- 傳統 HTML：確認未啟用 dynamic render 時結果不變。
- CSR fixture：原始 HTML 沒有 `<a>`，JavaScript 執行後新增連結。
- Timeout fixture：頁面長時間 pending，確認 render timeout 能收斂。
- Challenge-like fixture：頁面只有 challenge 文案或大量 script，確認只標診斷。
- Security fixture：動態 DOM 產生 private IP / localhost / metadata URL，確認仍被既有 policy 擋下。

## Headless runtime 評估

暫定建議：Phase 1 spike 優先採用 Playwright，並先控制使用者本機已安裝的 Microsoft Edge / Google Chrome；不要在第一階段把 Chromium 直接包進 portable package。

| 面向 | Playwright | Puppeteer | 本專案判斷 |
| --- | --- | --- | --- |
| 瀏覽器支援 | 支援 Chromium、Firefox、WebKit，也可控制 Chrome / Edge channel | 支援 Chrome 與 Firefox，主軸仍偏 Chrome | Playwright 彈性較高，較適合長期保留選項 |
| 瀏覽器下載 | 需透過 CLI 或 helper package 安裝指定 browser binary，也可用本機 Chrome / Edge | `puppeteer` 預設下載 Chrome for Testing；`puppeteer-core` 不下載 browser | 兩者都不應在 spike 階段直接增加 portable 體積 |
| 可攜版影響 | 若內建 Chromium / browser binary，會增加數百 MB 與 release 驗證負擔 | 官方文件列 Windows Chrome for Testing 約 280 MB，且另有 headless shell | 第一階段應避免內建瀏覽器 |
| 診斷與控制 | context、timeout、route、browser channel 管理完整 | API 直接簡潔，Chrome 路線成熟 | Playwright 較符合「可診斷、可限制、可回退」需求 |
| 備援路線 | 可先用 `playwright-core` 搭配本機瀏覽器，後續再評估是否包 browser | 可用 `puppeteer-core` 搭配本機 Edge / Chrome | Puppeteer-core 可保留為備選，但目前沒有明顯優勢 |

決策理由：

- 本專案是內部可攜式工具，優先考量穩定、可診斷、安全邊界與 package 體積。
- Dynamic render 只是補足 JS 依賴網站漏掃，不應改變預設靜態掃描體驗。
- 先使用本機 Edge / Chrome 可降低 portable package 體積與簽章、manifest、release 驗證負擔。
- 若本機沒有可用瀏覽器，GUI 應顯示「需要本機瀏覽器，已略過動態掃描」，而不是讓任務失敗或卡住。

參考來源：

- Playwright Browsers：https://playwright.dev/docs/browsers
- Playwright Library：https://playwright.dev/docs/library
- Puppeteer Installation：https://pptr.dev/guides/installation
- Puppeteer Supported Browsers：https://pptr.dev/supported-browsers

## 開放問題

- 是否使用 `playwright-core` 搭配本機 Edge / Chrome 作為 Phase 1 實作起點。
- 是否把 dynamic render 放在 page crawl 階段，或作為 scan quality 判定後的 fallback 階段。
- 預設 timeout、最大渲染頁數與併發數應如何設定，才符合承辦人使用情境。
- Portable package 體積會增加多少，是否需要拆成標準版與含瀏覽器版。
- Report schema 是否升級，以及 GUI / Analyzer / report-diff 如何顯示差異。

## 下一步

以下是原始規劃中的 Phase 0 + Phase 1 小範圍 spike 順序；目前不代表 main branch 的已授權下一步。現階段應先執行 `STATIC_DISCOVERY_RESILIENCE` 方向的產品驗證，確認較安全的 static / fallback discovery 仍不足以發現重要連結後，再考慮恢復 Dynamic Render。

1. 建立 CSR / timeout / security fixture。
2. 新增 opt-in headless render 流程，只抽取渲染後 DOM 連結。
3. 將結果以 `dynamic_dom` source type 寫入 inventory。
4. 補上 report summary diagnostics。
5. 用 GUI 狀態提示說明「已啟用動態掃描」與「部分頁面未能渲染」。
