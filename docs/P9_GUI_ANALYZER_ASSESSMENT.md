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

## 建議分支

P9 建議從新分支開始：

```text
codex/p9-gui-analyzer-improvements
```

第一個實作項目建議為：

```text
P9a-1：修正主 GUI 進度語意
```
