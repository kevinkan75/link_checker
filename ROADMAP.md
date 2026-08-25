# 開發路線圖

更新日期：2026-08-25

本文件只保留目前狀態、近期維護主線、下一步候選與決策邊界。已完成階段與歷史判斷請看 [docs/archive/README.md](docs/archive/README.md)。

## 目前狀態

- 最新正式版本仍是 `v1.3.0`。
- 目前沒有已知 release blocker。
- Production 靜態掃描流程仍是目前支援的產品主線；Dynamic Render / headless fallback 研究已保存但延後，且不是 release blocker。
- 目前產品優先方向仍是 Static Discovery Resilience / real-site compatibility。
- P12-1 HTML Sitemap Fallback 已完成。
- P12-2A Conventional XML Sitemap Fallback 已完成；詳細記錄見 [docs/archive/P12_2A_XML_SITEMAP_FALLBACK_RECORD.md](docs/archive/P12_2A_XML_SITEMAP_FALLBACK_RECORD.md)。
- 下一步應先收集 real-site / weak-frontier 證據，再評估是否需要 P12-2B robots-advertised sitemap 或 P12-3 incomplete coverage notice；兩者目前都是候選，不是已授權承諾。
- MAINT-FND-1 Unified Regression Runner 已完成；正式 regression 入口為 `scripts/run-tests.ps1`。
- MAINT-FND-2 Release Fail-Fast Automation 已完成；專案已有 release preflight、manual publication boundary 與 post-publication verification。完成記錄見 [docs/archive/MAINTENANCE_FOUNDATION_2026-08-25.md](docs/archive/MAINTENANCE_FOUNDATION_2026-08-25.md)。
- 主 GUI 預設檢查外部連結；CLI 仍維持保守預設，需要 `--external` 才檢查外部連結。
- 三個 GUI 功能頁是「連結檢查」、「外部連結分析」、「報告分析」。

## 產品邊界

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF 繞過工具或完整治理平台。

目前要守住的方向：

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 讓掃描結果可用 Excel / CSV / JSON / NDJSON 交辦、存查與分析。
- 外部連結治理只做基礎 inventory、risk rules 與可追溯規則來源，不擴張成完整治理平台。
- 發布自動化只負責 machine-checkable precheck / verify；tag、GitHub Release 與 asset publication 維持人工操作。

## 近期維護主線

### Static Discovery Resilience / real-site compatibility

狀態：目前產品優先方向。

- 先用真實網站或弱 frontier 案例確認 P12-1 / P12-2A 是否已足夠。
- 若證據顯示仍有通用缺口，再評估 robots-advertised sitemap 或 incomplete coverage notice。
- 所有新增 discovery seed 仍必須走既有 canonicalization、URL security policy、crawl scope、scheduler / rate controls、HTTP validation 與 report pipeline。
- 不為單一 hostname 寫特殊邏輯；站台特定補強應放在 rules 檔。

### Release 維護

狀態：持續維護。

- 每次正式 release 都要重新產生 portable package。
- `LinkChecker-portable.zip`、external manifest、package manifest 與 `.sha256` 必須對齊同一個 source commit。
- Release notes 必須列出 source commit、zip SHA256、launcher 簽章狀態、Node runtime 簽章狀態與 smoke test 結果。
- Formal release flow 維持：automated precheck -> manual publication -> automated read-only verify。

### 文件維護

狀態：持續維護。

