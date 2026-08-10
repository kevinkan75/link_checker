# JS Dynamic Scan Plan

狀態：完整檢視修訂稿（Headless runtime 已決定採用 `playwright-core`）  
完整檢視日期：2026-08-07  
適用基線：Local Link Checker v1.1.1 / report schema 1.3.0  
目的：規劃「針對依賴 JavaScript 的動態網站提供掃描能力」的實作範圍、技術邊界、開發階段、驗收 gate 與後續擴充方向。

---

## 1. 背景

目前 Local Link Checker 已支援：

- 傳統 HTML tag attribute 連結抽取。
- SPA / Nuxt / Next.js 部分 framework signal 偵測。
- SPA / framework inline payload literal URL/path 抽取。
- site link rules。
- sitemap 保守 seed。
- scan quality diagnostics。
- URL inventory、canonicalization、validation queue、404 / 410 confirmation。
- URL security policy、SSRF 防護、rate limit、Retry-After、WAF / Bot challenge 診斷。
- report-first 輸出與 GUI / Analyzer / CSV / NDJSON / report diff。

這些能力可以改善部分 SPA / CSR 網站的漏掃問題，但仍有一類網站的主要連結只會在瀏覽器執行 JavaScript 後出現在 runtime DOM，例如：

- 前端路由初始化後才產生 `<a href>`。
- API 載入完成後才建立選單、列表、文章卡片或分頁。
- 原始 HTML 只有 framework shell，主要內容由 client-side render 建立。
- runtime DOM 與原始 response HTML 的連結集合有明顯差異。

因此下一階段要增加的是「可選的 runtime DOM discovery」，而不是用 Browser 取代現有 HTTP crawler 或 HTTP validation。

---

## 2. 核心定位

Dynamic Render 應定位為：

> **既有 Discovery Layer 的附加來源，用來發現 JavaScript 執行後才出現在 DOM 的 URL。**

不應定位為：

- 新的 HTTP status checker。
- WAF / Bot protection bypass。
- 登入後網站爬蟲。
- 瀏覽器自動化測試框架。
- 自動點擊、表單操作或 workflow crawler。

建議核心資料流：

```text
Page URL
  |
  v
Existing HTTP fetch / security policy
  |
  +--> Static HTML extraction
  |
  +--> SPA / payload extraction
  |
  +--> Site link rules
  |
  +--> [opt-in] Headless Render
              |
              +--> Rendered HTML / DOM attributes
              |
              +--> rendered_dom links
  |
  v
Unified discovery ingestion
  |
  v
Existing URL inventory
  |
  v
Existing validation queue / HTTP checker
  |
  v
Existing confirmation / classification
  |
  v
report.json
```

Browser 的責任只到「發現 URL + 提供 render evidence」為止；URL 是否有效仍以既有 Node.js HTTP validation 結果為正式判讀。

---

## 2A. Target Audience / UX Design Constraints

### 2A.1 主要使用者背景

Local Link Checker 的主要使用者不是網站開發者，而是：

> **政府公務機關的網站承辦人員。**

產品設計不應假設使用者具備網站工程、HTTP、JavaScript、SPA、Browser automation 或 command-line 知識。

依實務觀察，主要 TA 常具有以下特徵：

- 能執行基本電腦與網站維護相關操作。
- 對陌生系統、未知設定或技術名詞較容易產生抗拒。
- 自主探索與自行學習新工具的能力差異大。
- 英語與資訊技術術語理解能力可能有限。
- 工作通常以既有 SOP、承辦流程、前人操作方式或資訊人員指示為主要依據。
- 部分使用者能理解資訊業務、依說明自行排除問題。
- 另一部分使用者可能不理解網站技術，只能依固定 SOP 順序執行。

因此不能以「平均資訊能力」設計介面。

### 2A.2 Persona 模型

第一版以三個 Persona 設計。

#### Persona A — SOP 型承辦人

核心心智模型：

> 「告訴我按哪裡、看到什麼結果、接下來要做什麼。」

能力假設：

- 可以輸入網址。
- 可以操作按鈕、勾選框、下載或匯出檔案。
- 可以依明確步驟完成任務。
- 不要求理解 HTTP status、SPA、CSR、JavaScript、Playwright、canonical URL 等技術概念。
- 遇到不熟悉選項時通常傾向維持預設值或停止操作。

**Persona A 是 GUI 的設計能力下限。**

#### Persona B — 熟練承辦人

核心心智模型：

> 「我大致知道網站怎麼運作，請給我進階控制與判斷證據。」

能力假設：

- 可理解網站架構、redirect、HTTP status、SPA 等部分概念。
- 能依技術文件調整 timeout、scope、concurrency 等設定。
- 能使用進階設定，部分使用者可使用 CLI。
- 可以閱讀完整 diagnostics。

**Persona B 是功能控制能力上限。**

#### Persona C — 資訊支援者

可能角色：

```text
機關資訊人員
資訊室
資訊中心
網站維護廠商
技術支援人員
```

核心需求：

> 「承辦人遇到問題時，我需要快速知道版本、環境、錯誤與掃描狀態。」

需要：

- stable diagnostic code。
- 工具版本。
- Browser / Dynamic Render 狀態。
- sanitized error detail。
- scan policy。
- 可複製或匯出的 troubleshooting information。

Persona C 不一定是主要操作人，但必須是正式 escalation path。

### 2A.3 產品設計原則

產品應遵循：

```text
Persona A
  -> 決定預設介面的理解門檻

Persona B
  -> 決定進階設定與技術資訊的能力上限

Persona C
  -> 決定 troubleshooting / escalation 資訊
```

也就是：

> **以 Persona A 設計能力下限，以 Persona B 設計能力上限，以 Persona C 設計支援出口。**

不可反過來以資訊人員的理解能力設計一般 GUI，再要求承辦人自行學習技術概念。

### 2A.4 Basic / Advanced 雙層介面

同一套 Local Link Checker 應提供兩層資訊密度，而不是兩套產品。

```text
Basic
  |
  +-- 網站網址
  +-- 開始掃描
  +-- 加強檢查動態網頁
  +-- 需要處理 / 建議確認 / 正常
  +-- 匯出結果

Advanced
  |
  +-- scan scope
  +-- timeout
  +-- concurrency
  +-- dynamic render technical settings
  +-- diagnostics
  +-- raw evidence
  +-- CLI mapping
```

一般使用者完成核心任務不應需要進入 Advanced。

### 2A.5 技術名詞不得成為基本操作前置知識

一般 GUI 不應要求使用者回答：

```text
這是不是 SPA？
是否使用 CSR？
要不要使用 Playwright？
Browser channel 是什麼？
Canonical strategy 要選哪一個？
Render concurrency 設多少？
```

「不知道」必須被視為合法且預期的使用狀態。

技術偵測由工具負責；使用者只需做可以理解的業務選擇。

例如 GUI 不顯示：

```text
Enable Playwright Dynamic Render
```

建議顯示：

```text
加強檢查動態網頁
```

說明：

> 有些網站的連結要在網頁載入完成後才會出現。啟用後可增加這類連結的檢查範圍，但掃描時間會較長。

`JavaScript`、`playwright-core`、`rendered_dom` 等資訊只放進進階說明或技術診斷。

### 2A.6 錯誤訊息必須回答三件事

所有面向一般使用者的 warning / error 應依：

```text
1. 發生什麼事
2. 會影響什麼
3. 現在可以怎麼做
```

例如內部 diagnostic：

```text
browser_not_found
```

一般 UI 建議：

```text
無法使用動態網頁加強檢查

電腦上沒有找到可使用的 Microsoft Edge 或 Google Chrome。
一般網站檢查已正常完成，但少數需要網頁載入後才出現的連結可能未被找到。

建議：
1. 若不需要加強檢查，可直接使用目前結果。
2. 若需要，確認電腦已安裝 Edge 或 Chrome。
3. 若仍無法使用，可將「診斷資訊」提供給資訊人員。
```

不要直接顯示 Playwright stack trace、Node error、Browser executable path 等內容。

### 2A.7 行動優先的結果呈現

Report / Analyzer 第一層應以承辦動作分類，不以技術狀態分類。

建議資訊層級：

```text
Level 1 — 行動
需要處理
建議確認
外部網站限制
正常

Level 2 — 人話說明
發生什麼
為什麼需要處理
下一步建議

Level 3 — 技術資訊
HTTP status
classification
confirmation
redirect
sourceType
render evidence
diagnostic code
```

Persona A 主要使用 Level 1 / Level 2。

Persona B / C 可展開 Level 3。

### 2A.8 SOP 必須與產品流程一致

SOP 不應只是另外附一本技術手冊，而應直接映射產品流程。

標準流程建議：

```text
步驟 1：輸入網站網址
步驟 2：確認掃描設定
步驟 3：開始掃描
步驟 4：先查看「需要處理」
步驟 5：逐筆確認問題與建議
步驟 6：必要時查看「建議確認」
步驟 7：匯出報告
步驟 8：遇到無法處理的問題，複製診斷資訊交給資訊人員
```

GUI、SOP、Help、Analyzer 必須使用一致用詞。

禁止同一概念在不同地方分別寫成：

```text
動態掃描
JS Rendering
Headless Discovery
Dynamic Render
```

面向一般使用者時統一採：

```text
加強檢查動態網頁
```

技術文件內部仍可使用 `Dynamic Render`。

### 2A.9 Escalation path

產品必須允許 Persona A 在不理解技術細節的前提下，把問題正確交給 Persona C。

建議提供：

```text
複製診斷資訊
```

內容可包括：

```text
Local Link Checker version
Report schema version
Dynamic Render enabled
Browser status
Browser channel / version
Diagnostic code
Sanitized error detail
Scan start time
Relevant scan options
```

不得包括：

- cookie。
- password。
- authorization header。
- sensitive query value。
- Browser profile path。
- request body。
- 完整 rendered DOM。

### 2A.10 Usability 產品原則

第一版必須接受：

- 「會用電腦」不等於「理解網站技術」。
- 「有 SOP」不等於「使用者會自行推論下一步」。
- 預設值必須安全且合理，不能要求使用者先理解所有設定。
- 可選設定數量越多，越需要合理 grouping、預設值與說明。
- UI 不應用英文 technical term 作為主要 action label。
- 使用者遇到 warning 時，不應需要自行搜尋錯誤碼才能知道下一步。
- 完成核心掃描任務不應依賴 CLI。
- 無法自助排除時，必須有可交接給資訊人員的診斷出口。


### 2A.11 Terminology mapping

文件應維護 internal / user-facing terminology mapping。

| Internal term | 一般使用者用詞 |
| --- | --- |
| Dynamic Render | 加強檢查動態網頁 |
| rendered_dom | 動態網頁取得 |
| Browser unavailable | 無法使用動態網頁加強檢查 |
| render timeout | 動態網頁檢查未在時間內完成 |
| security blocked | 部分動態載入要求因安全限制未執行 |
| budget exceeded | 已達動態網頁加強檢查上限 |
| diagnostics | 診斷資訊 |

新增 GUI / Help / SOP 字串時優先引用此 mapping，避免各模組自行命名。


---

## 3. 設計原則

### 3.1 保留既有預設行為

- Dynamic Render 必須 opt-in。
- 未啟用時，掃描結果、效能特性與 report 語意應與現行版本一致。
- 第一版不做 automatic browser fallback。
- 第一版不因偵測到 SPA 就自動啟動瀏覽器，只提供提示。

### 3.2 Render 只做 additive discovery / evidence

- Browser 發現的 URL 仍進入既有 canonicalization、inventory merge、validation 與 crawl policy。
- Browser navigation status 不覆蓋既有 HTTP `status`、`ok`、`classification` 或 `issueType`。
- Browser 能開啟而 HTTP checker 回傳 403 / protected 時，不直接改判正常。
- Dynamic Render 與現有 404 / 410 confirmation 採相同精神：保留原始結果，只增加證據。

### 3.3 只 Render 已被既有 crawler 接受的頁面

第一版 Render candidate 建議同時符合：

- Dynamic Render 已明確啟用。
- 頁面已由既有 HTTP pipeline 成功取得。
- `pageResult.ok === true`。
- response content type 為 HTML。
- 有可用 HTML body。
- URL 屬既有 crawl origin / start final origin。
- URL 判定為 page-like。
- 未超過 `maxDepth`、`maxPages` 與 render budget。
- 掃描未停止。

第一版**不要**使用 Browser 去補救：

- HTTP 403。
- WAF / Bot challenge。
- TLS 失敗。
- security blocked URL。
- CAPTCHA。
- Node HTTP 無法連線的頁面。

這可以避免 Dynamic Render 變成另一套繞過既有判讀與安全邊界的請求路徑。

### 3.4 Browser lifecycle 與 HTTP scheduler 分離

