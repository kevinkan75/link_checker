# 2026-07-18 Project Assessment

狀態：近期專案評估與產品定位校準紀錄。現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，使用入口請看 [../../README.md](../../README.md)。

本紀錄保存 2026-07-18 對 Local Link Checker 的完整專案評估結果。評估重點是目前可交付狀態、測試健康度、下一階段 P9c-2 的切入點，以及短中期風險。

## 結論

專案目前狀態穩定，核心掃描器、GUI、Analyzer、report diff、TTL cache、incremental scan、NDJSON sidecar 與 rules schema 都已形成可延續的基線。下一步建議維持 Roadmap 方向，優先做 P9c-2 Rules 追溯欄位，不建議現在重寫掃描核心或改變 `report.json` 主契約。

## 產品定位校準

2026-07-18 補充產品定位：本專案是本地端、低門檻、輔助型的無效連結檢測工具，主要提供給政府機關承辦人員使用。它不是要取代機關既有 CMS、網站維運流程、稽核系統或正式監控平台，而是協助承辦人快速盤點可能的壞連結、外部連結與需人工複核的狀態。

因此，後續功能應以「清楚、保守、可交辦」為核心：

- GUI 優先於 CLI 完整性；CLI 保留進階用途即可。
- 報告應協助承辦人判讀，不替承辦人做不可逆或過度自動化的結論。
- `403`、`429`、WAF、timeout、外站限制等應標示為需人工確認，不直接歸入明確壞連結。
- 匯出格式、來源頁、問題類型、建議處理與人工複核欄位，比平台化 dashboard 更重要。
- 掃描預設應保守，避免造成機關網站或外部網站壓力。
- 常駐 scheduler、平台化監控、複雜規則系統與 headless render 預設化都應保持延後或避免。

## 已驗證項目

- 17 個 `test-*.mjs` 回歸測試全部通過。
- 主要 `.mjs` 與 `public/*.js` 全部通過 `node --check` 語法檢查。
- `node .\link-checker.mjs --help` 與 `node .\report-diff.mjs --help` 可正常執行。
- 本機端到端煙霧測試通過：以臨時 HTTP server 建立首頁、正常頁與 404 頁，`LinkChecker` 可掃描 3 個 URL 並辨識 1 個壞連結。

## 專案優勢

- 安全邊界成熟：預設阻擋 localhost、private IP、metadata IP 與非 HTTP(S) scheme，redirect 後也會重新檢查目標。
- 回歸測試覆蓋主線風險：redaction、body/source limit、robots / compliance、Retry-After、SSRF / security policy、cache、incremental、sitemap、GUI artifacts、NDJSON import、rules schema 與 report diff。
- Report 契約方向清楚：`report.json` 是主契約，NDJSON sidecar 是大型報告輔助，不取代主格式。
- GUI / Analyzer 已完成 P9a 與 P9b 第一版，包含進度語意、空狀態、手機可讀性、大檔提示、列表分批載入與 NDJSON 匯入。
- 前端大多使用 DOM API 與 `textContent` 呈現使用者資料，少量 `innerHTML` 主要用於固定空狀態字串。

## 主要風險

### 1. Rules URL 載入未套用掃描安全政策

`--domain-rules`、`--external-risk-rules`、`--site-link-rules` 支援 `file-or-url`，但目前 rules URL 載入使用直接 `fetch()`。主掃描請求已套用 URL security policy；rules 載入尚未同等套用 private / metadata IP 防護、redirect 目標檢查、timeout 與大小限制。

此風險目前不算立即阻斷，因為 rules URL 主要由本機操作者明確指定，且 GUI 尚未提供 rules URL 欄位。但 P9c-2 會處理 rules metadata，建議同時補上 rules loader 的安全化，避免日後擴充 GUI 或批次流程時留下隱性風險。

### 2. 大型單檔造成維護壓力

`link-checker.mjs` 約 7,600 行，`gui-server.mjs` 約 1,400 行，三個前端 analyzer / app 檔案也都超過 1,100 行。短期不需要重寫，但中期應優先抽出邊界清楚的模組，例如 rules loader、report builder、security policy、output artifacts。

### 3. 缺少標準測試入口

目前沒有 `package.json` 或單一 test runner。測試仍可逐檔執行，但對 CI、交接、portable build 前 smoke test 不夠方便。建議新增最小測試入口，例如 `node test-runner.mjs` 或 `package.json` scripts。

### 4. Schema 是最低穩定契約，不是完整強約束

`schemas/report.schema.json` 多處保留 `additionalProperties: true`，這有利於演進，但 P9c-2 新增 `rulesVersion`、rules fingerprint 或 source metadata 時，應搭配 golden fixture 與 regression test，避免欄位語意漂移。

