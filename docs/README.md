# Documents

本目錄保存現行技術文件、歷史 roadmap、歸檔分析報告與規則範例。現行開發主線請看根目錄的 [ROADMAP.md](../ROADMAP.md)。

## 文件索引

- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md)：架構、掃描流程、資料模型、report schema、GUI API 與可重用設計點。
- [CLI_REFERENCE.md](CLI_REFERENCE.md)：完整 CLI 參數、規則檔格式、Report diff 與進階用法。
- [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md)：P6 report-to-report diff 的 normalization 原則。
- [P9_GUI_ANALYZER_ASSESSMENT.md](P9_GUI_ANALYZER_ASSESSMENT.md)：P9 GUI / Analyzer 改善的實作前評估、P9a / P9b / P9c 實作紀錄與 2026-07-18 整體驗收紀錄。
- [archive/README.md](archive/README.md)：歸檔文件分類索引與維護提醒。
- [archive/GUI_USABILITY_ASSESSMENT.md](archive/GUI_USABILITY_ASSESSMENT.md)：GUI 易用性第一優先評估與執行紀錄。
- [archive/RELEASE_SECURITY_ASSESSMENT.md](archive/RELEASE_SECURITY_ASSESSMENT.md)：`.cmd` / portable `.exe` 降低防毒與 SmartScreen 警戒的 release security 評估。
- [archive/DOCUMENTATION_IMPROVEMENT_RECORD.md](archive/DOCUMENTATION_IMPROVEMENT_RECORD.md)：README / ROADMAP 易讀性與一致性建議採納紀錄。
- [archive/PROJECT_ASSESSMENT_2026-07-18.md](archive/PROJECT_ASSESSMENT_2026-07-18.md)：2026-07-18 完整專案評估、產品定位校準、主要風險、延後項目與 P9c-2 建議範圍。
- [archive/ROADMAP_HISTORY.md](archive/ROADMAP_HISTORY.md)：已完成里程碑、驗收矩陣與設計理由。
- [rules/cec-site-link-rules.json](rules/cec-site-link-rules.json)：CEC site link rules 範例。

## 歸檔文件

- [archive/README.md](archive/README.md)：archive 入口索引；依主線歷史、階段評估、GUI / 發布與站台案例分類。
- [archive/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](archive/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md)：CEC / Nuxt 掃描問題分析；P5.5 已依此完成。
- [archive/P6_PREFLIGHT_ASSESSMENT.md](archive/P6_PREFLIGHT_ASSESSMENT.md)：P6 實作前的前置完成度與測試補強評估；P6 已完成。
- [archive/P6_IMPLEMENTATION_ANALYSIS.md](archive/P6_IMPLEMENTATION_ANALYSIS.md)：P6 實作範圍、切分、驗收與風險分析；P6 已完成。
- [archive/P6_5A_ASSESSMENT.md](archive/P6_5A_ASSESSMENT.md)：P6.5a 實作前評估、切分、風險與驗收建議；P6.5a 已完成。
- [archive/P6_5B_ASSESSMENT.md](archive/P6_5B_ASSESSMENT.md)：P6.5b 實作前評估、切分、風險與驗收建議；P6.5b 已完成。
- [archive/P7_CACHE_EVALUATION.md](archive/P7_CACHE_EVALUATION.md)：P7 TTL URL result cache 的實作前評估、MVP 範圍、風險與驗收建議；P7 已完成。
- [archive/P7_RELEASE_CLOSURE.md](archive/P7_RELEASE_CLOSURE.md)：P7 發布收尾紀錄、驗收結果、使用者可見變更與 P8 交接邊界。
- [archive/P8_INCREMENTAL_SCAN_ANALYSIS.md](archive/P8_INCREMENTAL_SCAN_ANALYSIS.md)：P8 incremental scan 的範圍邊界、舊 report/state 比對、新舊 URL 判斷、sitemap、reused result、GUI / Analyzer 呈現與分階段紀錄；P8 已完成。
- [archive/PROJECT_ASSESSMENT_2026-07-18.md](archive/PROJECT_ASSESSMENT_2026-07-18.md)：P9c-2 前的完整專案健康度評估、產品定位護欄與後續切分建議。
- [archive/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](archive/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md)：SPA payload extraction 與 site link rules 的實作筆記；P5.5 已依此完成。

## 狀態

- P0-P5.5 完成紀錄集中在 `archive/ROADMAP_HISTORY.md`。
- P6 report-to-report diff 第一版已完成，實作入口是根目錄的 `report-diff.mjs`，測試入口是 `test-report-diff.mjs`。
- P6.5a-1 輸出契約基線、P6.5a-2 redaction、P6.5a-3 sources/body limit 與 P6.5a-4 Header/Keep-Alive 已完成。
- P6.5b-1 到 P6.5b-5 已完成，包含 SSRF / URL security policy、partial report、robots / compliance、Retry-After / host diagnostics 與 WAF schema 收斂。
- P7 TTL URL result cache 已完成第一版與發布收尾，實作前評估記錄於 `archive/P7_CACHE_EVALUATION.md`，發布驗收記錄於 `archive/P7_RELEASE_CLOSURE.md`。
- P8 incremental scan 第一版已完成主要功能、呈現收尾與 main 合併，分析與驗收紀錄於 `archive/P8_INCREMENTAL_SCAN_ANALYSIS.md`。
- P9 已完成 GUI / Analyzer 實作前評估；`P9a-1：修正主 GUI 進度語意`、`P9a-2：改善空狀態與第一屏`、`P9a-3：修正手機版可讀性` 與 `P9a-4：匯入型頁面流程化` 已完成第一版並於 2026-07-17 驗收通過。P9a 不再是下一個實作起點。
- P9 已於 2026-07-18 整體驗收。P9b 大型 report / NDJSON 輔助輸出已完成並驗收；GUI log artifacts 會新增 `checked.ndjson`、`broken.ndjson`、`external-links.ndjson`，GUI SSE complete event 不再傳完整 report，Analyzer 具備大檔提示、載入狀態、列表「載入更多」，並可匯入 `broken.ndjson` / `external-links.ndjson`。P9c-1 Rules Schema 與 P9c-2 Rules 追溯 / rules URL 載入安全化已完成並驗收。
- 2026-07-18 完整專案評估已歸檔於 `archive/PROJECT_ASSESSMENT_2026-07-18.md`；結論是專案健康度穩定，P9c-2 已補上 rules 追溯與 rules URL 載入安全基線，下一步改為 P10 報告判讀與交辦友善強化。
- 2026-07-18 Roadmap 已整理為易讀版：主文聚焦目前狀態、產品定位護欄、近期主線、延後項目與索引；已完成階段的細節交由 archive 文件保存。
