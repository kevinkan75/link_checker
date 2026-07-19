# 開發路線圖

本文件是 Local Link Checker 的主線導航。它用來回答三件事：

1. 現在做到哪裡。
2. 下一步做什麼。
3. 哪些方向暫時不要做，避免偏離本地輔助工具定位。

已完成里程碑的細節請看 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)，技術規格請看 [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)，2026-07-18 完整專案評估請看 [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md)。

## 目前狀態

- P0-P8 已完成第一版。
- P9a 已於 2026-07-17 驗收通過；不要再把 P9a-1 當成下一個起點。
- P9 已於 2026-07-18 整體驗收；P9a、P9b 與 P9c 都已完成第一版並通過現有測試。
- P9b-1 到 P9b-4 已驗收，包含 GUI log artifacts、NDJSON sidecar、GUI complete payload 瘦身、大檔提示、列表「載入更多」與 NDJSON 匯入。
- P9c-1 / P9c-2 已驗收，包含 rules schema、root `rulesTrace`、rules fingerprint、source metadata、大小限制、redirect 檢查與 URL security policy。
- 目前主線為 P10：報告判讀與交辦友善強化；P10a / P10b / P10c 已完成。
- P10 完成並驗收後，可進入正式版 release gate；P11 應定位為發布前 hardening / packaging 檢查，不再新增大型產品功能。
- 2026-07-19 已確認 P10d 先不實作；P10a / P10b / P10c 已通過 P10 專用測試、全回歸測試與語法檢查。P11 建議拆成 release gate 檢查批次，供後續追查與執行。
- P9c 的定位是補齊 rules 信任基線：讓報告可追溯、讓 URL rules 載入安全；不是建立複雜規則平台，也不是重構 crawler。
- 產品定位已校準為本地端、低門檻、輔助型工具，主要提供政府機關承辦人員使用，不取代 CMS、維運流程、稽核系統或正式監控平台。

## 產品定位護欄

Local Link Checker 的目標是讓承辦人能在本機輸入網址、保守掃描、下載可讀且可交辦的檢查結果。後續規劃必須符合以下原則：

- GUI 優先，CLI 保留進階用途即可。
- 結果應協助判讀，不替承辦人做不可逆或過度自動化的結論。
- `403`、`429`、WAF、timeout、外站限制等結果應標示需人工確認，不直接視為明確壞連結。
- 輸出應適合交辦與存查，CSV / Excel 友善欄位比平台化 dashboard 更重要。
- 預設掃描應保守，避免造成機關網站或外部網站壓力。
- 避免常駐 scheduler、平台化監控、取代既有維運工具、過度自動化決策，以及會增加承辦人操作負擔的複雜規則系統。
- 可借鏡 W3C Link Checker 的 fragment / anchor 檢查、duplicate anchor 檢查與保守 request policy，但不以取代 W3C 或建立大型治理平台為目標。

## 近期主線

### 1. P9c-2：Rules 追溯與載入安全

**狀態：** 已完成第一版  
**目標：** 讓 report 能追溯使用了哪些 rules，並讓 rules URL 載入套用與主掃描一致的安全邊界。

重新評估結論：

- P9c-1 已解決「規則檔格式」問題；P9c-2 應聚焦「這次用了哪份規則」與「規則來源是否安全」。
- 目前 report 只保存 rules source 字串，還不足以支援存查、複核與跨次比對。
- P9c-2 已補上 root `rulesTrace`，讓 report 可保存規則來源、版本、fingerprint、byte size、rule count、loadedAt 與 warnings。
- rules URL 載入已改為安全 loader，套用 URL security policy、redirect 目標檢查、timeout、content length / body size limit 與清楚錯誤訊息。
- P9c-2 是信任基線修補，不是功能擴張；實作以 rules loader / metadata helper 為界，不啟動 crawler 大重構。

已交付：

- report 新增 root `rulesTrace` 欄位。
- 每類 rules 記錄是否啟用、source type、source path / URL、loadedAt、content hash / fingerprint、byte size、rule counts 與 load warnings。
- rules URL 載入安全化：URL security policy、redirect 目標檢查、timeout、content length / body size limit、清楚錯誤訊息。
- 回歸測試：`test-p9c2-rules-trace.mjs`、local file rules metadata、rules URL blocked cases、rules fingerprint 穩定性、既有 P9c-1 schema regression。

