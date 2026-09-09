# Project Context

本文件記錄可共享的專案維護脈絡，供新流程開始前快速回顧。日常使用請先看根目錄 `README.md`；目前狀態與版本方向請看 `ROADMAP.md`。

## 專案定位

- Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。
- GUI server 只應綁定 `127.0.0.1`。
- 掃描結果要協助承辦人判讀與交辦，不替使用者做不可逆決策。
- Report、CSV、NDJSON、manifest 與 release artifacts 都要保留可追溯性。

## Analyzer UX 原則

- Portable 的正常產品入口是 `Link Checker.exe`、`gui.cmd` 與 `check-links.cmd`；External Link Analyzer 從 main GUI 的「外部連結分析」進入，不另設 `analyzer.cmd`。
- External Link Analyzer 選擇檔案後會自動載入與分析，再顯示結果；匯出是選用操作，不把 Analyzer 呈現成必須逐步完成的 wizard。
- 待判讀清單優先於摘要、排行與掃描概況。
- 畫面文案先呈現處理建議，再呈現技術狀態。
- 本機檔案選取使用「匯入」或「載入」，不要用「上傳」。
- 技術狀態應盡量用人讀文字，例如 `HTTP 404 找不到頁面`，不要只顯示裸狀態碼。
- 不在清單卡片顯示沒有脈絡的高 / 中 / 低優先度徽章；CSV 可保留優先度欄位供 Excel 排序。
- 非二次確認候選不顯示二次確認列；只有真正排入、完成或有具體原因時才顯示二次確認結果。

## Static Discovery 與 coverage 契約

- 起始頁在 `depth=0` 完成既有 static extraction 後，若只產生 0 或 1 個 crawlable same-origin frontier page，且沒有 explicit `--sitemap`、`maxDepth >= 1` 且 page budget 尚有額度，可啟動 conventional `<start-origin>/sitemap.xml` fallback；2 個以上則沿用 normal static crawl，不做這項 auto probe。
- Automatic XML fallback 重用既有 sitemap fetch/security、parser、seed decision、inventory、page queue、crawler 與 validator。Explicit `--sitemap` 仍有優先權；自動來源不改寫 `options.sitemap`，也不啟用 incremental mode，same-origin、SSRF 與 budget policy 均不變。
- `sitemap_seed_truncated` 必須有 sitemap seed 因 page budget 被略過的直接證據，例如 `ignoredByReason.max_pages > 0`。Duplicate 或 `already_queued_or_crawled` 本身不構成 truncation；整體 crawl 的 `max_pages_reached` 也是獨立語意。
- 這項 refinement 不改 report schema；目前仍為 `1.3.0`。

## 驗證慣例

- 語法 gate 可用 `node --check` 檢查根目錄 `.mjs` 與 `public/*.js`。
- Full regression 通常使用 `scripts/run-tests.ps1` 作為 canonical entry point。
- 維護者不應在其他流程重複實作 `test-*.mjs` discovery logic。
- 個別 `test-*.mjs` 仍可用於 targeted debugging。
- GUI smoke 優先用本機 HTTP request 驗證 `/`、`/analyzer.html` 與 `/report-analyzer.html`，不需要自動開瀏覽器。
- 需要啟動 GUI server 做 smoke 時，優先使用短生命週期流程，並明確設定 manual shutdown 或 `--idle-shutdown-ms`。
- Portable smoke 應驗證 manual shutdown 與 idle shutdown。

## Release Gate 原則

