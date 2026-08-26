# 開發路線圖

更新日期：2026-08-26

本文件只保留目前狀態、當前焦點、後續候選、延後項目與長期決策邊界。使用說明請看 [README.md](README.md)，文件導覽請看 [docs/README.md](docs/README.md)，已完成階段與歷史判斷請看 [docs/archive/README.md](docs/archive/README.md)。

## 目前狀態

- 最新正式版本：`v1.3.1`。
- 目前沒有已知 release blocker。
- Production 靜態掃描流程是目前支援的產品主線。
- P0-P11 已完成或已驗收；歷史狀態保存在 [docs/archive/CURRENT_STATE_2026-08-03.md](docs/archive/CURRENT_STATE_2026-08-03.md) 與 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)。
- P12 Static Discovery Resilience 已完成 P12-1 HTML sitemap fallback 與 P12-2A 慣例 `/sitemap.xml` fallback。
- 近期 real-site evidence 顯示主要瓶頸已從 URL discovery 轉向 coverage/completion 提示與 HTTP validation reliability。
- 專案已有 canonical full regression 入口與 formal release validation foundation。

## 產品邊界

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 保守處理外部網站限制、rate limit、WAF、Bot challenge、CAPTCHA、timeout 與 TLS 類結果，並明確標示需要人工確認。
- 預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- `report.json` 是主要資料契約；CSV 與 NDJSON sidecar 是交辦、分析與大型資料的輔助入口。
- Site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler hostname 特例。

## Current / Next

### P12 Static Discovery Resilience

P12 保持既有名稱與範圍；後續只做 evidence-driven refinement，不重新命名已完成階段。

| 項目 | 狀態 | 邊界 |
| --- | --- | --- |
| P12-1 HTML Sitemap Fallback | DONE | 已完成；弱 initial frontier 時嘗試受限 HTML sitemap / site-navigation 候選。 |
| P12-2A Conventional XML `/sitemap.xml` Fallback | DONE | 已完成；只在 no explicit sitemap + empty initial same-origin frontier 時嘗試同站慣例 `/sitemap.xml`，並沿用既有 sitemap pipeline。 |
| P12-3 Incomplete Coverage Notice | NEXT | 下一個 Static Discovery 優先候選；清楚標示 run coverage / completion，不把它混同於 validation quality。 |
| P12-2B robots-advertised sitemap | CANDIDATE / EVIDENCE-REQUIRED | 保留候選；目前 real-site evidence 尚未證明它應排在 P12-3 前面，也不是已承諾實作。 |

P12-3 規劃的 coverage reason 至少包含：

- Discovery coverage：`max_pages_reached`、`sitemap_seed_truncated`。
- Validation coverage：`validation_incomplete`、`stopped_by_user`。

`scanQuality` 與 coverage / completion 是不同概念。已完成部分的 validation quality 可以正常，但整體 run 仍可能因 `maxPages`、sitemap seed truncation、pending validation 或 user stop 而 incomplete。

### P13 HTTP Validation Resilience

P13 是 P12 之後的正式後續 Phase，目標是提高 HTTP validation 可靠性，降低由 HEAD 行為、暫時性 network failure、特殊 redirect、WAF / Bot protection 造成的誤判與不必要人工判讀。Adaptive retry 優先於 global slowdown，不加入 hostname-specific workaround。

建議優先順序：

1. P13-1 Adaptive HEAD -> GET Validation：same-origin、page-like URL 的 HEAD `ConnectTimeout`、network error 或 ambiguous response，先做 targeted conservative GET retry；不把所有 URL 全面改成 GET，也不只靠降低全域 concurrency。
2. P13-2 Redirect-to-404/410 Confirmation：擴充既有 confirmation pipeline，支援 URL -> redirect -> final 404/410 -> conservative confirmation -> `confirmed_missing` / `recovered` / `needs_review`。
3. P13-3 Redirect / Error-route Validation Hardening：處理 `/notfound` 等 error-route repeated redirect；不因 path 名稱直接判定失效，依最終 HTTP evidence，必要時停止無意義 HEAD chain 並改用 GET confirmation。
4. P13-4 Protection-aware Interpretation：修正 precedence；confirmed missing evidence 優先於 generic uncertainty，但 final response 若是 WAF / Bot / protection challenge 且沒有 confirmed missing evidence，外部連結應進入 needs review / external limited，而非直接 `action_required`。
5. P13-5 Special Endpoint HEAD Recheck：針對 social / share-like endpoint 的 HEAD 4xx noise，評估 GET / browser-like confirmation 或轉入 `needs_review`；規則必須 generic，不以單一網域硬寫。

