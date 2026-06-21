# P6 Implementation Analysis

記錄日期：2026-06-21

## 結論

P6 可以開始實作。第一版應聚焦在 CLI、report normalization、diff generation 與 fixtures regression，不碰 GUI / Analyzer，也不改掃描流程。

P6 的核心是純 report-to-report diff：讀兩份既有 `report.json`，產生 `diff.json`。它不重新掃描網站、不重新判斷風險、不導入 cache、incremental scan、robots enforcement 或 adaptive backoff。

## 輸入與輸出

建議 CLI 形式：

```powershell
node .\report-diff.mjs old-report.json new-report.json --output diff.json
```

必要輸入：

- `old-report.json`
- `new-report.json`

必要輸出：

- `diff.json`，shape 依 [../schemas/diff.schema.json](../schemas/diff.schema.json)。
- 簡短 console summary，方便 CLI 使用者快速判讀。

## 前置狀態

P6 前置已足夠支援實作：

- `fixtures/reports/`：已有 4 組 golden cases。
- `schemas/diff.schema.json`：已有 diff schema 草案。
- `docs/REPORT_NORMALIZATION.md`：已有 normalization 原則。
- `docs/P6_PREFLIGHT_ASSESSMENT.md`：已記錄完成度與剩餘風險。

## 建議實作切分

### 1. `readReport(path)`

職責：

- 讀取 JSON。
- 保留 `startedAt`、`startUrl`、`schemaVersion`、`summary`。
- 沒有 `schemaVersion` 時加入 `legacy_report` warning。
- JSON 解析失敗時以 CLI error 結束，不輸出不完整 diff。

### 2. `normalizeReport(report, path)`

職責：

- 依 [REPORT_NORMALIZATION.md](REPORT_NORMALIZATION.md) 產生內部 normalized report。
- URL 結果優先使用 `checked[]`。
- 缺少 `checked[]` 時 fallback 到 `broken[]`。
- `externalLinks[]` 獨立建立 `externalByKey`。
- match key 優先 `canonicalUrl`，再 fallback `url`。

Normalization 不應重新 canonicalize URL，也不應重新推導風險。

### 3. `diffUrls(old.urlsByKey, new.urlsByKey)`

職責：

- 產生 `urlChanges`。
- 判斷 `added`、`removed`、`changed`。
- 判斷 `newIssue`、`resolvedIssue`、`persistentIssue`。
- 判斷 `confidenceIncreased`、`confidenceDecreased`。

第一版 URL 比較欄位以 `REPORT_NORMALIZATION.md` 的 Field Comparison 為準。

### 4. `diffExternal(old.externalByKey, new.externalByKey)`

職責：

- 產生 `externalChanges`。
- 判斷 `added`、`removed`、`changed`。
- 判斷 `riskIncreased`、`riskDecreased`。

Risk order：

```text
info < low < medium < high
```

若 `riskLevel` 缺少，才用 governance status 的保守排序：

```text
allowed < unknown < watchlisted < needs_review < blocked
```

### 5. `diffDiagnostics(old.diagnostics, new.diagnostics)`

職責：

- 比較 `summary.scanQuality`。
- 比較 `summary.spaDetection`。
- 比較 `summary.checkedByKind`。
- 產生 `diagnosticsChanges`。

P6 只比較既有 summary，不重新計算掃描品質。

### 6. `buildSummary(diff)`

職責：

- 匯總 schema 要求的 counts。
- 保持 `summary` 欄位名稱與 `schemas/diff.schema.json` 一致。
- 彙整 normalization 與 diff 過程中的 warnings。

## 第一版驗收

使用 `fixtures/reports/index.json` 驗證：

| Fixture | 預期 |
| --- | --- |
| `404-to-200` | `resolvedIssue` |
| `200-to-404` | `newIssue` |
| `needs-review-to-confirmed-missing` | `confidenceIncreased` |
| `external-risk-low-to-high` | `riskIncreased` |

第一版 regression test 至少應檢查：

- CLI 可以產生 `diff.json`。
- 每組 fixture 的預期 signal 存在。
- `diff.json` root 欄位符合 schema 草案的 required fields。
- legacy report 不因缺少 `schemaVersion` 失敗。

## 邊界

P6 不做：

- 不改 `link-checker.mjs`。
- 不改 scan report 格式。
- 不重新送 HTTP request。
- 不重新 canonicalize URL。
- 不把 `broken[]` 與 `checked[]` 合併成新 report。
- 不把外連治理結果回寫到 `checked[]`。
- 不做 GUI / Analyzer 呈現。
- 不導入 TTL cache、incremental scan、robots enforcement 或 adaptive backoff。

## 主要風險

1. `needsReview` 語意混淆  
   P4 confirmation 與 P5 external risk 都可能使用 review 語意。P6 必須拆成 `confirmationNeedsReview` 與 `externalRisk.needsReview`。

2. Legacy report 欄位不足  
   舊 report 可能只有 `broken[]`，沒有 `checked[]`。P6 需要 fallback，但不能推導不存在的欄位。

3. Duplicate key  
   同一 key 重複出現時，第一版採第一筆並輸出 `duplicate_key` warning，不嘗試合併。

4. Schema 尚未正式驗證 sample output  
   P6 實作時應補上最小 validator 或至少建立 deterministic sample assertion。

## 建議落地順序

1. 建立 `report-diff.mjs` CLI skeleton。
2. 實作 report loading 與 normalization。
3. 用 fixtures 建立最小 regression runner。
4. 實作 `urlChanges` 與 summary。
5. 補 `externalChanges`。
6. 補 `diagnosticsChanges`。
7. 對齊 `schemas/diff.schema.json`。
8. 更新 README 的 P6 使用方式。
