# P9 GUI and Analyzer Assessment

評估日期：2026-07-17

本文件記錄 P9 的實作前評估。P9 的主軸是改善 GUI / Analyzer 的易用性、可讀性與大型報告處理能力；第一階段應優先處理使用者會直接誤解的呈現問題，不改掃描語意，也不改 `report.json` 主契約。

## 結論

P9 可以開始，但應分階段實作：

1. P9a：GUI 易用性與 Analyzer 改善。
2. P9b：大型 report / NDJSON 輔助輸出。
3. P9c：Profile、Rules Schema 與 Next.js Payload。

目前狀態：P9a 已於 2026-07-17 驗收通過，P9b-1、P9b-2、P9b-3 與 P9b-4 已完成第一版；下一個實作起點是 P9c-1 Rules Schema 與驗證測試。下方 P9a 分析保留作為歷史決策與驗收脈絡，不代表 P9a-1 仍是下一步。

P9b-1 的已落地方向是：GUI log artifacts 新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`，並讓 GUI SSE complete event 不再傳完整 report。第一版採完成後從 `report.json` 派生 sidecar，不先重寫掃描核心、不先做完整 streaming parser、不先設計 CLI sidecar。

P9b-2 的已落地方向是：Report Analyzer 與 External Link Analyzer 在匯入大檔時先顯示檔案大小與載入狀態，載入期間暫停相關控制項，並把 JSON / CSV / rules 匯入錯誤轉成可行的使用者訊息。P9b-2 不加入 NDJSON 匯入，也不重做前端資料層；這些已由 P9b-3 / P9b-4 分別補上第一版。

P9b-3 的已落地方向是：Report Analyzer 壞連結清單與 External Link Analyzer 外連明細初始只渲染 200 筆，透過「載入更多」每次再展開 200 筆。排序、篩選仍在記憶體完成，匯出仍使用完整的目前篩選結果；此步只降低一次建立大量 DOM 的成本。

P9b-4 的已落地方向是：Report Analyzer 可直接載入 `broken.ndjson`，External Link Analyzer 可直接載入 `external-links.ndjson`。第一版不支援 `checked.ndjson` 匯入、不做跨 sidecar 合併、不加入 streaming parser / Web Worker / IndexedDB。

P9a 當時應先做，因為風險最低、使用者最有感，而且可以只動呈現層。P9b 會牽涉 Analyzer 載入策略與輔助輸出格式；P9c 會牽涉 CLI 參數、規則治理、payload extraction 與 report 欄位追溯，風險最高，應放在後段。

## P9a 優先實作

### P9a-1：修正主 GUI 進度語意

目前主 GUI 的進度條主要以 `pagesCrawled / maxPages` 計算。這會讓使用者誤以為頁面接近爬完時整體檢查也快完成，但實際耗時常常在 URL status validation，也就是待檢測 URL、目前請求與 validation queue。

現行呈現的風險：

- 頁面探索已接近 `maxPages` 時，進度條可能顯示很高。
- URL status validation 仍可能剩下大量工作。
- 使用者會誤解「頁面掃描快完成」等於「整體檢查快完成」。

建議改成雙層呈現：

- 主要進度：URL 檢測進度。
- 次要資訊：頁面探索狀態。

建議文案：

```text
URL 檢測進度 320 / 404
尚有 84 個待檢測 URL，4 個請求中
頁面探索：18 / 100，待爬 2
```

進度條不應再單純使用 `pagesCrawled / maxPages`。可改用目前已知 URL 的檢測進度：

```text
urlsChecked / (urlsChecked + pendingUrls)
```

但 UI 文案需標明這是「目前已知 URL 檢測進度」，因為掃描期間仍可能發現新的 URL，分母會變動。掃描中可強調數量與狀態，不過度承諾百分比；完成時才顯示 `100%`。

#### 2026-07-17 implementation record

P9a-1 已完成第一版：

- 主 GUI 進度標籤改為「URL 檢測進度」。
- 進度條改用目前已知 URL 的檢測進度，而不是 `pagesCrawled / maxPages`。
- 主狀態文字顯示已檢測 URL、待檢測 URL 與目前請求數。
- 頁面探索改為輔助資訊，顯示已爬頁面、上限與待爬頁面。
- 不改掃描核心、不改 `report.json` 主契約。

### P9a-2：改善空狀態與第一屏

三個 GUI 第一屏都應清楚回答「下一步要做什麼」。初始狀態不應顯示大量低價值 `0` 統計。

建議：

- 主 GUI 尚未開始時，只顯示待命狀態與下一步提示。
- 掃描開始後再展開詳細技術指標。
- 未載入檔案前，Report Analyzer / External Link Analyzer 隱藏清除、匯出等低價值操作。

#### 2026-07-17 implementation record

P9a-2 已完成第一版：

- 主 GUI 增加待命空狀態，明確顯示目前等待 URL、尚未建立 report 與事件紀錄待命。
- 問題連結與事件紀錄改為有語意的空狀態，不再只呈現空白或低價值 `0`。
- External Link Analyzer 與 Report Analyzer 增加匯入前待命提示；資料載入後自動收起。
- 不改掃描核心、不改 `report.json` 主契約。

### P9a-3：修正手機版可讀性

P9a 第一版應至少確保 390px 寬手機 viewport 不出現整頁水平捲動。

建議：

- External Link Analyzer 的表格水平捲動限制在表格容器內。
- Report Analyzer 摘要區改為更緊湊的 2 欄或列表式呈現。
- 長 URL 與長狀態文字使用容器內換行或局部捲動，不撐開整頁。

#### 2026-07-17 implementation record

P9a-3 已完成第一版：

- 三個 GUI shell 加入小螢幕防整頁水平溢出規則。
- Header 導覽、操作按鈕與長文字徽章在手機寬度改為可換行、可堆疊。
- 主 GUI、External Link Analyzer 與 Report Analyzer 的表格寬度限制在表格容器內，手機只允許局部橫向捲動。
- 壞連結、外連明細與排行列表加強 `min-width: 0` 與長文字換行，避免長 URL 撐開整頁。
- 不改掃描核心、不改 `report.json` 主契約。

### P9a-4：匯入型頁面流程化

External Link Analyzer / Report Analyzer 應改成更明確的流程：

```text
選檔 -> 可選規則 -> 分析 -> 匯出
```

選檔後要有清楚狀態與下一步提示，避免使用者不確定是否已載入、是否需要再按分析、或目前是否可匯出。

#### 2026-07-17 implementation record

P9a-4 已完成第一版：

- External Link Analyzer 增加 `選檔 -> 分析 -> 匯出` 流程列。
- External Link Analyzer 在未選檔前停用「分析」，選檔後明確提示下一步，分析完成後提示可匯出。
- Report Analyzer 增加 `選檔 -> 載入 -> 篩選 / 匯出` 流程列。
- Report Analyzer 載入中、載入成功與讀取失敗都會更新流程狀態。
- 不改 Analyzer 計算語意、不改 `report.json` 主契約。

## P8 延後項目

P8 的 GUI 啟用入口與 state 管理不建議放進 P9a 第一批。這些功能不是純呈現層，會牽涉掃描參數、state 檔路徑、policy fingerprint 與 `changed-only` 語意。

建議：

- P9a 可以改善 P8 report 的呈現與說明。
- GUI 啟用 incremental scan、state 管理頁、手填 state path 放到 P9 後段或 P10 評估。
- `changed-only` 不應做成醒目的主按鈕，避免誤解成「只掃變更頁面」。

## P9b 邊界

P9b 目標是讓 Analyzer / GUI 可處理大型 report。建議等 P9a 的 UI 基線穩定後再做。

可能交付：

- Analyzer 載入大型 JSON 時的分段處理。
- GUI 分頁或虛擬化清單。
- `checked.ndjson`、`broken.ndjson`、`external-links.ndjson` 作為輔助輸出。

限制：

- NDJSON 不取代 `report.json` 主格式。
- 不在 P9b 同時改掃描分類語意。

### 2026-07-17 P9b assessment record

P9b 可以開始，但建議拆成小步實作，不要一次同時處理 streaming parser、GUI 分頁與 NDJSON 匯入。

現況：

- 後端目前輸出 `report.json`、`broken.csv`、`external-links.csv`、`summary.json` 與 `external-summary.json`。
- `report.json` 仍一次包含完整 `checked[]`、`broken[]`、`externalLinks[]`。
- 目前 `report.json` 不是執行時同步邊掃邊寫入；掃描完成後才一次 build report、一次 `JSON.stringify()` 與寫檔。
- GUI 掃描完成時當時會透過 complete event 把完整 report 傳給前端，超大 report 可能在使用者端卡住。
- Report Analyzer 目前以 `file.text()` + `JSON.parse()` 一次載入完整 report。
- External Link Analyzer 目前也會一次讀入 CSV / JSON，再完整分析、排序、截斷顯示。
- 現有 UI 已有顯示上限，但 normalize、sort、filter 仍會處理完整陣列。

建議切分：

1. P9b-1：新增輔助輸出 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`，更新 manifest / summary，並讓 GUI complete event 只回傳 summary / manifest / log path 等輕量資料。此步不改 `report.json` 主契約。
2. P9b-2：Analyzer 大檔保護，包含檔案大小提示、載入中狀態與建議改用 NDJSON / CSV。
3. P9b-3：前端分頁或「載入更多」，先套用在 Report Analyzer 壞連結清單與 External Link Analyzer 外連明細。
4. P9b-4：NDJSON 匯入支援，先支援 `broken.ndjson` 與 `external-links.ndjson` 的主要列表與摘要。

