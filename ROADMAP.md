# 開發路線圖

更新日期：2026-08-26

本文件只保留目前狀態、當前焦點、後續候選、延後項目與長期決策邊界。使用說明請看 [README.md](README.md)，文件導覽請看 [docs/README.md](docs/README.md)，已完成階段與歷史判斷請看 [docs/archive/README.md](docs/archive/README.md)。

## 目前狀態

- 最新正式版本仍是 `v1.3.1`。
- 目前沒有已知 release blocker。
- Production 靜態掃描流程是目前支援的產品主線。
- 目前靜態探索 baseline 包含 HTML sitemap fallback 與慣例 `/sitemap.xml` fallback。
- 專案已有 canonical full regression 入口與 formal release validation foundation。

## 產品邊界

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 保守處理外部網站限制、rate limit、WAF、Bot challenge、CAPTCHA、timeout 與 TLS 類結果，並明確標示需要人工確認。
- 預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- `report.json` 是主要資料契約；CSV 與 NDJSON sidecar 是交辦、分析與大型資料的輔助入口。
- Site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler hostname 特例。

## Current Focus

### Static Discovery Resilience

目前優先方向是 evidence-driven Static Discovery Resilience / real-site compatibility。

- 先用真實網站或 weak-frontier 案例檢查目前靜態 pipeline 是否足夠。
- 如果證據顯示通用 discovery 缺口，再評估 robots-advertised sitemap。
- 如果證據主要顯示使用者可能誤解掃描覆蓋程度，再評估 incomplete coverage notice。
- 如果目前靜態 pipeline 已足夠，不增加 discovery 複雜度。
- 任何新增 discovery seed 都必須沿用既有 canonicalization、URL security policy、crawl scope、scheduler / rate controls、HTTP validation 與 report pipeline。
- 不為單一 hostname 寫 crawler 特例。

P12-2B robots-advertised sitemap 與 P12-3 incomplete coverage notice 都是候選，不是已授權承諾。

## Future Candidates

以下項目只作為後續版本候選，不代表已授權或承諾實作。

| 項目 | 邊界 |
| --- | --- |
| GUI rules URL input | 讓使用者不必切 CLI 就能載入 site-specific rules；需保留安全提示、錯誤呈現與權限邊界。 |
| Fragment / duplicate anchor optional check | 補足頁內品質提醒；不影響壞連結主判讀。 |
| Report Analyzer large-file UX improvement | 優先沿用 NDJSON sidecar，不急著改主契約。 |
| External-risk handoff / governance refinement | 強化交辦欄位與規則來源可追溯性；不得擴張成完整治理平台。 |

## Deferred / Evidence-required

| 項目 | Resume 條件 |
| --- | --- |
| Dynamic Render / headless fallback | 只有當靜態 HTML、SPA / payload / static-signal extraction、robots / XML sitemap discovery、fallback seed、HTML navigation 仍漏掉重要連結，且 browser runtime execution 明確補到重要連結時才恢復評估。 |
| Report-diff legacy / ambiguous input hardening | Duplicate-key policy 與 legacy / manual value normalization 暫緩；只有 real imported reports 或 report-contract requirements 需要政策決定時才恢復。期間維持 deterministic warnings，避免猜測。 |
| Public-trust code signing | 需另行評估正式對外散布需求、憑證成本、簽章流程與長期維護責任。 |

## Maintenance Baseline

- `scripts/run-tests.ps1` 是 canonical full regression entry。
- Formal release flow 維持 automated precheck -> manual publication -> automated read-only verify。
- Formal release artifacts 必須對齊同一個 source commit。
- Portable artifacts 每次 formal release 都要重新產生。
- 詳細維護慣例、release gate、文件分層與歷史記錄分別放在 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)、[docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)、[docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。