- 每個 scan 最多建立一個 Browser instance。
- Browser 採 lazy initialization；未真正遇到 render candidate 時不啟動。
- Browser launch 必須 single-flight；多個 page worker 同時要求 render 時，不得重複啟動多個 Browser。
- 每個 render job 建立一個新的 ephemeral BrowserContext，再於該 Context 建立一個 Page；render 完成後立即關閉 Context。
- 不在不同 page render job 間共享 cookie、localStorage、sessionStorage 或其他 browsing state。
- Render concurrency 與 HTTP `concurrency` / `perHostConcurrency` 分離。
- 第一版不另建獨立 render queue；render job 直接在 `processPage()` lifecycle 內由 `renderLimiter` 控制並等待完成。
- stop 時 queued render job 必須在真正啟動前檢查 `stopped` 並直接 skip；不得因 limiter queue 讓停止後仍逐頁啟動 Browser render。
- Browser unexpectedly closed 後，第一版不在同一 scan 中無限 relaunch；renderer 標記 unavailable / failed，後續 job graceful skip。
- 若後續要把 render queue 非同步化，再同步調整 `isCrawlFinished()`。

### 3.5 不複製現有 Link Ingestion 邏輯

正式導入 Browser 前，先將 `processPage()` 內「link → resolve → source → inventory → validation → page queue」抽成共用 method。

概念：

```text
Static links --------\
SPA payload links ----> ingestDiscoveredLinks()
Rendered DOM links ---/
```

這是 Dynamic Render 上線前最重要的低風險 refactor。

### 3.6 Render 後優先重用現有 extractor

MVP 正式採用 `page.content()` + 既有 `extractLinks()`，不另寫第二套完整 DOM attribute parser。

第一版流程：

```text
page.goto()
  -> bounded settle
  -> page.content()
  -> challenge / protection check
  -> rendered HTML size guard
  -> getDocumentBaseUrl(renderedHtml, page.url())
  -> existing extractLinks()
  -> sourceType 改標為 rendered_dom
  -> ingestDiscoveredLinks()
```

好處：

- 靜態與動態 DOM 使用一致的 tag / attribute 規則。
- `srcset`、`form[action]`、`iframe[src]`、`link[href]` 等既有邏輯可重用。
- 避免 Playwright selector 邏輯與 regex extractor 長期分歧。
- 第一版只補 runtime DOM attribute discovery，不重新跑 framework payload extraction。
- URL resolve 的 fallback document URL 使用 render 完成時的 `page.url()`，不是固定使用原始 HTTP `finalUrl`；若 runtime `<base>` 存在，仍由 `getDocumentBaseUrl()` 優先處理。
- rendered HTML 仍受既有 `maxHtmlBytes` 等級的處理上限保護；超出時記錄診斷並不送入大量字串解析流程。
- 若 rendered DOM 呈現 CAPTCHA / WAF / bot challenge 等既有 protection signal，記錄 `challenge_detected` 診斷，不把 challenge page 上的連結當成一般內容 discovery。

第一版已知限制：

- 不保證抽取 Shadow DOM 內部連結。
- 不遞迴掃描 iframe 內部 document DOM。
- 不處理沒有 `href` / `src` 等 URL attribute、完全依賴 click handler 的 router element。
- 不自動操作選單、load more、tab、infinite scroll 或其他互動後才出現的 link。

### 3.7 既有 Report 1.3.0 regression baseline

在 Phase 3 正式修改 report contract 前，Phase 0 / Phase 1 必須把目前 production source / output 視為既有相容性基線。已確認：

```text
Local Link Checker source version = 1.1.1
report schema = 1.3.0
checked[] = 主要 HTTP result collection，現況不保存完整 sources[]
broken[] = checked[] 失敗子集 + source provenance
externalLinks[] = 獨立 external source / governance collection
root securityPolicy = 現行 production output
```

因此 Phase 0 的 behavior-preserving refactor 不得新增、刪除或改名 report 欄位，也不得因舊版文件摘要漏列某欄位就改變現行 runtime output。若維護文件與目前 production source / output 對「已發布欄位」描述不一致，應保留目前 production 行為並另外記錄 documentation drift。

`report-diff.mjs` 可作為 normalization / compatibility regression evidence，但**不是完整 report semantic-equivalence oracle**。目前 diff 只比較既定投影欄位；行為不變 refactor 仍需在 controlled fixture 上直接驗證：

```text
canonical URL set
urlsDiscovered
uniqueCanonicalUrls
duplicateUrlReferences
sourcesMerged
validationSkippedByInventory
inventoryMergeRatio
broken[].sourceCount / sources[]
externalLinks[].sourceCount / sources[]
existing sourceType values
validation scheduling / crawl queue semantics
```

真實外部網站產生的 report 可作 compatibility / reference sample，但不作 exact deterministic golden snapshot；正式 regression golden 應優先使用 controlled local fixture 或 sanitized deterministic fixture。

---

## 4. 安全與合規邊界

Dynamic Render 的安全模型必須高於或至少不弱於既有 HTTP pipeline。

### 4.1 Navigation 前檢查

所有 `page.goto()` 入口 URL：

1. 必須先走既有 `evaluateUrlSecurity()`。
2. 只允許 HTTP(S)。
3. 沿用 localhost / private IP / link-local / metadata / reserved IP policy。
4. 被 policy 阻擋時不啟動 navigation，並記錄 render skip reason。
5. Browser main-frame navigation 必須維持在既有 crawl origin（`startFinalOrigin || startOrigin`）；public cross-origin subresource 可在通過安全政策後載入，但 main frame 不因 redirect / JavaScript navigation 離開掃描 origin。
6. HTTP redirect chain 必須記錄並受既有 `maxRedirects` 約束；不可只依賴 `page.goto()` 的最終結果。
7. JavaScript 造成的 repeated main-frame navigation / reload 另外設 bounded navigation count，避免 client-side navigation loop。

### 4.2 Browser 子請求攔截

只檢查 `page.goto()` 不足以保護 SSRF 邊界，因為 JavaScript 執行後還可能發出：

- script / stylesheet / image / iframe request。
- `fetch()` / XHR。
- navigation。
- popup。
- Service Worker request。

MVP 建議：

- 每個 render job 的 BrowserContext 在建立 Page **之前**先完成所有 network policy 設定。
- 使用 BrowserContext-level `route()` 攔截 HTTP(S) requests。
- 每個 HTTP(S) request 都先套用既有 URL security policy。
- policy 不允許的 request 直接 abort。
- BrowserContext 設定 `serviceWorkers: "block"`，避免 Service Worker 讓部分 request 脫離一般 route interception。
- 使用 `browserContext.routeWebSocket()` 將 WebSocket 預設阻擋；第一版不依賴 WebSocket 取得 discovery。
- Phase 2 必須盤點 WebRTC、preconnect / dns-prefetch 等不一定等同一般 HTTP route 的 network channel；無法治理的 egress 不得被假設為已受到 SSRF policy 保護。
- popup / 新 page 預設關閉，不納入掃描；Context-level routing 必須先於 Page 建立，以涵蓋 popup 初始 request。
- BrowserContext 設 `acceptDownloads: false`，並對 download event 做 cancel / diagnostic；不保存下載檔。
- Scan stop 時由 `DynamicRenderer.requestStop()` 主動關閉 active BrowserContext，使 Page / navigation 儘快中止，不單純等待 `renderTimeoutMs`。
- limiter 中尚未開始的 render job 在取得執行權後先檢查 stop flag，直接標記 `stopped`，不得再建立 Context / Page。

### 4.3 HTTP method policy

即使使用者沒有點擊，頁面初始化 JavaScript 本身仍可能送出具有副作用的 request。

第一版建議 Browser network policy：

- `GET`：允許，但仍需通過 URL security policy。
- `HEAD`：允許。
- `OPTIONS`：允許，用於瀏覽器正常 CORS preflight；仍需通過 URL security policy。
- `POST` / `PUT` / `PATCH` / `DELETE`：預設阻擋。
- `CONNECT` / `TRACE` / 未知或非預期 method：預設阻擋。

影響：

- 部分以 POST GraphQL / API 載入內容的 SPA 可能無法完整 render。
- `OPTIONS` 僅允許瀏覽器完成必要的 preflight，不代表後續 unsafe method 會被放行。
- 此限制應明確列為第一版能力邊界，不應為了提高 coverage 而預設允許 HTTP 語意上非 safe 的 method。
- 此政策只能限制 request method；若目標網站錯誤地讓 GET / HEAD / OPTIONS 具有伺服器端副作用，Browser 端無法單靠 method 名稱保證「絕對無副作用」，因此文件與 GUI 不應做此絕對承諾。

### 4.4 Session / Profile

第一版：

- 不使用使用者日常 Chrome / Edge profile。
- 不讀取既有 cookie、password、local storage 或 browser login session。
- 每個 render job 使用新的 ephemeral BrowserContext，render 完成即關閉。
- 不在 render jobs 之間保存 cookie / storage state。
- 不設定 HTTP credentials，不載入 storageState。
- `ignoreHTTPSErrors` 維持 `false`，不因 Browser render 放寬 TLS 錯誤。
- permissions 維持預設不授權，不主動授予 camera / microphone / geolocation 等權限。
- 不保存 browsing profile。
- 不支援 authenticated scan。
- 不接受 CAPTCHA / login automation。

### 4.5 Browser request identity 與 header 原則

第一版 BrowserContext 應保持可追溯且避免攜帶額外身份：

- 可沿用 Link Checker 已設定的 `userAgent` / Accept-Language 語意，使 static 與 render 路徑的識別政策一致。
- 不把 HTTP checker 的 Authorization、Cookie、Proxy-Authorization 等敏感 request header 複製到 Browser。
- 不從使用者現有 Browser 匯入 cookie / local storage。
- Browser 原生產生的正常 navigation / subresource headers 由 Browser 自行管理。
- 若未來需要 proxy 或 client certificate，必須另立安全設計，不直接沿用使用者環境中的秘密。

### 4.6 不保存高風險 Browser artifact

MVP 不保存：

- screenshot。
- trace。
- video。
- HAR。
- 完整 rendered DOM dump。
- response body。

Report 只保存必要的 render diagnostics 與 URL provenance。

---

## 5. Headless runtime 選型

### 5.1 正式決策

Dynamic Scan 第一版正式採用：

```text
playwright-core
```

Browser strategy：

```text
1. Microsoft Edge (`msedge`)
2. Google Chrome (`chrome`)
3. 皆不可用 -> Dynamic Render graceful unavailable
```

Portable 第一版：

```text
不 bundled Chromium
不要求使用者另外安裝 Playwright-managed browser
不依賴 persistent browser profile
```

此決策適用於 Phase 1～Phase 6。後續若真實部署資料顯示 branded browser 相容性不足，再於 Phase 6 之後評估 project-managed Chromium；不影響第一版架構。

### 5.2 選擇 `playwright-core` 的理由

本專案採用 `playwright-core`，主要因為：

- Dynamic Render 是 opt-in 的附加 discovery 能力，不應讓 Browser binary 成為所有使用者的基本 runtime。
- portable package 第一版不希望因 Chromium 額外增加大量容量與 release artifact 管理成本。
- Windows 環境通常已具備 Microsoft Edge，可作為第一優先 Browser channel。
- Browser unavailable 時可以 graceful degrade，保留既有 static scan。
- `playwright-core` 仍提供本專案需要的 Chromium / Browser / BrowserContext / Page / Route API。
- 將 Browser runtime 視為可替換 dependency，較符合 Local Link Checker 現有 report-first / optional feature 設計。

### 5.3 BrowserProvider 抽象

`LinkChecker` 不應直接散落：

```js
chromium.launch({ channel: "msedge" })
```

建議建立：

```text
DynamicRenderer
    |
    +-- BrowserProvider
            |
            +-- try msedge
            +-- try chrome
            +-- unavailable
```

概念 API：

```js
const launchResult = await browserProvider.launchFirstAvailable();

if (!launchResult.ok) {
  return {
    outcome: "browser_unavailable",
    reason: launchResult.reason,
  };
}

const browser = launchResult.browser;
```

BrowserProvider 的責任：

- 依固定順序嘗試支援的 Browser channel。
- Browser launch 採 single-flight，避免多 worker 重複 launch。
- 盡可能區分 `browser_not_found` 與 `browser_launch_failed`；實際 error mapping 由 OQ-1 驗證。
- 回傳 browser channel / version。
- 將 launch error 轉成穩定 diagnostics。
- 不讓 Playwright-specific launch detail 散落到 crawler。
- 為未來 bundled / project-managed Chromium 保留替換點。

### 5.4 Browser channel policy

第一版固定順序：

```text
auto:
  1. msedge
  2. chrome
```

CLI 可允許：

```text
--render-browser auto
--render-browser msedge
--render-browser chrome
```

其中：

- `auto`：依上述順序 fallback。
- `msedge`：只嘗試 Edge。
- `chrome`：只嘗試 Chrome。
- Browser 不存在或無法啟動時，Dynamic Render 記錄 warning，但整體 scan 不 failed。

### 5.5 不建議直接使用 arbitrary executablePath

第一版 Browser resolution 以 Playwright browser channel 為主。

不建議將以下方式作為正常主流程：

```js
chromium.launch({
  executablePath: "..."
})
```

原因：

- 會把 Browser executable discovery、版本相容性與路徑管理責任直接帶進 Link Checker。
- 不同 Windows 安裝模式、Enterprise policy 與 Browser update 會增加維護成本。
- BrowserProvider 使用官方 channel 名稱較容易形成穩定 diagnostics。

若未來 project-managed Chromium 確有需要，再另外設計明確、可驗證的 executable resolution policy。

### 5.6 Browser 版本與診斷

Runtime report 應記錄：

