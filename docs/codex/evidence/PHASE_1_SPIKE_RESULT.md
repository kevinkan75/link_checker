# Phase 1 Spike Result

Date: 2026-08-11
Branch: `feature/js-dynamic-scan`
Decision: `GO`

## Environment

- Repository: `C:\Users\kevin\Documents\Link_checker`
- Working tree before P1-06 evidence update: clean.
- Recent Phase 1 commits verified:
  - `b947aa4 feat: harden dynamic render failure handling`
  - `9a8ca31 feat: add browser boundary telemetry`
  - `1e12a0a feat: integrate rendered DOM discovery`
  - `132ce90 feat: add dynamic render lifecycle`
  - `b264f16 feat: add dynamic render browser provider`
- Runtime dependency: `playwright-core@1.62.1`
- Full `playwright`: absent.
- `@playwright/test`: absent.
- Browser binaries: no Playwright browser install/download command was run for P1-06.
- Report schema remains `1.3.0`.

## Browser

Evidence state: `AUTOMATED_PASS` for deterministic provider tests; `AUTOMATED_PASS` for current local Edge/Chrome smoke on this workstation.

- Deterministic BrowserProvider contract passed.
- Edge channel smoke:
  - requested: `msedge`
  - status: `available`
  - version: `151.0.4129.72`
  - close outcome: `closed`
- Chrome channel smoke:
  - requested: `chrome`
  - status: `available`
  - version: `151.0.7922.77`
  - close outcome: `closed`
- Auto behavior:
  - requested: `auto`
  - selected: `msedge`
  - status: `available`
- Unavailable and launch-failure classification are covered by deterministic tests.
- Browser absence remains an environment outcome rather than a product-code failure.

Approximate browser launch elapsed was not emitted as a stable field by the smoke script. The launch/close compatibility result was observed by successful smoke completion.

## Discovery

Evidence state: `LOCAL_FIXTURE_PASS`.

Dynamic Render remains opt-in/default-off. Successful render discovery path remains:

```text
page.goto()
-> bounded settle
-> page.content()
-> guards
-> runtime page.url() base
-> existing extractLinks()
-> sourceType = rendered_dom
-> existing ingestDiscoveredLinks()
-> Node HTTP validation
```

Controlled metric projection:

- Average render elapsed across the controlled projection: `822.68 ms`.
- `csr-basic`
  - rendered pages: `2`
  - outcomes: `rendered`, `rendered`
  - rendered canonical URLs:
    - `http://127.0.0.1:<port>/csr-basic-same-origin`
    - `https://dynamic.example/csr-basic-external`
  - inventory summary: `urlsDiscovered=2`, `uniqueCanonicalUrls=2`, `duplicateUrlReferences=0`, `sourcesMerged=0`, `validationSkippedByInventory=0`, `inventoryMergeRatio=0`
- `csr-delayed`
  - rendered pages: `2`
  - outcomes: `rendered`, `rendered`
  - rendered canonical URL:
    - `http://127.0.0.1:<port>/csr-delayed-target`
  - inventory summary: `urlsDiscovered=1`, `uniqueCanonicalUrls=1`, `duplicateUrlReferences=0`, `sourcesMerged=0`, `validationSkippedByInventory=0`, `inventoryMergeRatio=0`
- `duplicate-link`
  - rendered pages: `2`
  - outcomes: `rendered`, `rendered`
  - rendered canonical URL:
    - `http://127.0.0.1:<port>/duplicate-link/shared-target`
  - inventory summary: `urlsDiscovered=3`, `uniqueCanonicalUrls=1`, `duplicateUrlReferences=2`, `sourcesMerged=1`, `validationSkippedByInventory=2`, `inventoryMergeRatio=0.6667`
- `runtime-base-url`
  - rendered pages: `2`
  - outcomes: `rendered`, `rendered`
  - rendered canonical URL:
    - `http://127.0.0.1:<port>/runtime-history/runtime-base/relative-target`
  - inventory summary: `urlsDiscovered=1`, `uniqueCanonicalUrls=1`, `duplicateUrlReferences=0`, `sourcesMerged=0`, `validationSkippedByInventory=0`, `inventoryMergeRatio=0`

Additional P1-03 integration test coverage passed for runtime-only CSR discovery, delayed DOM mutation, duplicate merge/provenance, runtime `page.url()` base resolution, challenge no-ingestion, eligibility gates, navigation failure/timeout, and Node HTTP truth isolation.

## Lifecycle

Evidence state: `AUTOMATED_PASS` and `LOCAL_FIXTURE_PASS`.