不納入 P9b：

- 不改掃描分類語意。
- 不改 `report.json` 主格式。
- 不做 profile / rules schema；該範圍留給 P9c。
- 不做治理排程或 WAF 協調建議；該範圍留給 P10。
- 不優先做完整 streaming JSON parser 讀整份 `report.json`。

建議第一步為 P9b-1：NDJSON 輔助輸出與 GUI complete payload 瘦身。單純新增 NDJSON sidecar 能改善 Analyzer 後續讀取，但不會降低掃描完成瞬間把完整 report 傳到使用者端的卡頓風險；因此 complete event 應同步改為輕量摘要。

### 2026-07-17 P9b consistency analysis

採納方向：`report.json` 維持正式主契約與完成後輸出；NDJSON 作為大型報告的輔助輸出與逐筆處理格式。P9b 不應把兩者混成同一個主格式，也不應為了支援超大檔而改變掃描分類語意。

JSON 與 NDJSON 分工：

- `report.json`：保留完整結構，適合小型與中型報告、diff、既有 Analyzer 與人工檢視；不優先做邊掃邊寫。
- `checked.ndjson`：最適合邊跑邊寫；每筆 URL 檢查完成即可 append。
- `broken.ndjson`：適合邊跑邊寫；當結果已可判定為壞連結時 append。
- `external-links.ndjson`：可作為輔助輸出；若要邊跑邊寫，需先確認 external link 去重、來源累積與風險分類的穩定點。第一版可接受掃描完成後由完整結果輸出。
- `summary.json` / `manifest.json`：以完成後輸出為準，負責記錄統計、sidecar 清單與工具版本。

