# 開發路線圖

更新日期：2026-08-31

本文件只保留目前狀態、當前焦點、後續候選、延後項目與長期決策邊界。使用說明請看 [README.md](README.md)，文件導覽請看 [docs/README.md](docs/README.md)，已完成階段與歷史判斷請看 [docs/archive/README.md](docs/archive/README.md)。

## 目前狀態

- 最新正式版本：`v1.3.1`。
- 目前沒有已知 release blocker。
- Production 靜態掃描流程是目前支援的產品主線。
- P0-P11 已完成或已驗收；歷史狀態保存在 [docs/archive/CURRENT_STATE_2026-08-03.md](docs/archive/CURRENT_STATE_2026-08-03.md) 與 [docs/archive/ROADMAP_HISTORY.md](docs/archive/ROADMAP_HISTORY.md)。
- P12 Static Discovery Resilience 已完成 P12-1 HTML sitemap fallback、P12-2A 慣例 `/sitemap.xml` fallback 與 P12-3 incomplete coverage notice。
- P13 HTTP Validation Resilience 已完成 P13-1 bounded adaptive HEAD -> GET transport fallback、P13-2 Redirect-to-404/410 Confirmation 與 P13-4 Protection-aware Interpretation。P13-3 Necessity Review 已完成，結論為 SKIPPED / NOT REQUIRED：現有 evidence 沒有發現未被既有邏輯處理的 residual pathological redirect / error-route case；只有出現新的可重現 evidence 才 reopen。P13-5 Necessity Review 亦完成，結論為 SKIPPED / NOT REQUIRED：沒有證明可通用的 bounded request-level recovery path。依目前 evidence，P13 已無待執行 implementation 項目。
- P14 Result Interpretation & Management Handoff 已完成 scope review，依最新 TYCG real-site evidence 縮減為小範圍 management presentation / handoff refinement；目前 implementation 暫停，後續須另行 review 與明確 activation。
- 專案已有 canonical full regression 入口與 formal release validation foundation。

## 產品邊界

Local Link Checker 是本機輔助工具，不是集中式監控平台、CMS、排程系統、WAF bypass 工具或完整治理平台。

- 協助承辦人判讀與交辦，不替使用者做不可逆決策。
- 保持本機執行、localhost-only、可攜式散布與清楚安全邊界。
- 保守處理外部網站限制、rate limit、WAF、Bot challenge、CAPTCHA、timeout 與 TLS 類結果，並明確標示需要人工確認。
- 預設阻擋 private / localhost / metadata / reserved IP；內部掃描需明確開啟。
- `report.json` 是主要資料契約；CSV 與 NDJSON sidecar 是交辦、分析與大型資料的輔助入口。
- 跨次掃描的 status transition、confidence change 與 historical evidence comparison 優先由既有 `report-diff.mjs` 承接，不在 crawler core 建立第二套歷史狀態資料庫。
- Site-specific 邏輯應放在 rules 檔，不要硬寫進 crawler hostname 特例。

## Current / Next

### P12 Static Discovery Resilience

P12 保持既有名稱與範圍；後續只做 evidence-driven refinement，不重新命名已完成階段。

| 項目 | 狀態 | 邊界 |
| --- | --- | --- |
| P12-1 HTML Sitemap Fallback | DONE | 已完成；弱 initial frontier 時嘗試受限 HTML sitemap / site-navigation 候選。 |
| P12-2A Conventional XML `/sitemap.xml` Fallback | DONE | 已完成；只在 no explicit sitemap + empty initial same-origin frontier 時嘗試同站慣例 `/sitemap.xml`，並沿用既有 sitemap pipeline。 |
| P12-3 Incomplete Coverage Notice | DONE | 重用既有 `runStatus`、page budget、sitemap seed 與 validation queue evidence；清楚分離 coverage / completion 與 `scanQuality`，不新增 discovery engine，不修改 report schema version。 |
| P12-2B robots-advertised sitemap | CANDIDATE / EVIDENCE-REQUIRED | 保留候選；目前 real-site evidence 尚未證明它應排在 P12-3 前面，也不是已承諾實作。 |

P12-3 已支援的 coverage reason 至少包含：

- Discovery coverage：`max_pages_reached`、`sitemap_seed_truncated`。
- Validation coverage：`validation_incomplete`、`stopped_by_user`。

`scanQuality`、run completion、validation completion 與 discovery coverage 是不同概念。`runStatus = complete` 只代表本次排定的 validation 已執行完畢，不代表整個網站 discovery coverage 完整；例如 `pagesCrawled` 達 `maxPages` 或 sitemap discovered URLs 大於 seeded URLs 時，即使 validation 已完成，仍應提示 coverage limitation。

### P13 HTTP Validation Resilience

