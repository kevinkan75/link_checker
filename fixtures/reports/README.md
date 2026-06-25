# P6 Report Diff Fixtures

These fixtures are minimal legacy-compatible `report.json` pairs for P6 report-to-report diff development.

They intentionally avoid `schemaVersion` and `generator` because P6 must read older reports. Each case has an `old.json` and `new.json` pair, and `index.json` records the expected high-level diff signal.

## Cases

| Case | Purpose | Expected signal |
| --- | --- | --- |
| `404-to-200` | Same canonical URL changes from confirmed missing to OK. | `resolvedIssue` |
| `200-to-404` | Same canonical URL changes from OK to confirmed missing. | `newIssue` |
| `needs-review-to-confirmed-missing` | Confirmation confidence changes from review-needed to confirmed missing. | `confidenceIncreased` |
| `external-risk-low-to-high` | Same external canonical URL changes from low risk to high risk. | `riskIncreased` |
| `diagnostics-suspicious-to-ok` | Summary diagnostics change from suspicious scan quality to OK. | `diagnosticsChanged` |

P6 should prefer `checked[].canonicalUrl` for checked URL matching, fall back to `url` for legacy reports, and compare `externalLinks[]` independently from `checked[]`.