檔案級距定義：

- 小型：瀏覽器可直接載入與分析 `report.json`，使用者端不應有明顯停頓。
- 中型：`report.json` 仍可保留與下載，但 Analyzer 應提供載入提示、分頁或顯示上限，避免一次渲染過多資料。
- 大型 / 超大型：不應要求使用者端一次解析完整 `report.json`；應優先使用 NDJSON / CSV sidecar、分批讀取與列表分頁。

整體一致性結論：

1. Roadmap、P9 評估與技術規格需一致表述：NDJSON 是輔助輸出，不取代 `report.json`。
2. P9b-1 必須同時處理 NDJSON sidecar 與 GUI complete payload 瘦身，否則仍可能在掃描完成瞬間卡住使用者端。
3. P9b 不優先投入完整 streaming JSON parser；若後續仍需要讀超大 `report.json`，應另開小步驟評估。
4. Analyzer 的大型檔支援應先走「提示、保護、分頁、NDJSON 匯入」，再考慮更複雜的 JSON streaming parser。

### 2026-07-18 P9b focused re-analysis

目前程式碼顯示 P9b 的主要風險集中在三個位置：

1. 掃描核心：`LinkChecker.buildReport()` 仍在結束時一次組出 `checked[]`、`broken[]`、`externalLinks[]`，所以第一版 P9b 不應承諾「真正邊跑邊寫」來降低 Node 端記憶體。較穩的第一步是完成後從正式 report 派生 sidecar，先固定輸出契約。
2. GUI server：當時 `saveJobArtifacts()` 只保存 JSON / CSV / log / manifest；`buildCompletePayload()` 仍把完整 `job.report` 放進 SSE complete event。大型掃描最大的前端卡頓點在這裡，因為 complete event 會先 JSON.stringify 完整 report，再讓瀏覽器 JSON.parse 與 render。
3. Analyzer：Report Analyzer 與 External Link Analyzer 都使用 `file.text()` + `JSON.parse()` / CSV parse 全量讀入；列表雖有顯示上限，但載入與分析階段仍是全量記憶體操作。

