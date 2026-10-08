# Documents

本資料夾保存 Local Link Checker 的使用參考、技術契約、評估紀錄與歸檔文件。日常使用請先看根目錄 [README.md](../README.md)；目前開發狀態請看 [ROADMAP.md](../ROADMAP.md)。

## 文件權威與用途

下表明文化目前既有文件分工，不建立新的 policy layer：

| 資訊類型 | Current authority |
| --- | --- |
| 使用方式與目前正式版本 | 根目錄 [README.md](../README.md) |
| Current project state、priorities 與 phase disposition | 根目錄 [ROADMAP.md](../ROADMAP.md) |
| Maintenance principles、release policy 與 release gate | [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) |
| Current implementation behavior 與 technical contract | [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) |
| CLI options 與 CLI usage contract | [CLI_REFERENCE.md](CLI_REFERENCE.md) |
| Report schema | [schemas/report.schema.json](../schemas/report.schema.json) 與目前 report-producing implementation（主要為 [link-checker.mjs](../link-checker.mjs)） |
| Report diff / normalization semantics | [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md) |
| Deferred Dynamic Render research | [JS_DYNAMIC_SCAN_PLAN.md](JS_DYNAMIC_SCAN_PLAN.md)；current priority 仍由根目錄 `ROADMAP.md` 決定 |
| Historical decisions、assessments 與 acceptance evidence | [archive/](archive/README.md) |

Active documents 描述目前有效的使用方式、狀態、契約或維護政策；`archive/` 保存特定時間點的歷史決策、評估、驗收與 evidence，不因專案後續演進而持續改寫 current state。Archive 並非不可修改：可修正明顯錯字、失效 link / path、metadata 或索引錯誤，也可增加必要的 historical clarification；但不應為了同步 current state 而重寫歷史內容。

文件間若出現 current-state 衝突，先辨識資訊類型並查閱上表所列 authority，再以目前 implementation / repository evidence 驗證。Archive 只代表其記錄時點，不覆蓋 current authority；若 current authority 與 implementation evidence 不一致，應依 evidence 修正對應 active document。

## 使用與規格

- [CLI_REFERENCE.md](CLI_REFERENCE.md)：CLI 參數、範例、cache、incremental、sitemap、rules、portable package 與 formal-release verification 說明。
- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md)：核心流程、URL inventory、request policy、report schema、GUI API、Analyzer 契約與 release / packaging 技術細節。
- [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md)：report-to-report diff 與 normalization 設計。
- [JS_DYNAMIC_SCAN_PLAN.md](JS_DYNAMIC_SCAN_PLAN.md)：Dynamic Render 延後設計紀錄，保存依賴 JavaScript 網站掃描之研究、分階段構想、安全邊界及重新評估條件。
- [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md)：新流程開始前可回顧的共享維護脈絡、UX 原則、驗證慣例與 release gate 原則。
- [rules/basic-domain-rules.template.json](rules/basic-domain-rules.template.json)：外連分類規則入門範本，需複製後替換成自己的網域，不會自動套用。
- [rules/cec-site-link-rules.json](rules/cec-site-link-rules.json)：CEC SPA / CMS site link rules 範例。

## 歸檔入口

- [archive/V1_5_4_RELEASE_PROVENANCE_NOTE.md](archive/V1_5_4_RELEASE_PROVENANCE_NOTE.md)：`v1.5.4` artifact build source 與 tag target 的 historical provenance exception 紀錄。
- [archive/P13_HTTP_VALIDATION_RESILIENCE_CLOSURE.md](archive/P13_HTTP_VALIDATION_RESILIENCE_CLOSURE.md)：P13 HTTP Validation Resilience 最終 disposition、acceptance / real-site regression evidence 與收尾紀錄。
- [archive/P14_RESULT_INTERPRETATION_HANDOFF_ASSESSMENT.md](archive/P14_RESULT_INTERPRETATION_HANDOFF_ASSESSMENT.md)：P14 管理導向結果呈現與交辦 necessity review、既有能力稽核及最終 disposition。
- [archive/README.md](archive/README.md)：歸檔文件索引。
- [archive/CURRENT_STATE_2026-08-03.md](archive/CURRENT_STATE_2026-08-03.md)：2026-08-03 根 ROADMAP 收斂前的目前狀態、v1.0.4 摘要與已完成階段總覽。
- [archive/ROADMAP_HISTORY.md](archive/ROADMAP_HISTORY.md)：P0-P5.5 已完成里程碑的詳細歷史。
- [archive/PROJECT_ASSESSMENT_2026-07-18.md](archive/PROJECT_ASSESSMENT_2026-07-18.md)：2026-07-18 完整專案評估。
- [archive/P9_GUI_ANALYZER_ASSESSMENT.md](archive/P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 改善、NDJSON sidecar、Analyzer 匯入與 rules schema / trace 的評估及驗收紀錄。
- [archive/P12_2A_XML_SITEMAP_FALLBACK_RECORD.md](archive/P12_2A_XML_SITEMAP_FALLBACK_RECORD.md)：P12-2A `/sitemap.xml` 自動 fallback 規劃、TYCG 實證與唯讀實作稽核。
- [archive/MAINTENANCE_FOUNDATION_2026-08-25.md](archive/MAINTENANCE_FOUNDATION_2026-08-25.md)：Unified regression runner 與 release fail-fast automation 完成記錄。
- [archive/README_2026-07-22_PRE_DOCS_REFRESH.md](archive/README_2026-07-22_PRE_DOCS_REFRESH.md)：本次整理前的根 README 快照。
- [archive/ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md](archive/ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md)：本次整理前的根 ROADMAP 快照。

## 維護原則

- 根 README 保持短而可操作，避免塞入驗收流水帳。
- 根 ROADMAP 只放目前狀態、下一步、延後項目與決策邊界。
- 已完成階段的長篇設計、驗收結果與歷史判斷放入 `archive/`。
- 新增文件時，請同步更新本索引與必要的 archive 索引。
