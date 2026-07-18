# P6 Preflight Assessment

狀態：歷史前置評估。P6 已完成；現行開發主線請看 [../../ROADMAP.md](../../ROADMAP.md)，P6 實作分析請看 [P6_IMPLEMENTATION_ANALYSIS.md](P6_IMPLEMENTATION_ANALYSIS.md)。

評估日期：2026-06-21

## 結論

P6 前置三項已完成，完成度約 85-90%，足以進入 P6 `report-diff.mjs` 實作。

目前已具備：

- Golden report fixtures。
- `diff.json` schema 草案。
- Report normalization 原則文件。

主要剩餘風險是尚未接上自動化 regression test，也尚未用正式 JSON Schema validator 驗證 sample output。這些不阻塞 P6 開始實作，但應在 P6 實作期間補齊。

## 項目評估

| 項目 | 狀態 | 完成度 | 評估 |
| --- | --- | ---: | --- |
| Golden fixtures | 已完成 | 90% | `fixtures/reports/` 已有 4 組 old/new report pairs、`index.json` 與 README，且所有 JSON 可解析。 |
| Diff schema 草案 | 已完成 | 85% | `schemas/diff.schema.json` 已定義 P6 diff root、summary、URL 變更、外連變更、診斷變更與 warnings。 |
| Report normalization 原則 | 已完成 | 95% | `docs/REPORT_NORMALIZATION.md` 已固定 `checked[]`、`broken[]` fallback、`externalLinks[]` 與 match key 規則。 |

## 已驗證

- `fixtures/reports/*.json` 全部可成功解析。
- `schemas/diff.schema.json` 可成功解析。
- `fixtures/reports/index.json` 記錄 4 組預期 diff signal。
- Roadmap 已將三項 P6 前置標為已處理。

## 尚未完成但不阻塞

- 尚未建立 P6 regression test runner。
- 尚未對 fixture 做逐欄 assertion。
- 尚未用正式 JSON Schema validator 驗證實際 `diff.json` sample output。
- 尚未實作 `report-diff.mjs`。

## 進入 P6 的建議

P6 可以開始實作，建議順序：

1. 實作 report normalization function，依 [../REPORT_NORMALIZATION.md](../REPORT_NORMALIZATION.md) 產生內部 `urlsByKey`、`externalByKey` 與 diagnostics。
2. 用 `fixtures/reports/index.json` 驅動最小 regression test。
3. 實作 diff summary 與 `urlChanges`。
4. 補上 `externalChanges` 與 `diagnosticsChanges`。
5. 產出符合 `schemas/diff.schema.json` 的 `diff.json`。