```text
playwrightCoreVersion
browserStatus
browserChannel
browserVersion
browserLaunchOutcome
```

`browserStatus` 至少可區分：

```text
not_checked
available
not_found
launch_failed
closed_unexpectedly
```

因 Browser 採 lazy launch，若本輪沒有任何 render candidate，狀態必須是 `not_checked`，不能誤寫成 unavailable。

目的：

- 協助比對不同電腦的 Browser 差異。
- 協助 Enterprise Edge / Chrome policy troubleshooting。
- 避免將「已安裝 Browser 但不能被 Playwright 控制」誤顯示為「Browser 未安裝」。

### 5.7 Enterprise / Managed Browser 限制

第一版需明確接受：

- Edge / Chrome 可能受 Group Policy、Endpoint Protection、Application Control 或 Mandatory Extension 影響。
- Browser 已存在不代表一定可以被 Playwright 啟動。
- 遇到 Enterprise policy 限制時只做 diagnostics，不嘗試規避。
- Dynamic Render 失敗不應影響 static scan。

### 5.8 長期備援路線

若 Phase 5 / Phase 6 benchmark 顯示：

- local Edge / Chrome launch failure rate 偏高；
- Browser version 差異造成明顯 regression；
- Enterprise 環境需要可重現 browser runtime；

再評估：

```text
playwright-core
+
project-managed Chromium
```

可能形成：

```text
Standard Portable:
  playwright-core + local Edge / Chrome

Optional Dynamic Runtime:
  playwright-core + controlled Chromium
```

此項目不屬第一版必要範圍。

第一版應在 `package-lock.json` / release manifest 中固定實際 `playwright-core` 版本；若使用 `browserContext.routeWebSocket()`，選定版本必須包含該 API，避免 portable 環境因 dependency 漂移失去既定 network policy。


---

## 6. Render readiness / settle 策略

不使用「永遠等待 network idle」作為主要完成條件。

### 6.1 Hard deadline

`renderTimeoutMs` 第一版定義為 **單一頁面的 hard render deadline**，涵蓋：

```text
Context / Page setup
-> page.goto()
-> bounded settle
-> page.content()
-> challenge / size check
-> link extraction
```

`renderSettleMaxMs` 必須小於 hard deadline，只是 settle 子階段的上限。

若 hard deadline 在 navigation 階段耗盡：

```text
navigation_timeout
```

若 navigation 已成功，但 settle 到達 `renderSettleMaxMs`：

```text
仍抽取當下 DOM
settled = false
outcome = rendered_unsettled
```

也就是 settle 上限代表「可能不完整」，不是直接丟棄已取得的 runtime DOM。

### 6.2 Stability 判定

MVP 建議：

1. `page.goto(..., waitUntil: "domcontentloaded")`。
2. 等待最小 settle floor，避免 DOMContentLoaded 後立即把空 DOM 判定為穩定。
3. 進入 bounded settle loop。
4. 每隔固定短時間讀取「可抽取 URL attribute 的 signature」，而不是只看 link count。
5. signature 連續數次不變，且已超過 minimum settle time，才視為 settled。
6. 不論是否 settled，都受 `renderSettleMaxMs` 與 `renderTimeoutMs` 限制。
7. render 完成時記錄 `page.url()`；URL resolve 以 runtime `<base>` 為優先，否則以 `page.url()` 為 fallback base。

只比較 count 會漏掉「數量不變但 href 被替換」的情境，因此不採 count-only 判定。

### 6.3 初步 development values

```text
renderTimeoutMs = 15000
renderSettleMinMs = 1000
renderSettleIntervalMs = 250
renderSettleStableSamples = 3
renderSettleMaxMs = 2500
```

以上是 development defaults，不是正式產品承諾；Phase 5 以 benchmark 調整。


---

## 7. Report 契約修正

原規劃直接使用：

```text
checked[].sources[].sourceType
```

但現行 `checked[]` 並不保存完整 sources；完整來源主要出現在 `broken[]` 與 `externalLinks[]`，因此 Dynamic Render 不應假設 `checked[].sources[]` 已存在。

### 7.1 建議新增 options

```text
options.dynamicRender
options.renderBrowser
options.renderConcurrency
options.renderTimeoutMs
options.renderMaxPages
options.renderSettleMinMs
options.renderSettleIntervalMs
options.renderSettleStableSamples
options.renderSettleMaxMs
```

### 7.2 建議新增 summary

```text
summary.dynamicRender.enabled
summary.dynamicRender.playwrightCoreVersion
summary.dynamicRender.browserStatus
summary.dynamicRender.browserChannel
summary.dynamicRender.browserVersion
summary.dynamicRender.attemptedPages
summary.dynamicRender.renderedPages
summary.dynamicRender.renderedUnsettledPages
summary.dynamicRender.skippedPages
summary.dynamicRender.timeoutPages
summary.dynamicRender.failedPages
summary.dynamicRender.linksObserved
summary.dynamicRender.linksAddedToInventory
summary.dynamicRender.linksMergedIntoInventory
summary.dynamicRender.linksRejected
summary.dynamicRender.securityBlockedRequests
summary.dynamicRender.methodBlockedRequests
summary.dynamicRender.websocketBlockedRequests
summary.dynamicRender.budgetExceeded
summary.dynamicRender.warnings[]
```

### 7.3 建議加入 page-level additive evidence

`renderEvidence` 只附加在「實際屬於 crawl page 且曾被 Dynamic Render 評估」的 page result；Dynamic Render 關閉時，以及 asset / media 等非 page result，不為了填 `enabled: false` 而大量增加欄位。

範例：

```json
{
  "renderEvidence": {
    "candidate": true,
    "attempted": true,
    "outcome": "rendered",
    "settled": true,
    "renderFinalUrl": "https://example.com/page",
    "redirectCount": 0,
    "elapsedMs": 842,
    "linksObserved": 28,
    "linksAddedToInventory": 9,
    "linksMergedIntoInventory": 18,
    "linksRejected": 1,
    "securityBlockedRequests": 0,
    "methodBlockedRequests": 1,
    "websocketBlockedRequests": 0,
    "reason": "ok"
  }
}
```

`outcome` 建議固定 enum：

```text
rendered
rendered_unsettled
skipped
browser_unavailable
navigation_timeout
render_timeout
navigation_failed
render_scope_blocked
challenge_detected
render_html_too_large
budget_exceeded
stopped
```

語意：

- `rendered`：navigation + settle + extraction 正常完成。
- `rendered_unsettled`：到達 settle 上限，但已抽取當下 DOM；屬 partial evidence。
- `render_scope_blocked`：main frame 嘗試離開允許的 crawl origin。
- `challenge_detected`：渲染結果被判定為 challenge / protection page，因此不 ingest 其內容 link。
- `securityBlockedRequests` / `methodBlockedRequests` 屬 additive diagnostics；單一 subrequest 被阻擋不必把整頁 outcome 改成 failed。

原始 HTTP：

```text
status
ok
classification
issueType
confirmation
```

全部保持原意，不被 `renderEvidence` 覆蓋。

所有 `renderFinalUrl`、warning detail 與錯誤訊息仍需套用既有 sensitive query redaction / sanitization。

### 7.4 URL provenance

Browser 發現的 URL：

```text
sourceType = "rendered_dom"
```

在現有 source model 可自然出現在：

- internal inventory source。
- `broken[].sources[]`。
- `externalLinks[].sources[]`。

為符合「report 能清楚追溯哪些 URL 由 runtime DOM 發現」的產品目標，第一版 schema **應新增 compact provenance**：

```text
checked[].discovery.sourceTypes[]
```

例如：

```json
{
  "discovery": {
    "sourceTypes": ["html_attribute", "rendered_dom"]
  }
}
```

不要為此把完整 `sources[]` 複製到所有 `checked[]`，避免 report 體積快速增加。

第一版定義：

- `sourceTypes` 為 deduplicated、穩定排序的 source type array。
- 同一 URL 同時由 static 與 render 發現時，保留兩種 provenance。
- `rendered_dom` 只是 discovery provenance，不代表 Browser 已驗證 HTTP status。

階段邊界：

- Phase 1 必須證明 internal source / inventory 能保留 static + `rendered_dom` provenance，並可用 targeted tests / internal diagnostics 作為 Spike evidence。
- Phase 1 **不要求**把 `checked[].discovery.sourceTypes[]` 定案成正式 production schema。
- Phase 3 才正式加入 `checked[].discovery.sourceTypes[]`、schema validation、Analyzer / diff compatibility 與 release contract。
- 若 Phase 1 為了 Spike evidence 暫時產生 projection，必須明確視為 provisional，不得宣稱已完成 Phase 3 report contract。

### 7.5 Render discovery metric 定義

為避免 benchmark 與 report 各自解讀，第一版固定：

```text
linksObserved
  = rendered extractor 產生且可進入 URL resolve 流程的候選數

linksAddedToInventory
  = canonical key 在本輪 inventory 中原本不存在，因 render 首次建立的數量

linksMergedIntoInventory
  = render candidate resolve 後命中既有 canonical inventory item 的數量

linksRejected
  = invalid URL、unsupported scheme、超過 per-page render link cap 或其他明確不進 inventory 的數量
```

以上為計數語意，不等於 HTTP status 結果。

### 7.6 Schema / release

Dynamic Render 會新增：

- CLI options。
- scanning behavior。
- report fields。
- source type。
- GUI / Analyzer semantics。

因此應以 minor release 規劃，不應放入單純 patch release。

---

# 8. 開發階段

以下階段以「每階段都有明確 exit gate」為原則。前一階段未通過，不進入下一階段。

---

## Phase 0：Baseline、Fixture 與無行為變更 Refactor

### 目的

先降低 Dynamic Render 導入時對既有 crawler 的侵入性，建立可重複驗證環境。

### 實作範圍

#### 0A. 建立 Git 開發基線

Dynamic Scan 不直接在 `main` 開發。開始 Phase 0 前：

```bash
git switch main
git pull --ff-only

git tag --list v1.1.1
git switch -c feature/js-dynamic-scan
```

原則：

- `main` 維持穩定、可重建、可發布。
- `feature/js-dynamic-scan` 作為 Dynamic Scan 的主要開發線。
- 確認正式版 `v1.1.1` 已有 tag 指向實際 release commit；若尚未建立，應先依專案 release 紀錄確認正確 commit 後再補 tag。
- Phase 0～Phase 6 原則上都在 `feature/js-dynamic-scan` 完成。
- 不為每個 Phase 再建立長期 feature branch，避免增加不必要的 merge 複雜度。
- 若需要實驗性高風險 spike，可建立短生命週期子分支，但完成或放棄後應立即 merge / delete。

#### 0B. 建立 fixture

至少建立：

1. `static-html`
   - 傳統 `<a href>`。
   - 不需要 JavaScript。

2. `csr-basic`
   - 原始 HTML 無目標 `<a>`。
   - JavaScript 執行後插入站內與外部 `<a>`。

3. `csr-delayed`
   - DOM link 延遲數百毫秒產生。

4. `render-timeout`
   - 頁面持續 pending 或不穩定。

5. `security-private-url`
   - runtime DOM / fetch 指向 localhost、private IP、metadata-like target。

6. `side-effect-method`
   - page load 嘗試 POST / PUT，驗證 Browser policy 會阻擋。

7. `popup-download`
   - page load 嘗試 popup / download，驗證不建立額外掃描路徑。

8. `duplicate-link`
   - 同一 URL 同時存在 static HTML 與 rendered DOM，驗證 inventory merge。

9. `runtime-base-url`
   - JavaScript 更新 history / `<base>` 後產生相對 URL，驗證以 runtime document URL / base resolve。

10. `render-cross-origin-navigation`
    - main frame redirect / JavaScript navigation 到其他 origin，驗證 render scope 被阻擋。

11. `challenge-rendered`
    - Browser 渲染後呈現 challenge-like DOM，驗證只記 diagnostics、不 ingest challenge links。

12. `websocket-egress`
    - 頁面啟動 WebSocket，驗證第一版預設阻擋。

13. `browser-request-burst`
    - 單頁建立大量 subresource / fetch，用於 OQ-6 Browser traffic / rate-limit 評估。

#### 0C. 抽出 unified discovery ingestion

將 `processPage()` 中：

```text
resolve
source
addSource
addInventoryItem
addExternalLink
schedule validation
enqueue page
```

抽成共用 method，例如：

```text
ingestDiscoveredLinks()
```

Static / SPA 行為不變。

#### 0D. Regression gate

執行：

- `node --check`。
- 全部現有 `test-*.mjs`。
- static fixture。
- GUI smoke。
- 至少一份既有 report snapshot / normalization check。
- controlled fixture 的 deterministic before / after projection，直接比較 canonical URL set、inventory metrics、source provenance、validation scheduling 與 crawl queue 語意。

`report-diff.mjs` 在此只作 supplementary compatibility evidence，不作 behavior parity 的唯一 oracle。Phase 0 不修 unrelated report-diff normalization limitation。

### Exit gate

只有在以下全部成立時進 Phase 1：

- 未加入 Browser dependency 前，既有測試全過。
- static scan report 與 refactor 前無非預期語意差異。
- `processPage()` 已不再複製 link ingestion 邏輯。
- fixture 可在本機穩定重現。

### Rollback

此階段只做 refactor / fixture；若 regression 無法快速收斂，先回復 refactor，不進入 Browser spike。

