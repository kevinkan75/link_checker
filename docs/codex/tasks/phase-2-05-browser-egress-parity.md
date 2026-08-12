# P2-05 - Browser Egress Parity

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
7. accepted P2-01 through P2-04 outputs
8. this task packet
9. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
10. actual committed production code and tests

## Objective

Verify and enforce first-release Browser egress policy across Browser request classes and non-HTTP channels owned by Phase 2.

## Threat Closed

Browser subresources, frames, popups, WebSockets, downloads, or unclassified channels must not bypass the approved security policy.

## Security Invariant

Every Browser egress path either uses the approved destination enforcement model or fails closed with sanitized diagnostics.

## Dependencies

- P2-01 accepted.
- P2-02 `FEASIBLE`.
- P2-03 accepted.
- P2-04 accepted or explicitly integrated into this task.

## Production Seams

Relevant seams may include:

- BrowserContext route installation.
- WebSocket route handling.
- Popup/new-page handling.
- Download event handling.
- Request telemetry.
- Selected Browser network policy module.

## Expected Files

Candidate files:

- `dynamic-renderer.mjs`
- selected Browser network policy module
- `test-p2-browser-egress-parity.mjs`

## Fixture/Test Strategy

Use existing controlled fixtures and add controlled local fixtures only as necessary.

No real sensitive/private/metadata target probing.

## Positive Tests

- Main document, iframe/frame, fetch, XHR, image, script, stylesheet, font, media, and other accepted Browser subresources obey policy.
- OPTIONS/preflight behavior matches P2-01 policy.
- Existing successful dynamic rendered discovery remains intact.

## Negative/Adversarial Tests

- Unsafe subresource blocked before delivery.
- Unsafe iframe/frame destination blocked before delivery.
- Unsafe font, media, and other Browser subresource destinations are blocked before delivery.
- `ws:` WebSocket attempt blocked and handshake delivery prevented where safely applicable.
- `wss:` WebSocket attempt blocked and handshake delivery prevented where safely applicable.
- Popup/new page does not traverse DOM or ingest links and remains policy-controlled.
- Download is not saved, inspected, or path-persisted.
- Missing WebSocket or route capability fails closed or blocks gate.
- Unknown or unclassified network-capable request class has explicit fail-closed behavior.

## Fail-Closed Behavior

Any egress channel that cannot be policy-controlled must be blocked or must block Phase 2 gate passage. HTTP route enforcement alone is not evidence of WebSocket coverage.

## Acceptance Criteria

- HTTP route coverage and WebSocket coverage are separately proven.
- First-release WebSockets remain blocked for both `ws:` and `wss:` where safely applicable.
- Unsupported or missing WebSocket interception capability must not silently permit WebSocket egress.
- Method policy remains allow `GET`, `HEAD`, `OPTIONS`; block `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, unknown/unsupported.
- Popup and download boundaries remain non-persistent and sanitized.
- No Browser egress class silently bypasses policy.
- Telemetry remains bounded and sanitized.
- Node HTTP truth remains authoritative.

## OQ Impact

- Advances OQ-3.
- Preserves OQ-6 as Phase 5 pacing/parity work; do not claim HostScheduler parity.

## Known Residual Risks

Phase 5 still owns Browser request pacing and performance budget.

## Explicit Non-Goals

- Request pacing.
- Phase 3 report schema.
- GUI, Analyzer, packaging.

## Validation Commands

Run focused P2-05 tests, P2-03/P2-04 regressions, P1 regressions, all root `test-*.mjs`, syntax checks, dependency check, and `git diff --check`.

## Evidence States

Use only:

- `AUTOMATED_PASS`
- `LOCAL_FIXTURE_PASS`
- `ENV_BLOCKED`
- `HUMAN_WINDOWS_REQUIRED`
- `HUMAN_USABILITY_REQUIRED`

## Git Restrictions

Do not stage, commit, push, merge, rebase, reset, clean, stash, or switch branches unless explicitly authorized after review.

## Completion Report Contract

Report:

- request-class evidence;
- WebSocket evidence;
- popup/download evidence;
- capability fail-closed behavior;
- telemetry and sanitization;
- OQ impact;
- validation commands and evidence states;
- git status.

## NO-GO / Blocker Implication

If any Browser egress path cannot be governed or failed closed, stop and report a Phase 2 blocker.

Final readiness must be exactly one of:

```text
P2-05_READY_FOR_REVIEW
P2-05_BLOCKED
```
