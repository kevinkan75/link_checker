# P13 HTTP Validation Resilience — Final Closure

狀態：final closure record，更新於 2026-09-02。

## 1. Closure Purpose

P13 已完成全部 disposition review。本文件保存 implementation completion、focused / canonical regression evidence、real-site evidence、skip decisions、resume boundaries 與 compatibility implications，並將已完成階段的歷史 acceptance evidence 自 root ROADMAP 收斂至 archive。

[P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md](P13_HTTP_VALIDATION_RESILIENCE_ASSESSMENT.md) 保留 planning / pre-implementation / evolving evidence；本文件則是 final dispositions、acceptance evidence 與 closure baseline，不是新的 planning document。

## 2. Final Scope

P13 的目標是提高 HTTP validation reliability，並降低以下來源造成的不必要 false positives / manual review：

- HEAD behavior
- transport uncertainty
- redirect-to-error semantics
- 404/410 confirmation gaps
- WAF / Bot / protection uncertainty

P13 採 reuse-first：重用 `fetchUrl()`、既有 HEAD -> GET behavior、retry / scheduler、redirect handling、404/410 confirmation、protection detection 與 interpretation；不建立第二套 validation / confirmation framework。

## 3. Final Disposition

| Item | Final disposition |
| --- | --- |
| P13-1 Extend Existing HEAD -> GET Fallback for Transport Failures | DONE |
| P13-2 Redirect-to-404/410 Confirmation | DONE |
| P13-3 Residual Redirect / Error-route Hardening | SKIPPED / NOT REQUIRED |
| P13-4 Protection-aware Interpretation | DONE |
| P13-5 Special Endpoint HEAD Recheck | SKIPPED / NOT REQUIRED |

```text
Implemented DONE = 3/5
Disposition resolved = 5/5
(3 DONE + 2 SKIPPED / NOT REQUIRED)
Remaining implementation items = 0
```

Item count 不代表 workload percentage，也不代表 skipped 項目已實作完成。

## 4. P13-1 Acceptance

正式 implementation 為 bounded adaptive HEAD -> GET transport fallback，僅適用 eligible same-origin、page-like、HEAD-first status validation。fallback 僅由 transport trigger 啟動，受既有 retry loop 約束，並保留 scheduler、security policy、Referer 與 redirect behavior。

Eligible trigger 至少包括 timeout / `AbortError` semantics、`ETIMEDOUT`、`ECONNRESET`、`UND_ERR_CONNECT_TIMEOUT`、`UND_ERR_HEADERS_TIMEOUT`、`UND_ERR_SOCKET`。明確排除 `ENOTFOUND`、`EAI_AGAIN`、`ECONNREFUSED`、TLS / security errors 與 user stop。`transportFallback` 是 additive evidence。

Acceptance evidence：focused tests = PASS；canonical regression = PASS；real-site request-path regression = PASS。

TYCG targeted regression 沒有自然重新觸發 adaptive transport recovery；觀察到的是既有 HTTP-response / redirect fallback 路徑。因此：

```text
REAL_SITE_ACTIVATION_EFFECTIVENESS = OBSERVATIONAL / NOT PROVEN
```

這項限制不是 completion blocker。

## 5. P13-2 Acceptance

既有 404/410 confirmation candidate selection 已 generalize 至 URL -> redirect -> final 404/410，仍重用 existing confirmation scheduler、GET confirmation、Referer、existing flow 使用的 browser-like UA、client redirect evidence 與 `confirmed_missing` / `recovered` / `needs_review` outcomes。

Acceptance evidence：focused tests = PASS；canonical regression = `40 / 40 PASS`。TYCG eligible redirect-to-404/410 samples 中，`20 / 20` 進入 formal confirmation，`20 / 20` 為 `confirmed_missing`，semantic mismatch = `0`。

Real-site regression 未自然觀察到 recovered / protection confirmation case；相關路徑由 deterministic tests cover。

## 6. P13-3 Skip Decision

`P13-3 = SKIPPED / NOT REQUIRED`。

Necessity review 結果：reproducible residual candidates = `0`；generic candidates = `0`；user-impacting residual candidates = `0`；candidates satisfying all activation criteria = `0`。

`redirect -> 404/410` 由 P13-2 處理；redirect + protection precedence 由 P13-4 處理；social-share HEAD noise 屬 P13-5 review scope；original/final link-scope semantics 屬 later interpretation / P14-related scope。

只有新的 evidence 同時具備 reproducible、generic、user-impacting、not already handled 與 bounded-fix candidate 時才 reopen。不得因 `/notfound` 或 `/error` path 名稱建立 heuristic，也不得新增 hostname-specific workaround。

## 7. P13-4 Acceptance

Root cause：

```text
DETECTION FAILURE = NO
EVIDENCE LOSS = NO
INTERPRETATION PRECEDENCE BUG = YES
```

Final precedence：

```text
FORMAL CONFIRMED MISSING
>
PROTECTION UNCERTAINTY
>
GENERIC REDIRECT_TO_ERROR
```

`redirect_to_error` 同時有 meaningful protection evidence 且沒有 formal `confirmed_missing` 時，interpretation 為 `needs_review` 或 `external_limited`；formal `confirmed_missing` 仍為 `action_required`。

Acceptance evidence：focused test = PASS；P13-2 regression = PASS；canonical regression = `41 / 41 PASS`。Real-site 自然觀察到 `1` 個 protection / redirect precedence sample，semantic mismatch = `0`；P13-2 `confirmed_missing` sample 仍維持 `action_required`。

## 8. P13-5 Skip Decision

`P13-5 = SKIPPED / NOT REQUIRED`。

Historical evidence：`3` TYCG scans 的 `120` 個 social/share results 全部為 HEAD `400`。既有 generic fallback 不包括 HTTP `400`。代表性 replay 結果為：

```text
HEAD normal scanner UA = 400
GET normal scanner UA = 400
GET pure browser UA = 400
NO_BOUNDED_REQUEST_LEVEL_FIX_FOUND
```

因此不擴充 generic 400 fallback、不將所有 social 400 降為 `needs_review`、不建立 Facebook-specific validation engine；confirmed external GET 404/410 必須保持 actionable。這不是 Dynamic Render 的 activation evidence。

只有新的可重現 evidence 證明 generic、bounded、request-level 且有效的 recovery path 時才 reopen。

## 9. Compatibility and Non-actions

`REPORT_SCHEMA_VERSION = 1.3.0` 維持不變；目前最新 formal release 仍是 `v1.3.1`。

P13 沒有引入 new validation framework、new confirmation framework、new WAF detector、new crawler architecture、new database、new service、new Dynamic Render 或 new hostname workaround。`summary.coverage`、`transportFallback`、confirmation evidence 與 interpretation correction 均屬既有 contract 下的 additive 或 corrective behavior。

## 10. Final Closure Status

```text
P13_HTTP_VALIDATION_RESILIENCE_STATUS = CLOSED

P13_1 = DONE
P13_2 = DONE
P13_3 = SKIPPED / NOT REQUIRED
P13_4 = DONE
P13_5 = SKIPPED / NOT REQUIRED

P13_IMPLEMENTED_DONE = 3 / 5
P13_DISPOSITION_RESOLVED = 5 / 5
P13_REMAINING_IMPLEMENTATION_ITEMS = 0

P13_REOPEN_POLICY = NEW REPRODUCIBLE EVIDENCE REQUIRED

Dynamic Render = DEFERRED / EVIDENCE-REQUIRED
```
