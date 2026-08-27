# P13 HTTP Validation Resilience Assessment

狀態：planning record，更新於 2026-08-27。本文記錄 v1.3.1 後的 roadmap 整理、real-site evidence、reuse-first scope refinement 與後續 phase 切分；本次沒有修改 crawler、GUI、report schema、tests 或版本號。

現行使用說明以 [../../README.md](../../README.md) 為準；短版優先順序以 [../../ROADMAP.md](../../ROADMAP.md) 為準；P12-2A 完成紀錄見 [P12_2A_XML_SITEMAP_FALLBACK_RECORD.md](P12_2A_XML_SITEMAP_FALLBACK_RECORD.md)。

## 1. Context

目前正式版本為 `v1.3.1`。P0-P11 已完成或已驗收；P12 Static Discovery Resilience 已完成：

- P12-1 HTML Sitemap Fallback。
- P12-2A Conventional XML `/sitemap.xml` Fallback。

P12-2A 讓 weak initial frontier 可在沒有 explicit `--sitemap` 時嘗試同站慣例 `/sitemap.xml`，並沿用既有 sitemap seed / crawler pipeline。這沒有引入 Dynamic Render、headless browser、新 crawler 或 hostname-specific workaround。

## 2. Existing Implementation Audit

本次 roadmap refinement 先讀取現有 implementation，避免把已存在的能力重複規劃成新的平行系統。觀察到的既有能力包括：

- HTTP validation 已有 `fetchUrl()` / `fetchUrlOnce()`、HEAD first、HEAD -> GET fallback、retry loop、Retry-After cooldown、request scheduler / per-host scheduler。
- HEAD fallback predicate 已涵蓋 403、404、405、501、5xx，以及 `redirect_error`、`redirect_to_error`、`too_many_redirects`、`redirect_loop`。
- Confirmation 已有 `confirmNotFoundResults()`、candidate selection、confirmation scheduler、conservative GET、browser-like User-Agent、Referer、`confirmed_missing`、`recovered`、`needs_review` 與 client redirect evidence。
- Redirect handling 已有 manual redirect、redirect chain、redirect loop detection、max redirects、long redirect、cross-host redirect 與 `redirect_to_error` classification。
- Protection handling 已有 Cloudflare / WAF / Bot detection、body signature、WAF headers、`suspectedWaf`、`suspectedBot` 與 protection metadata。
- External categorization 已有 domain category rules、`social` category 與 external risk metadata。
- P10 interpretation 已有 `action_required`、`needs_review`、`external_limited`、`likely_problem`、`redirect_ok`、`ok`、`page_quality_notice`，並產生 `summary.interpretationByCategory`；GUI / Report Analyzer 已有 interpretation filtering，CSV exporter 也已有 handoff 欄位。

因此 P13 / P14 應優先延伸既有 predicate、candidate selection、classification precedence、summary mapping 與 exporter，而不是建立第二套 validation、confirmation、protection detector、crawler-side management schema 或 Analyzer。

## 3. Real-site Evidence Summary

近期以桃園觀光導覽網 `https://travel.tycg.gov.tw/zh-tw` 進行多次 real-site validation，並以 W3C Link Checker 作為對照。這些觀察屬於 roadmap evidence，不是穩定產品契約，也不應把本機 report、log、大型 JSON 或 W3C output 納入 repository。

目前 evidence 顯示：

- Static discovery 已可透過 conventional `/sitemap.xml` fallback 補足 weak initial frontier。
- 桃園案例尚未提供 P12-2B robots-advertised sitemap 的必要性證據。
- Incomplete coverage notice 有實際需求：`maxPages` 可達上限、sitemap discovered URLs 可大於 seeded URLs、partial scan 仍可能顯示 `scanQuality` 正常、user-stopped run 可能保留大量 pending validations。
- 主要瓶頸已從 URL discovery 轉向 HTTP validation reliability。
- HEAD validation 可能產生大量不穩定 `ConnectTimeout` / network error；降低 global concurrency 只部分改善，且 throughput 下降明顯。
- 真正 redirect -> 404 的 URL 重現性較高，適合納入 confirmation pipeline。
- WAF / Bot / Cloudflare 類 evidence 可能因 `redirect_to_error` precedence 被誤分類為 `action_required`。
- Social/share endpoint 的 HEAD 4xx 可能造成 `likely_problem` noise。
- W3C 對照發現 fragment case，例如 page 本身 HTTP 200，但 `#main-content` 目標不存在；這適合作為 future optional quality check，不應改變目前 broken-link core judgment。

第三次桃園完整掃描提供了額外 evidence：