- P1-02 deterministic lifecycle tests passed: `14`.
- P1-02 real lifecycle smoke passed with Edge `151.0.4129.72`.
- P1-05 stop/timeout/failure tests passed: `23`; real timeout fixture: `LOCAL_FIXTURE_PASS`.
- Verified lifecycle properties:
  - lazy launch;
  - single-flight launch;
  - one Browser per renderer/scan;
  - fresh ephemeral Context/Page per render job;
  - idempotent stop/close;
  - stop during pending Browser launch disposes late Browser;
  - hard render timeout covers limiter wait, Browser acquisition, Context/Page setup, navigation, settle, content, guards, and extraction;
  - late Browser, `newPage()`, and navigation completions do not revive state, produce a second outcome, ingest links, or create unhandled rejections;
  - job-local failures can leave later render jobs viable;
  - terminal unexpected disconnect does not relaunch automatically.

## Boundary Observations

Evidence state: `LOCAL_FIXTURE_PASS`.

P1-04 telemetry run:

- Controlled browser-request burst:
  - total controlled requests: `10`
  - resource types: `document=1`, `stylesheet=1`, `script=1`, `fetch=3`, `image=4`
  - started: `10`
  - finished: `10`
  - failed: `0`
  - final inflight: `0` by completed-job invariant
  - peak inflight: `7`
  - peak inflight by host: `127.0.0.1:<port>=7`
  - browser requests/page for the burst fixture: `10`
  - request-start interval samples were monotonic and non-negative.
