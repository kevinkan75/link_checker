# Archive Index

狀態：archive 入口索引。現行主線請看 [../../ROADMAP.md](../../ROADMAP.md)，本文件只負責導覽歷史文件。

本目錄保存已完成階段、歷史分析、驗收紀錄與文件整理紀錄。這些文件用來回查「當時為什麼這樣做」，不是目前主線入口。

目前主線請看 [../../ROADMAP.md](../../ROADMAP.md)，使用入口請看 [../../README.md](../../README.md)，文件總索引請看 [../README.md](../README.md)。

## 使用原則

- 要看下一步：先看 [../../ROADMAP.md](../../ROADMAP.md)。
- 要看目前產品定位與 P9c-2 前評估：看 [PROJECT_ASSESSMENT_2026-07-18.md](PROJECT_ASSESSMENT_2026-07-18.md)。
- 要追已完成里程碑的背景：看 [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md)。
- 要找某階段的實作前分析或驗收理由：看下方階段文件。
- Archive 內容可能包含已完成、延後或被後續決策取代的想法；實作前應回到 Roadmap 與技術規格確認現行邊界。

## 主線歷史與近期決策

| 文件 | 用途 |
| --- | --- |
| [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md) | P0-P5.5 等早期完成里程碑、驗收矩陣與設計理由 |
| [PROJECT_ASSESSMENT_2026-07-18.md](PROJECT_ASSESSMENT_2026-07-18.md) | 2026-07-18 完整專案評估、產品定位校準、P9c-2 建議與延後項目 |
| [DOCUMENTATION_IMPROVEMENT_RECORD.md](DOCUMENTATION_IMPROVEMENT_RECORD.md) | README / ROADMAP / docs 索引整理與採納紀錄 |

## 階段評估與收尾

| 文件 | 階段 | 用途 |
| --- | --- | --- |
| [P6_PREFLIGHT_ASSESSMENT.md](P6_PREFLIGHT_ASSESSMENT.md) | P6 前置 | report diff 前置完成度與測試補強評估 |
| [P6_IMPLEMENTATION_ANALYSIS.md](P6_IMPLEMENTATION_ANALYSIS.md) | P6 | report-to-report diff 實作範圍、切分、驗收與風險分析 |
| [P6_5A_ASSESSMENT.md](P6_5A_ASSESSMENT.md) | P6.5a | 輸出契約、manifest、redaction、body/source limit、Header / Keep-Alive |
| [P6_5B_ASSESSMENT.md](P6_5B_ASSESSMENT.md) | P6.5b | SSRF、partial report、robots / compliance、Retry-After、WAF schema |
| [P7_CACHE_EVALUATION.md](P7_CACHE_EVALUATION.md) | P7 | TTL URL result cache 實作前評估、MVP、風險與驗收建議 |
| [P7_RELEASE_CLOSURE.md](P7_RELEASE_CLOSURE.md) | P7 | P7 發布收尾、驗收結果、使用者可見變更與 P8 交接 |
| [P8_INCREMENTAL_SCAN_ANALYSIS.md](P8_INCREMENTAL_SCAN_ANALYSIS.md) | P8 | incremental scan 範圍邊界、state / sitemap / reused result 與驗收紀錄 |

## GUI、發布與站台案例

| 文件 | 用途 |
| --- | --- |
| [GUI_USABILITY_ASSESSMENT.md](GUI_USABILITY_ASSESSMENT.md) | GUI 易用性第一優先評估與執行紀錄 |
| [RELEASE_SECURITY_ASSESSMENT.md](RELEASE_SECURITY_ASSESSMENT.md) | portable `.cmd` / `.exe`、SmartScreen、防毒警戒與 release security 評估 |
| [CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](CEC_SPA_SCAN_IMPROVEMENT_REPORT.md) | CEC / Nuxt 掃描落差分析，P5.5 已依此完成 |
| [SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md) | SPA payload extraction、site link rules 與 priority queue 實作筆記 |

## 維護提醒

- 新增歸檔文件時，請同步更新本索引與 [../README.md](../README.md)。
- 若某份 archive 文件被後續 Roadmap 決策取代，請在該文件開頭補「狀態」說明。
- 不要把目前下一步只寫在 archive；主線決策應回填到 [../../ROADMAP.md](../../ROADMAP.md)。