- 本專案採單人維護、`main`-based formal release；一般 release 不建立 release branch。`DEFAULT_RELEASE_MODE = FAST RELEASE`；release SOP 不再以 Patch / Full / Lean Full / Normal Release 區分執行模式，SemVer 版本幅度也不是重新測試的依據。
- Development acceptance 是 final behavior source 的 authoritative gate。Behavior / correctness change 應在 development 階段完成 implementation、風險相稱的 targeted validation、必要的 canonical regression、必要的 real-site acceptance、review / acceptance，並推送為 validated `main`。核心分工是 `TEST ON CHANGE / BUILD ON RELEASE / VERIFY ON PUBLISH`。
- Fast Release 的進入條件是 final behavior source 已完成 development acceptance。符合時，`TARGETED_TESTS_DURING_RELEASE = NO`、`CANONICAL_REGRESSION_DURING_RELEASE = NO`、`REAL_SITE_SCAN_DURING_RELEASE = NO`；不符合時不得發布，應回到 development acceptance。Canonical regression 仍是 development / behavior validation responsibility，而不是 release 階段重複執行的 QA。
- Fast Release 依序負責：確認 validated source identity；更新 version 與必要 active docs；嚴格檢查 validated behavior source 到 release source 的 diff；建立 release-prep commit；fresh build portable exactly once；執行 minimal portable smoke；確認 remote safety 並 normal push；執行 release-preflight；建立並推送 release tag；發布 GitHub Release；執行 normal release-verify；停止。
- Release-prep diff 只允許 release metadata / documentation，例如 `TOOL_VERSION`、`GENERATOR_VERSION`、`AssemblyVersion`、`AssemblyFileVersion`、`AssemblyInformationalVersion`、README version / download reference、ROADMAP release-state text、release notes 與必要 active docs。若出現 crawler、HTTP、404 / 405、WAF、classification、form、security、schema、runtime 或 build behavior change，立即停止 release 並回到 development acceptance；不得在 release 階段臨時修改 behavior 後補跑測試繼續發布。
- 每次正式 release 只 fresh 執行一次 `build-portable.ps1`（`RELEASE_BUILD_RUNS = 1`）。Build 與後續 preflight 成功後不重建；只有 artifact 有實際錯誤時才重新產生。
- Minimal portable smoke 只驗證最終 ZIP 的 disposable extraction：portable CLI / GUI 可啟動、只綁 `127.0.0.1`、manual shutdown 與 idle shutdown 正常。不得執行 canonical `dist\LinkChecker-portable` package，也不把 smoke 擴張成 full regression、real-site scan 或大型 functional QA。
- `scripts/release-preflight.ps1` 是 mandatory release gate，驗證 release source identity、authoritative version surfaces、schema coherence、artifact / manifest provenance、ZIP SHA256、signature minimum requirements 與 repository integrity；不弱化既有 checks。
- Build manifest 自動保存 source、file hashes 與簽章 evidence；不要求維護者逐欄手動複核。Bundled Node Authenticode 必須為 `Valid`；launcher local/self-signed 狀態只記錄，除非出現 `HashMismatch` 等完整性失敗，否則不作一般 release blocker。
- Publication 維持人工操作；發布前確認 `main`、clean worktree、HEAD / origin / remote safety，且只使用 normal push。正常公開資產只有 `LinkChecker-portable.zip` 與 `LinkChecker-portable.zip.sha256`。Package `BUILD-MANIFEST.json` 留在 ZIP 內，external build manifest 留作本機技術 evidence。
- `scripts/release-verify.ps1` normal mode 是 Fast Release 的預設（`RELEASE_VERIFY = NORMAL`），驗證 remote tag、tag target、GitHub Release state、ZIP asset、SHA256 asset 與 GitHub ZIP digest。
- `scripts/release-verify.ps1 -Deep` 保留（`DEEP_VERIFY_AVAILABLE = YES`），但預設不執行且僅供例外情況使用（`DEEP_VERIFY_DEFAULT = NO`、`DEEP_VERIFY_EXCEPTION_ONLY = YES`）。只有 publication anomaly、digest mismatch、packaging / build workflow change、release tooling change、runtime / launcher packaging change、audit / high-assurance requirement 或 maintainer 明確要求時才考慮執行。
- Release notes 一般只需 main changes、必要的 compatibility / limitations、accepted development validation summary、source commit 與 ZIP SHA256。Node / launcher signer、component hashes、manifest hashes 與完整 smoke details 留在技術 evidence。
- Real-site scan 屬於 development evidence、bug reproduction 或 feature validation，不是一般 release gate。
- 責任分層維持清楚：development regression 由 `scripts/run-tests.ps1` 負責；release 由 `build-portable.ps1`、`scripts/release-preflight.ps1` 與 `scripts/release-verify.ps1` 負責。One release process 不代表 one giant release script。

## 文件分層

- 根 README 面向使用者，保留快速開始、常見輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，保留目前狀態、近期方向、延後項目與決策邊界。
- `docs/` 放共享規格、維護脈絡與索引。
- `docs/archive/` 放完成階段的長篇評估、驗收紀錄與歷史快照。
- 本機工具限制、個人操作偏好與特定機器問題不要放在共享文件；請放在被 git ignore 的 `.codex-local-notes.md`。