---

## Phase 1：CLI-only Headless Render Spike

### Spike 定義與 Exit Decision

本階段的 Spike 不是正式功能完成版，也不是單純證明 Playwright 可以啟動 Browser。

Spike 的目的：

> **以最小可運作實作取得工程證據，確認 Browser-based runtime DOM discovery 能否乾淨地插入既有 LinkChecker 架構，並辨識是否存在足以否決此技術方向的 integration、lifecycle、安全或 operational 風險。**

Spike 要回答的核心問題分成兩層。

#### A. Feasibility Spike

回答：

```text
Can it work?
```

最小可驗證資料流：

```text
Static HTML 沒有目標 URL
  |
  v
Browser 執行 JavaScript
  |
  v
runtime DOM 出現 URL
  |
  v
page.content()
  |
  v
existing extractLinks()
  |
  v
ingestDiscoveredLinks()
  |
  v
existing inventory
  |
  v
existing HTTP checker
```

Feasibility Spike 至少證明：

- `playwright-core` 可以透過 BrowserProvider 啟動支援的本機 Browser。
- CSR fixture 的 runtime DOM URL 可以被發現。
- `page.content()` + existing `extractLinks()` 可重用。
- `rendered_dom` 可以進入既有 unified discovery ingestion。
- duplicate URL 可以由 inventory 正常 merge。
- Browser discovery 不改變既有 HTTP validation truth。
- runtime document URL / `<base>` 的 relative URL resolution 行為符合契約。

#### B. Risk Spike

回答：

```text
Can it work safely and predictably?
```

Phase 1 先驗證能在此階段低成本觀察的風險，並為 Phase 2 / Phase 5 建立 evidence：

- Browser lazy launch / single-flight 是否可靠。
- timeout / exception 是否能 graceful degrade。
- stop 時 active / queued render job 是否能收斂。
- Browser / Context / Page 是否完整清理，不留下 orphan process。
- Browser unavailable / launch failure 是否不影響 static scan。
- main-frame origin / redirect / challenge 等情境是否能進入既定 diagnostics。
- Browser request burst / resource type / per-host request telemetry 是否可量測。
- Phase 2 所需 network security fixture 是否具備可重現條件。

Phase 1 **不要求**關閉 OQ-3 DNS / SSRF Parity，也不要求在此階段完成正式 Browser request pacing；這些分別由 Phase 2 與 Phase 5 負責決策。

#### Spike 可以接受的非正式部分

為避免 Spike 膨脹成完整 production implementation，本階段允許：

- 僅提供 CLI。
- 以 fixture 為主要驗證來源。
- diagnostics 先採 internal stats / verbose event。
- report schema 尚未正式固定。
- GUI / Analyzer 尚未實作。
- portable packaging 尚未完成。
- performance defaults 尚未定案。
- 部分 internal API 在 Spike 後仍可調整。

但以下事項不可為了「快速 PoC」而跳過：

```text
Browser cleanup
stop behavior
timeout boundary
runtime URL resolution
inventory integration
HTTP truth separation
basic origin / redirect boundary
security telemetry hooks
```

因為若跳過這些項目，就無法判斷此方案是否真的適合 Local Link Checker。

#### Spike 成功定義

Phase 1 的成功 **不是**：

```text
Edge 可以啟動
```

也不是：

```text
成功抓到一個 CSR link
```

Phase 1 success 必須至少成立：

```text
Browser availability path works
+
runtime DOM discovery works
+
existing extractor / inventory are reused
+
existing HTTP validation remains truth
+
failure degrades safely
+
Browser lifecycle cleans up correctly
+
stop / timeout can converge
+
Phase 2 / Phase 5 risks are measurable
```

也就是：

> **證明此技術方向值得繼續工程化，而不是證明 Browser automation 本身存在。**

#### Spike 交付物

Phase 1 結束時至少留下四類成果：

```text
1. Working prototype
2. Reproducible test fixtures
3. Evidence / measurements
4. Decision record
```

建議 Spike Result 格式：

```text
Phase 1 Spike Result

Browser
- Edge launch:
- Chrome fallback:
- browser unavailable degradation:
- lifecycle cleanup:

Discovery
- csr-basic:
- csr-delayed:
- duplicate merge:
- runtime base URL:

Lifecycle
- stop during render:
- queued render after stop:
- hard timeout:
- unexpected browser close:

Observed
- browser launch elapsed:
- average render elapsed:
- rendered pages:
- new URLs discovered:
- browser requests/page:
- peak browser requests by host:

Open / Next Gate
- OQ-2 unsafe-method coverage:
- OQ-3 DNS / SSRF parity -> Phase 2
- OQ-4 settle tuning -> Phase 5
- OQ-5 performance budget -> Phase 5
- OQ-6 browser traffic / rate-limit parity -> Phase 5

Decision
- GO
- ADJUST_AND_REPEAT
- NO_GO
```

#### Exit Decision

Phase 1 最後必須明確給出其中一個結論：

```text
GO
```

條件：

- Feasibility Spike 通過。
- lifecycle / integration 沒有 blocking defect。
- 已知安全風險可由 Phase 2 明確驗證。
- 尚未解決的 operational 問題已有 telemetry 與後續 Gate。

```text
ADJUST_AND_REPEAT
```

條件：

- 技術方向仍合理，但 Browser lifecycle、extractor integration、stop、runtime URL resolution 或 diagnostics 存在可修復問題。
- 修正後需重新執行 Phase 1 Exit Gate，不直接進 Phase 2。

```text
NO_GO
```

條件：

- Browser discovery 無法可靠併入既有 inventory / validation 架構。
- Browser lifecycle 無法安全收斂。
- 需要大幅破壞既有 HTTP truth / security boundary 才能達成功能目標。
- Spike 發現無法合理隔離、且會使後續安全設計失去基礎的架構問題。

只有 `GO` 才能正式進入 Phase 2 Security Gate。

### 目的

驗證 `playwright-core` + 本機 Edge / Chrome 是否能在不改既有 validation truth 的前提下，把 CSR link 加入 inventory。

### 實作範圍

新增 dependency：

```text
playwright-core
```

新增內部元件：

```text
DynamicRenderer
BrowserProvider
RenderLimiter
RenderStats
```

新增 CLI：

```text
--dynamic-render
--render-browser <auto|msedge|chrome>
--render-timeout <ms>
--render-concurrency <n>
--render-max-pages <n>
```

初步 development default：

```text
dynamicRender = false
renderBrowser = auto
renderConcurrency = 1
renderTimeoutMs = 15000
renderMaxPages = 25
```

Browser：

- lazy launch + single-flight。
- 每 scan 共用一個 Browser instance。
- 每個 render job 建立新的 ephemeral BrowserContext + Page，完成即 close Context。
- BrowserContext 建 Page 前先設定 route / routeWebSocket / Service Worker policy。
- `serviceWorkers: "block"`。
- `acceptDownloads: false`。
- `ignoreHTTPSErrors: false`。
- permissions 不主動授予。
- headless。
- 不使用 persistent profile / storageState / HTTP credentials。

Render：

- 只處理 eligible same-origin page-like HTML page。
- main-frame 不允許離開既有 crawl origin。
- redirect count 受既有 `maxRedirects` 約束。
- `DOMContentLoaded` + minimum settle floor + bounded signature stability。
- settle max 到達時可抽取當下 DOM 並標 `rendered_unsettled`。
- `page.content()` 後先做 challenge / size guard。
- `getDocumentBaseUrl(renderedHtml, page.url())`。
- 重用 `extractLinks()`。
- source type 改成 `rendered_dom`。
- 送入 `ingestDiscoveredLinks()`。

錯誤：

- browser unavailable 不使 scan failed。
- page timeout 不使 scan failed。
- render exception 不使整個 scan failed。
- 所有失敗都記錄 diagnostics。

### Phase 1 暫不做

- GUI。
- automatic render。
- browser bundling。
- screenshot / trace。
- render cache。
- render queue。
- POST API 支援。
- resource blocking optimization。

### Exit gate

- `csr-basic` 能發現 static scan 找不到的 URL。
- duplicate URL 能被 inventory 正常 merge。
- 未開 `--dynamic-render` 時輸出與現況一致。
- Browser unavailable 時 scan 仍完成。
- Browser instance 在 scan 結束或 error 時一定 close。
- stop scan 不會留下 orphan browser process，且 queued render job 不會在 stop 後繼續建立 Context。
- runtime base URL / main-frame scope / challenge fixture 行為符合契約。
- OQ-1 已取得初步 Browser compatibility evidence，至少可判定 `provisionally_acceptable` 或 `blocked`。
- OQ-2 / OQ-4 / OQ-5 所需 diagnostics 已開始收集，避免到 Phase 5 才補 instrumentation。

---

## Phase 2：Browser Network Security Gate

### 目的

在 Dynamic Render 進 GUI 或正式 report contract 前，先確保 Browser 不會成為 SSRF / side-effect bypass。

### 實作範圍

- navigation 前套用 `evaluateUrlSecurity()`。
- BrowserContext-level route interception。
- HTTP(S) subrequest 逐筆套用 URL security policy。
- `serviceWorkers: "block"`。
- `routeWebSocket()` 預設阻擋 WebSocket。
- 盤點 WebRTC、preconnect / dns-prefetch 等 route() 未必能代表的 network channel。
- main-frame origin scope + redirect count / navigation count policy。
- 預設只允許 GET / HEAD / OPTIONS，阻擋 POST / PUT / PATCH / DELETE / CONNECT / TRACE 與未知 method。
- popup 關閉。
- download 禁止。
- security blocked / method blocked 計數。
- Browser request diagnostics 不保存敏感 request body。
- 從 Phase 1 起記錄 Browser request host / resourceType / request-start / request-finished 統計，供 OQ-6 評估；在尚未證明 rate-limit parity 前，不宣稱 Browser subrequest 已完全沿用 HostScheduler。

### 必測情境

除 URL 字串與 private IP fixture 外，Phase 2 必須特別驗證 **DNS / SSRF parity**：

- `evaluateUrlSecurity()` 預先解析為 public IP，但 Browser 真正連線前 DNS 結果改變的情境。
- public hostname 解析到 private / loopback / link-local / metadata target。
- redirect 後 hostname / DNS target 改變。
- iframe / script / fetch / XHR 等 Browser 子請求指向受限網段。
- route interception 與 Browser DNS resolution 之間可能存在的 TOCTOU / rebinding 風險。

若無法證明 Browser request 能維持與既有 Node HTTP security policy 足夠一致的防護，Dynamic Render 應維持 fail-closed，且不得通過 Phase 2 Security Gate。

其他必測：

- localhost。
- `127.0.0.1` / `::1`。
- RFC1918/private。
- link-local。
- metadata IP。
- public hostname resolve 到 private IP。
- redirect / iframe / script 指向 private target。
- JS `fetch()` 指向 private target。
- WebSocket 指向 public / private target。
- WebRTC / preconnect / dns-prefetch 能否產生未治理 egress 的 threat-model 驗證。
- POST API。
- popup。
- download。
- main-frame cross-origin redirect / JavaScript navigation。
- redirect chain 超過 `maxRedirects`。

### Exit gate

- Dynamic Render 無法直接存取既有 security policy 禁止的 target。
- 所有 blocked request 能被統計。
- blocked subrequest 不會使整體 scan crash。
- Browser 與 Node HTTP security policy 的預設 allow/deny 語意一致。
- DNS resolution / redirect / subrequest / WebSocket 情境沒有可重現的 SSRF bypass。
- Browser 可產生的其他 network egress channel 已被盤點；若存在無法可靠治理且足以突破 threat model 的 channel，必須預設停用、隔離或判定 No-Go。
- main-frame origin scope 與 `maxRedirects` 不因 Browser rendering 被突破。
- 若存在無法可靠攔截或驗證的 request 類型，必須預設阻擋或停用該能力。
- 不能證明安全的情境維持 fail-closed。

### Go / No-Go

**Phase 2 是正式功能的安全 release gate。**

Phase 2 結束前：

- OQ-2 必須形成第一版 policy 結論。
- OQ-3 必須取得明確 `PASS`；若為 `REPRODUCIBLE_SSRF_BYPASS`，直接 No-Go。
- 不能把 OQ-3 留成「release 已知限制」。

若 Browser network policy 無法可靠落實，Dynamic Render 不進 Phase 3、GUI 或 release。

---

## Phase 3：Report Contract 與 Diagnostics

### 目的

把 spike 結果正式納入 report-first 架構。

### 實作範圍

新增：

- `options.dynamicRender` 等 render options。
- `summary.dynamicRender`。
- page-level `renderEvidence`。
- `sourceType: "rendered_dom"`。
- `checked[].discovery.sourceTypes[]`（compact provenance，第一版 schema 必要欄位）。

更新：

- `schemas/report.schema.json`。
- `TECHNICAL_SPEC.md`。
- `CLI_REFERENCE.md`。
- `REPORT_NORMALIZATION.md` 的相容性說明。
- report fixtures。

### Report diff 原則

第一版 `report-diff.mjs`：

