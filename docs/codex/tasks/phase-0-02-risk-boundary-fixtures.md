Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P0-02 — Risk / Boundary Fixtures

## Objective

Add controlled fixtures for lifecycle, network-boundary, and coverage-risk cases that later Phase 1/2 tasks can measure reproducibly.

## Depends on

P0-01 Core Dynamic Fixtures.

## In scope

Add fixtures for:

- `render-timeout`
- `security-private-url`
- `side-effect-method`
- `popup-download`
- `render-cross-origin-navigation`
- `challenge-rendered`
- `websocket-egress`
- `browser-request-burst`

All targets must be controlled fixtures. Do not use real metadata services, private infrastructure, or arbitrary public websites.

## Out of scope

- Implementing Browser interception in production code.
- Closing OQ-2/OQ-3/OQ-6.
- Changing current security defaults.

## Fixture contract

### render-timeout
Creates deterministic long-running/unsettled behavior without hanging the test process forever.

### security-private-url
Emits runtime URLs or requests representing localhost/private/metadata-like cases using a controlled test mechanism. Never contact a real cloud metadata service.

### side-effect-method
Attempts POST/PUT-style initialization requests against a controlled endpoint that records whether the request was received.

### popup-download
Attempts a popup and a download; endpoints must be local and safe.

### render-cross-origin-navigation
Attempts main-frame navigation to a second controlled origin/port.

### challenge-rendered
Renders a deterministic challenge-like page matching the project's existing protection/challenge signals where possible.

### websocket-egress
Attempts a WebSocket connection to a controlled local endpoint and records whether the handshake was accepted.

### browser-request-burst
Creates a known number/type of subresource/fetch requests so OQ-6 telemetry can compare request starts and peak in-flight behavior.

## Acceptance criteria

- Every fixture has a deterministic pass/fail observation point.
- No fixture requires unauthorized external scanning.
- Side-effect fixture can prove whether unsafe methods were actually blocked later.
- WebSocket fixture can prove whether connection establishment was blocked later.
- Burst fixture exposes known expected request counts/types.
- Existing tests remain green.

## Validation

Run syntax + all existing `test-*.mjs` + targeted fixture harness tests.

## Required completion evidence

For each fixture, record:

```text
start URL
expected action
observation endpoint/state
expected later policy result
```

## Suggested commit message

`test: add dynamic scan boundary fixtures`
