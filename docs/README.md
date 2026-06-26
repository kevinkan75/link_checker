# Documents

本目錄保存現行技術文件、歷史 roadmap、歸檔分析報告與規則範例。現行開發主線請看根目錄的 [ROADMAP.md](../ROADMAP.md)。

## 文件索引

- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md)：架構、掃描流程、資料模型、report schema、GUI API 與可重用設計點。
- [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md)：P6 report-to-report diff 的 normalization 原則。
- [P6_PREFLIGHT_ASSESSMENT.md](P6_PREFLIGHT_ASSESSMENT.md)：P6 實作前的前置完成度與測試補強評估。
- [P6_IMPLEMENTATION_ANALYSIS.md](P6_IMPLEMENTATION_ANALYSIS.md)：P6 實作範圍、切分、驗收與風險分析。
- [P6_5A_ASSESSMENT.md](P6_5A_ASSESSMENT.md)：P6.5a 實作前評估、切分、風險與驗收建議。
- [ROADMAP_HISTORY.md](ROADMAP_HISTORY.md)：已完成里程碑、驗收矩陣與設計理由。
- [rules/cec-site-link-rules.json](rules/cec-site-link-rules.json)：CEC site link rules 範例。

## 歸檔文件

- [archive/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md](archive/CEC_SPA_SCAN_IMPROVEMENT_REPORT.md)：CEC / Nuxt 掃描問題分析；P5.5 已依此完成。
- [archive/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md](archive/SPA_LINK_EXTRACTION_IMPLEMENTATION_NOTES.md)：SPA payload extraction 與 site link rules 的實作筆記；P5.5 已依此完成。

## 狀態

- P0-P5.5 完成紀錄集中在 `ROADMAP_HISTORY.md`。
- P6 report-to-report diff 第一版已完成，實作入口是根目錄的 `report-diff.mjs`，測試入口是 `test-report-diff.mjs`。
- 下一個主要工作是 P6.5a 穩定性修補；實作前評估與分批建議見 `P6_5A_ASSESSMENT.md`。