不納入：

- GUI rules URL 表單。
- profile presets。
- Next.js `__NEXT_DATA__` 專用 parser。
- 大型重構 crawler。
- 複雜 suppress rules 或規則治理平台。

實際效益：

- 承辦人與協助人員可以從 report 判斷這次結果套用了哪份規則，方便存查、交辦與日後複核。
- 規則內容 fingerprint 可支援跨次比對，避免「同一來源檔案但內容已變更」造成判讀混亂。
- rules URL 安全化可避免日後開放 GUI 或批次使用時誤讀內網、localhost、metadata IP 或不可信 redirect。
- 小步抽出 rules loader 能降低後續維護成本，但不改變既有 crawler 行為。

### 2. P10：報告判讀與交辦友善強化

**狀態：** P10a / P10b / P10c 已完成，P10d optional
**目標：** 讓承辦人更容易判斷哪些要修、哪些要人工確認、哪些只是外站限制或已知轉址。
**階段定位：** P10 是正式版前的最後一個產品功能主線；P10 完成並驗收後，專案可進入正式版 release gate。

重新評估結論：

- P10 應收斂為「報告判讀與交辦友善強化」，不是整站治理平台、排程系統或正式監控工具。
- 舊規劃中的整站檢測策略應只保留對承辦人有直接幫助的小步分類、呈現與匯出改善。
- P10 不應擴大為取代 CMS、維運流程、稽核系統、W3C Link Checker 或監控平台。
- P10 的驗收重點應是「承辦人是否更容易看懂、交辦、複核」，而不是「工具是否能自動治理整個網站」。
- P10 完成後不再新增大型功能；正式版前只做 release hardening、package smoke test、manifest / checksum、文件與版本檢查。

建議交付：

- 更清楚的結果分級：明確壞連結、可能失效、需人工確認、外站限制、已轉址但仍可用；頁內跳轉失效僅作 optional 品質提醒。
- CSV / Excel 交辦友善欄位：來源頁、問題網址、問題類型、建議處理、是否需人工確認。
- GUI 摘要用業務語言呈現，不要求使用者理解所有 HTTP / WAF 細節。

建議切分：

| 階段 | 名稱 | 內容 |
| --- | --- | --- |
| P10a | 判讀分類基線 | 定義 report / GUI / CSV 共用的人工可讀分類 |
| P10b | 交辦欄位 | 補 CSV / Excel 友善欄位與建議處理文字 |
| P10c | GUI 摘要改善 | 用承辦人語言呈現要修、要確認、可先忽略的結果 |
| P10d | 頁內品質檢查 | Optional；Fragment / anchor 與 duplicate anchor，作為提醒類別 |

P10a 評估紀錄：

- 結論：P10a 應優先做，屬於 P10 的核心地基。它不是新增掃描能力，而是把現有 `issueType`、`classification`、`confirmation.outcome`、redirect labels 與 `externalRisk` 等技術訊號，統一翻譯成 report / GUI / CSV 共用的人讀分類契約。
- 建議新增 additive 欄位，例如每筆 `checked[]` / `broken[]` 補 `interpretation`，包含 `category`、`label`、`severity`、`action` 與 `needsManualReview`。同時在 `summary` 補 `interpretationByCategory`，供 GUI 摘要與 CSV 欄位使用。
- 建議分類 vocabulary：
  - `action_required`：明確壞連結，例如二次確認後仍為 `404 / 410`，或 redirect 最終到錯誤頁。
  - `likely_problem`：可能失效，例如其他 `4xx / 5xx`，但尚未達高信心確認。
  - `needs_review`：需人工確認，例如 `403`、`429`、WAF / Bot、timeout、network error、TLS 問題。
  - `external_limited`：外站限制，例如外部網站拒絕、限流或防護阻擋；不直接算明確壞連結。
  - `redirect_ok`：已轉址但仍可用，可視情況更新為 final URL。
  - `ok`：正常、允許清單或低風險資訊。
  - `page_quality_notice`：頁內品質提醒，留給 P10d 的 fragment / duplicate anchor，不混入壞連結主清單。
