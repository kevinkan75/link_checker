Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-04 — Browser Boundary Hooks / Telemetry

## Objective

Install the preliminary Browser network/origin hooks required for safe Phase 1 experimentation and collect evidence for OQ-2/OQ-3/OQ-6. This task does **not** close the Phase 2 Security Gate.

## Depends on

P0-02 risk fixtures + P1-03 render integration.

## In scope

Before Page creation, install Context-level controls for:

- HTTP(S) routing hook;
- URL security-policy evaluation hook;
- method policy: allow GET/HEAD/OPTIONS; block other/unknown methods;
- `serviceWorkers: 'block'`;
- WebSocket routing/blocking where supported by the pinned Playwright Core version;
- popup/new-page closure policy;
- no saved downloads;
- main-frame origin enforcement;
- redirect/navigation counting sufficient for Phase 1 evidence;
- sanitized counters/telemetry.

Collect at least:

```text
securityBlockedRequests
methodBlockedRequests
websocketBlockedRequests
requestsStartedByHost
requestsFinishedByHost
peakInflightByHost
requestStartIntervals
resourceType
renderPage
```

Do not claim Browser request pacing equals HostScheduler yet.

## Out of scope

- No formal DNS-rebinding/TOCTOU parity conclusion.
- No unsafe-method relaxation.
- No WebSocket content support.
- No arbitrary public-site security testing.
- No Phase 2 PASS/No-Go conclusion.
- No final BrowserRequestPacing design unless the operator explicitly advances to Phase 5 later.

## Acceptance criteria

Using controlled fixtures where environment permits:

- unsafe POST/PUT requests are not delivered to the fixture endpoint;
- WebSocket connection is not established;
- cross-origin main-frame navigation is blocked/aborted and recorded;
- blocked requests do not crash the overall scan;
- counters increment consistently;
- challenge fixture is diagnosed and its challenge links are not ingested;
- request-burst fixture produces measurable per-host telemetry.

For security-private-url fixture, collect evidence only within a controlled safe setup. Mark DNS/TOCTOU conclusions as still open.

## Validation

- syntax + all tests;
- P0-02 integration fixtures;
- browser tests where available.

## Required completion evidence

- method block observations;
- WebSocket block observation;
- main-frame scope observation;
- request telemetry sample;
- explicit statement: `OQ-3 remains open for Phase 2`.

## Stop conditions

If a reproducible policy bypass is found, do not weaken policy. Record the reproduction, keep behavior fail-closed where possible, and mark the task/next gate blocked for security review.

## Suggested commit message

`feat: add browser boundary hooks and telemetry`
