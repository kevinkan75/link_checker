# Dynamic Scan Codex Task Index

Execute one task at a time in this order.

| Order | Task | Depends on | Primary result |
| --- | --- | --- | --- |
| 1 | `phase-0-01-core-fixtures.md` | none | reproducible static/CSR discovery fixtures |
| 2 | `phase-0-02-risk-boundary-fixtures.md` | P0-01 | reproducible timeout/security/method/popup/challenge/network fixtures |
| 3 | `phase-0-03-ingestion-refactor.md` | P0-01 | behavior-preserving `ingestDiscoveredLinks()` refactor |
| 4 | `phase-1-01-browser-provider.md` | Phase 0 gate | formal `playwright-core` dependency + BrowserProvider spike |
| 5 | `phase-1-02-render-lifecycle.md` | P1-01 | lazy single-flight Browser + per-job Context lifecycle |
| 6 | `phase-1-03-rendered-dom-integration.md` | P1-02, P0-03 | runtime DOM links feed existing inventory/HTTP validation |
| 7 | `phase-1-04-boundary-hooks-telemetry.md` | P1-03, P0-02 | preliminary route/method/WebSocket/origin hooks + security telemetry |
| 8 | `phase-1-05-stop-timeout-failure.md` | P1-02..04 | stop/timeout/failure convergence and cleanup |
| 9 | `phase-1-06-spike-decision.md` | P1-01..05 | evidence report + GO / ADJUST_AND_REPEAT / NO_GO |

Do not start Phase 2 implementation from these task packets. P1-06 only determines whether Phase 2 may begin.
