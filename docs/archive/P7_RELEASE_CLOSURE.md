# P7 Release Closure

狀態：歷史發布收尾紀錄。P7 已完成並合併主線；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，技術規格請看 [../TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md)。

本文件記錄 P7：persistent TTL URL result cache 的發布收尾狀態。P7 第一版已完成並可作為 P8 incremental scan 的基線。

## 發布狀態

- 狀態：已完成第一版並完成發布收尾。
- 分支：`codex/release-v0.14.0-p7`
- 發布日期：2026-07-15
- 主要交付：跨執行的 URL status-result TTL cache、CLI 參數、report cache summary、技術規格與回歸測試。

## 使用者可見變更

- 新增 `--cache`，啟用 persistent TTL URL status-result cache。
- 新增 `--cache-file <file>`，可指定 cache 檔案路徑，預設 `.cache/link-check-cache.json`。
- 新增 `--cache-ttl-hours <n>`，設定成功結果的 TTL，預設 `24` 小時。
- 新增 `--refresh-cache`，忽略既有 cache entry，重新檢查並回寫新結果。
- 新增 `--no-cache`，停用 persistent cache。
- `report.json` 會在 `options` 與 `summary.cache` 中記錄 cache 設定、命中、miss、expired、refreshed、written、bypassed 與 errors。

## 發布邊界

P7 cache 是本機效能最佳化資料，不是正式 report，也不改變掃描語意。

- `--cache` 預設關閉，使用者需明確啟用。
- cache 只服務不需要 HTML body 的 URL status check。
- 頁面爬行需要 `requireBody: true` 時仍會實際抓取 HTML body。
- cache 命中不得跳過 HTML link extraction、SPA payload extraction、site link rules 或 inventory 建立。
- cache file 不保存完整 response body。
- cache file 的展示 URL 會強制遮罩敏感 query value，即使 report redaction 被停用也一樣。
- GUI 第一版不新增 cache 控制表單；GUI 保存的 report 會自然包含 `summary.cache`。

## 驗收結果

發布收尾時已執行完整本機測試，全部通過：

- `test-p65a-limits.mjs`
- `test-p65a-network.mjs`
- `test-p65a-output-contract.mjs`
- `test-p65a-redaction.mjs`
- `test-p65b-retry-after.mjs`
- `test-p65b-robots-compliance.mjs`
- `test-p65b-run-status.mjs`
- `test-p65b-security-policy.mjs`
- `test-p65b-waf-signature.mjs`
- `test-p7-cache.mjs`
- `test-report-diff.mjs`

P7 cache 測試覆蓋：

- 第二次 status check 命中 cache 並避免重複 request。
- `--refresh-cache` 會略過舊 entry 並回寫新結果。
- expired entry 不命中。
- User-Agent、Accept-Language、security policy 與 robots policy 改變時不誤命中。
- `requireBody: true` 不因 status cache 命中而跳過 HTML body fetch。
- `summary.cache` 統計與 cache file redaction 行為符合契約。

## P8 交接條件

P8 可在此基線上設計 incremental scan，但不得假設 P7 已保存 page HTML body 或完整 URL discovery state。

P8 第一個建議切入點：

1. 定義 scan state 檔案格式。
2. 設計 `--incremental`、`--state-file <file>`、`--changed-only` 與 `--sitemap <url-or-file>`。
3. 先以 report diff、scan state 與 P7 status cache 建立優先檢查策略。
4. changed-only 模式仍需保留完整 summary，不只輸出 delta。
5. 不得因 sitemap 或 state 跳過本次 HTML inventory 發現的新 URL。