- Third scan was complete，約 2940 URLs checked，約 138 minutes。
- `network_error` 約 307。
- `needs_review` 約 298。
- `action_required` 約 21。
- Slower global settings did not materially improve validation reliability。

與第一次完整掃描對照：

- 第一次 throughput 約 43 URLs/min。
- 第三次 throughput 約 21 URLs/min。
- `network_error` 未下降，反而由約 281 增至約 307。

Evidence conclusion：

- `GLOBAL_SLOWDOWN_AS_PRIMARY_FIX = NOT_SUPPORTED_BY_CURRENT_TYCG_EVIDENCE`。
- `TARGETED_ADAPTIVE_VALIDATION = STRONGLY_SUPPORTED`。
- 這不是保證性的普遍定律；它只表示目前桃園 real-site evidence 不支持繼續把 global slowdown 當作主要修正策略。

Cross-run stability evidence：

- 相同本站 URL 在不同 scan 間大量出現 `ok` -> `needs_review` 與 `needs_review` -> `ok`。
- 真正 redirect -> 404 的 actionable URL 相對具有高度重現性。
- 單次 HEAD transport failure 不宜直接視為 stable link failure evidence。
- P13-1 應處理 transport uncertainty，而不是改變 confirmed HTTP error semantics。

Additional reproduced gaps：

- `REDIRECT_TO_ERROR_CONFIRMATION_GAP = REPRODUCED`：第三次完整掃描仍出現 `redirect_to_error` / `action_required`，但 confirmation candidate / checked 仍為 0，支持 generalize 既有 confirmation candidate selection。
- `PROTECTION_PRECEDENCE_BUG = REPRODUCIBLE`：`khh.travel` 類案例已多次重現 redirect、Cloudflare 403、WAF / Bot evidence，最後仍被 interpretation 成 `action_required`；這是 interpretation precedence 問題，不是 WAF detection 缺失。
- `SOCIAL_SHARE_HEAD_NOISE = REPRODUCIBLE`：social / share-like endpoint 的 HEAD 4xx noise 持續重現。
- `CONFIRMED_EXTERNAL_404_MUST_REMAIN_ACTIONABLE = YES`：外部 PDF / service URL 若經 GET 確認為 404/410，仍應可成為政府網站維護的 actionable issue。

## 4. P12 Remainder

P12 保持 Static Discovery Resilience，不重新命名已完成階段。

| 項目 | 狀態 | 決策 |
| --- | --- | --- |
| P12-1 HTML Sitemap Fallback | DONE | 保留完成狀態。 |
| P12-2A Conventional XML `/sitemap.xml` Fallback | DONE | 保留完成狀態。 |
| P12-3 Incomplete Coverage Notice | NEXT | 成為 Static Discovery Resilience 的下一個優先候選。 |
| P12-2B robots-advertised sitemap | CANDIDATE / EVIDENCE-REQUIRED | 保留，但不排在 P12-3 前面，也不是已承諾實作。 |

P12-3 的核心是區分 run completion、validation completion、discovery coverage 與 `scanQuality`。

- `scanQuality` 描述已完成 validation / discovered content 的品質訊號。
- `runStatus = complete` 只代表本次排定的 validation 已執行完畢。
- validation completion 描述 queued validation 是否完成；它不等於整個網站 discovery coverage 完整。
- coverage / completion 描述本次 run 是否完整涵蓋可探索或待驗證範圍。
- 已完成部分的 validation quality 可以正常，但整體 run 仍可能因 page budget、sitemap seed truncation、pending validation 或 user stop 而 incomplete。

兩種實證應分開處理：

- Case A partial run：`stopped_by_user`、pending validations、validation incomplete。
- Case B complete run：pending validations = 0，但 `maxPages` 達上限，且 sitemap discovered URLs 大於 seeded URLs。

因此：

- `RUN_COMPLETION != DISCOVERY_COVERAGE_COMPLETENESS`。
- `scanQuality != coverage`。

P12-3 至少應規劃以下 reason：

| 類型 | Reason |
| --- | --- |
| Discovery coverage | `max_pages_reached` |
| Discovery coverage | `sitemap_seed_truncated` |
| Validation coverage | `validation_incomplete` |
| Validation coverage | `stopped_by_user` |

P12-3 不應新增 discovery engine 或 sitemap parser；它應把既有 run / sitemap / queue evidence 轉成清楚的 coverage limitation notice。

## 5. P13 HTTP Validation Resilience

P13 的目的為提高 HTTP validation 的可靠性，降低由 HEAD 行為、暫時性 network failure、特殊 redirect、WAF / Bot protection 所產生的誤判與不必要人工判讀。

P13 採 reuse-first 原則：

