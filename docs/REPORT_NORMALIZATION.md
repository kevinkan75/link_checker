# P6 Report Normalization

本文件固定 P6 `report-diff.mjs` 讀取兩份既有 `report.json` 時的 normalization 原則。P6 只讀 report 並輸出 diff，不重新掃描、不重新判斷風險、不改既有 scan report 契約。

## 目標

- 支援沒有 `schemaVersion` 的 legacy report。
- 優先使用 `checked[]` 做 URL 結果比對。
- 舊 report 缺少 `checked[]` 時 fallback 到 `broken[]`。
- `externalLinks[]` 需獨立 normalization，不和 `checked[]` 混成同一集合。
- 將 P4 `needsReview` 與 P5 `externalRisk.needsReview` 拆成不同語意，避免 diff 顯示混淆。

## Normalized Report Shape

P6 實作可先整理成下列內部結構，再產生 `diff.json`：

```js
{
  ref: {
    path,
    startedAt,
    startUrl,
    schemaVersion,
    summary
  },
  urlsByKey: Map<string, NormalizedUrl>,
  externalByKey: Map<string, NormalizedExternal>,
  diagnostics: {
    scanQuality,
    spaDetection,
    checkedByKind
  },
  warnings: []
}
```

這是 `report-diff.mjs` 的內部模型，不要求掃描器輸出此 shape。

## Report Reference

每份輸入 report 都保留最小 provenance：

- `path`：CLI 傳入的 report path。
- `startedAt`：若存在則保留。
- `startUrl`：若存在則保留。
- `schemaVersion`：若存在則保留；缺少時視為 legacy report。
- `summary`：保留原始 summary，供 diff summary 與 diagnostics 使用。

缺少 `schemaVersion` 不應造成錯誤；應加入 `legacy_report` warning。

## Match Key

URL 與外連比對 key 的規則一致：

1. 優先使用 `canonicalUrl`。
2. 若沒有 `canonicalUrl`，fallback 到 `url`。
3. 若兩者都缺少，該筆略過並加入 warning。
4. key 不重新 canonicalize，不重新排序 query，不套用新的正規化策略。

P6 必須尊重 report 當時產生的 canonical key，否則 diff 會把歷史掃描語意改掉。

## Checked URL Normalization

`checked[]` 是主要來源。每筆 normalized URL 至少投影下列欄位：

- `url`
- `canonicalUrl`
- `ok`
- `status`
- `issueType`
- `classification`
- `finalUrl`
- `redirected`
- `redirectCount`
- `redirectType`
- `redirectIssues`
- `confirmationOutcome`，來自 `confirmation.outcome`
- `confirmationNeedsReview`，來自 P4 語意的 `needsReview` 或 `confirmation.outcome === "needs_review"`
- `transientFailure`

如果同一 key 在 `checked[]` 中重複出現，第一版採第一筆並加入 `duplicate_key` warning。不要在 P6 嘗試合併多筆結果。

## Broken Fallback

只有在 report 缺少 `checked[]` 或 `checked[]` 不是 array 時，才使用 `broken[]` 作為 URL normalization 來源。

Fallback 原則：

- `broken[]` 中的項目視為 `ok: false`，除非項目明確提供其他值。
- 可投影的欄位與 checked URL normalization 相同。
- 缺少的欄位保持 `null` 或省略，不推導新狀態。
- 使用 fallback 時加入 `fallback_to_broken` warning。

若 report 同時有 `checked[]` 與 `broken[]`，P6 不應把 `broken[]` 再合併回 `checked[]`；`broken[]` 只作 legacy fallback。

## External Link Normalization

`externalLinks[]` 必須獨立於 `checked[]` 建立 `externalByKey`。即使同一外部 URL 也存在於 `checked[]`，P6 仍應分別輸出：

- URL 狀態變化放在 `urlChanges`
- 外連治理風險變化放在 `externalChanges`

每筆 normalized external 至少投影：

- `url`
- `canonicalUrl`
- `hostname`
- `registrableDomain`
- `ok`
- `status`
- `issueType`
- `finalUrl`
- `externalRisk.riskLevel`
- `externalRisk.governanceStatus`
- `externalRisk.riskReasons`
- `externalRisk.matchedRules`
- `externalRisk.needsReview`

缺少 `externalLinks[]` 時不視為錯誤；加入 `missing_external_links` warning，並使用空集合。

## Diagnostics Normalization

P6 只比較 report summary 中已存在的診斷摘要，不重新計算掃描品質：

- `summary.scanQuality`
- `summary.spaDetection`
- `summary.checkedByKind`

這些變化輸出到 `diagnosticsChanges`。缺少欄位時以 `null` 比較即可，不要回頭掃描頁面或重算 asset ratio。

## Field Comparison

第一版 URL 比較欄位：

- `ok`
- `status`
- `issueType`
- `classification`
- `finalUrl`
- `redirected`
- `redirectCount`
- `redirectType`
- `redirectIssues`
- `confirmationOutcome`
- `confirmationNeedsReview`
- `transientFailure`

第一版 external 比較欄位：

- `ok`
- `status`
- `issueType`
- `finalUrl`
- `externalRisk.riskLevel`
- `externalRisk.governanceStatus`
- `externalRisk.riskReasons`
- `externalRisk.matchedRules`
- `externalRisk.needsReview`

Array 欄位先用穩定 JSON 字串比較。P6 不需要做語意集合 diff；若未來 Analyzer 需要更細呈現，再在 P9 補。

## Change Types

URL 集合層級：

- `added`：key 只存在於 new report。
- `removed`：key 只存在於 old report。
- `changed`：key 同時存在，但比較欄位有差異。
- `newIssue`：old `ok === true`，new `ok !== true`。
- `resolvedIssue`：old `ok !== true`，new `ok === true`。
- `persistentIssue`：old `ok !== true` 且 new `ok !== true`。
- `confidenceIncreased`：confirmation 從 `needs_review` 變成 `confirmed_missing`，或 `confirmationNeedsReview` 從 `true` 變成 `false` 且問題仍存在。
- `confidenceDecreased`：confirmation 從 `confirmed_missing` 變成 `needs_review`，或 `confirmationNeedsReview` 從 `false` 變成 `true`。

External 集合層級：

- `added`
- `removed`
- `changed`
- `riskIncreased`
- `riskDecreased`

Risk order：

```text
info < low < medium < high
```

Governance status 可輔助判斷，但第一版 risk 升降以 `externalRisk.riskLevel` 為主。若 risk level 缺少，才用 `governanceStatus` 的保守排序：

```text
allowed < unknown < watchlisted < needs_review < blocked
```

## Warnings

P6 normalization 至少支援下列 warnings，並對應 `schemas/diff.schema.json`：

- `legacy_report`
- `missing_checked`
- `missing_external_links`
- `fallback_to_broken`
- `duplicate_key`
- `unsupported_schema`

P6.5b 才會正式導入 partial report 語意；P6 如遇明顯的 partial 訊號，可輸出 `partial_report` warning，但不得自行定義新的 scan report 欄位。

## Non-goals

- 不讀取網站、不重新送 HTTP request。
- 不重新 canonicalize URL。
- 不把 `broken[]` 與 `checked[]` 合併成更完整的新 report。
- 不將外連治理結果回寫到 `checked[]`。
- 不導入 TTL cache、incremental scan、robots enforcement 或 adaptive backoff。