- 不必把 `renderEvidence` 納入 URL changed 判定。
- 仍以既有 `ok/status/issueType/...` 比較為主。
- 可先忽略未知 render 欄位。
- 若後續需要比較 render coverage，再加入 diagnosticsChanges。
- diff normalization 只代表既定投影的 compatibility comparison，不宣稱能證明完整 report semantic equality；inventory/source parity 由 crawler fixture / direct assertions 驗證。

避免：

> 僅因 Browser 版本、render time 或 linksObserved 改變，就把 URL 判成狀態 changed。

### Exit gate

- 新 schema 可驗證。
- **新版** GUI / Analyzer / diff 必須能讀取既有 report schema 1.3.0。
- 舊版程式是否能讀取新 schema 屬 forward-compatibility best effort；除非實測證明，不將「舊 binary 一定可讀新 report」列為 release 保證。
- 若舊 Analyzer / schema validator 對新 `sourceType` 或新欄位採 strict enum，應在 release notes 明確標示最低相容版本。
- `renderEvidence` 不改變 HTTP result interpretation。
- `checked[].discovery.sourceTypes[]` 能讓成功與失敗 URL 都保留 `rendered_dom` provenance。
- sensitive query redaction 對 render diagnostics 同樣生效。

---

## Phase 4：GUI Opt-in、Progress 與 Analyzer

### 目的

讓一般承辦人可以理解並安全使用 Dynamic Render。

### GUI

一般設定或掃描建議區加入：

```text
加強檢查動態網頁
```

主要說明：

> 有些網站的連結要在網頁載入完成後才會出現。啟用後可增加這類連結的檢查範圍，但掃描時間會較長。

第二層說明才補充：

> 此功能不保證可處理需要登入、驗證碼或網站防護的頁面。

一般畫面不使用 `Playwright`、`Headless`、`CSR`、`SPA` 等詞作為主要標籤。

預設：

```text
關閉
```

Basic 畫面原則：

```text
網站網址
[開始掃描]

[ ] 加強檢查動態網頁
```

進階參數如：

```text
render timeout
render concurrency
render max pages
browser channel
```

預設不顯示於 Basic；只有 Advanced / CLI 才提供。


### Progress

Basic progress 顯示業務語意：

- 一般網頁檢查進度。
- 是否正在「加強檢查動態網頁」。
- 已完成多少動態頁面檢查。
- 是否有頁面因逾時或環境限制未完成。
- 是否已達動態檢查上限。

不要直接暴露 Playwright、BrowserContext、route、render limiter 等技術細節給一般使用者。

Advanced / diagnostic view 才可顯示：

```text
browserStatus
browserChannel
attemptedPages
renderedPages
renderedUnsettledPages
timeoutPages
failedPages
budgetExceeded
```

### Analyzer

Analyzer 採行動優先三級呈現。

Level 1：

```text
需要處理
建議確認
外部網站限制
正常
```

Level 2：

- 人話說明問題。
- 說明對結果的影響。
- 提供下一步建議。

Level 3（展開技術資訊）：

- `動態網頁取得` source badge。
- render summary。
- render timeout / browser unavailable diagnostic。
- HTTP status / redirect / confirmation / sourceType 等技術證據。

不得把 Browser 成功顯示為 HTTP link「恢復」。

### Exit gate

- GUI 未勾選時完全不啟動 Browser。
- 使用者可以辨識 Dynamic Render 已啟用。
- Browser 不存在時 UI 有可理解提示。
- stop job 可中止後續 render 並清理 Browser。
- partial report 可保留已完成 render diagnostics。
- Persona A 在不理解 HTTP / SPA / JavaScript / Playwright 的前提下，可依畫面完成一次掃描、找到「需要處理」項目並匯出結果。
- Persona A 遇到 Browser unavailable / render timeout 時，可從 UI 理解「發生什麼、影響什麼、下一步做什麼」。
- Persona A 不需要進入 Advanced 即可完成核心任務。
- Persona C 可透過「複製診斷資訊」取得足夠 troubleshooting evidence，且內容已 sanitization。

---

## Phase 5：Resource Budget、效能與穩定化

### 目的

確認 Dynamic Render 不會讓 portable 工具在大型網站上失控。

### 建議加入 budget

```text
renderConcurrency
renderMaxPages
renderTimeoutMs
renderSettleMaxMs
renderMaxLinksPerPage
renderTotalBudgetMs
```

可選後續：

```text
renderMaxFailures
renderMaxSecurityBlocks
```

### Benchmark

至少建立：

- 10 pages。
- 50 pages。
- 100 pages。
- SPA-heavy。
- static-heavy。
- timeout-heavy。

Benchmark 至少比較：

```text
renderConcurrency = 1   <- 第一版基準 / 預設
renderConcurrency = 2   <- Phase 5 候選
```

只有在 `2` 明顯改善 elapsed 且 CPU / memory / timeout / Browser stability 可接受時，才考慮調整正式預設值。

記錄：

- total scan elapsed。
- render elapsed。
- peak browser process memory（若容易取得）。
- pages rendered。
- links added。
- duplicates。
- timeout rate。
- browser crash / launch failure。
- Browser request peak concurrency by host。
- Browser request start-rate / request count by host。
- Context create / close overhead。

### Resource blocking 評估

此階段才評估是否阻擋：

- image。
- font。
- media。

不要在 spike 一開始就預設阻擋，避免因 page lifecycle / onload 行為改變導致 discovery regression。

### Exit gate

- render budget 到達時能正常停止，不視為 fatal error。
- 大型 scan 不會無限延長。
- Browser crash 可 graceful degrade。
- OQ-4 已完成 benchmark 並固定 production settle defaults。
- OQ-5 已完成 concurrency / budget benchmark。
- OQ-6 已完成 Browser traffic / rate-limit parity 評估，並明確記錄第一版採用的 browser request pacing policy。
- render concurrency default 有 benchmark 依據。
- `renderMaxPages` / `renderTotalBudgetMs` / `renderMaxLinksPerPage` 已有正式預設或明確不採用理由。
- memory / elapsed time 可接受。

---

## Phase 6：Portable Packaging 與 Release Gate

### 目的

確認 Dynamic Render 不破壞 Local Link Checker 的 portable / release 模型。

### 第一版 packaging 建議

- package `playwright-core` library code。
- 不內建 Chromium。
- `BrowserProvider` 預設依序嘗試本機 Edge (`msedge`) / Chrome (`chrome`)。
- Browser 不可用時 Dynamic Render graceful unavailable。
- `Start Link Checker.exe` / Node runtime / manifest 流程保持原則不變。

### Build manifest 建議增加

若 Dynamic Render 正式 release，可記錄：

```text
dynamicRender.supported
playwrightCoreVersion
bundledBrowser = false
supportedBrowserChannels
```

不要把實際使用者機器的 browser path 寫入 release manifest。

Runtime scan report 可記錄：

```text
browserChannel
browserVersion
```

### Release gate

第一版 Browser distribution 已定案為 local Edge / Chrome；Phase 6 的工作是驗證此策略是否達到 release gate，而不是重新選型。

必測：

- Edge (`msedge`) available：Dynamic Render smoke pass。
- Edge unavailable、Chrome (`chrome`) available：fallback smoke pass。
- Edge / Chrome 都 unavailable：Dynamic Render 顯示 graceful unavailable，Static Scan 正常。
- Browser 已安裝但 launch failed：錯誤分類為 `browser_launch_failed`，不得誤報為 `browser_not_found`。
- Managed / Enterprise 環境若受 policy 阻擋：保留 sanitized diagnostics，不嘗試規避。

Release gate：

- portable build 可重建。
- zip SHA256 / manifests 一致。
- 無 Browser 的乾淨 Windows 環境仍可正常使用 static scan。
- 有 Edge 的環境可完成 Dynamic Render smoke。
- Dynamic Render failure 不影響 GUI server 啟動。
- OQ-1 已完成 portable / Edge / Chrome fallback / browser unavailable / managed environment 最終驗證。
- OQ-1 狀態為 `closed` 或 `closed_with_known_limitation`，且限制已寫入 release notes。
- OQ-6 已 `closed` 或 `closed_with_known_limitation`；Browser 額外網路流量的限制已反映在 CLI/GUI 說明與 release notes。
- `playwright-core` 實際版本已被 lockfile / manifest 固定。
- 新功能以 minor release 發布。

---

## Phase 7：Detection / Recommendation 強化

### 目的

在有實際 render benchmark 後，再改善「什麼網站值得開 Dynamic Render」的提示。

### 擴充 spaDetection / scanQuality

候選 signal：

- low anchor count。
- large HTML + low anchor。
- framework shell。
- script count / script byte ratio。
- SPA root container。
- `__NEXT_DATA__` / Nuxt signals。
- route hint。
- API endpoint hint。
- static discovery pages 很低但 payload / script signals 高。
- 使用 Dynamic Render 後新增 URL 比例高。

### GUI

Phase 7 的 recommendation 不只是 convenience feature，也是 Persona A 的 usability requirement。

一般使用者不應自行判斷網站是否為 SPA / CSR。

系統依 evidence 顯示：

> **這個網站可能有部分連結需要網頁完整載入後才能找到。**

Action：

```text
[加強檢查]
```

第二層說明：

> 啟用後會增加檢查時間，但可能找到一般掃描未發現的連結。

不要顯示：

```text
SPA detected
CSR detected
Enable Playwright
```

除非使用者展開技術資訊。

仍然保持 opt-in，不自動啟用。

### Exit gate

- traditional HTML false-positive 可接受。
- CSR fixture 提示率明顯較高。
- recommendation 有 report evidence 可追溯。
- Persona A 不需要理解 SPA / CSR 即可理解 recommendation 的意思與影響。
- 使用者選擇不啟用時，不產生恐嚇式或錯誤式警示。

---

## Phase 8：Optional Auto Render Fallback

### 狀態

延後評估，不納入第一版 Dynamic Render 正式 release 的必要範圍。

### 前提

只有當 Phase 1–7 已取得足夠真實資料後才評估：

```text
--dynamic-render auto
```

可能流程：

```text
Static discovery
  |
  v
scanQuality / SPA signal
  |
  +-- confidence low --> no render
  |
  +-- confidence high --> render candidate
```

### 必要限制

- 仍受 renderMaxPages / total budget。
- 使用者可完全關閉。
- report 必須記錄 auto trigger reason。
- 不因 HTTP 403 / WAF / CAPTCHA 自動改用 Browser。
- 不因 Browser 可以打開就覆蓋 HTTP truth。

---

## 9. Git 開發、分支與版本管理策略

Dynamic Scan 是會改變 crawler discovery、CLI、dependency、report schema 與 GUI 的功能，不應直接在已穩定發布的 `main` 上持續開發。

### 9.1 Branch model

建議採簡化的 trunk + feature branch 模型：

```text
main
|
|  v1.1.1  <- 目前穩定正式版
|
+-- fix/*                       <- v1.1.x 維護修正
|
+-- feature/js-dynamic-scan     <- Dynamic Scan 主開發線
```

角色：

- `main`
  - 永遠維持可測試、可 build、可 release。
  - 不直接承載未完成的 Dynamic Scan 實驗。
- `feature/js-dynamic-scan`
  - 從穩定 `main` / `v1.1.1` 基線建立。
  - 承載 Phase 0～Phase 6 的主要開發。
  - 通過所有 release gate 後才 merge 回 `main`。
- `fix/*`
  - Dynamic Scan 開發期間若 `v1.1.x` 發現正式版 bug，從 `main` 建立。
  - 修正完成後先 merge 回 `main`、必要時發布 patch，再同步回 Dynamic Scan branch。

第一階段不建議引入完整 Git Flow：

```text
main
develop
feature/*
release/*
hotfix/*
```

目前專案以一條穩定主線加一條大型 feature branch 即可，避免額外長期 branch 的同步成本。

### 9.2 穩定版本 Tag

`v1.1.1` 應有明確 Git tag 指向正式 release commit：

```text
v1.1.1
```

目的：

- 可以重建當時正式版本。
- portable zip / manifest / SHA256 可以回溯到同一 source commit。
- Dynamic Scan 開發不會模糊穩定基線。
- 若未來需要從該版本重建 hotfix，可直接由 tag 建立。

例如：

```bash
git switch -c fix/example v1.1.1
```

實際補 tag 前必須先確認 release commit，不應只依目前 branch HEAD 猜測。

### 9.3 Dynamic Scan branch 建立

建議 branch 名稱：

```text
feature/js-dynamic-scan
```

理由：

- 與 `JS_DYNAMIC_SCAN_PLAN.md` / 本規劃名稱一致。
- 比單純 `feature/render` 更能表達功能範圍。
- 後續 GitHub PR、commit 與 release note 容易追溯。

建議操作：

```bash
git switch main
git pull --ff-only
git switch -c feature/js-dynamic-scan
```

### 9.4 Commit 策略

不要把 Phase 0～Phase 6 累積成一個大型 commit。

建議每個 commit 只完成一個可驗證目的，例如：

```text
test: add dynamic scan fixtures
refactor: extract discovered link ingestion
feat: add headless render spike
feat: enforce browser request security policy
feat: add dynamic render report diagnostics
feat: expose dynamic scan in GUI
test: add portable dynamic render smoke coverage
docs: document dynamic scan release behavior
```

原則：

- refactor commit 與 behavior-changing commit 分開。
- test fixture 優先於功能實作。
- schema change 與 GUI change盡量不要混在同一 commit。
- 每個 commit 應盡可能通過當時適用的 syntax / unit / regression gate。
- 不將 generated report、browser profile、trace、cache 或本機測試產物誤 commit。