- 根 README 面向使用者，保留快速開始、預設值、輸出、判讀與安全邊界。
- 根 ROADMAP 面向維護者，只保留目前狀態、下一步與延後項目。
- `docs/PROJECT_CONTEXT.md` 保存共享維護慣例與決策邊界。
- `docs/TECHNICAL_SPEC.md` 保存目前技術契約。
- 詳細設計、驗收紀錄與歷史討論放入 `docs/archive/`。
- 新增或移動文件時，同步更新 [docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。

## 下一階段候選

以下項目只作為後續版本候選，不代表已授權或承諾實作。

| 項目 | 價值 | 注意事項 |
| --- | --- | --- |
| Static Discovery Resilience follow-up | 累積 real-site / weak-frontier 證據，評估 robots-advertised sitemap 與不完整覆蓋提醒 | 優先保留既有 crawler/security/report pipeline；不得為單一 hostname 寫特殊邏輯 |
| P12-2B robots-advertised sitemap | 補足 robots.txt 宣告 sitemap 的通用 discovery case | 需先有 real-site evidence；仍須沿用既有 sitemap fetch / parse / seed pipeline |
| P12-3 incomplete coverage notice | 讓使用者知道本次掃描可能未完整涵蓋重要內容 | 應是 report / UI 診斷提示，不應改判掃描結果 |
| GUI rules URL 輸入欄位 | 讓使用者不必切 CLI 就能載入 site-specific rules | 需設計安全提示、錯誤呈現與權限邊界 |
| Fragment / duplicate anchor 檢查 | 補足頁內品質提醒 | 屬 optional 品質檢查，不應影響壞連結主判讀 |
| 更完整的 release page template | 降低每次發版人工漏項 | 應包含 artifact、SHA256、簽章狀態與 smoke 結果 |
| Report Analyzer 大型檔案體驗改善 | 讓大型 report 的人工檢視更順 | 優先沿用 NDJSON sidecar，不急著改主契約 |
| 更細的 external risk governance 欄位 | 方便外連治理與交辦 | 需避免把工具膨脹成完整治理平台 |

## 延後項目

這些項目有價值，但目前不應插入 patch release 或阻擋既有正式版維護。

| 項目 | 延後理由 |
| --- | --- |
| Scheduler / 平台化監控 | 超出本機輔助工具定位 |
| 複雜 suppress rules | 需要更完整治理流程，暫不納入近期版本 |
| 多種技術型 profile presets | 目前保留簡化掃描模式，避免增加操作負擔 |
| Dynamic Render / headless fallback 後續工作 | 研究保存；後續 implementation 依產品範圍暫緩，不是 release blocker |
| `report.json` streaming parser | 已先用 NDJSON sidecar 和「載入更多」降低大型 report 痛點 |
| 集中式規則平台 | 目前只補 schema、trace 與安全載入，不建立多人審核或發布流程 |
| 公開信任 code signing | 對正式對外散布有價值，但需另行評估憑證成本、流程與維護責任 |

## 全域原則

- 掃描邊界：先維持 DOM / HTML / SPA payload / site rules 抽取，不預設引入 headless browser。
- Dynamic Render resume 邊界：只有當靜態 HTML、SPA / payload / static-signal extraction、robots / XML sitemap discovery、保守 fallback seed、HTML site-map / site-navigation discovery 仍無法覆蓋重要連結，且 Browser runtime DOM execution 明確提供額外重要連結時，才重新列為 active product candidate。
- 規則邊界：site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler。
- 外連邊界：保守處理 rate limit、WAF、Bot challenge 與 timeout，並明確標示需要人工確認。
- 安全邊界：預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- 合規邊界：不偽裝 Googlebot，不繞過 CAPTCHA，不把工具定位成 WAF bypass。
- 輸出邊界：`report.json` 是主契約；NDJSON sidecar 是大型資料的輔助入口。
- 版本邊界：patch release 只應包含修正、文件、文案與 release packaging 小修；若改 report schema、CLI 契約或掃描策略，應評估 minor 版本。

## 文件入口

| 主題 | 文件 |
| --- | --- |
| 使用者入口 | [README.md](README.md) |
| CLI 參數、portable package 與 formal release verification | [docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md) |
| 技術流程與 report schema | [docs/TECHNICAL_SPEC.md](docs/TECHNICAL_SPEC.md) |
| 共享維護脈絡與 release gate 原則 | [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md) |
| Report normalization / diff | [docs/REPORT_NORMALIZATION.md](docs/REPORT_NORMALIZATION.md) |
| 文件索引 | [docs/README.md](docs/README.md) |
| 已完成里程碑與維護記錄 | [docs/archive/README.md](docs/archive/README.md) |