因此 P9b 重新切分如下：

#### P9b-1：sidecar artifacts 與 complete payload 瘦身

第一版建議採用「完成後派生 NDJSON」：

- GUI log 目錄新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`。
- 每行是一筆已 redacted 的 report item，直接來自 `report.checked`、`report.broken`、`report.externalLinks`。
- `manifest.json` 的 `generatedFiles` 加入三個 NDJSON sidecar，`summary.json.reportFiles` 也加入對應路徑。
- `README.txt` 說明 NDJSON 是大型報告輔助輸出，`report.json` 仍是正式完整報告。
- GUI SSE complete event 改成輕量 payload，只回傳 `state`、`summary`、`reportFiles`、`manifest` 或 `manifestPath`、`logRelativePath`、`reportUrl`、`logError`，不直接放完整 `report`。
- 主 GUI 需要在 complete 後先顯示 summary；使用者按下載時再走既有 `/api/jobs/:id/report` 或 log artifact，而不是從 `currentReport` 重新 stringify。

P9b-1 不必先改 CLI `--output`。CLI 目前只寫指定 `report.json` 與 `manifest.json`，沒有 log artifact 目錄；若要 CLI 也輸出 NDJSON，建議另開 `--output-dir` 或 `--sidecar-output` 設計，不要塞進 P9b-1 第一刀。

P9b-1 驗收標準：

- GUI 掃描完成時，SSE complete event 不包含 `report.checked`、`report.broken`、`report.externalLinks`。
- GUI log 目錄包含 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`。
- NDJSON 行數分別等於 report 的 `checked.length`、`broken.length`、`externalLinks.length`。
- `manifest.json` 與 `summary.json.reportFiles` 能找到所有新 sidecar。
- 主 GUI 完成後仍能顯示總覽、壞連結數、log 位置，並仍能下載完整 report。
- 不改 `report.json` schema、不改掃描分類語意、不改 exit code。

#### P9b-2：Analyzer 大檔保護

第二步先保護載入體驗，不急著做 NDJSON 匯入：

- Report Analyzer 選到過大的 `report.json` 時，先顯示檔案大小提示與載入中狀態。
- 若檔案超過保守門檻，提示使用 `broken.csv` / `external-links.csv` / NDJSON sidecar。
- External Link Analyzer 同樣在 JSON / CSV 載入前提示檔案大小與可能耗時。
- 錯誤訊息需區分「格式錯誤」與「檔案太大或瀏覽器無法處理」。

#### P9b-3：前端列表分頁 / 載入更多

第三步處理渲染成本：

- Report Analyzer 壞連結清單從固定前 800 筆改為「初始 200 筆 + 載入更多」。
- External Link Analyzer 外連明細從固定前 500 筆改為「初始 200 筆 + 載入更多」。
- 排序與篩選可以仍在記憶體完成；此步目標是避免一次建立大量 DOM。

#### P9b-4：NDJSON 匯入

第四步再讓 Analyzer 能直接吃 sidecar：

- Report Analyzer 先支援 `broken.ndjson`，並以 summary / manifest 補足總覽；若沒有 summary，至少能顯示壞連結清單與分類。
- External Link Analyzer 支援 `external-links.ndjson`。
- `checked.ndjson` 第一版不必直接匯入 UI，除非要做完整檢查結果瀏覽器。

#### 延後項目

- 真正掃描過程中 append NDJSON。
- 完整 `report.json` streaming parser。
- CLI sidecar 輸出設計。
- 以 IndexedDB 或 Web Worker 重做 Analyzer 資料層。

重新結論：P9b-1 的價值不只是產生 NDJSON，而是把「掃描完成瞬間」從大 payload 變成小 payload。若只新增 sidecar、但 complete event 仍回傳完整 report，P9b 的主要風險仍未解除。

