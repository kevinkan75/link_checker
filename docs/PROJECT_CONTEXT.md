# Project Context

本文件記錄可共享的專案維護脈絡，供新流程開始前快速回顧。日常使用請先看根目錄 `README.md`；目前狀態與版本方向請看 `ROADMAP.md`。

## 專案定位

- Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。
- GUI server 只應綁定 `127.0.0.1`。
- 掃描結果要協助承辦人判讀與交辦，不替使用者做不可逆決策。
- Report、CSV、NDJSON、manifest 與 release artifacts 都要保留可追溯性。

## Report Analyzer UX 原則

- 待判讀清單優先於摘要、排行與掃描概況。
- 畫面文案先呈現處理建議，再呈現技術狀態。
- 本機檔案選取使用「匯入」或「載入」，不要用「上傳」。
- 技術狀態應盡量用人讀文字，例如 `HTTP 404 找不到頁面`，不要只顯示裸狀態碼。
- 不在清單卡片顯示沒有脈絡的高 / 中 / 低優先度徽章；CSV 可保留優先度欄位供 Excel 排序。
- 非二次確認候選不顯示二次確認列；只有真正排入、完成或有具體原因時才顯示二次確認結果。

## 驗證慣例

- 語法 gate 可用 `node --check` 檢查根目錄 `.mjs` 與 `public/*.js`。
- 測試 gate 可執行全部 `test-*.mjs`。
- GUI smoke 優先用本機 HTTP request 驗證 `/`、`/analyzer.html` 與 `/report-analyzer.html`，不需要自動開瀏覽器。
- 需要啟動 GUI server 做 smoke 時，優先使用短生命週期流程，並明確設定 manual shutdown 或 `--idle-shutdown-ms`。
- Portable smoke 應驗證 manual shutdown 與 idle shutdown。

## Release Gate 原則

- Patch release 不應改變掃描邏輯、CLI 參數、GUI API、report schema 或輸出契約，除非 release notes 明確說明。
- 正式 release 前必須重建 portable package，不能沿用舊 `dist` 產物。
- `LinkChecker-portable.zip`、external manifest、package manifest 與 `.sha256` 必須對齊同一個 source commit。
- Build manifest 的 `gitStatus` 應為空字串。
- Release notes 必須列出 source commit、zip SHA256、Node runtime、launcher 簽章狀態、Node 簽章狀態與 smoke test 結果。
- 如果 launcher 維持 `NotSigned`，README、ROADMAP、portable README、manifest 與 release notes 都應如實記錄，並提醒使用 SHA256 / manifest 驗證。

## 文件分層

- 根 README 面向使用者，保留快速開始、常見輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，保留目前狀態、近期方向、延後項目與決策邊界。
- `docs/` 放共享規格、維護脈絡與索引。
- `docs/archive/` 放完成階段的長篇評估、驗收紀錄與歷史快照。
- 本機工具限制、個人操作偏好與特定機器問題不要放在共享文件；請放在被 git ignore 的 `.codex-local-notes.md`。
