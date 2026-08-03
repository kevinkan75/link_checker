# Archive Index

本資料夾保存已完成里程碑、實作前評估、驗收紀錄、文件整理紀錄與舊版主文件快照。現行使用說明請看 [../../README.md](../../README.md)，現行開發狀態請看 [../../ROADMAP.md](../../ROADMAP.md)。

## 使用原則

- 查目前狀態：看 [../../ROADMAP.md](../../ROADMAP.md)。
- 查使用方式：看 [../../README.md](../../README.md)。
- 查文件入口：看 [../README.md](../README.md)。
- 查已完成里程碑背景：看 [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md)。
- 查特定階段的取捨與驗收：看下方分類表。

## 主線歷史與文件快照

| 文件 | 說明 |
| --- | --- |
| [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md) | P0-P5.5 等早期完成里程碑、驗收矩陣與設計理由 |
| [CURRENT_STATE_2026-08-03.md](CURRENT_STATE_2026-08-03.md) | 2026-08-03 根 ROADMAP 收斂前的目前狀態、v1.0.4 摘要與 P0-P11 完成總覽 |
| [PROJECT_ASSESSMENT_2026-07-18.md](PROJECT_ASSESSMENT_2026-07-18.md) | 2026-07-18 完整專案評估、產品定位、風險與後續切分建議 |
| [DOCUMENTATION_IMPROVEMENT_RECORD.md](DOCUMENTATION_IMPROVEMENT_RECORD.md) | README / ROADMAP / docs 索引整理與採納紀錄 |
| [README_2026-07-22_PRE_DOCS_REFRESH.md](README_2026-07-22_PRE_DOCS_REFRESH.md) | 2026-07-22 文件整理前的根 README 快照 |
| [ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md](ROADMAP_2026-07-22_PRE_DOCS_REFRESH.md) | 2026-07-22 文件整理前的根 ROADMAP 快照 |

## 階段評估與收尾

| 文件 | 階段 | 說明 |
| --- | --- | --- |
| [P5_5_SPA_LINK_EXTRACTION_RECORD.md](P5_5_SPA_LINK_EXTRACTION_RECORD.md) | P5.5 | CEC / Nuxt 站台掃描問題、SPA payload extraction、site link rules 與 priority queue 設計筆記 |
| [P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md](P6_REPORT_DIFF_AND_CONTRACT_ASSESSMENT.md) | P6 / P6.5 | report diff 前置與實作分析、輸出契約、redaction、body/source limit、SSRF、partial report、robots / compliance、Retry-After、WAF schema |
| [P7_CACHE_ASSESSMENT_AND_RELEASE.md](P7_CACHE_ASSESSMENT_AND_RELEASE.md) | P7 | TTL URL result cache 實作前評估、MVP、發布收尾、驗收紀錄與 P8 銜接 |
| [P8_INCREMENTAL_SCAN_ANALYSIS.md](P8_INCREMENTAL_SCAN_ANALYSIS.md) | P8 | incremental scan、state、sitemap、reused result、GUI / Analyzer 呈現 |
| [P9_GUI_ANALYZER_ASSESSMENT.md](P9_GUI_ANALYZER_ASSESSMENT.md) | P9 | GUI usability 前置評估、GUI / Analyzer 改善、NDJSON sidecar、Analyzer 匯入、rules schema / trace 與驗收紀錄 |

## GUI、發布與站台案例

| 文件 | 說明 |
| --- | --- |
| [RELEASE_SECURITY_ASSESSMENT.md](RELEASE_SECURITY_ASSESSMENT.md) | portable `.cmd` / `.exe`、bundled runtime、SmartScreen 與 release security 評估 |

## 維護提醒

- 新增歸檔文件時，請同步更新本索引。
- 根 README 與 ROADMAP 應保持短、清楚、可行動；長篇設計與驗收紀錄放在 archive。
- 不要把已完成階段的流水帳搬回根 ROADMAP，除非它仍會影響下一個決策。