### P14 Result Interpretation & Management Handoff

P14 不重新打開 P10；它承接 management-oriented presentation / handoff refinement。近期保留既有 technical interpretation enum 與 report contract。

- P14-1 Management Status Layer：在 UI / Analyzer 上新增管理層級「需處理」「需確認」「正常／可用」「品質提醒」。初步 mapping：`action_required` -> 需處理；`needs_review`、`external_limited`、`likely_problem` -> 需確認；`redirect_ok`、`ok` -> 正常／可用；`page_quality_notice` -> 品質提醒。
- P14-2 Link Scope Dimension：管理狀態與 link scope 分開；scope 至少包含「全部」「本站」「外部連結」。External 本身不代表低優先級，已確認失效的外部連結仍可屬於需處理。
- P14-3 GUI Summary / Live Snapshot：未來 GUI KPI 不只看 `brokenLinks` 或待判讀總數，應呈現需處理、需確認、正常／可用，並評估由 gui-server live snapshot 提供與 report 一致的 interpretation summary。
- P14-4 Report Analyzer：第一層以管理行動分組，第二層區分本站 / 外部連結，第三層才呈現 HTTP status、network error、timeout、redirect、WAF / Bot、protection evidence 與 technical classification。
- P14-5 CSV / Handoff Export：近期保留 `broken[]`、`broken.csv`、`broken.ndjson` 名稱與 contract；未來可增加「管理狀態」「連結範圍」等交辦友善欄位。

較完整的 real-site evidence 與規劃理由保存在 [docs/archive/P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md](docs/archive/P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md)。

## Future Candidates

以下項目只作為後續版本候選，不代表已授權或承諾實作。

| 項目 | 邊界 |
| --- | --- |
| GUI rules URL input | 讓使用者不必切 CLI 就能載入 site-specific rules；需保留安全提示、錯誤呈現與權限邊界。 |
| Fragment / duplicate anchor optional check | 已有 real-site evidence 顯示 HTTP page 為 200 但 `#fragment` 目標不存在；定位為 future optional quality check，不影響目前 broken-link core judgment，優先度低於 P13 / P14。 |
| Report Analyzer large-file UX improvement | 優先沿用 NDJSON sidecar，不急著改主契約。 |
| External-risk rule governance refinement | 強化外部風險規則來源、白名單與分類依據可追溯性；交辦呈現由 P14 承接，不擴張成完整治理平台。 |

## Deferred / Evidence-required

| 項目 | Resume 條件 |
| --- | --- |
| Dynamic Render / headless fallback | 維持 deferred。只有當靜態 HTML、SPA / payload / static-signal extraction、慣例 XML sitemap fallback、HTML sitemap fallback 與其他安全 discovery 仍漏掉重要連結，且 browser runtime execution 明確補到重要連結時才恢復評估；目前桃園案例沒有支持恢復 headless priority 的證據。 |
| Report-diff legacy / ambiguous input hardening | Duplicate-key policy 與 legacy / manual value normalization 暫緩；只有 real imported reports 或 report-contract requirements 需要政策決定時才恢復。期間維持 deterministic warnings，避免猜測。 |
| Public-trust code signing | 需另行評估正式對外散布需求、憑證成本、簽章流程與長期維護責任。 |

## Maintenance Baseline

- `scripts/run-tests.ps1` 是 canonical full regression entry。
- Formal release flow 維持 automated precheck -> manual publication -> automated read-only verify。
- Formal release artifacts 必須對齊同一個 source commit。
- Portable artifacts 每次 formal release 都要重新產生。
- 詳細維護慣例、release gate、文件分層與歷史記錄分別放在 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)、[docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)、[docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。