- 優先順序規則：
  - `confirmation.outcome === "confirmed_missing"` 優先判為 `action_required`。
  - redirect 到錯誤、redirect loop、too many redirects 判為需處理。
  - `403`、`429`、WAF / Bot、timeout、network error 與 TLS 問題不得稱為明確壞連結，應歸為 `needs_review` 或 `external_limited`。
  - redirect 成功但 final URL 不同，判為 `redirect_ok`。
  - 外部風險分類只輔助判讀，不覆蓋明確 HTTP 結果。
- 驗收標準：
  - 同一筆結果在 report、GUI、CSV 使用同一個人讀分類。
  - `403`、`429`、WAF / Bot、timeout 不會被歸成明確壞連結。
  - `404 / 410` 搭配二次確認後能區分「確認不存在」與「需人工確認」。
  - redirect 成功與 redirect 到錯誤能分開。
  - 新欄位維持 additive，不破壞舊 report、Analyzer 或 report diff。

P10a 實作紀錄：

- 狀態：核心 report 契約已完成。每筆 `checked[]` / `broken[]` 會補上 additive `interpretation`，包含 `category`、`label`、`severity`、`action` 與 `needsManualReview`。
- `summary.interpretationByCategory` 已加入報告輸出與 schema，GUI 摘要會優先使用正式 summary 欄位；若讀到舊報告，仍會以既有 technical breakdown fallback 推導。
- 分類規則已落地：已確認的 `404 / 410` 與 redirect 到錯誤頁歸為 `action_required`；同站 `403 / 429 / timeout / WAF / Bot / network error` 歸為 `needs_review`；外站限制歸為 `external_limited`；成功轉址歸為 `redirect_ok`。
- 已新增 `test-p10a-interpretation.mjs` 覆蓋站內 404、站內 403、429、成功轉址、轉址到錯誤頁與外站 403。
- CSV / Excel 交辦友善欄位已由 P10b 完成，並直接使用同一個 `interpretation` 契約，避免另做一套分類。

P10b 評估與實作紀錄：

- 結論：P10b 應採用，且應列為 P10a 後的優先項。它不新增掃描能力，而是把 P10a 的判讀結果變成承辦人可直接用 Excel 篩選、交辦與存查的欄位。
- 實作範圍應收斂為 `broken.csv` 的交辦友善輸出，不擴大成派工平台、審核流程或 dashboard。
- `broken.csv` 已在前段新增交辦欄位：`判讀分類`、`建議處理`、`是否需人工確認`、`優先度`、`問題網址`、`來源頁`、`連結文字`、`HTTP 狀態`、`技術原因`、`最終網址`、`確認結果`、`檢查時間`。
- 原本技術欄位仍保留在後段，維持向後追查能力；新增欄位直接使用 `interpretation`，缺少舊報告欄位時才 fallback。
- 已新增 `test-p10b-broken-csv.mjs`，驗收 BOM、CRLF、交辦欄位順序、P10a 判讀文字、final URL、來源頁與敏感 query 遮罩。

P10c 評估紀錄：

- 結論：P10c 應採用，作為 P10 的收尾項之一。它的價值不是新增掃描能力，而是把 P10a / P10b 的判讀分類帶到使用者每天看的畫面、Analyzer 與文件語言裡。
- 主 GUI 已大致符合 P10c 方向：主畫面已使用「需判讀結果」、「判讀分類」、「需處理」、「需人工確認」、「外站限制」、「可能失效」、「已轉址仍可用」等承辦人語言，也已在明細中顯示「建議處理」。
- 尚未完全同步的範圍是 Report Analyzer 與 README：Analyzer 仍多處使用「壞連結」與 `issueType` 技術分類；README 仍有 `404 / 403 / 429` 技術導向說明，應補成以判讀分類為主、HTTP 狀態為輔。
- 建議實作範圍只做語言與呈現同步：Analyzer 優先顯示 `interpretation.label`、`interpretation.action` 與 `interpretation.needsManualReview`；README 補判讀分類表；technical spec 補 GUI / Analyzer 應優先顯示 interpretation。
- 不納入 P10c：新的 dashboard、派工流程、複雜技術型 profile presets、Analyzer 大型重構、report 契約變更。

P10c 實作紀錄：