### 9.5 Phase 與 Commit 的關係

建議：

```text
Phase 0
  -> fixtures
  -> ingestion refactor

Phase 1
  -> playwright-core dependency
  -> browser lifecycle
  -> render limiter
  -> rendered_dom discovery

Phase 2
  -> request interception
  -> method policy
  -> SSRF/security fixtures

Phase 3
  -> report schema
  -> renderEvidence
  -> summary.dynamicRender

Phase 4
  -> GUI
  -> Analyzer

Phase 5
  -> budgets
  -> performance / stability

Phase 6
  -> packaging
  -> release docs / smoke
```

Phase 是工程 gate，不必強迫「一個 Phase = 一個 commit」；應以可 review、可回退、可測試為準。

### 9.6 Dynamic Scan 開發期間的 v1.1.x 維護

若 `main` 在 Dynamic Scan 開發期間需要修正正式版：

```text
main
  |
  +-- fix/<issue>
        |
        +-- test
        +-- merge -> main
        +-- optional v1.1.2 release
```

完成後再把 `main` 的更新同步到：

```text
feature/js-dynamic-scan
```

建議優先採 regular merge 或團隊既有一致策略，不應為了保持 commit graph 漂亮而在已共享的 branch 上頻繁 rewrite history。

核心原則：

> 穩定版修正先回到 `main`，再由 `main` 向 Dynamic Scan branch 同步；不要只在 Dynamic Scan branch 修正式版 bug。

### 9.7 GitHub Pull Request

建議 Dynamic Scan branch 建立 Draft Pull Request，即使主要由單一開發者維護也有價值。

PR 應集中記錄：

- 對應 Dynamic Scan plan。
- Phase 0～6 checklist。
- report schema 變更。
- CLI 變更。
- security gate 結果。
- benchmark。
- portable smoke。
- known limitations。
- release note 草案。

建議 PR gate：

```text
Draft PR
  |
  +-- Phase 0 regression passed
  +-- Phase 1 render spike passed
  +-- Phase 2 security gate passed
  +-- Phase 3 schema compatibility passed
  +-- Phase 4 GUI / stop behavior passed
  +-- Phase 5 stability benchmark passed
  +-- Phase 6 portable release gate passed
  |
  v
Ready for review
  |
  v
Merge to main
```

### 9.8 Merge 回 main 的條件

只有在以下條件成立時才 merge：

- 所有既有 regression test 通過。
- Dynamic Render 預設為 off。
- Browser unavailable 不影響 static scan。
- Phase 2 Security Gate 通過。
- report schema 已固定並驗證。
- GUI stop / partial report 正常。
- portable build / smoke 通過。
- release notes 已說明新 CLI、dependency 與限制。
- source commit、portable artifacts、manifest 與 SHA256 可追溯。

Merge 後再依正式 release policy 建立下一個 minor version tag。

### 9.9 Rollback 原則

若 Dynamic Scan 尚未 merge：

- 直接保留 `main` 在穩定狀態。
- 可暫停、重做或刪除 `feature/js-dynamic-scan`，不影響正式版。

若已進入 PR 但某個 Phase 不通過：

- 不強行 merge。
- 退回上一個已通過 gate 的 commit。
- 針對失敗 Phase 修正後重新驗證。

若功能已 merge 但 release 前發現重大問題：

- 優先 revert feature merge / offending commits。
- 不以未驗證 hot patch 掩蓋 security 或 lifecycle 問題。

---

## 10. 建議 CLI 契約演進

### 第一個可用版本

```text
--dynamic-render
--render-browser <auto|msedge|chrome>
--render-timeout <ms>
--render-concurrency <n>
--render-max-pages <n>
```

### 後續才考慮

```text
--render-settle-max-ms
--render-total-budget-ms
--render-max-links-per-page
--dynamic-render-mode <off|on|auto>
```

第一版已發布的 boolean `--dynamic-render` 必須持續代表 `on`；未來若加入 auto mode，使用新的 `--dynamic-render-mode`，避免把同一 CLI flag 從「無參數 boolean」改成「需要 value」而破壞既有 script。

不要一開始暴露所有 Playwright options。

---

## 11. 建議程式結構

在不立即大拆 `link-checker.mjs` 的前提下，先建立明確邏輯邊界：

```text
LinkChecker
|
+-- HTTP Layer
|   +-- fetchUrl()
|   +-- request()
|   +-- HostScheduler
|   +-- evaluateUrlSecurity()
|
+-- Discovery Layer
|   +-- extractLinks()
|   +-- detectSpaFramework()
|   +-- extractFrameworkLinks()
|   +-- ingestDiscoveredLinks()        NEW
|   +-- DynamicRenderer                NEW
|   +-- BrowserProvider                 NEW
|   +-- BrowserNetworkPolicy            NEW
|   +-- BrowserRequestPacing            NEW / Phase 5 finalize
|
+-- Inventory Layer
|   +-- addSource()
|   +-- addInventoryItem()
|
+-- Validation Layer
|   +-- validationQueue
|   +-- checkUrl()
|   +-- confirmation
|
+-- Reporting
    +-- renderEvidence                 NEW
    +-- summary.dynamicRender          NEW
```

若 Dynamic Renderer 後續成長，才將其移出 `link-checker.mjs` 成為例如：

```text
lib/dynamic-renderer.mjs
```

第一個 spike 不必為模組化而大規模搬移既有程式。

---

## 12. 建議 RenderStats

內部可先使用：

```js
{
  enabled,
  browserStatus,
  browserChannel,
  browserVersion,
  playwrightCoreVersion,
  launchAttempts,
  attemptedPages,
  renderedPages,
  renderedUnsettledPages,
  skippedPages,
  timeoutPages,
  failedPages,
  linksObserved,
  linksAddedToInventory,
  linksMergedIntoInventory,
  linksRejected,
  securityBlockedRequests,
  methodBlockedRequests,
  websocketBlockedRequests,
  budgetExceeded,
  warnings
}
```

所有 warning 建議使用穩定 code，例如：

```text
browser_unavailable
browser_launch_failed
render_navigation_timeout
render_navigation_failed
render_timeout
render_unsettled
render_scope_blocked
render_challenge_detected
render_html_too_large
render_security_request_blocked
render_method_blocked
render_websocket_blocked
render_budget_exceeded
render_stopped
```

GUI 再將 code 轉成人讀文案。

---

## 13. 測試策略

### Unit

- render option normalization。
- render eligibility。
- source type mapping。
- render outcome normalization。
- report summary aggregation。
- Browser channel fallback decision。
- browser status `not_checked` / available / failure mapping。
- blocked method decision。
- main-frame origin / redirect budget decision。
- render metric accounting。
- compact discovery sourceTypes aggregation。

### Integration fixture

- CSR runtime DOM。
- delayed DOM。
- duplicate static + runtime link。
- runtime external link。
- security blocked target。
- POST blocked。
- timeout。
- browser unavailable。
- Browser process close。
- user stop + queued render drain。
- runtime `<base>` / `history.pushState()` URL resolution。
- main-frame cross-origin navigation blocked。
- redirect limit。
- challenge rendered DOM。
- rendered HTML size guard。
- WebSocket blocked。
- Browser request burst / pacing telemetry。

### Regression

每階段都必須確認：

- Static scan 不變。
- SPA payload extraction 不變。
- Site rules 不變。
- sitemap seed 不變。
- cache / incremental 不跳過 current discovery。
- confirmation 不受 Browser status 影響。
- report diff 不因 render timing 產生 URL false change。

### Usability / Persona

Phase 4 起至少建立 Persona-based usability test。

#### Persona A 任務

在不提供 HTTP / SPA / JavaScript / Playwright 教學的情況下，測試使用者能否：

1. 輸入網站網址。
2. 開始掃描。
3. 理解「加強檢查動態網頁」的大意。
4. 完成掃描。
5. 找到「需要處理」項目。
6. 理解至少一筆問題的下一步。
7. 匯出結果。
8. 遇到環境問題時找到「複製診斷資訊」。

失敗條件包括：

- 必須請使用者解釋技術名詞才能繼續。
- 使用者不知道下一步。
- 使用者把 warning 誤解為掃描完全失敗。
- 使用者因進階選項過多而無法開始。
- 使用者找不到匯出或支援入口。

#### Persona B 任務

驗證熟練承辦人能：

- 展開 Advanced。
- 理解 Dynamic Render 進階參數。
- 查看 technical evidence。
- 需要時使用 CLI reference。

#### Persona C 任務

驗證資訊支援者能：

- 取得 stable diagnostic code。
- 取得版本 / Browser / scan policy。
- 判斷 browser unavailable、launch failure、timeout、security block 等主要類型。
- diagnostics 不包含敏感資訊。

### Portable smoke

正式 release 前增加：

- Dynamic Render off。
- Dynamic Render on + Edge available。
- Dynamic Render on + Edge unavailable / Chrome fallback。
- Dynamic Render on + browser unavailable。
- GUI stop while rendering。
- idle shutdown after render scan。

---

## 14. Cache / Incremental 原則

第一版：

- 不建立 render cache。
- `--changed-only` 不復用 rendered DOM。
- page body discovery 仍以本輪資料為準。
- Dynamic Render candidate 若啟用，仍執行本輪 render。
- Browser link discovery 不寫入 persistent URL status cache。

未來若效能需求明確，再另行設計：

- DOM fingerprint。
- render discovery cache。
- browser/version/policy fingerprint。
- TTL 與 invalidation。

不得直接把 status cache 套用到 DOM discovery。

---

## 15. 失敗語意

Dynamic Render failure 預設是：

```text
scan warning / evidence
```

不是：

```text
URL broken
```

例如：

| Render outcome | 對 HTTP result 的影響 | 建議呈現 |
| --- | --- | --- |
| `rendered` | 無 | 已完成動態渲染 |
| `rendered_unsettled` | 無 | 已取得部分 runtime DOM，但在 settle 上限前未穩定 |
| `browser_unavailable` | 無 | 本機沒有可用瀏覽器，已略過 |
| `navigation_timeout` | 無 | 動態頁面 navigation 逾時，保留一般掃描結果 |
| `render_timeout` | 無 | 單頁 hard render deadline 到達 |
| `render_scope_blocked` | 無 | main frame 嘗試離開允許的 crawl origin |
| `challenge_detected` | 無 | 偵測到 challenge/protection page，不 ingest 其內容 link |
| `budget_exceeded` | 無 | 已達動態掃描上限 |
| `navigation_failed` | 無 | 動態渲染失敗，保留一般掃描結果 |

只有既有 HTTP validation 才決定 link `ok` / broken classification。

一般 UI 不直接顯示 outcome enum 作為主要訊息。

例如：

```text
browser_unavailable
```

轉譯為：

```text
無法使用動態網頁加強檢查

一般網站檢查已完成，但部分需要網頁完整載入後才會出現的連結可能未被找到。

建議：
- 可直接使用目前結果。
- 若需要更完整檢查，確認電腦已安裝 Edge 或 Chrome。
- 若仍無法使用，複製診斷資訊交給資訊人員。
```

stable code 保留於 Advanced / diagnostics。


---

## 16. 開發順序總表

| 階段 | 核心成果 | 是否改掃描結果 | 是否進 GUI | 是否改 schema | Release gate |
| --- | --- | --- | --- | --- | --- |
| Phase 0 | fixture + ingestion refactor | 否 | 否 | 否 | regression |
| Phase 1 | CLI render spike | opt-in 才會新增 discovery | 否 | 暫可內部診斷 | browser lifecycle |
| Phase 2 | network security / redirect / egress control | opt-in | 否 | 否/少量 | **安全 gate** |
| Phase 3 | report contract | opt-in | 否 | 是 | schema compatibility |
| Phase 4 | GUI / Analyzer / Persona usability | opt-in | 是 | 沿用 Phase 3 | UX / stop / Persona A task completion |
| Phase 5 | budget / performance / browser traffic pacing | opt-in | 是 | 可能補 summary | stability |
| Phase 6 | portable / release | 正式功能 | 是 | 固定 | **release gate** |
| Phase 7 | detection hint | 否 | 是 | diagnostics | false-positive |
| Phase 8 | auto fallback | 未定 | 未定 | 未定 | 延後評估 |

---

## 17. 建議版本策略

Dynamic Render 不建議進 patch release。

建議：

- `v1.1.x`：維持現行修正與小幅 UX / maintenance。
- 下一個 minor：納入 opt-in Dynamic Render。
- Auto Render、bundled browser、authenticated browsing 分別另行評估，不和第一版綁在一起。

正式版本號仍依專案 release policy 決定。

---

## 18. 開放問題

經架構檢視後，第一版不再保留過多「尚未決定」項目。已能由現有架構直接定案的部分移至 Architecture Decision / Implementation Contract；只有需要實機或安全測試才能回答的項目保留為 Open Question。

### OQ-1：Local Browser Compatibility

需要 Phase 1 / Phase 6 實測：

- `playwright-core` 使用 `msedge` / `chrome` channel 的 discovery、launch、context creation、navigation 成功率。
- Browser 已安裝但無法啟動時，實際錯誤是否能穩定映射到既定 diagnostics。
- Enterprise / managed Windows 環境對 launch / automation 的影響程度。