P13 是 P12 之後的正式後續 Phase，目標是提高 HTTP validation 可靠性，降低由 HEAD 行為、暫時性 network failure、特殊 redirect、WAF / Bot protection 造成的誤判與不必要人工判讀。

P13 採 reuse-first 原則：優先擴充既有 `fetchUrl()`、HEAD -> GET fallback、retry / scheduler、redirect handling、404/410 confirmation、protection detection 與 interpretation pipeline；除非既有 abstraction 無法承接，不建立平行 validation / confirmation framework。多次桃園 real-site regression 顯示，單純降低 global concurrency 或增加 delay 並未穩定降低 HEAD transport uncertainty，因此後續仍以 targeted evidence-driven validation / interpretation 修正為主，而不是把 global slowdown 當主要修正策略。

目前狀態：

| 項目 | 狀態 | 邊界 |
| --- | --- | --- |
| P13-1 Extend Existing HEAD -> GET Fallback for Transport Failures | DONE | 已完成 bounded adaptive HEAD -> GET transport fallback；只適用 eligible same-origin page-like HEAD-first validation，沿用既有 retry budget、scheduler、redirect、安全政策與 Referer，並以 additive `transportFallback` evidence 與 adaptive method cache policy 保持相容；不建立平行 validation engine，既有 HTTP-response fallback 仍是獨立路徑。 |
| P13-2 Redirect-to-404/410 Confirmation | DONE | 已 generalize 既有 404/410 confirmation candidate selection，使 eligible URL -> redirect -> final 404/410 進入 existing confirmation scheduler、GET confirmation、Referer、client redirect evidence 與既有 `confirmed_missing` / `recovered` / `needs_review` outcome semantics；confirmation outcome 會尊重既有 protection uncertainty，`redirect_to_error` interpretation 亦會使用 formal confirmation evidence。不建立第二套 confirmation framework，report schema version 未修改。 |
| P13-3 Residual Redirect / Error-route Hardening | SKIPPED / NOT REQUIRED | Necessity Review 已完成。P13-2 與 P13-4 已覆蓋目前已知 redirect semantic issues；未發現可重現、通用、具使用者影響且未被既有邏輯處理的 residual redirect / error-route pathology，因此不啟動 implementation。只有新的可重現 evidence 才 reopen；不重寫 manual redirect、redirect loop、max redirects 或 `redirect_to_error` handling，不因 `/notfound` path 名稱直接判定失效，不加入 hostname-specific workaround。 |
| P13-4 Protection-aware Interpretation | DONE | 已完成 interpretation precedence correction；沿用既有 WAF / Bot / Cloudflare detection、body / header protection evidence、protection metadata 與 `hasMeaningfulProtectionEvidence()`。當 `redirect_to_error` 同時存在 protection uncertainty 且沒有 formal `confirmed_missing` evidence 時，使用者判讀改為 `needs_review` / `external_limited`；P13-2 `confirmed_missing` -> `action_required` semantics 保持不變。未新增 detector，未修改 redirect engine、confirmation framework、report schema、GUI 或 dependencies。 |
| P13-5 Special Endpoint HEAD Recheck | SKIPPED / NOT REQUIRED | Necessity Review 已完成；不得建立 Facebook-specific validation engine、不得擴充 generic 400 fallback 或將 social 400 一律降級，confirmed external GET 404/410 仍應可成為 actionable issue。只有新的可重現 evidence 證明通用且 bounded 的 request-level fix 才 reopen。 |

P13-1 implementation 已完成；focused tests、canonical regression 與 real-site request-path regression 已通過。實站 activated transport recovery effectiveness 仍是 observational / pending：既有 TYCG targeted regression 沒有重新觸發 adaptive transport fallback，觀察到的是既有 HTTP-response / redirect fallback 路徑，因此不把 real-site effectiveness 寫成已證明，也不把它列為 P13-1 完成 blocker。

P13-2 implementation 已完成；focused tests、canonical regression（40/40）與 targeted real-site regression 均通過。既有 TYCG baseline 所抽取的 20 個 eligible redirect-to-404/410 samples 均進入 formal confirmation，20/20 再確認為 `confirmed_missing`，semantic mismatch 為 0。real-site 本次未自然觀察到 recovered 或 protection case；相關路徑已由 deterministic local tests 驗證。

P13-4 implementation 已完成；focused test、P13-2 regression 與 canonical regression（41/41）均通過。Targeted real-site regression 自然觀察到 1 個 protection / redirect precedence sample，修正後 interpretation 符合 `needs_review` / `external_limited` semantics，semantic mismatch 為 0；另抽查 P13-2 `confirmed_missing` real-site sample，仍維持 `action_required`，未發現 regression。

