# Maintenance Hardening — 2026-08-26

## Scope

This record summarizes the focused maintenance cycle across crawler correctness, GUI lifecycle/security, frontend compatibility, and report-diff correctness. It preserves context that no longer belongs in the active roadmap.

## Completed

- P0-LC-001: canonical page crawl queue dedupe.
- GUI-SEC-001: localhost GUI mutation API session-token/origin protection.
- GUI-LIFE-001: abort active HTTP requests when scan stop is requested.
- P1-PUB-SESSION-001: analyzer/report-analyzer heartbeat restored under GUI session guard.
- P1-PUB-INTERP-001: Report Analyzer fallback aligned with `external_limited` semantics.
- RD-MATCH-001: canonicalUrl/url alias reconciliation prevents false added/removed results.
- RD-NORM-001: `riskReasons` and `matchedRules` normalized as unordered string sets.

Final accepted regression baseline: 35/35 PASS.

These maintenance fixes did not change the report schema, product version, release tags, or release state.

## Deferred Findings

- Duplicate-key ambiguity in report-diff: policy is intentionally deferred; do not assume first/worst/aggregate behavior until real evidence or a report-contract requirement exists.
- Legacy/manual value normalization: numeric string normalization may be reasonable, but null vs missing semantics are not yet defined; defer until the report-contract requirement is clear.

## Maintenance Outcome

- No broad refactor is required.
- `build-portable.ps1` has no current maintenance action; re-evaluate only when packaging, runtime, signing, manifest, or release evidence warrants it.
- Active product focus returns to the current focus in the root roadmap.
