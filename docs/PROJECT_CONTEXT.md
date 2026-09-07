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
- Full regression 通常使用 `scripts/run-tests.ps1` 作為 canonical entry point。
- 維護者不應在其他流程重複實作 `test-*.mjs` discovery logic。
- 個別 `test-*.mjs` 仍可用於 targeted debugging。
- GUI smoke 優先用本機 HTTP request 驗證 `/`、`/analyzer.html` 與 `/report-analyzer.html`，不需要自動開瀏覽器。
- 需要啟動 GUI server 做 smoke 時，優先使用短生命週期流程，並明確設定 manual shutdown 或 `--idle-shutdown-ms`。
- Portable smoke 應驗證 manual shutdown 與 idle shutdown。

## Release Gate 原則

- 本專案採單人維護、`main`-based formal release；一般 release 不建立 release branch，也不設獨立的 Scope Freeze 或 Version Preparation phase。
- 發布前確認 `main`、clean worktree 與 `HEAD == origin/main`，並執行一次 `scripts/run-tests.ps1` canonical regression。
- 每次正式 release 都要重新執行 `build-portable.ps1`，再以最終 ZIP 的 disposable extraction 完成 portable CLI / GUI、`127.0.0.1` bind、manual shutdown 與 idle shutdown smoke。
- `scripts/release-preflight.ps1` 只驗證 release source、authoritative version surfaces、artifact / manifest provenance、ZIP SHA256 與簽章最低要求；不重跑 regression，也不探測 GitHub publication prerequisites。
- Build manifest 自動保存 source、file hashes 與簽章 evidence；不要求維護者逐欄手動複核。Bundled Node Authenticode 必須為 `Valid`；launcher local/self-signed 狀態只記錄，除非出現 `HashMismatch` 等完整性失敗，否則不作一般 release blocker。
- Publication 維持人工操作；正常公開資產只有 `LinkChecker-portable.zip` 與 `LinkChecker-portable.zip.sha256`。Package `BUILD-MANIFEST.json` 留在 ZIP 內，external build manifest 留作本機技術 evidence。
- `scripts/release-verify.ps1` 正常模式只驗證 tag target、公開 Release 狀態、ZIP / SHA256 assets 與 GitHub ZIP digest；`-Deep` download verification 只用於 publication anomaly 或高保證稽核。
- Release notes 一般只需 main changes、必要的 compatibility / limitations、canonical regression result、source commit 與 ZIP SHA256。Node / launcher signer、component hashes、manifest hashes與完整 smoke details留在技術 evidence。
- Real-site scan 屬於 development evidence、bug reproduction 或 feature validation，不是一般 release gate。

## 文件分層

- 根 README 面向使用者，保留快速開始、常見輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，保留目前狀態、近期方向、延後項目與決策邊界。
- `docs/` 放共享規格、維護脈絡與索引。
- `docs/archive/` 放完成階段的長篇評估、驗收紀錄與歷史快照。
- 本機工具限制、個人操作偏好與特定機器問題不要放在共享文件；請放在被 git ignore 的 `.codex-local-notes.md`。