### 2026-07-18 P9b consolidated decision

綜合前後兩次 P9b 分析後，最佳效益不是推翻舊結論，而是把舊結論的完整方向與新結論的低風險落地方式合併。

舊結論的長處：

- 清楚指出 P9b 需要處理大型報告、NDJSON 輔助輸出、Analyzer 保護、列表分頁與 NDJSON 匯入。
- 保持 `report.json` 是正式主契約，不讓 NDJSON 取代既有格式。
- 及早把 streaming parser 排除在第一優先之外，避免過度實作。

新結論的長處：

- 更精準地指出最大痛點是 GUI 掃描完成瞬間仍透過 SSE complete event 傳送完整 report。
- 明確收斂第一版 NDJSON 為「完成後從 `report.json` 派生 sidecar」，不承諾一開始就邊跑邊 append。
- 把 Analyzer 大檔保護與列表分頁排在 NDJSON 匯入之前，先降低使用者可感知的卡頓與失敗風險。
- 明確延後 CLI sidecar、完整 `report.json` streaming parser 與 Analyzer 資料層重做。

採納的合併路線：

1. 先不重寫掃描核心。
2. 先不做完整 streaming parser。
3. 先不急著設計 CLI sidecar。
4. 先讓 GUI log artifacts 新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`。
5. 同步讓 GUI SSE complete event 不再傳完整 `report`，改傳 summary / manifest / reportFiles / log path / reportUrl 等輕量資訊。
6. 接著補 Analyzer 大檔保護與列表分頁。
7. 最後才加入 `broken.ndjson` 與 `external-links.ndjson` 匯入支援。

最終決策：P9b 的最高效益第一刀是 **P9b-1：GUI log artifacts 新增 NDJSON sidecar，並讓 SSE complete event 不再傳完整 report**。這一步同時保留舊結論的方向完整性，也採用新結論的保守落地方式；能最大幅降低大型掃描完成時的前端卡頓風險，且不改 `report.json` schema、不改掃描語意、不改 CLI exit code。

### 2026-07-18 P9b-1 implementation record

P9b-1 已完成第一版：

- GUI log artifacts 新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`。
- 三個 NDJSON sidecar 由完成後的正式 `report.checked`、`report.broken`、`report.externalLinks` 派生，每行一筆 JSON object。
- `manifest.json` 的 `generatedFiles` 已加入三個 NDJSON sidecar。
- `summary.json.reportFiles` 已加入 `checkedNdjson`、`brokenNdjson`、`externalLinksNdjson`。
- `README.txt` 已列出三個 NDJSON sidecar。
- GUI SSE complete event 不再包含完整 `report`，改回傳 summary / reportFiles / manifest / log path / reportUrl 等輕量資訊。
- 主 GUI 完成後以摘要更新總覽；問題明細延後到完整 report、CSV 或 NDJSON sidecar，避免完成瞬間解析與渲染大型 report。
- 下載完整 report 改由既有 `/api/jobs/:id/report` 或 queue report endpoint 取得。
- 新增 `test-p9b-gui-artifacts.mjs`，驗證 complete payload 不含完整 report、NDJSON 行數與來源陣列一致、summary reportFiles 包含 sidecar。

驗證通過：

- `node --check gui-server.mjs`
- `node --check public/app.js`
- `node test-p9b-gui-artifacts.mjs`
- `node test-p65a-output-contract.mjs`

保留延後項目：

- 真正掃描過程中 append NDJSON。
- 完整 `report.json` streaming parser。
- CLI sidecar 輸出設計。
- Analyzer NDJSON 匯入與資料層重做。

### 2026-07-18 P9b-2 implementation record

P9b-2 已完成第一版：

- Report Analyzer 選取 `report.json` 後會顯示檔名、檔案大小與大型檔案提示；載入期間會暫停檔案選擇、清除與匯出控制項，避免重複操作造成狀態混亂。
- Report Analyzer 將 JSON 語法錯誤與記憶體 / 檔案過大類錯誤轉成較清楚的訊息，並建議大型報告優先使用 `broken.csv` 或後續 NDJSON sidecar 流程。
- External Link Analyzer 選取 JSON / CSV 後會顯示檔名、檔案大小與大型檔案提示；分析期間會先讓瀏覽器更新載入狀態，再進行檔案讀取與解析。
- External Link Analyzer 將 links JSON、`external-links.csv` 與 rules JSON 的匯入錯誤分開描述，避免所有錯誤都落成不明確的解析失敗。
- 兩個 Analyzer 都保留現有 `report.json` / CSV 匯入契約；NDJSON 匯入、Web Worker、IndexedDB 與列表分頁不在 P9b-2 範圍。