- 狀態：已完成。Report Analyzer 已改用「待判讀結果」、「判讀分類」與 `interpretation` 優先呈現；`issueType` 保留為技術原因與追查輔助。
- Analyzer 篩選、排行、明細 badge、建議處理與匯出 CSV 已改以 `interpretation.label`、`interpretation.action`、`interpretation.needsManualReview` 為主；舊報告缺少 `interpretation` 時仍會 fallback 推導。
- README 已補判讀分類表，將 `404 / 403 / 429` 等 HTTP 狀態調整為輔助技術原因，而非主要使用者分類。
- Technical spec 已明確規定 GUI 與 Report Analyzer 應優先顯示 `interpretation`。
- 已新增 `test-p10c-report-analyzer-language.mjs`，驗收 Analyzer 判讀語言、CSV 前段交辦欄位、README 判讀分類表與 technical spec interpretation-first 規則。

Profile presets 決策紀錄：

- 結論：不需要再大幅簡化，也不應擴張。主 GUI 維持少量、可理解的掃描模式即可。
- 保留 `標準保守` 作為預設，符合承辦人接獲正式清查指令後，需要產出可回報結果的主要情境。
- 保留 `快速掃描`，供小站或初步檢查使用，固定為較輕量的 `100` 頁 / 深度 `2`，但文案需持續提醒較容易遇到 `403`、`429` 或 timeout。
- 保留 `更保守`，供政府網站、防護較強網站、容易 timeout 的站使用，沿用正式清查頁數但降低單一 host 併發與增加延遲。
- `還原預設` 可保留，定位為重設操作，不視為新的 profile。
- 不新增 `government-conservative`、`large-site`、`blog-scan`、`external-governance`、`spa`、`audit`、`deep scan` 等技術型 profile；網誌清查需求以頁數建議與說明文字處理，不做成新 profile。

GUI 預設掃描數值執行紀錄：

- 已採用承辦人正式清查情境作為主 GUI 預設，而不是以快速試掃作為預設。
- `標準保守` / `balanced` 預設固定為 `300` 頁、深度 `3`、全站併發 `6`、單一 host 併發 `2`、固定延遲 `1000ms`、重試 `1` 次。
- `快速掃描` / `fast` 明確固定為 `100` 頁、深度 `2`、全站併發 `12`、單一 host 併發 `4`、固定延遲 `500ms`，定位為初步試跑，不作為正式清查預設。
- `更保守` / `conservative` 沿用 `300` 頁、深度 `3`，並降低單一 host 併發到 `1`、使用 `2000-5000ms` 隨機延遲、瀏覽器 User-Agent 與 `GET` 優先，供容易 `403`、`429` 或 timeout 的網站使用。
- CLI 核心預設目前仍維持 `100` 頁，避免無預警改變既有 CLI 使用者行為；若後續要讓 CLI 也對齊正式清查情境，需另行評估並記錄。
- 後續不得未經重新評估就把主 GUI `標準保守` 預設改回 `100` 頁 / 深度 `2`，以免偏離本專案協助承辦人完成正式無效連結清查並回復上級的主旨。

2026-07-18 重新檢視 P10：

- P10 方向正確，且 P10a / P10b / P10c 已完成；主 GUI 與 Report Analyzer 已採用承辦人判讀分類與較保守的掃描模式。
- P10a：核心契約已完成，report / schema / GUI 可共用 `interpretation` 與 `interpretationByCategory`；CSV / Excel 欄位串接留給 P10b。
- P10b：已完成 `broken.csv` 交辦友善欄位，直接使用 P10a `interpretation` 契約；後續只需視需要讓 Analyzer 匯出也同步同欄位。
- P10c：已完成。主 GUI、Report Analyzer、README 與 technical spec 已同步使用判讀分類與交辦語言。
- P10d：維持 optional。Fragment / anchor 與 duplicate anchor 有價值，但不應阻擋 P10a-c 完成後進入 release gate。
- GUI 掃描模式目前已足夠，不應擴大成複雜技術型 profile presets 或把所有 CLI 參數搬進 GUI。
- P10 接下來可進入 release gate；P10d 僅保留 optional，不列為 release gate 阻擋項，除非後續另行評估採用。

與舊規劃比對：