P13-3 Necessity Review 已完成：reproducible candidates、generic candidates、user-impacting candidates 與符合全部 activation criteria 的 candidates 均為 0。`redirect -> 404/410` confirmation 屬 P13-2，redirect + protection precedence 屬 P13-4；social-share HEAD noise 屬 P13-5，original / final URL scope semantics 屬 P14 / later interpretation scope。P13-3 不啟動 implementation；只有新的可重現 evidence 才 reopen。

P13-5 Necessity Review 已完成：三次 TYCG scans 的 120 個 social/share results 均為 HEAD 400；既有 generic HEAD -> GET fallback 不涵蓋 400。代表性 social/share URL 的 targeted replay 顯示 normal scanner GET 與 pure `BROWSER_USER_AGENT` GET 均為 400，未證明 bounded request-level recovery path。因此不啟動 implementation；generic 400 fallback expansion 與 social-specific downgrade semantics 均不受目前 evidence 支持。只有新的可重現 evidence 證明通用且 bounded 的 request-level fix 才 reopen。

P13 status：3 DONE、2 SKIPPED / NOT REQUIRED、0 remaining implementation items。Implemented DONE = 3/5；disposition resolved = 5/5（3 DONE + 2 SKIPPED）。此 item-count / disposition count 不代表固定剩餘工作量，也不代表 skipped 項目已實作完成。

P13 子項編號代表既有規劃識別，不強制等同實際 implementation sequence；conditional 項目應由 regression evidence 決定是否進入實作。

### P14 Result Interpretation & Management Handoff

狀態：`PLANNED / SCOPE REDUCED / IMPLEMENTATION PAUSED`。

P14 不重新打開 P10 或 P13；它是小範圍的 management presentation / handoff refinement，不是 crawler correctness 或額外 validation work。最新 TYCG real-site evidence 顯示，目前 technical validation 與 interpretation 已足以支援現階段產品；剩餘較高價值缺口主要在 operator presentation 與 handoff。

最新 TYCG evidence：

- `2,939` URLs checked；`21` `action_required`。
- `57` review-oriented results（`14` `external_limited` + `43` `likely_problem`）。
- scan execution complete；discovery coverage incomplete，原因為 `sitemap_seed_truncated` 與 `max_pages_reached`。

P14 後續如經 review 明確 activation，優先評估順序：

1. **Coverage Context**：重用既有 `coverage.status`、`coverage.reasons`、`coverage.details`，清楚區分 scan execution completion 與 discovery coverage completeness，避免將「scan complete」表達為全站完整涵蓋。
2. **Management Summary**：重用既有 interpretation 作為 presentation aggregation：`action_required` 為「需處理」；`needs_review`、`external_limited`、`likely_problem` 為「需確認」；`ok`、`redirect_ok` 為「正常／目前可用」；`page_quality_notice` 為「品質提醒」。不建立新的 crawler classification 或 schema contract。
3. **Link Scope**：重用 URL / origin / external-link evidence 呈現「本站」與「外部連結」，協助判斷責任與交辦路徑；不建立 crawler-side scope engine。
4. **Report Analyzer Reuse**：只在能降低 operator review effort 時，重用相同 management presentation model，以「management status -> internal / external -> technical detail」呈現；不建立新 Analyzer。

目前延後（`DEFERRED / EVIDENCE-REQUIRED`）：新的 `managementStatus` report/schema layer、report schema version change、CSV / handoff export expansion、新 crawler validation logic、新 technical classification enums、HEAD / GET behavior changes、social-platform-specific validation、WAF / Bot detection expansion，以及 Dynamic Render / headless browser activation。

P14 目標是讓非技術承辦人能快速判斷需處理與需確認項目、本站或外部責任，以及 scan coverage 是否完整。Implementation 目前暫停；本步僅完成 documentation decision，後續 implementation 必須另行 review 與明確 activation。

P13 HTTP validation 相關的既有 real-site evidence 與歷史判斷保存在 [docs/archive/P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md](docs/archive/P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md)；本次 P14 scope decision 以本節所列最新 TYCG evidence 為目前決策依據。

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
| Report-diff legacy / ambiguous input hardening | 維持 deferred；duplicate-key policy 與 legacy / manual value normalization 暫緩。跨次掃描比較仍優先沿用既有 `report-diff.mjs`，但不因此提升為 Current / Next。 |
| Public-trust code signing | 需另行評估正式對外散布需求、憑證成本、簽章流程與長期維護責任。 |

## Maintenance Baseline

- `scripts/run-tests.ps1` 是 canonical full regression entry。
- Formal release flow 維持 automated precheck -> manual publication -> automated read-only verify。
- Formal release artifacts 必須對齊同一個 source commit。
- Portable artifacts 每次 formal release 都要重新產生。
- 詳細維護慣例、release gate、文件分層與歷史記錄分別放在 [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md)、[docs/CLI_REFERENCE.md](docs/CLI_REFERENCE.md)、[docs/README.md](docs/README.md) 與 [docs/archive/README.md](docs/archive/README.md)。