驗證通過：
- `node --check public/report-analyzer.js`
- `node --check public/analyzer.js`

### 2026-07-18 P9b-3 implementation record

P9b-3 已完成第一版：

- Report Analyzer 壞連結清單從固定顯示前 800 筆改為初始 200 筆，並提供「載入更多」每次再展開 200 筆。
- External Link Analyzer 外連明細從固定顯示前 500 筆改為初始 200 筆，並提供「載入更多」每次再展開 200 筆。
- 篩選條件、重新分析或重新載入資料時，列表會回到初始 200 筆，避免沿用舊資料的展開狀態。
- 匯出行為不受畫面顯示筆數限制，仍匯出完整的目前篩選結果。
- 此步不加入虛擬清單、Web Worker、IndexedDB 或 NDJSON 匯入；目標只是在現有資料模型上降低一次建立大量 DOM 的成本。

驗證通過：
- `node --check public/report-analyzer.js`
- `node --check public/analyzer.js`
- `node test-p9b3-list-pagination.mjs`

後續已由 P9b-4 補上 NDJSON 匯入支援，先支援 `broken.ndjson` 與 `external-links.ndjson` 的主要列表與摘要。

### 2026-07-18 P9b-4 implementation record

P9b-4 已完成第一版：

- Report Analyzer 檔案選擇器支援 `.ndjson`，可直接載入 GUI log 目錄中的 `broken.ndjson`。
- `broken.ndjson` 逐行解析後會包成 sidecar report model，保留壞連結列表與可確定的壞連結數，並標示為 partial report，避免誤以為有完整 checked / summary 資訊。
- External Link Analyzer 檔案選擇器支援 `.ndjson`，可直接載入 GUI log 目錄中的 `external-links.ndjson`。
- `external-links.ndjson` 逐行解析後走既有 external link normalization、dedupe、risk analysis 與匯出流程。
- NDJSON 錯誤訊息會指出這是一行一筆 JSON object 的 sidecar 格式，並保留解析失敗行號。
- 此步不支援 `checked.ndjson` 匯入、不做 `summary.json` / `manifest.json` 合併、不加入完整 streaming parser、Web Worker 或 IndexedDB。

驗證通過：
- `node --check public/report-analyzer.js`
- `node --check public/analyzer.js`
- `node --check test-p9b4-ndjson-import.mjs`
- `node test-p9b4-ndjson-import.mjs`

下一步：P9c-1 Rules Schema 與驗證測試，先固定 `domain-rules`、`external-risk-rules`、`site-link-rules` 契約。

## P9c 邊界

P9c 目標是建立 profile、rules schema 與 Next.js payload 支援。

可能交付：

- `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` profile。
- `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json`。
- `rulesVersion` 與 `profileExpandedOptions` 的 report 追溯。
- Next.js `__NEXT_DATA__` payload extraction。

限制：

- 不應先於 P9a 做大規模設定入口。
- configured values 與 robots / Retry-After 後的 effective values 必須可追溯。

## P9a 驗收標準

P9a 第一版完成時至少需符合：

- 主 GUI 進度不再讓使用者誤以為「頁面爬完就快完成」。
- URL 檢測與頁面探索分開呈現。
- 手機 390px 寬不出現整頁水平捲動。
- 三個 GUI 第一屏都能清楚回答「下一步要做什麼」。
- 空狀態不顯示大量低價值技術統計。
- 匯入型頁面選檔後有清楚狀態與下一步。
- 不改 `report.json` 主契約。
- 不改掃描語意。

### 2026-07-17 P9a acceptance record

P9a 第一版驗收通過：

