# 開發路線圖

更新日期：2026-09-25

本文件只保留目前狀態、當前焦點、後續候選、延後項目與長期決策邊界。使用說明請看 [README.md](README.md)，文件導覽請看 [docs/README.md](docs/README.md)，已完成階段與歷史判斷請看 [docs/archive/README.md](docs/archive/README.md)。

## Current State

- 目前沒有已知 release blocker；`v1.4.1` maintenance release 已完成 correctness stabilization 與 release validation foundation。
- `v1.5.0` formal release 已完成 Static Discovery refinement 與 Analyzer maintenance cleanup；`v1.5.1` 已發布 accuracy / false-positive corrections；`v1.5.2` 收斂 GUI、portable packaging、host diagnostics 與 Report Analyzer 的 maintenance refinements；最新正式版本 `v1.5.3` 已完成 packaging-only maintenance patch。
- Production 靜態掃描流程是目前支援的產品主線。
- P12、P13、P14 均沒有目前待執行的已授權 implementation item。
- 專案已進入 maintenance / evidence-driven refinement 階段，並保有 canonical full regression 與 formal release validation foundation。

## Current Focus

目前專案階段是 maintenance / evidence-driven refinement。只依新的 deterministic evidence 啟動範圍明確的 correctness refinement；不因候選項目存在而自動擴張產品範圍或變更 report schema。

後續工作以 real-site evidence、實際使用問題、regression evidence 與維護成本作為是否啟動 Future Candidate 的依據；Roadmap 中存在候選項目不代表自動進入實作。

## Next Candidates

以下項目只作為後續候選，不代表已授權或承諾實作。

| Candidate | Status | Activation criteria / Boundary |
| --- | --- | --- |
| GUI rules URL input | CANDIDATE | 讓使用者不必切 CLI 即可載入 site-specific rules；必須保留安全提示、錯誤呈現與權限邊界。 |
| Fragment / duplicate anchor optional check | LOW PRIORITY | 已有 real-site evidence 顯示 HTTP 200 不代表 `#fragment` 目標存在；定位為 optional quality check，不影響 broken-link core judgment。 |
| Report Analyzer large-file UX improvement | EVIDENCE-REQUIRED | 優先評估現有 `report.json` 處理流程及 NDJSON compatibility input 的 UX 改善；不因大型檔案需求恢復預設 NDJSON sidecar 輸出。只有實際效能或記憶體 evidence 顯示現行資料契約不足時，才重新評估 output strategy。 |
| External-risk rule governance refinement | CANDIDATE | 強化規則來源、白名單、分類依據與可追溯性；不擴張成 malware database、threat intelligence platform 或完整治理平台。 |
| P12-2B robots-advertised sitemap | CANDIDATE / EVIDENCE-REQUIRED | 目前 real-site discovery evidence 尚不足，不屬已承諾 implementation；只有現有 static discovery fallback 仍存在實質缺口時才重新評估。 |
| P13-6 Response Body Timeout Lifecycle | EVIDENCE-REQUIRED | 先建立 HTTP headers 立即可用、response body stall 超過 configured `timeoutMs` 的 deterministic fixture；只有可重現 configured timeout 未涵蓋 native fetch body consumption，才 reopen P13 implementation。本候選不授權變更 timeout behavior。 |
| P6.5b-1 DNS Security Boundary Refinement | SECURITY REVIEW / EVIDENCE-REQUIRED | 已知 security `dnsLookup()` 與 native fetch connection 的實際 DNS resolution 未綁定同一 validated address，且 security DNS lookup failure 目前 fail open。後續須獨立完成 threat model、targeted reproduction、minimum design 與 security regression；不得直接將所有 DNS error 改為 fail closed。 |
| P6.5a-3 Legacy TLS Decompressed Body Limit | LOW PRIORITY / EVIDENCE-REQUIRED | legacy TLS path 目前先以 `readBuffer(maxBytes)` 限制 compressed bytes，再進行 gzip / deflate sync decompression。只有新的安全或資源 evidence 才評估；目前不修改 legacy TLS。 |
| P6.5b-2 Partial-run Validation Settlement | EVIDENCE-REQUIRED / NOT CONFIRMED | detached validation tasks 理論上可能在 partial / failed report snapshot 後才 settle，但目前沒有 deterministic evidence；先重現再決定是否需要 bounded correction。 |

## Deferred / Evidence-required

