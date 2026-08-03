# Documents

本資料夾保存 Local Link Checker 的使用參考、技術契約、評估紀錄與歸檔文件。日常使用請先看根目錄 [README.md](../README.md)；目前開發狀態請看 [ROADMAP.md](../ROADMAP.md)。

## 使用與規格

- [CLI_REFERENCE.md](CLI_REFERENCE.md)：CLI 參數、範例、cache、incremental、sitemap、rules 與 portable package 說明。
- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md)：核心流程、URL inventory、request policy、report schema、GUI API、Analyzer 契約與 release / packaging 技術細節。
- [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md)：report-to-report diff 與 normalization 設計。
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)：新流程開始前可回顧的共享維護脈絡、UX 原則、驗證慣例與 release gate 原則。
- [rules/cec-site-link-rules.json](rules/cec-site-link-rules.json)：CEC SPA / CMS site link rules 範例。

## 歸檔入口

- [archive/README.md](archive/README.md)：歸檔文件索引。
- [archive/ROADMAP_HISTORY.md](archive/ROADMAP_HISTORY.md)：P0-P5.5 已完成里程碑的詳細歷史。
- [archive/PROJECT_ASSESSMENT_2026-07-18.md](archive/PROJECT_ASSESSMENT_2026-07-18.md)：2026-07-18 完整專案評估。
- [archive/P9_GUI_ANALYZER_ASSESSMENT.md](archive/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 改善、NDJSON sidecar、Analyzer 匯入與 rules schema / trace 的評估及驗收紀錄。
- [archive/README_2026-07-22_PRE_DOCS_REFRESH.md](archive/README_2026-07-22_PRE_DOCS_REFRESH.md)：本次整理前的根 README 快照。
- [archive/ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md](archive/ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md)：本次整理前的根 ROADMAP 快照。

## 維護原則

- 根 README 保持短而可操作，避免塞入驗收流水帳。
- 根 ROADMAP 只放目前狀態、下一步、延後項目與決策邊界。
- 已完成階段的長篇設計、驗收結果與歷史判斷放入 `archive/`。
- 新增文件時，請同步更新本索引與必要的 archive 索引。