| 項目 | 重新評估 |
| --- | --- |
| 報告判讀分類 | 保留，列為 P10 核心 |
| 人工複核欄位 | 保留，列為 P10 核心 |
| CSV / Excel 交辦欄位 | 保留，最符合政府承辦人需求 |
| Fragment / anchor 檢查 | 保留，但定位為頁面品質提醒 |
| Duplicate anchor 檢查 | 保留，但不要混入明確壞連結主清單 |
| GUI 掃描模式 | 已決策，保留少量可理解模式，不展開複雜技術型 profile |
| 整站檢測策略強化 | 收斂為小步分類與呈現，不做治理平台 |
| Incremental / sitemap 整合 | 已有基礎，P10 不擴大成排程 |
| Scheduler / 平台化監控 | 移出 P10 |
| 複雜 suppress rules | 移出 P10 |
| 複雜技術型 profile presets | 移出 P10 |
| Headless render 預設化 | 移出 P10 |

不納入 P10：

- 常駐排程。
- 平台化 dashboard。
- 多人審核 / 派工流程。
- 複雜規則治理。
- GUI rules URL 表單。
- 複雜技術型 profile presets；保留少量 GUI 掃描模式。
- headless render 預設化。
- Web Worker / IndexedDB 大改。
- 取代 W3C Link Checker 或機關既有工具。

P10 完成後的正式版 release gate：

- 全部 `.mjs` 語法檢查與全部 `test-*.mjs` 通過。
- 以本機 smoke test 驗證 GUI 啟動、掃描、報告下載與 Analyzer 匯入流程。
- 重建 portable package，確認 bundled runtime、launcher、localhost-only、manual / idle shutdown 行為。
- 產生並檢查 build manifest、SHA256、runtime version、來源 commit 與產物清單。
- 更新 README、Roadmap、CLI reference、technical spec 與 release notes。
- 明確標示 self-signed / SmartScreen 限制；若要對外公開發佈，再評估公開信任 code signing。

P11 分階段分析紀錄（2026-07-19）：

- 結論：P11 應分階段執行，但每一階段都屬於 release gate 檢查，不新增產品功能，也不把 P10d 併入阻擋項。
- P11a：測試與語法 gate。執行全部 `test-*.mjs`，並對主要 `.mjs` 與前端 Analyzer 腳本做語法檢查。
- P11b：GUI smoke test。驗證 GUI 啟動、掃描、報告下載、Report Analyzer 匯入與 External Link Analyzer 匯入。
- P11c：Portable package 重建。重建 portable zip，確認 bundled runtime、launcher、localhost-only、manual shutdown 與 idle shutdown。
- P11d：Manifest / checksum / release metadata。檢查 build manifest、SHA256、Node runtime version、來源 commit、產物清單與簽章狀態。
- P11e：文件與 release notes 收尾。更新 README、Roadmap、CLI reference、technical spec、release notes，並明確標示 self-signed / SmartScreen 限制。
- P11f：最終 release gate 判定。彙整測試結果、package smoke test、hash、文件狀態與安全說明，決定是否可標正式版。

P11a 執行紀錄（2026-07-19）：

- 狀態：通過。
- Node runtime：`v24.18.0`。
- 全部 `test-*.mjs` 已執行並通過，共 21 個測試檔。
- 語法 gate 已通過，共檢查 28 個檔案，包含根目錄 `.mjs` 與 `public/*.js`。
- 結論：P11a 測試與語法 gate 可關閉，下一步進入 P11b GUI smoke test。

P11b 執行紀錄（2026-07-19）：

- 狀態：修正後通過。
- GUI 啟動：本機 GUI server 可正常啟動並回應主頁；測試期間另啟本機 fixture server，結束後已停止。
- 掃描流程：以 GUI 主畫面執行最小範圍 smoke scan，目標 `https://example.com/`，設定 1 頁、深度 0、不檢查外部連結；畫面顯示「檢查完成」，下載 JSON 按鈕啟用，並產生完整 GUI log artifacts。
- 報告產物：`report.json` 為 complete run，包含 `summary.interpretationByCategory`，同批輸出 `broken.csv`、`external-links.csv` 與 NDJSON sidecars。
- Report Analyzer：可匯入該次 `report.json`，指標、判讀分類與待判讀清單更新，無前端錯誤。
- External Link Analyzer：初次驗證發現 GUI 在無外連時產生的 header-only `external-links.csv` 會被 Analyzer 誤判為不可解析；已修正為接受空 `external-links.csv` / `external-links.ndjson`，並新增 `test-p11b-empty-external-analyzer.mjs` 防回歸。
- 修正後驗證：External Link Analyzer 可匯入並分析 header-only `external-links.csv`，呈現 0 筆外連且無前端錯誤。
- 回歸測試：修正後全部 `test-*.mjs` 已執行並通過，共 22 個測試檔。
- 語法 gate：修正後共檢查 29 個檔案，包含根目錄 `.mjs` 與 `public/*.js`，全部通過。
- 結論：P11b GUI smoke test 可關閉，下一步進入 P11c portable package 重建。

