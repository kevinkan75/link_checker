# P13 HTTP Validation Resilience Assessment

狀態：planning record。本文記錄 v1.3.1 後的 roadmap 整理、real-site evidence 與後續 phase 切分；本次沒有修改 crawler、GUI、report schema、tests 或版本號。

現行使用說明以 [../../README.md](../../README.md) 為準；短版優先順序以 [../../ROADMAP.md](../../ROADMAP.md) 為準；P12-2A 完成紀錄見 [P12_2A_XML_SITEMAP_FALLBACK_RECORD.md](P12_2A_XML_SITEMAP_FALLBACK_RECORD.md)。

## 1. Context

目前正式版本為 `v1.3.1`。P0-P11 已完成或已驗收；P12 Static Discovery Resilience 已完成：

- P12-1 HTML Sitemap Fallback。
- P12-2A Conventional XML `/sitemap.xml` Fallback。

P12-2A 讓 weak initial frontier 可在沒有 explicit `--sitemap` 時嘗試同站慣例 `/sitemap.xml`，並沿用既有 sitemap seed / crawler pipeline。這沒有引入 Dynamic Render、headless browser、新 crawler 或 hostname-specific workaround。

## 2. Real-site Evidence Summary

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

## 3. P12 Remainder

P12 保持 Static Discovery Resilience，不重新命名已完成階段。

| 項目 | 狀態 | 決策 |
| --- | --- | --- |
| P12-1 HTML Sitemap Fallback | DONE | 保留完成狀態。 |
| P12-2A Conventional XML `/sitemap.xml` Fallback | DONE | 保留完成狀態。 |
| P12-3 Incomplete Coverage Notice | NEXT | 成為 Static Discovery Resilience 的下一個優先候選。 |
| P12-2B robots-advertised sitemap | CANDIDATE / EVIDENCE-REQUIRED | 保留，但不排在 P12-3 前面，也不是已承諾實作。 |

P12-3 的核心是區分 `scanQuality` 與 coverage / completion。

- `scanQuality` 描述已完成 validation / discovered content 的品質訊號。
- coverage / completion 描述本次 run 是否完整涵蓋可探索或待驗證範圍。
- 已完成部分的 validation quality 可以正常，但整體 run 仍可能因 page budget、sitemap seed truncation、pending validation 或 user stop 而 incomplete。

P12-3 至少應規劃以下 reason：

| 類型 | Reason |
| --- | --- |
| Discovery coverage | `max_pages_reached` |
| Discovery coverage | `sitemap_seed_truncated` |
| Validation coverage | `validation_incomplete` |
| Validation coverage | `stopped_by_user` |

## 4. P13 HTTP Validation Resilience

P13 的目的為提高 HTTP validation 的可靠性，降低由 HEAD 行為、暫時性 network failure、特殊 redirect、WAF / Bot protection 所產生的誤判與不必要人工判讀。

### P13-1 Adaptive HEAD -> GET Validation

當第一輪 HEAD 出現特定不確定結果時，不直接形成最終判讀，而針對該 URL 進行較保守的 GET retry。

優先適用：

- same-origin。
- page-like URL。
- HEAD `ConnectTimeout`。
- HEAD network error。
- ambiguous HEAD response。

設計方向：

- Targeted retry，優先於 global slowdown。
- 不把所有 URL 全面改成 GET。
- 不單純再降低整個 scan 的 global concurrency。
- Retry 時可使用更低 per-host concurrency / delay。

### P13-2 Redirect-to-404/410 Confirmation

擴充既有 confirmation pipeline，不建立第二套結果模型。

目標流程：

```text
URL
-> redirect
-> final 404/410
-> conservative confirmation
-> confirmed_missing / recovered / needs_review
```

`confirmation.outcome` 既有語意仍是主要承接點：`confirmed_missing`、`recovered`、`needs_review`。

### P13-3 Redirect / Error-route Validation Hardening

處理 real-site 中出現的 error-route behavior，例如：

```text
HEAD
-> /notfound
-> /notfound
-> repeated redirect
```

原則：

- 不因 URL path 名稱包含 `notfound` 就直接判定失效。
- 依最終 HTTP evidence 判斷。
- 發現 abnormal / repeated redirect 時，可停止無意義 HEAD chain，再用 GET confirmation。
- 不加入單一 hostname hack。

### P13-4 Protection-aware Interpretation

修正 interpretation precedence。

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
- Final response 是 WAF / Bot / protection challenge，且沒有 confirmed missing evidence 時，External + protection evidence 應進入 needs review / external limited，而非直接 `action_required`。
- 規則必須是 generic precedence 修正，不加入 hostname-specific 特例。

### P13-5 Special Endpoint HEAD Recheck

處理 social/share endpoint 等特殊 URL。已觀察到 share-like endpoint 使用 HEAD 時可能大量回 4xx。

規劃方向：

- social/share-like endpoint + HEAD 4xx -> GET / browser-like confirmation。
- 或在保守確認不足時轉為 `needs_review`。
- 規則必須 generic，不 hardcode 單一網域作為唯一條件。

## 5. P14 Result Interpretation & Management Handoff

P10 已完成，不重新打開或重編。P14 承接新的呈現與交辦 refinement，目的是將可靠的 technical validation 結果轉換成政府網站管理者可以直接採取行動的資訊。

近期保留既有 technical interpretation enum：

- `action_required`
- `needs_review`
- `external_limited`
- `likely_problem`
- `redirect_ok`
- `ok`
- `page_quality_notice`

不直接修改 schema enum。

### P14-1 Management Status Layer

UI / Analyzer 可新增較高階 management layer：

| 管理狀態 | 初步 technical mapping |
| --- | --- |
| 需處理 | `action_required` |
| 需確認 | `needs_review`、`external_limited`、`likely_problem` |
| 正常／可用 | `redirect_ok`、`ok` |
| 品質提醒 | `page_quality_notice` |

`likely_problem` 未來仍可依 P13 validation refinement 再細分。

### P14-2 Link Scope Dimension

管理狀態與 link scope 必須是不同維度。

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

並評估讓 `gui-server` live snapshot 直接提供與 report 一致的 interpretation summary，而不是前端自行推算。

### P14-4 Report Analyzer

Report Analyzer 第一層應改為管理行動：

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

避免把所有 technical non-OK 結果混成「壞連結」。

### P14-5 CSV / Handoff Export

近期保留既有名稱與 contract：

- `broken[]`
- `broken.csv`
- `broken.ndjson`

未來可增加交辦友善欄位：

- 管理狀態。
- 連結範圍。

讓承辦人可以直接篩選「管理狀態 = 需處理」作為交辦清單。

## 6. Deferred and Non-goals

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

## 7. Suggested Order

目前建議順序：

1. P12-3 Incomplete Coverage Notice。
2. P13 HTTP Validation Resilience。
3. P14 Result Interpretation & Management Handoff。

P13 內部建議順序：

1. P13-1 Adaptive HEAD -> GET Validation。
2. P13-2 Redirect-to-404/410 Confirmation。
3. P13-3 Redirect / Error-route Validation Hardening。
4. P13-4 Protection-aware Interpretation。
5. P13-5 Special Endpoint HEAD Recheck。

P12-2B robots-advertised sitemap 保留為 evidence-required candidate，不排入近期優先主線。