- 主 GUI 以 URL 檢測進度為主要進度，頁面探索改為輔助資訊。
- 初始空狀態不再顯示大量低價值 `0` 指標。
- 手機截圖驗收已覆蓋 Link Checker、External Link Analyzer 與 Report Analyzer 的空狀態與載入資料後狀態。
- 匯入型頁面已有清楚流程狀態：External Link Analyzer 為 `選檔 -> 分析 -> 匯出`，Report Analyzer 為 `選檔 -> 載入 -> 篩選 / 匯出`。
- 驗證通過：`node --check public/app.js`、`node --check public/analyzer.js`、`node --check public/report-analyzer.js`。
- 本機頁面載入驗證通過：`/`、`/analyzer.html`、`/report-analyzer.html` 均回應 `200`。
- 未修改掃描語意，未修改 `report.json` 主契約。

## 2026-07-18 P9 重新分析

### 目前狀態

P9a 已完成且仍可視為通過。主 GUI 已改用 URL 檢測進度作為主要進度，頁面探索只作輔助資訊；External Link Analyzer 與 Report Analyzer 也已有匯入流程狀態與較清楚的空狀態。這部分不需要重新打開，除非後續 P9b 改動導致 GUI 完成事件或報告載入流程變動。

P9b-1 已完成第一版。現有 GUI / CLI 仍以完成後一次建立完整 `report.json` 為主契約；GUI log 目錄會寫出 `summary.json`、`report.json`、`broken.csv`、`external-links.csv`、`external-summary.json`、`events.log`、`manifest.json`，並額外產生 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson` 作為大型報告輔助格式。GUI complete event 已改為輕量 payload，不再直接回傳完整 `report`。

P9b-2 已完成第一版。Report Analyzer 與 External Link Analyzer 已加入檔案大小提示、載入狀態、載入期間控制項暫停，以及更清楚的 JSON / CSV / rules 匯入錯誤訊息。此步只保護現有匯入流程，不新增 NDJSON 匯入，也不重做列表渲染。

P9b-3 已完成第一版。Report Analyzer 壞連結清單與 External Link Analyzer 外連明細已改為初始 200 筆，並可透過「載入更多」每次再展開 200 筆；匯出仍使用完整篩選結果。

P9b-4 已完成第一版。Report Analyzer 可載入 `broken.ndjson` 並以 partial sidecar report 呈現壞連結主列表；External Link Analyzer 可載入 `external-links.ndjson` 並沿用既有 normalization / dedupe / risk analysis。

P9c 部分已有前置能力，但未完整交付。CLI 已支援 `--domain-rules`、`--external-risk-rules`、`--site-link-rules`，掃描報告也會記錄這些 rules source；SPA 偵測可辨識 `__NEXT_DATA__` signal，實際抽取仍主要依 inline script URL/path literal 與 site-link-rules，不是完整的 Next.js payload parser。`schemas/` 目前只有 `report.schema.json` 與 `diff.schema.json`，尚未建立 `domain-rules.schema.json`、`external-risk-rules.schema.json`、`site-link-rules.schema.json`。也尚未看到 `normal`、`government-conservative`、`large-site`、`spa`、`external-governance` 這類 profile 的正式資料模型、CLI 入口或 `profileExpandedOptions` / `rulesVersion` 追溯欄位。

### 重新排序

1. P9c-1：補 rules schema 檔與驗證測試，先固定 `domain-rules`、`external-risk-rules`、`site-link-rules` 契約。
2. P9c-2：再做 profiles 與 report 追溯欄位，避免在 schema 還未固定時擴大設定面。
3. P9c-3：評估 Next.js `__NEXT_DATA__` 專用 parser；若只靠 URL/path literal 已足夠，先不要把它升成 P9c 必做。

### 重新結論

P9 的下一個實作點不是繼續修 UI，也不是重做掃描核心，而是 P9c-1。P9b-1 已解除完成瞬間傳送完整 report 的主要卡點，P9b-2 已保護 Analyzer 載入大型檔案時的使用者體驗，P9b-3 已降低大量列表一次渲染造成的 DOM 成本，P9b-4 已讓 Analyzer 可直接載入主要 NDJSON sidecar；接下來應固定 rules schema 與驗證測試。

P9c 應排在 P9b 基礎輸出之後。現有 rules 與 SPA 能力可以支撐目前掃描，但缺少 schema、profile 與追溯欄位，若太早加 GUI profile 設定，容易造成報告契約反覆變動。

## 建議分支

P9 建議從新分支開始：

```text
codex/p9-gui-analyzer-improvements
```

下一個實作項目建議為：

```text
P9c-1：Rules Schema 與驗證測試
```