### 3. 頁內連結品質檢查

**狀態：** P10d optional，不阻擋 release gate
**目標：** 借鏡 W3C Link Checker，補足一般 HTTP status 看不出的頁面內部連結問題。

建議交付：

- Fragment / anchor 檢查：頁面存在但 `#fragment` 目標不存在時，標示為「頁內跳轉失效」。
- Duplicate anchor 檢查：同頁重複 `id` 或 anchor name 時，標示為「頁面品質提醒」。

呈現原則：

- 不與明確 404 壞連結混在一起。
- 優先作為可修復提醒，避免產生過度警報。

### 4. GUI 掃描模式簡化

**狀態：** 已決策
**目標：** 用少量、安全、容易理解的掃描模式取代過多參數，不展開複雜技術型 profile。

已採用模式：

- `標準保守`：主 GUI 預設，供承辦人正式清查與回報使用。
- `快速掃描`：小站或初步試跑使用。
- `更保守`：政府網站、防護較強網站或容易 timeout 的網站使用。
- `還原預設`：重設操作，不視為新的 profile。

網誌清查頁數評估紀錄：

- 參考 GOV.UK、Canada.ca 與 Digital.gov 的連結治理方向後，網誌清查應強調定期維護、分批清查、確認 redirect 是否仍正確，以及外部連結是否仍可信；不應把單次超大頁數作為預設。
- 若以承辦人接獲正式清查指令、需檢測網站無效連結並回復上級為主情境，主 GUI 的 `標準保守` 預設應採 `300` 頁 / 深度 `3`，比 `100` 頁更能涵蓋公告、最新消息、活動紀錄與分頁列表後的文章頁。
- `快速掃描` 仍維持 `100` 頁 / 深度 `2`，定位為初步試跑，不作為正式清查預設。
- 若承辦人員目標是清查網誌、最新消息、活動紀錄或文章型頁面的無效連結，建議以 `300` 頁作為第一輪清查值。
- 年度或半年正式清查可使用 `500` 頁；若文章橫跨多年或分類很多，應以年份、分類頁或列表頁分批掃描，每批 `300` 到 `500` 頁。
- 不建議一開始使用 `1000+` 作為 GUI 預設或一般建議，避免掃描時間過長、增加網站壓力，並偏離本工具「本地端、低門檻、輔助型」定位。
- 若網站容易出現 `403`、`429` 或 timeout，頁數可維持 `300`，但應搭配更保守模式或降低每 host 併發到 `1`。

不急著做：

- 大量技術型 profile，例如完整 `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` 展開。
- 把所有 CLI 參數搬進 GUI。

## 階段總覽

| 階段 | 狀態 | 重點 | 下一步 |
| --- | --- | --- | --- |
| Stage 0 | 已收斂 | README、CSV BOM、GUI/CLI 落差提示、`sourceCount` 說明 | 僅保留必要文件或小修 |
| P6 | 已完成 | report-to-report diff | 後續呈現放 P9 / Analyzer |
| P6.5a | 已完成 | 輸出契約、manifest、redaction、body/source limit、Header / Keep-Alive | 無 |
| P6.5b | 已完成 | SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | 無 |
| P7 | 已完成第一版 | TTL URL result cache | 僅保留 P9/P10 呈現整合 |
| P8 | 已完成第一版 | incremental scan、sitemap seed、changed-only result reuse | GUI state 管理延後 |
| P9a | 已驗收 | GUI 易用性、手機可讀性、匯入流程 | 不再是下一個起點 |
| P9b | 已驗收 | 大型報告處理、NDJSON sidecar、Analyzer 載入更多 | 不取代 `report.json` 主契約 |
| P9c-1 | 已驗收 | Rules Schema | 已接續完成 P9c-2 |
| P9c-2 | 已驗收 | Rules 追溯與 rules URL 載入安全 | 後續只保留小修 |
| P10 | 已完成核心收尾 | 報告判讀、人工複核分類、交辦友善欄位與 GUI / Analyzer 語言同步 | 進入正式版 release gate；P10d optional |
| P11 | Release gate | 發布前 hardening、portable package、manifest、checksum、smoke test、文件與版本檢查 | P10 驗收後執行 |