- Method boundary:
  - observed Browser attempts: `GET=1`, `POST=1`, `PUT=1`
  - blocked method count: `2`
  - unsafe method server receives: `0`
  - deterministic method matrix covers `GET`, `HEAD`, `OPTIONS`, `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, and `CUSTOM`.
- WebSocket:
  - WebSocket blocked requests: `1`
  - server handshakes: `0`
- Cross-origin main-frame boundary:
  - main-frame navigation blocked: `1`
  - second-origin deliveries: `0`
  - outcome: `render_scope_blocked`
- Popup/download:
  - popup closed count: `1`
  - download diagnostic count: `1`
  - no download content/path persistence is part of report output.
- Telemetry storage:
  - detailed normal request cap exercised: `230` starts, `30` normal request samples dropped
  - interval cap exercised: `29` interval samples dropped
  - blocked request cap exercised: `130` starts, `30` blocked request samples dropped

These are Phase 1 observation and narrow hook results only. They do not prove Browser/Node security parity.

## Report / Regression Compatibility

Evidence state: `AUTOMATED_PASS` and `LOCAL_FIXTURE_PASS`.

- Dynamic Render remains default-off.
- Browser render remains discovery/evidence only.
- Node HTTP remains authoritative for `status`, `ok`, `classification`, `issueType`, confirmation, and redirect truth.
- `REPORT_SCHEMA_VERSION` remains `1.3.0`.
- No formal Phase 3 report fields were added:
  - no `renderEvidence`;
  - no `summary.dynamicRender`;
  - no formal `checked[].discovery.sourceTypes[]`.
- P0-03 ingestion regression passed with direct controlled inventory/provenance assertions.
- `report-diff.mjs` passed in the full root sweep and remains supplementary compatibility evidence, not the sole equivalence oracle.

## Observed Performance / Telemetry

- Production render timeout default: `15000 ms`.
- Production render concurrency default: `1`.
- Production render page budget default: `25`.
- Production settle defaults:
  - `renderSettleMinMs=1000`
  - `renderSettleIntervalMs=250`
  - `renderSettleStableSamples=3`
  - `renderSettleMaxMs=2500`
- Controlled projection average render elapsed: `822.68 ms`.
- Controlled projection rendered pages: `8` across four fixtures.
- Controlled burst browser requests/page: `10`.
- Controlled burst peak inflight by host: `7`.

These figures are spike evidence only. They are not final Phase 5 performance or pacing benchmarks.

## Open / Next Gate

| OQ | Question | Phase 1 evidence | Current status | Remaining work | Resolution phase | Downstream blocking gate |
| --- | --- | --- | --- | --- | --- | --- |
| OQ-1 | Local Browser Compatibility | `playwright-core@1.62.1`; Edge `151.0.4129.72` and Chrome `151.0.7922.77` launched/closed locally; auto selected Edge; deterministic absence/failure handling. | `provisionally_acceptable` | Broader Windows, enterprise policy, portable-package, and managed-environment validation. | Phase 6 | Phase 6 release gate |
| OQ-2 | Unsafe-method Coverage | GET/HEAD/OPTIONS allowed by deterministic policy; POST/PUT observed and blocked with server receives `0`; wider unsafe/custom matrix covered. | `collecting_evidence` | Phase 2 must finish/evaluate the Browser unsafe-method security policy and diagnostics required by the security gate. | Phase 2 | Phase 2 Security Gate exit |
| OQ-3 | DNS / SSRF Parity | Existing URL evaluator hook and controlled passive fixtures exist; no real sensitive endpoint probing; no DNS rebinding/TOCTOU parity proof. | `open` | Phase 2 Browser Network Security Gate must prove DNS/SSRF/redirect/subrequest parity or fail closed. | Phase 2 | HARD BLOCKER for Phase 2 Security Gate exit |
| OQ-4 | Render Settle Tuning | Bounded settle discovers `csr-basic` and `csr-delayed`; settle max yields `rendered_unsettled` rather than hanging; production defaults remain development values. | `collecting_evidence` | Phase 5 settle benchmark and final default decision. | Phase 5 | Phase 6 consumes completed tuning result |
| OQ-5 | Render Performance Budget | Hard `15000 ms` timeout, concurrency `1`, page budget `25`, bounded settle, bounded telemetry, controlled fixture timings. | `collecting_evidence` | Phase 5 performance benchmark for concurrency, CPU/memory, elapsed time, stop latency, and discovery yield. | Phase 5 | Phase 6 consumes completed budget result |
| OQ-6 | Browser Traffic / Rate-limit Parity | Burst telemetry captured request counts, resource types, peak inflight, per-host peak, and request-start intervals. | `collecting_evidence` | Phase 5 HostScheduler/pacing parity benchmark and accepted pacing policy. | Phase 5 | Phase 6 operational gate if unresolved |

DNS/SSRF parity not proven.

OQ-3 is resolved at the Phase 2 Security Gate, not Phase 3. Phase 3 may later expose/report diagnostics, but it is not the resolution phase for OQ-2 unsafe-method security policy or OQ-3 DNS/SSRF parity. A reproducible Browser SSRF bypass that cannot be safely closed is a No-Go condition.

## Decision

GO

## Rationale

Phase 1 meets the spike decision rule:

- Browser runtime discovery integrates with existing LinkChecker without replacing Node HTTP truth.
- Local Edge/Chrome channel strategy is viable for the spike without bundled Chromium.
- Browser lifecycle is bounded and clean under stop, timeout, failure, and unexpected disconnect tests.
- Runtime DOM discovery finds controlled runtime-only links and preserves inventory/provenance/validation semantics through the existing ingestion path.
- Stop/timeout/failure paths terminate deterministically without state revival or partial ingestion.
- Boundary hooks and telemetry provide measurable seams for Phase 2 and Phase 5 decisions.
- Remaining DNS/SSRF, redirect, pacing, final tuning, GUI, report-schema, and packaging work is explicitly assigned to later gates and is not evidence of Phase 1 architecture failure.

This GO authorizes progression only to Phase 2 Browser Network Security Gate. It does not authorize release, default enablement, GUI rollout, portable packaging, or claims of Browser security parity.

## Environment-blocked Checks

None for the current automated/local fixture matrix. Broader Windows/enterprise/portable compatibility remains deferred to Phase 6 and is not claimed by this evidence.

## Validation

| Command | Result | Evidence state |
| --- | --- | --- |
| `git branch --show-current` | `feature/js-dynamic-scan` | `AUTOMATED_PASS` |
| `git status --short` | clean before evidence update | `AUTOMATED_PASS` |
| `git log -12 --oneline` | P1-01 through P1-05 and P0 commits present | `AUTOMATED_PASS` |
| `node .\test-p1-browser-provider.mjs` | PASS | `AUTOMATED_PASS` |
| `node .\test-p1-browser-provider-smoke.mjs` | PASS; Edge and Chrome available locally; auto selected Edge | `AUTOMATED_PASS` |
| `node .\test-p1-render-lifecycle.mjs` | PASS; 14 tests | `AUTOMATED_PASS` |
| `node .\test-p1-render-lifecycle-smoke.mjs` | PASS; Edge lifecycle smoke | `AUTOMATED_PASS` |
| `node .\test-p1-rendered-dom-integration.mjs` | PASS | `LOCAL_FIXTURE_PASS` |
| `node .\test-p1-boundary-hooks-telemetry.mjs` | PASS | `LOCAL_FIXTURE_PASS` |
| `node .\test-p1-stop-timeout-failure.mjs` | PASS; 23 tests; real timeout fixture local pass | `LOCAL_FIXTURE_PASS` |
| `node .\test-p0-dynamic-fixtures.mjs` | PASS | `LOCAL_FIXTURE_PASS` |
| `node .\test-p0-boundary-fixtures.mjs` | PASS | `LOCAL_FIXTURE_PASS` |
| `node .\test-p0-ingestion-refactor.mjs` | PASS | `LOCAL_FIXTURE_PASS` |
| syntax check over root `.mjs` and `public/*.js` | PASS; 47 files | `AUTOMATED_PASS` |
| all root `test-*.mjs` | PASS; 38 files | `AUTOMATED_PASS` |
| `npm.cmd ls playwright-core --depth=0` | PASS; `playwright-core@1.62.1` | `AUTOMATED_PASS` |
| `npm.cmd ls playwright @playwright/test --depth=0` | expected empty tree for absent packages | `AUTOMATED_PASS` |
| report schema/source field search | `REPORT_SCHEMA_VERSION = "1.3.0"`; no Phase 3 fields found | `AUTOMATED_PASS` |
| controlled metric projection | PASS; average render elapsed `822.68 ms`; rendered runtime URLs observed | `LOCAL_FIXTURE_PASS` |
| `git diff --check` | PASS | `AUTOMATED_PASS` |