| 項目 | Resume 條件 |
| --- | --- |
| Dynamic Render / headless fallback | DEFERRED / EVIDENCE-REQUIRED。Taitung bounded acceptance 已確認 weak-frontier conventional `/sitemap.xml` 能在沒有 explicit `--sitemap` 時補強 discovery，因此目前不提高 Dynamic Render 優先度。只有當靜態 HTML、SPA / payload / static-signal extraction、conventional `/sitemap.xml`、HTML sitemap fallback 與其他安全 discovery 仍漏掉重要連結，且 browser runtime execution 能明確補到重要連結時才恢復評估。 |
| Report-diff legacy / ambiguous input hardening | DEFERRED。duplicate-key policy 與 legacy / manual value normalization 暫緩；跨次掃描比較仍優先沿用既有 `report-diff.mjs`。 |
| Public-trust code signing | EVIDENCE-REQUIRED。需另行評估正式對外散布需求、憑證成本、簽章流程與長期維護責任；目前不是 release blocker。 |

## Completed / Resolved Phases

| Phase | Status | Summary |
| --- | --- | --- |
| P0-P11 | COMPLETE / ACCEPTED | 已完成或驗收；歷史狀態由 [CURRENT_STATE_2026-08-03.md](docs/archive/CURRENT_STATE_2026-08-03.md) 與 [ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md) 承接。 |
| P12 Static Discovery Resilience | COMPLETE / REFINEMENT ONLY | HTML sitemap fallback、weak initial frontier（0–1 個 crawlable same-origin page）的 conventional `/sitemap.xml` fallback 與 incomplete coverage notice 已完成；sitemap seed truncation 只依 direct page-budget omission evidence 判定。robots-advertised sitemap 維持 evidence-required candidate。 |
| P13 HTTP Validation Resilience | RESOLVED | P13-1、P13-2、P13-3、P13-4 DONE；P13-5 SKIPPED / NOT REQUIRED。4 DONE、5 / 5 disposition resolved、0 remaining implementation items。P13-3 因新 deterministic evidence 確認 3xx without `Location` 可保留 `ok=true` 並漏出 `broken[]`，已沿用既有 redirect failure semantics 完成 bounded correction。維持 reuse-first，不建立平行 validation / confirmation engine、不擴充 generic 400 fallback、不建立 Facebook-specific workaround，且 protection uncertainty 不可蓋過 formal `confirmed_missing` semantics。詳細 acceptance、skip rationale 與 regression evidence 見 [P13_HTTP_VALIDATION_RESILIENCE_CLOSURE.md](docs/archive/P13_HTTP_VALIDATION_RESILIENCE_CLOSURE.md)。 |
| P14 Result Interpretation & Management Handoff | REVIEW COMPLETE / NO IMPLEMENTATION | necessity review complete；既有功能已主要承接需求，目前無 justified implementation item。`P14_AS_SEPARATE_IMPLEMENTATION_PHASE = NOT_JUSTIFIED`；`P14_IMPLEMENTATION_ITEMS_JUSTIFIED_NOW = 0`。Link Scope filter 已移至 Next Candidates；詳細 evidence 見 [P14_RESULT_INTERPRETATION_HANDOFF_ASSESSMENT.md](docs/archive/P14_RESULT_INTERPRETATION_HANDOFF_ASSESSMENT.md)。 |

2026-09 maintenance refinement 同時移除 redundant `analyzer.cmd` launcher；Analyzer 功能仍由 main GUI 提供，選檔後自動分析，不再呈現第二個 Analyze action 或三步 stepper。這是既有產品面的精簡，不建立新的 Analyzer phase。

## Architecture / Product Guardrails

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 保守處理外部網站限制、rate limit、WAF、Bot challenge、CAPTCHA、timeout 與 TLS 類結果，並明確標示需要人工確認。
- 預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- `report.json` 是主要資料契約，`broken.csv` 是目前一般交辦輸出；舊有或另行取得的 `external-links.csv` 與 `external-links.ndjson` 僅作為 Analyzer 相容匯入及資料分析的輔助入口，非目前預設掃描輸出。
- 跨次掃描的 status transition、confidence change 與 historical evidence comparison 優先由既有 `report-diff.mjs` 承接，不在 crawler core 建立第二套歷史狀態資料庫。
- Site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler hostname 特例。

## Maintenance Baseline

- `scripts/run-tests.ps1` 是 canonical full regression entry。
- Formal release artifacts 必須對齊同一個 source commit。
- Portable artifacts 每次 formal release 都要重新產生。
- 詳細維護慣例、release gate、文件分層與歷史記錄分別放在 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)、[docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)、[docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。
