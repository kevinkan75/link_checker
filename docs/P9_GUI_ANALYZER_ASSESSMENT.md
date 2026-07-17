# P9 GUI and Analyzer Assessment

評估日期：2026-07-17

本文件記錄 P9 的實作前評估。P9 的主軸是改善 GUI / Analyzer 的易用性、可讀性與大型報告處理能力；第一階段應優先處理使用者會直接誤解的呈現問題，不改掃描語意，也不改 `report.json` 主契約。

## 結論

P9 可以開始，但應分階段實作：

1. P9a：GUI 易用性與 Analyzer 改善。
2. P9b：大型 report / NDJSON 輔助輸出。
3. P9c：Profile、Rules Schema 與 Next.js Payload。

P9a 應先做，因為風險最低、使用者最有感，而且可以只動呈現層。P9b 會牽涉 Analyzer 載入策略與輔助輸出格式；P9c 會牽涉 CLI 參數、規則治理、payload extraction 與 report 欄位追溯，風險最高，應放在後段。

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
- GUI 掃描完成時目前會透過 complete event 把完整 report 傳給前端，超大 report 可能在使用者端卡住。
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

## 建議分支

P9 建議從新分支開始：

```text
codex/p9-gui-analyzer-improvements
```

第一個實作項目建議為：

```text
P9a-1：修正主 GUI 進度語意
```