## 建議 P9c-2 範圍

P9c-2 建議收斂成三個交付：

1. 在 report 中加入 rules 追溯欄位，例如 `rulesVersion`、rules source metadata、content fingerprint、loadedAt、rule counts 與 load warnings。
2. 將 rules URL 載入安全化，套用與主掃描一致的 URL security policy、redirect 檢查、timeout、content length / body size limit 與清楚錯誤訊息。
3. 補測試：rules metadata fixture、rules URL blocked cases、local file rules metadata、既有 P9c-1 schema regression。

## 未來規劃：整站無效連結檢測策略

此項目先記錄為未來規劃，現在不排入 P9c-2 實作。完整整站無效連結檢測不應只依賴 HTTP status，而應整合 URL 發現、狀態檢查、來源追溯、誤判分級與增量監控。

建議的長期策略：

1. 以 crawl-based 掃描作為主流程，從起始頁抽取 HTML、資源、同站頁面與外部連結，保留每個壞連結的來源頁。
2. 搭配 sitemap-based 掃描補足頁面清單，特別是大型網站、SEO 頁面與有 `lastmod` 的增量判斷。
3. 對 SPA / CMS 使用 rules 檔推導 payload 內的 route、外部 URL 或特定欄位，不把站台邏輯硬寫進 crawler。
4. 對 `404 / 410` 做二次確認；對 `403 / 429 / WAF / timeout` 以 `needs_review` 或診斷分類處理，避免直接判定為壞連結。
5. 透過 cache 與 incremental state 做定期掃描，優先重查新增、變更、過期、曾失敗或 redirect 不穩定的 URL。
6. 外部連結治理應與站內壞連結分開呈現，保留 domain 分類、allowlist / blocklist / watchlist 與風險理由。
7. Headless browser / render 掃描只作 opt-in fallback，用於 SPA 或 JS 動態產生連結，避免預設增加資源消耗與 bot 偵測風險。

優點：

- 覆蓋站內頁面、外部連結、資源、SPA payload、sitemap 與長期狀態變化。
- 可追溯壞連結來源頁，方便修復。
- 適合政府網站、內容網站與大型站台的持續治理。
- 增量掃描可降低重複請求與 WAF / 429 風險。

限制：

- 無法保證 100% 覆蓋孤兒頁、登入後頁面或高度動態頁面。
- 外站狀態容易受 WAF、CDN、bot protection、rate limit 影響，誤判率高於站內連結。
- Headless render 成本高，不適合預設啟用。
- 若 request rate 與 robots / authorization policy 設計不當，可能造成對方網站壓力或治理風險。

未來若要實作，建議放在 P10 或 P10 之後，作為「治理與分級排程」的一部分，而不是在 P9c-2 前插入。

依產品定位重新評估後，此項目不應發展成大型治理平台。若未來要做，應以本地輔助為界線，優先改善承辦人可直接使用的分類與匯出：

1. 明確壞連結、可能失效、需人工確認、外站限制、已轉址但仍可用、頁內跳轉失效。
2. CSV / Excel 欄位使用業務語言，例如來源頁、問題網址、問題類型、建議處理、是否需人工確認。
3. GUI 提供少量一鍵模式，例如一般檢查、保守檢查、外部連結盤點。
4. Fragment / anchor 檢查與 duplicate anchor 檢查可作為頁面品質提醒，優先度高於 headless render 或 scheduler。

不建議在近期推動常駐監控、完整 scheduler、平台化 dashboard、取代既有工具的治理流程，或需要承辦人維護複雜規則檔的功能。

## 延後項目

- 完整重構 crawler。
- `report.json` streaming parser。
- CLI sidecar 邊跑邊 append。
- GUI rules URL 表單。
- profile presets。
- Next.js `__NEXT_DATA__` 專用 parser。
- 整站無效連結檢測策略強化：crawl + sitemap + rules + incremental + 外部治理 + opt-in render 的混合模式。
- 常駐 scheduler / 平台化監控。
- 複雜 suppress rules 或過度自動化治理流程。

這些項目仍有價值，但不應先於 P9c-2 的 rules 追溯與安全基線。

## 重新排序後的近期建議

1. P9c-2：rules 追溯與 rules URL 載入安全化。
2. 報告判讀改善：明確壞連結、需人工確認、外站限制、已轉址、頁內跳轉失效等分類。
3. CSV / Excel 交辦友善輸出，補來源頁、建議處理與人工複核欄位。
4. Fragment / anchor 檢查。
5. GUI 一鍵模式簡化：一般檢查、保守檢查、外部連結盤點。
6. Duplicate anchor 檢查，作為頁面品質提醒。
7. 其他大型站、SPA、streaming、scheduler 與平台化能力保持延後。