既定 diagnostics taxonomy：

```text
browser_available
browser_not_found
browser_launch_failed
browser_closed_unexpectedly
render_navigation_failed
render_navigation_timeout
```

Open 的不是 taxonomy，而是「實際 Playwright / OS error 如何可靠映射」。

### OQ-2：Unsafe-method Blocking Coverage Impact

第一版 Browser method policy 已定案：

```text
ALLOW:
  GET
  HEAD
  OPTIONS

BLOCK:
  POST
  PUT
  PATCH
  DELETE
  CONNECT
  TRACE
  other / unknown
```

需要 Phase 1 / Phase 2 fixture 與真實網站樣本回答：

- 有多少 CSR 網站依賴 POST GraphQL / API 才能建立主要 DOM link。
- 阻擋 unsafe method 後，Dynamic Render discovery coverage 下降多少。
- 是否有必要在未來設計更細緻的 explicit opt-in method policy。

第一版不因 coverage 不足而自動允許 unsafe method。

### OQ-3：DNS / SSRF Parity

這是 Phase 2 最高優先級安全問題。

需要驗證：

- `evaluateUrlSecurity()` 的 DNS/IP 判斷與 Browser 實際 request target 是否可能產生時間差或 resolution 差異。
- public hostname -> private / loopback / link-local / metadata IP 的 re-resolution / rebinding 情境。
- redirect、iframe、script、fetch、XHR 等子請求是否全部受同等 policy 約束。
- BrowserContext routing + Service Worker blocking + WebSocket blocking 是否足以形成 fail-closed security boundary。
- WebRTC、preconnect / dns-prefetch 等非典型 egress 是否可能突破 threat model。
- 是否存在 Browser request / connection 類型無法可靠 interception / validation。

若無法證明與既有 Node HTTP security policy 足夠一致，Dynamic Render 不通過 Phase 2。

### OQ-4：Render Settle Tuning

演算法已定案：

```text
DOMContentLoaded
  -> minimum settle floor
  -> URL-attribute signature stability samples
  -> hard max settle time
  -> page.content()
```

待測的是 tuning，不再重新選擇架構。

Phase 5 需決定：

- `renderSettleMinMs`。
- `renderSettleIntervalMs`。
- `renderSettleStableSamples`。
- `renderSettleMaxMs`。
- navigation timeout 與 settle timeout 是否應分開計數。

初始 development values：

```text
renderSettleMinMs = 1000
renderSettleIntervalMs = 250
renderSettleStableSamples = 3
renderSettleMaxMs = 2500
```

### OQ-5：Render Performance Budget

第一版基準：

```text
renderConcurrency = 1
```

Phase 5 benchmark 再比較：

```text
1 vs 2
```

並決定：

- 正式 `renderMaxPages`。
- `renderTotalBudgetMs`。
- `renderMaxLinksPerPage`。
- 是否需要 `renderMaxFailures` / `renderMaxSecurityBlocks`。

調整依據：

- elapsed time。
- CPU / memory。
- timeout rate。
- Browser stability。
- per-job BrowserContext 建立 / 關閉成本。
- 新增 URL discovery 效益。

### OQ-6：Browser Traffic / Rate-limit Parity

現有 `HostScheduler` 管理 Node HTTP checker 的 per-host concurrency / request delay；Browser render 會額外產生 document、script、stylesheet、image、fetch/XHR 等 requests，不能因 `renderConcurrency = 1` 就假設其 request burst 已符合既有 rate-limit。

Phase 1 起先蒐集：

```text
requestsStartedByHost
requestsFinishedByHost
peakInflightByHost
requestStartIntervals
resourceType
renderPage
```

Phase 5 必須決定第一版 browser request pacing policy：

- 是否需要建立 `BrowserRequestPacing`，把 route 中待放行的 HTTP(S) request 依 host 做 start pacing。
- 若要限制真正 in-flight concurrency，token 生命週期必須延續到 `requestfinished` / `requestfailed`，不能在 `route.continue()` 後立即視為完成。
- 是否沿用既有 `perHostConcurrency` / `requestDelayMs`，或為 Browser 設較保守且獨立的 limits。
- 若無法做到完全 parity，必須量化差異並在 GUI / docs 說明，不得宣稱 Browser traffic 與 Node HostScheduler 完全相同。

OQ-6 不屬 Phase 2 SSRF No-Go，但屬 Phase 6 前的 operational / politeness gate。

### 已關閉的原開放問題

以下已改為 Architecture Decision / Implementation Contract，不再阻塞第一個 Sprint：

1. **BrowserContext lifecycle**
   - 1 Browser / scan。
   - 1 fresh ephemeral BrowserContext / render job。
   - 1 Page / Context。
   - Context 完成即 close，不跨 page 保存 cookie / storage。

2. **Rendered DOM extraction**
   - MVP 固定採 `page.content()` + 既有 `extractLinks()`。
   - 已知限制另列，不在第一版擴充 Shadow DOM / iframe document / click-only router。

3. **Render evidence contract**
   - page-level `renderEvidence` 使用 additive evidence。
   - Browser / Playwright runtime metadata 放 `summary.dynamicRender`。
   - 不用 Browser result 覆蓋 HTTP truth。

4. **Stop behavior**
   - `LinkChecker.stop()` 同步呼叫 `DynamicRenderer.requestStop()`。
   - 主動 close BrowserContext，中止 active Page / navigation。
   - Phase 4 只需驗證 race conditions。

5. **第一版 Browser distribution**
   - `playwright-core`。
   - local `msedge` -> fallback `chrome`。
   - no bundled Chromium。

### Deferred Decision

以下不屬第一版 Open Question：

```text
project-managed / bundled Chromium
```

只有符合既定重新評估條件時才重新討論：

- local Edge / Chrome 相容性明顯不足。
- Enterprise launch failure rate 無法接受。
- Browser version drift 造成 regression 難以重現。
- portable 使用情境明確要求固定 Browser runtime。
- Browser binary 的 package / release 成本已有可接受方案。


### Open Question Evaluation Schedule

Open Question 不要求在 Phase 1 一次全部關閉。評估時程依「是否阻塞下一階段」安排，並使用固定欄位管理：

```text
Evaluate From
Decision By
Blocking Phase
Evidence Required
```

#### 評估總表

| Open Question | Evaluate From | Decision By | Blocking Phase | Evidence Required |
| --- | --- | --- | --- | --- |
| OQ-1 Local Browser Compatibility | Phase 1 | Phase 6 Release Gate | Phase 6 | Edge / Chrome launch、context、navigation、close、fallback、browser unavailable、managed environment smoke |
| OQ-2 Unsafe-method Blocking Coverage Impact | Phase 1 | Phase 2 結束 | Phase 3 | CSR fixture + 真實樣本中 POST / unsafe API 被阻擋後的 discovery coverage 與診斷 |
| OQ-3 DNS / SSRF Parity | Phase 2 開始 | **Phase 2 結束** | **Phase 3** | redirect、DNS resolution、private target、iframe/script/fetch/XHR、rebinding / TOCTOU、Service Worker interception fixture |
| OQ-4 Render Settle Tuning | Phase 1 蒐集 | Phase 5 結束 | Phase 6 | settle elapsed、signature stability、links observed / added、unsettled rate、不同 min / interval / stable samples / max settle 比較 |
| OQ-5 Render Performance Budget | Phase 1 蒐集 | Phase 5 結束 | Phase 6 | concurrency 1 vs 2、elapsed、CPU / memory、Context overhead、timeout、crash、stop latency、discovery yield |
| OQ-6 Browser Traffic / Rate-limit Parity | Phase 1 蒐集 | Phase 5 結束 | Phase 6 | per-host request count、peak in-flight、start interval、resource type、pacing policy benchmark |

#### 決策波次

```text
Phase 0
  |
  +-- 建立 fixtures
  +-- 建立 benchmark / diagnostics 欄位
  |
  v
Phase 1
  |
  +-- OQ-1 初步驗證
  +-- OQ-2 開始蒐集
  +-- OQ-4 開始蒐集
  +-- OQ-5 開始蒐集
  +-- OQ-6 開始蒐集
  |
  v
Phase 2
  |
  +-- OQ-2 第一版結論
  +-- OQ-3 Security Go / No-Go
  |
  v
Phase 3-4
  |
  +-- Report / GUI
  +-- 不重新打開已關閉的架構決策
  |
  v
Phase 5
  |
  +-- OQ-4 正式關閉
  +-- OQ-5 正式關閉
  +-- OQ-6 正式關閉
  |
  v
Phase 6
  |
  +-- OQ-1 Portable / Enterprise 最終驗證
  |
  v
Release Gate
```

#### OQ-1 評估時程：Local Browser Compatibility

**Evaluate From：Phase 1**

第一輪只需要回答：

> local Edge / Chrome 是否足以支持後續 Dynamic Render 與 Security Spike。

Phase 1 最低測試矩陣：

```text
Edge installed
Chrome installed
Edge + Chrome installed
No supported browser
Browser installed but launch failed
User stop during active render
```

每一情境至少記錄：

```text
browserChannel
browserVersion
launchOutcome
contextCreationOutcome
navigationOutcome
closeOutcome
sanitizedErrorCode
```

Phase 1 結論允許：

```text
provisionally_acceptable
```

不要求永久關閉 OQ-1。

**Decision By：Phase 6 Release Gate**

Phase 6 再執行：

- portable + Edge smoke。
- portable + Chrome fallback smoke。
- portable + no Browser smoke。
- managed / Enterprise Windows 可取得環境的 smoke。
- Browser installed but automation blocked / launch failed 的 diagnostic 驗證。

只有 Phase 6 通過，OQ-1 才標記 `closed`；若有不阻塞 release 的環境限制則使用 `closed_with_known_limitation`。

#### OQ-2 評估時程：Unsafe-method Blocking Coverage Impact

**Evaluate From：Phase 1**

Phase 1 就開始記錄：

```text
methodBlockedRequests
renderedPages
linksObserved
linksAddedToInventory
renderOutcome
```

至少建立：

- GET API CSR fixture。
- OPTIONS + GET CORS fixture。
- POST GraphQL / API fixture。
- mixed API fixture。

Phase 1 的目的不是決定是否放寬 policy，而是建立 coverage 差異。

**Decision By：Phase 2 結束**

第一版 policy 預設維持：

```text
ALLOW:
GET
HEAD
OPTIONS

BLOCK:
POST
PUT
PATCH
DELETE
CONNECT
TRACE
unknown
```

Phase 2 應回答：

- unsafe method 被阻擋時，report diagnostics 是否足以說明結果可能不完整。
- coverage 損失是否仍符合「補充 discovery」產品定位。
- 是否存在為了 coverage 而必須執行具副作用 request 的網站類型。

若 coverage 不足，但安全邊界合理：

```text
OQ-2 = closed_with_known_limitation
```

不要因此自動允許 POST。

#### OQ-3 評估時程：DNS / SSRF Parity

**Evaluate From：Phase 2 開始**

這是第一版最重要的 blocking Open Question。

測試順序建議：

1. literal localhost / loopback。
2. RFC1918 / private IP。
3. link-local。
4. metadata target。
5. public hostname resolve 到 private target。
6. HTTP redirect 到受限 target。
7. iframe / script / image 等 subresource。
8. fetch / XHR。
9. hostname DNS result 改變 / rebinding fixture。
10. Service Worker 已停用時 interception coverage。

每一 fixture 應證明：

```text
security decision
actual Browser request outcome
route action
final render outcome
diagnostic counter
```

**Decision By：Phase 2 結束**

Phase 2 必須產生明確結果：

```text
PASS
  -> 進入 Phase 3

FAIL_CLOSED_BUT_FIXABLE
  -> 留在 Phase 2 修正與重測

REPRODUCIBLE_SSRF_BYPASS
  -> NO-GO
  -> Dynamic Render 不進 Phase 3 / GUI
```

OQ-3 不允許以「已知限制」直接帶到 release。

Security Gate outcome 與 OQ status 對應：

```text
PASS                       -> OQ-3 = closed
FAIL_CLOSED_BUT_FIXABLE    -> OQ-3 = blocked
REPRODUCIBLE_SSRF_BYPASS   -> OQ-3 = no_go
```

#### OQ-4 評估時程：Render Settle Tuning

**Evaluate From：Phase 1**

使用既定 development defaults：

```text
renderSettleMinMs = 1000
renderSettleIntervalMs = 250
renderSettleStableSamples = 3
renderSettleMaxMs = 2500
```

Phase 1～4 持續累積：

```text
navigationMs
settleMs
renderElapsedMs
linksObserved
linksAddedToInventory
linksMergedIntoInventory
linksRejected
renderedUnsettled
```

**Decision By：Phase 5 結束**

Phase 5 才正式比較不同參數組合。

主要判斷指標：

```text
Discovery Yield
=
linksAddedToInventory / renderedPages
```

以及：

```text
additional discovery gain
vs
additional settle time
```

目標不是追求等待最久，而是找到 discovery gain 開始趨近飽和的位置。

若：

```text
1s -> 4.1 URLs/page
2s -> 7.8 URLs/page
4s -> 8.0 URLs/page
```

則 2 秒比 4 秒更合理。

Phase 5 結束後才將 tuning 值改為正式 default。