## 已完成里程碑索引

| 階段 | 完成摘要 | 詳細紀錄 |
| --- | --- | --- |
| P0-P5.5 | 本機工具、URL inventory、`404 / 410` 二次確認、外部連結治理、SPA / Nuxt 抽取改善 | [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) |
| P6 | report diff 第一版，支援 URL、external risk 與 summary diagnostics 比對 | [docs/archive/P6_IMPLEMENTATION_ANALYSIS.md](docs/archive/P6_IMPLEMENTATION_ANALYSIS.md) |
| P6.5a | 輸出契約、manifest、redaction、sources/body limit、Header / Keep-Alive | [docs/archive/P6_5A_ASSESSMENT.md](docs/archive/P6_5A_ASSESSMENT.md) |
| P6.5b | SSRF、partial report、robots / compliance、Retry-After / host diagnostics、WAF signature schema | [docs/archive/P6_5B_ASSESSMENT.md](docs/archive/P6_5B_ASSESSMENT.md) |
| P7 | TTL URL result cache、CLI 參數、report `summary.cache`、回歸測試與發布收尾 | [docs/archive/P7_RELEASE_CLOSURE.md](docs/archive/P7_RELEASE_CLOSURE.md) |
| P8 | incremental scan、sitemap 保守 seed、changed-only result reuse、GUI / Analyzer 呈現 | [docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](docs/archive/P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| P9 | GUI 易用性、大型報告處理、NDJSON 輔助輸出、Analyzer 匯入與分批載入、rules schema、rules trace 與 rules URL 安全載入；已於 2026-07-18 整體驗收 | [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md) |
| 2026-07-18 評估 | 專案健康度、產品定位、P9c-2 建議、延後項目重新排序 | [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md) |
| Release security 小修 | portable `.cmd` 使用 bundled runtime、build manifest、SHA256、localhost-only、自簽說明 | [docs/archive/RELEASE_SECURITY_ASSESSMENT.md](docs/archive/RELEASE_SECURITY_ASSESSMENT.md) |

## 延後項目

這些項目不是否定價值，而是目前不應插到 P9c-2 前面，也不應偏離本地輔助工具定位。

| 項目 | 延後原因 |
| --- | --- |
| 完整重構 crawler | 目前核心行為穩定；只應在需要維護時小步抽出 rules loader、security policy、report builder 等邊界清楚的模組 |
| `report.json` streaming parser | P9b 已先用 NDJSON sidecar 與「載入更多」降低大型報告痛點；等真的常遇到瀏覽器無法載入再做 |
| CLI sidecar 邊跑邊 append | 對承辦人價值不直接，且會牽涉 partial output、manifest 一致性與中斷恢復 |
| GUI rules URL 表單 | rules URL 安全基線已補齊，但 GUI 欄位仍需獨立 UX、錯誤訊息與承辦人操作負擔評估 |
| 複雜技術型 profile presets | 已採少量 GUI 掃描模式；避免承辦人需要理解過多技術 profile |
| Next.js `__NEXT_DATA__` 專用 parser | 保持 opt-in / rules-driven，不把站台特定邏輯硬寫回 crawler |
| Headless render 預設化 | 成本高、容易觸發 bot protection，只能作進階 fallback |
| 常駐 scheduler / 平台化監控 | 偏離本地輔助工具定位，也可能與機關既有工具重疊 |
| 複雜 suppress rules / 自動治理流程 | 對承辦人操作負擔高；可先用人工複核分類與交辦欄位降低噪音 |
| 規則平台化治理 | P9c 只補 schema、trace 與安全載入；不建立多人審核、發布流程或集中式規則管理 |

## 全域原則

### 掃描邊界

- 保留現有 `extractLinks()` 方向，不以第一刀重寫成完整 DOM / browser crawler。
- SPA payload extraction 以低成本、可回退為原則。
- 站台特定欄位透過 `--site-link-rules`，不硬寫在核心 crawler。
- Headless render 只作 opt-in fallback，不預設啟用。
- `report.json` 是正式主契約；NDJSON 只能作大型報告輔助輸出，不取代主格式。

### 安全與合規

- CDN/WAF/Bot 處理定位是辨識、降誤報、節流、保存證據與提示人工協調，不做繞過防護。
- robots.txt、授權掃描與 compliance 只記錄工具行為與使用者宣告，不代表工具驗證授權。
- 本機工具也需有安全邊界；預設不得請求 localhost、metadata IP、private IP 或 blocked scheme，除非明確開啟相容模式。
- report、CSV 與 logs 應避免輸出敏感 query value。
- rules URL 載入已在 P9c-2 補齊主掃描同等安全邊界；後續若開放 GUI rules URL 表單，仍需重新檢視使用者提示與錯誤呈現。

### 輸出與版本

- 日常輸出檔名保持穩定，避免腳本、GUI 與使用者流程每次都要追新檔名。
- 版本資訊放在 JSON 內容與每次輸出的 `manifest.json`。
- 只有 release / package 產物才採檔名版本化。
- CSV 不新增每列版本欄位；需要追溯工具、schema、runtime 與輸出清單時，以同目錄 manifest 為準。

## 暫不納入近期主線

| 類別 | 暫不納入項目 |
| --- | --- |
| 防護繞過 | 不輪換 User-Agent、不偽裝 Googlebot、不使用代理 IP 輪換、不解 CAPTCHA、不模擬真人互動 |
| TLS | 不使用 `rejectUnauthorized: false` 作為一般功能；TLS 問題優先使用 `--system-ca` 或 `--legacy-tls` |
| 架構 | 不導入 PostgreSQL、server-client 架構、eGov 登入或常駐 Windows Service |
| 掃描策略 | 不預設 aggressive canonicalization、不做泛用 404 重試、不用 body 過短單獨判斷 false positive |
| 輸出格式 | 不預設替日常輸出檔名加版本號，不在 CSV 每列加入 schema / app version |

## 細部規格索引

| 類別 | 細項 | 落點 | 狀態 |
| --- | --- | --- | --- |
| schema version | `1.0.0` 舊 report、`1.1.0` 輸出契約、`1.2.0` security / runStatus / robots / host diagnostics / protection | P6.5a / P6.5b | 已完成 |
| output manifest | 每次輸出建立 `manifest.json` | P6.5a | 已完成 |
| normalization | `load report -> detect schemaVersion -> normalize to internal ReportModel` | P6 / P9b | 已完成第一版 |
| security CLI | `--block-private-ip`、`--allow-private-ip`、`--allow-localhost` | P6.5b | 已完成 |
| redaction CLI | `--redact-sensitive-query`、`--no-redact-sensitive-query`、`--redact-query-keys <list>` | P6.5a | 已完成 |
| body / source limit CLI | `--max-html-bytes`、`--max-body-preview-bytes`、`--max-download-probe-bytes`、`--max-sources-per-url` | P6.5a | 已完成 |
| rules governance | `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json` | P9c | P9c-1 已完成 |
| rules tracing | root `rulesTrace`、fingerprint、source metadata、load warnings、rules URL 安全載入 | P9c-2 | 已完成第一版 |
| report interpretation | 人工複核分類、交辦友善欄位、GUI / Analyzer 判讀語言同步；頁內跳轉失效 optional | P10 | 核心收尾完成 |
| release | package manifest、Node runtime version、smoke test、dependency audit、license summary、SBOM、checksum / signing | P11 / release gate | P10 後執行 |

## 參考文件

- [README.md](README.md)：使用入口、產品定位與快速開始。
- [docs/README.md](docs/README.md)：文件目錄索引。
- [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)：完整 CLI 參數與規則檔格式。
- [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md)：技術規格。
- [docs/P9_GUI_ANALYZER_ASSESSMENT.md](docs/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 評估與紀錄。
- [docs/archive/PROJECT_ASSESSMENT_2026-07-18.md](docs/archive/PROJECT_ASSESSMENT_2026-07-18.md)：完整專案評估與產品定位校準。
- [docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](docs/archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性採納紀錄。
