# Current State Snapshot 2026-08-03

狀態：歷史狀態快照。現行開發狀態請看 [../../ROADMAP.md](../../ROADMAP.md)，使用入口請看 [../../README.md](../../README.md)。

本文件承接 2026-08-03 前後從根 ROADMAP 移出的完成狀態與 release 摘要，避免根 ROADMAP 變成歷史紀錄。

## v1.0.4 狀態

- 最新正式版本：`v1.0.4`。
- `v1.0.4` 是 patch release，沒有改變掃描邏輯、CLI 參數、GUI API、report schema 或輸出契約。
- GitHub Release：`v1.0.4 Portable` 本機 release gate 已通過；發布時需上傳 portable zip、build manifest、zip SHA256 與 release notes。
- Source commit 與 portable zip SHA256 以 GitHub Release 上傳的 build manifest 與 `.sha256` 檔為準。
- Portable launcher 在本機 build 中記錄為 `NotSigned`；release notes、portable README 與 manifest 已明確標示，散布前應以 SHA256 / manifest 驗證 zip。

## v1.0.4 重點

- 改善 Report Analyzer 的人工檢視工作流，讓待判讀清單優先於追查摘要與掃描概況。
- 將狀態碼改為「技術狀態」人讀文字，並把匯出動作放入目前清單工具列。
- 調整本機檔案語意為「匯入」，避免誤解為上傳到遠端服務。
- 隱藏非候選二次確認狀態，並移除清單中缺少脈絡的高 / 中 / 低優先度徽章。
- 整理 archive 文件，保留歷史紀錄但降低根文件噪音。

## 已完成階段總覽

| 階段 | 狀態 | 重點 | 主要紀錄 |
| --- | --- | --- | --- |
| P0-P5.5 | 已完成 | 基礎掃描、URL inventory、404 / 410 二次確認、外連風險、SPA / Nuxt 抽取 | [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md)、[P5_5_SPA_LINK_EXTRACTION_RECORD.md](P5_5_SPA_LINK_EXTRACTION_RECORD.md) |
| P6 / P6.5 | 已完成 | report-to-report diff、輸出契約、redaction、body/source limit、SSRF、partial report、robots / compliance、Retry-After、WAF signature schema | [P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md](P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md) |
| P7 | 已完成 | TTL URL result cache、驗收紀錄與 P8 銜接 | [P7_CACHE_ASSESSMENT_AND_RELEASE.md](P7_CACHE_ASSESSMENT_AND_RELEASE.md) |
| P8 | 已完成 | incremental scan、sitemap seed、changed-only result reuse | [P8_INCREMENTAL_SCAN_ANALYSIS.md](P8_INCREMENTAL_SCAN_ANALYSIS.md) |
| P9 | 已驗收 | GUI / Analyzer 改善、NDJSON sidecar、rules schema、rules trace 與 rules URL 安全載入 | [P9_GUI_ANALYZER_ASSESSMENT.md](P9_GUI_ANALYZER_ASSESSMENT.md) |
| P10 | 已完成 | 判讀分類、交辦欄位、GUI / Analyzer 語言同步 | [../../README.md](../../README.md)、[../TECHNICAL_SPEC.md](../TECHNICAL_SPEC.md) |
| P11 | 已完成 | release gate、portable build、manifest / checksum、GUI smoke、release notes | `dist/v1.0.4-notes.md` |

## 當時決策摘要

- 主 GUI 預設會檢查外部連結；CLI 仍維持保守預設，需要 `--external` 才檢查外部連結。
- 主 GUI 三個功能頁切換按鈕已改為繁中：「連結檢查」、「外部連結分析」、「報告分析」。
- P0-P11 release gate 已完成；當時沒有阻擋正式版使用的已知 release gate 項目。