- 優先擴充既有 `fetchUrl()` / `fetchUrlOnce()`。
- 優先延伸 existing HEAD -> GET fallback predicate。
- 沿用 retry / scheduler、request security policy、Referer、redirect handling、404/410 confirmation、protection detection 與 interpretation pipeline。
- 除非既有 abstraction 確實無法承接，不建立平行 validation / confirmation framework。
- Targeted adaptive validation 優先於 global slowdown。

### P13-1 Extend Existing HEAD -> GET Fallback for Transport Failures

現行 implementation 已具備 HEAD -> GET fallback；本階段只補足 HEAD 在沒有取得 HTTP response 時的 transport uncertainty，不建立第二套 adaptive engine。

優先適用：

- same-origin。
- page-like URL。
- HEAD `ConnectTimeout`。
- HEAD timeout。
- HEAD `network_error`。

設計方向：

- HEAD -> transport uncertainty -> targeted conservative GET retry -> reuse existing HTTP classification。
- 優先延伸 existing fallback predicate / fetch pipeline。
- 沿用既有 scheduler、安全政策、Referer、redirect handling。
- 不把所有 URL 全面改成 GET。
- 不單純再降低整個 scan 的 global concurrency。

### P13-2 Redirect-to-404/410 Confirmation

Generalize 既有 404/410 confirmation candidate selection，不建立第二套結果模型。

目標流程：

```text
URL
-> redirect
-> final 404/410
-> existing confirmation scheduler
-> existing GET confirmation
-> confirmed_missing / recovered / needs_review
```

應明確沿用：

- existing confirmation scheduler。
- existing browser-like UA。
- existing Referer logic。
- existing `confirmation.outcome` semantics：`confirmed_missing`、`recovered`、`needs_review`。
- existing client redirect evidence where applicable。

不要建立：

- second confirmation subsystem。
- separate redirect-confirmation outcome enum。
- parallel result model。

### P13-3 Residual Redirect / Error-route Hardening — CONDITIONAL

只有 P13-1 與 P13-2 完成並經 real-site regression 後，若仍有既有 redirect handling / confirmation pipeline 無法處理的 pathological cases，才進行本項。

可能的 residual case 例如：

```text
HEAD
-> /notfound
-> /notfound
-> repeated redirect
```

原則：

- 現有 redirect loop、max redirects、`redirect_to_error`、manual redirect handling 等能力不可重寫。
- 不因 URL path 名稱包含 `notfound` 就直接判定失效。
- 仍以最終 HTTP evidence 為準。
- 若 P13-1 / P13-2 已解決實站案例，P13-3 可以不進入實作。
- 不加入單一 hostname hack。

### P13-4 Protection-aware Interpretation

Scope 限定為 interpretation precedence correction only。既有 detector 全部沿用：

- WAF detection。
- Bot detection。
- Cloudflare detection。
- body signature。
- header evidence。
- protection metadata。

已知 generic pattern：

```text
HTTP URL
-> HTTPS redirect
-> protection challenge / WAF / Bot evidence
-> suspectedWaf=true / suspectedBot=true
```

若沒有 confirmed missing evidence，不應只因 redirect-to-error 就直接分類為 `action_required`。

預期方向：

- Confirmed missing evidence 優先於 generic protection uncertainty。
- Final response 是 WAF、Bot challenge、protection challenge 或 Cloudflare browser verification，且沒有 confirmed missing evidence 時，external result 應進入 needs review / external limited，而非因 `redirect_to_error` precedence 直接進 `action_required`。
- 這是小範圍 classification precedence refinement，不是新增第二套 protection detector。
- 規則必須是 generic precedence 修正，不加入 hostname-specific 特例。

### P13-5 Special Endpoint HEAD Recheck

處理 social/share endpoint 等特殊 URL。已觀察到 share-like endpoint 使用 HEAD 時可能大量回 4xx；應優先利用既有 external-link category / `social` classification。

規劃方向：

- social/share-like endpoint + HEAD 4xx -> GET / browser-like confirmation。
- 或在保守確認不足時轉為 `needs_review`。
- 規則必須 generic，不 hardcode 單一網域作為唯一條件。
- 不建立 Facebook-specific validation engine。
- 不把所有 external 4xx 都降級。
- 不影響 confirmed external GET 404/410 的 actionability。

## 6. P14 Result Interpretation & Management Handoff

P10 已完成，不重新打開或重編。P14 承接新的呈現與交辦 refinement，目的是將可靠的 technical validation 結果轉換成政府網站管理者可以直接採取行動的資訊。

Reuse-first 原則：

- Management status 與 link scope 優先由既有 interpretation、source page、URL origin 與 external-link metadata 衍生。
- 不新增 crawler-side management classification schema。
- 不把 P14 做成新的 crawler-side classification system。