#### OQ-5 評估時程：Render Performance Budget

**Evaluate From：Phase 1**

第一版全程以：

```text
renderConcurrency = 1
```

作為 correctness / security baseline。

從 Phase 1 起記錄：

```text
totalScanElapsed
renderElapsed
renderedPages
timeoutPages
failedPages
linksAddedToInventory
browserCrashCount
stopLatency
```

若可低成本取得，再加：

```text
peakBrowserMemory
CPU observation
```

**Decision By：Phase 5 結束**

Phase 5 固定比較：

```text
renderConcurrency = 1
vs
renderConcurrency = 2
```

只有 `2` 同時符合下列條件才考慮改 default：

- total elapsed 有明顯改善。
- discovery 結果基本一致。
- timeout rate 沒有明顯惡化。
- Browser crash / launch stability 沒有惡化。
- memory / CPU 成本可接受。
- stop latency 可接受。

同一階段決定：

```text
renderMaxPages
renderTotalBudgetMs
renderMaxLinksPerPage
```

`renderMaxFailures` / `renderMaxSecurityBlocks` 僅在 benchmark 顯示必要時加入。

#### OQ-6 評估時程：Browser Traffic / Rate-limit Parity

**Evaluate From：Phase 1**

先做 telemetry，不急著在 render spike 前實作複雜 scheduler：

```text
requestsStartedByHost
requestsFinishedByHost
peakInflightByHost
requestStartIntervals
resourceType
```

**Decision By：Phase 5 結束**

比較至少：

```text
native browser scheduling
vs
browser request start pacing
```

若需要限制真正 in-flight concurrency，必須以 `requestfinished` / `requestfailed` 釋放 host token。

第一版需產出明確決策：

```text
OQ-6 = closed
```

或：

```text
OQ-6 = closed_with_known_limitation
```

後者必須量化 Browser traffic 與 Node HostScheduler 的差異，並在 GUI / CLI docs / release notes 說明。

#### Open Question Status 值

建議規劃與 PR checklist 使用固定狀態：

```text
open
collecting_evidence
provisionally_acceptable
closed
closed_with_known_limitation
blocked
no_go
deferred
```

避免只用：

```text
open / closed
```

因為 OQ-1 會經過 Phase 1 的 provisional 結論，再到 Phase 6 才正式 close。

#### PR / Phase Checklist 對應

Draft PR 中建議增加：

```text
Open Questions

[ ] OQ-1 Phase 1 initial compatibility evidence
[ ] OQ-1 Phase 6 final portable validation

[ ] OQ-2 method coverage evidence
[ ] OQ-2 first-release policy accepted

[ ] OQ-3 DNS / SSRF Security Gate PASS

[ ] OQ-4 settle benchmark completed
[ ] OQ-4 production defaults recorded

[ ] OQ-5 concurrency / budget benchmark completed
[ ] OQ-5 production defaults recorded

[ ] OQ-6 browser traffic telemetry collected
[ ] OQ-6 request pacing policy accepted
```

其中：

```text
OQ-3 PASS
```

是 Phase 3 前的硬性 Gate。

OQ-4 / OQ-5 / OQ-6 則是 Phase 6 前的穩定化 / operational Gate。


---

## 19. 第一個實作 Sprint 建議

第一個 Sprint **只完成 Phase 0 + Phase 1 最小範圍**：

1. 確認 `v1.1.1` release tag / commit 基線。
2. 從 `main` 建立 `feature/js-dynamic-scan`。
3. 建立 Draft PR，先放入 Phase checklist 與本規劃連結。
4. 建立 CSR / delayed / timeout / security / method fixture。
5. 抽出 `ingestDiscoveredLinks()`，獨立 commit 並確認 static regression。
6. 加入正式 dependency `playwright-core`，並建立 BrowserProvider spike。
7. 實作 lazy Browser lifecycle + single-flight launch。
8. 實作 `renderLimiter`；每個 render job 使用 fresh BrowserContext，完成即 close。
9. Context 建 Page 前設定 Service Worker / HTTP route / WebSocket / download policy。
10. 只 render 已成功取得的 same-origin HTML page，並限制 main-frame origin / redirects。
11. 使用 `DOMContentLoaded` + minimum settle floor + URL-attribute signature stability。
12. `page.content()` 後做 challenge / size guard，再重用 `extractLinks()`。
13. runtime URL resolve 使用 `getDocumentBaseUrl(renderedHtml, page.url())`。
14. `sourceType = "rendered_dom"`，先以 internal source / inventory / targeted test 證明 provenance；正式 `checked[].discovery.sourceTypes[]` production schema 留到 Phase 3。
15. 先以 internal stats / verbose event 驗證，不急著完成 GUI。
16. 開始蒐集 OQ-6 Browser request burst / per-host telemetry。
17. 驗證 scan stop / limiter queue drain / timeout / browser unavailable 都能正常收斂。

**第一個 Sprint 不應同時處理 GUI、Analyzer、portable bundling、auto-render、browser cache。**

但 internal naming 與 diagnostics code 從一開始就應保持「技術名稱與使用者名稱分離」：

```text
internal: Dynamic Render / rendered_dom / browser_not_found
user-facing: 加強檢查動態網頁 / 動態網頁取得 / 無法使用動態網頁加強檢查
```

避免 Phase 4 才發現 technical term 已滲入 report / GUI contract。

完成後再進 Phase 2 Security Gate。

---

## 20. 技術決策紀錄：Playwright Core

### 決策

```text
Decision: Adopt playwright-core
Status: Accepted
Scope: Dynamic Scan first release
```

### 固定事項

- 使用 `playwright-core`，不改採完整 `playwright` 作為第一版 runtime dependency。
- 第一版不 bundled Chromium。
- BrowserProvider 先嘗試 `msedge`，再嘗試 `chrome`。
- Browser unavailable / launch failed 為 Dynamic Render warning，不是 scan fatal error。
- 不使用使用者既有 Browser profile。
- 每 scan 使用一個 Browser instance；每個 render job 使用 fresh ephemeral BrowserContext + Page，完成即 close。
- MVP 使用 `page.content()` + existing `extractLinks()`，runtime resolve fallback base 使用 `page.url()`。
- Browser method policy 僅允許 GET / HEAD / OPTIONS；WebSocket 預設阻擋。
- main-frame 不離開 crawl origin，redirect chain 受 `maxRedirects` 約束。
- 不以 Browser navigation result 覆蓋既有 HTTP status truth。
- Playwright Browser request 仍受 URL security policy 與 method policy 約束。

### 重新評估觸發條件

只有以下條件之一成立時，才重新評估 Browser distribution：

- local Edge / Chrome 相容性明顯不足。
- Enterprise environment launch failure rate 無法接受。
- Browser version drift 導致 Dynamic Scan regression 難以重現。
- portable 使用情境明確要求固定 Browser runtime。
- project-managed Chromium 的 release / size 成本已有可接受方案。

重新評估 Browser binary distribution，不等於重新評估 `playwright-core` 本身；即使未來 bundled Chromium，仍優先維持 BrowserProvider + `playwright-core` 架構。

---

## 21. 成功條件

第一版 Dynamic Render 可以視為成功，必須同時符合：

- Static scan 預設行為不變。
- CSR fixture 的 runtime URL 可以進 inventory。
- Browser 發現的 URL 使用既有 HTTP checker 驗證。
- Browser 不覆蓋 HTTP truth。
- Browser request 不突破既有 URL security policy。
- Phase 2 已驗證 redirect / subrequest / DNS resolution 情境沒有可重現的 SSRF bypass。
- Browser network policy 僅允許 HTTP 語意上的 safe methods（GET / HEAD / OPTIONS）；文件不宣稱能防止伺服器錯誤實作造成的 GET-side effect。
- 不使用登入 profile。
- Browser failure 不拖垮 scan。
- WebSocket 與其他 Browser egress channel 已依 Phase 2 threat model 處理，沒有可重現的 policy bypass。
- main-frame origin / redirect limit 不因 Browser render 被突破。
- stop / timeout 可正常清理 Browser，且 queued render jobs 不會在 stop 後繼續執行。
- Browser 額外 request traffic 已完成 OQ-6 評估，不會被誤宣稱為與 Node HostScheduler 完全相同。
- report 能清楚說明 Dynamic Render 是否啟用、成功多少、失敗多少、增加多少 discovery。
- GUI 能讓一般使用者理解這是「補充掃描」，不是「保證完整掃描所有 JavaScript 網站」。
- Persona A 不理解 HTTP / SPA / JavaScript / Playwright 仍能完成核心掃描任務。
- Persona A 遇到 warning 時能理解「發生什麼、影響什麼、下一步做什麼」。
- Persona B 可取得進階控制與完整 evidence。
- Persona C 可透過 sanitized diagnostics 接手 troubleshooting。
- GUI、SOP、Help、Analyzer 對同一功能使用一致的使用者用詞。
- portable 在沒有 Browser 的環境仍可正常執行原本 static scan。
- Dynamic Scan 全程在獨立 feature branch 開發，通過 regression / security / portable gate 後才 merge 回 `main`。
- 正式 release tag、source commit、portable artifacts、manifest 與 SHA256 可互相追溯。

---

## 22. 延後項目

以下項目明確延後：

- 自動點擊選單 / load more。
- infinite scroll。
- authenticated scan。
- CAPTCHA / WAF bypass。
- POST API 自動允許。
- WebSocket 動態內容支援（第一版預設阻擋）。
- Browser session persistence。
- screenshot / trace / HAR。
- render cache。
- bundled Chromium。
- 多瀏覽器 cross-engine scan。
- auto render fallback。
- Browser 作為 HTTP validation replacement。

以上項目若未來需要，應各自重新建立安全、隱私、效能與 report contract 設計，不直接塞入第一版 Dynamic Render。

---

## 23. Codex Execution Layer

本文件是 Dynamic Scan 的 **Product / Architecture / Security / UX Source of Truth**。若由 Codex 或其他 coding agent 執行實作，不應只用一句「依本文件完成開發」一次處理 Phase 0～Phase 6，而應搭配 repo-level execution layer。

正式執行文件：

```text
AGENTS.md
  -> repo-wide Codex instructions / safety / validation / Git boundary

docs/codex/DYNAMIC_SCAN_EXECUTION.md
  -> 共用執行流程、驗證矩陣、完成回報格式

docs/codex/tasks/
  -> 一次只執行一個 well-scoped task packet
```

### 23.1 權威順序

若文件內容衝突，依下列順序處理：

```text
1. 本規劃中的 Accepted Architecture Decision / Security Gate / No-Go 規則
2. repo 根目錄 AGENTS.md
3. 當前 task packet 的 scope / acceptance criteria
4. DYNAMIC_SCAN_EXECUTION.md 的一般執行流程
```

操作者當次明確指令可以縮小工作範圍，但不得在沒有新安全評估與決策紀錄的情況下，默默放寬本規劃已接受的安全邊界。

### 23.2 Codex 工作粒度

Phase / Sprint 是工程治理單位，不直接等於單一 Codex task。

第一輪 task packets：

```text
P0-01 Core Dynamic Fixtures
P0-02 Risk / Boundary Fixtures
P0-03 Unified Discovery Ingestion Refactor
P1-01 playwright-core + BrowserProvider
P1-02 DynamicRenderer Lifecycle
P1-03 Rendered DOM Discovery Integration
P1-04 Browser Boundary Hooks / Telemetry
P1-05 Stop / Timeout / Failure Convergence
P1-06 Phase 1 Evidence + Spike Decision
```

每個 task 完成並通過自己的 acceptance criteria 後才進下一個 task；不得為了「一次完成整個 Phase」自行擴大修改範圍。

### 23.3 Codex 不得自行決定的事項

Codex 可以：

- 實作 instrumentation。
- 建立 fixture。
- 執行可用的自動化測試。
- 蒐集 evidence。
- 根據 evidence 提出 Open Question 建議結論。

Codex 不得：

- 用假設關閉 Open Question。
- 為了讓測試通過而弱化 SSRF / method / origin / profile 等安全政策。
- 自行把 Deferred scope 拉進第一版。
- 自行改變 Accepted Architecture Decision。
- 把環境無法執行的 Windows / Enterprise / Persona usability 驗證標成 PASS。
- 在未獲明確授權時對任意外部或政府網站做測試掃描；預設只使用本機可控 fixture。

### 23.4 Environment-dependent evidence

Codex 執行環境不一定具備 Windows、Edge、Chrome、Enterprise policy 或真人 usability test 條件。

因此所有 Gate 證據必須區分：

```text
AUTOMATED_PASS
LOCAL_FIXTURE_PASS
ENV_BLOCKED
HUMAN_WINDOWS_REQUIRED
HUMAN_USABILITY_REQUIRED
```

`ENV_BLOCKED` 不等於 FAIL，也不等於 PASS；必須留待指定環境補驗。

### 23.5 文件維護

將這組 execution files 放入正式 repo 時：

- `AGENTS.md` 放 repo root。
- `DYNAMIC_SCAN_EXECUTION.md` 與 task packets 放 `docs/codex/`。
- 同步更新既有 `docs/README.md` 索引。
- 已完成 task 的長篇 evidence / spike result 可依既有文件分層移至 `docs/archive/`，但 active task packet 保留在 `docs/codex/tasks/`。