近期保留既有 technical interpretation enum：

- `action_required`
- `needs_review`
- `external_limited`
- `likely_problem`
- `redirect_ok`
- `ok`
- `page_quality_notice`

不直接修改 schema enum，也不把 `managementStatus` 加入 report schema 作為近期必要條件。

### P14-1 Management Status Layer

UI / Analyzer 可將既有 technical interpretation 衍生為較高階 management layer：

| 管理狀態 | 初步 technical mapping |
| --- | --- |
| 需處理 | `action_required` |
| 需確認 | `needs_review`、`external_limited`、`likely_problem` |
| 正常／可用 | `redirect_ok`、`ok` |
| 品質提醒 | `page_quality_notice` |

`likely_problem` 未來仍可依 P13 validation refinement 再細分。

此項優先是 derived grouping，不修改 existing interpretation enum。

### P14-2 Link Scope Dimension

管理狀態與 link scope 必須是不同維度。Link scope 由既有 result URL origin、source page origin 與 external-link metadata 衍生，不建立新的 scope detection engine。

Scope 至少包含：

- 全部。
- 本站。
- 外部連結。

External 本身不代表低優先級。政府網站提供的外部連結若已確認失效，仍應屬於「需處理」。

### P14-3 GUI Summary / Live Snapshot

未來 GUI 不應只以 `brokenLinks` 或「需判讀結果總數」作為主要 KPI。

應規劃呈現：

- 需處理。
- 需確認。
- 正常／可用。

完整 report 的 existing `interpretationByCategory` 應繼續作為 authoritative summary。Live GUI 應優先重用同一 interpretation helper / mapping，避免 frontend 另外推算第二套分類邏輯；目標是減少 core / GUI interpretation drift。不要修改 report schema 作為此規劃的前提。

### P14-4 Report Analyzer

Report Analyzer 第一層應改為 management action：

- 需處理。
- 需確認。
- 正常／可用。

第二層區分：

- 本站。
- 外部連結。

第三層才呈現：

- HTTP status。
- network error。
- timeout。
- redirect。
- WAF / Bot。
- protection evidence。
- technical classification。

避免把所有 technical non-OK 結果混成「壞連結」。這是既有 Analyzer 的 UX / grouping refinement，不是建立新的 Analyzer。

### P14-5 CSV / Handoff Export

近期保留既有名稱與 contract：

- `broken[]`
- `broken.csv`
- `broken.ndjson`

未來可沿用 existing CSV exporter，只增加必要的交辦友善欄位：

- 管理狀態。
- 連結範圍。

讓承辦人可以直接篩選「管理狀態 = 需處理」作為交辦清單；不建立新的 handoff export format。

## 7. Report-diff Architecture Boundary

跨次掃描的 status transition、confidence change、historical evidence comparison 優先由既有 `report-diff.mjs` 承接。

例如：

```text
previous confirmed missing
-> current network_error
```

未來若要呈現 historical evidence，應先評估擴充 report-diff，而不是在 crawler core 建立第二套歷史狀態資料庫。這不表示 Report-diff legacy / ambiguous input hardening 需要從 Deferred 提升為 Current / Next。

## 8. Deferred and Non-goals

Dynamic Render / headless fallback 維持 Deferred / Evidence-required。目前桃園案例沒有證據支持恢復 headless priority。現有 static discovery 包含 HTML、SPA / payload / static signals、conventional XML sitemap fallback 與 HTML sitemap fallback，已可有效取得重要頁面。

Report-diff legacy hardening 與 public-trust code signing 也維持既有 deferred policy。

本 roadmap 整理不包含：

- 修改 application code。
- 修改 crawler behavior。
- 修改 GUI。
- 修改 report schema。
- 修改 interpretation enum。
- 修改 CLI option。
- 修改正式版本號。
- 建立 release 或 Git tag。
- 發布 artifact。
- 加入 hostname-specific workaround。
- 重啟 Dynamic Render。
- 將 P12-2B 描述成已核准開發。

`report.json` 仍是主要資料契約。

## 9. Suggested Order

目前建議順序：

1. P12-3 Incomplete Coverage Notice。
2. P13 HTTP Validation Resilience。
3. P14 Result Interpretation & Management Handoff。

P13 內部建議順序：

1. P13-1 Extend Existing HEAD -> GET Fallback for Transport Failures。
2. P13-2 Redirect-to-404/410 Confirmation。
3. P13-3 Residual Redirect / Error-route Hardening — CONDITIONAL。
4. P13-4 Protection-aware Interpretation。
5. P13-5 Special Endpoint HEAD Recheck。

P12-2B robots-advertised sitemap 保留為 evidence-required candidate，不排入近期優先主線。
