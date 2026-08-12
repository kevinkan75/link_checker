# P2-06 - Adversarial SSRF Security Matrix

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
7. accepted P2-01 through P2-05 outputs
8. this task packet
9. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
10. actual committed production code and tests

## Objective

Build and run the deterministic adversarial security matrix required to support the Phase 2 gate decision.

## Threat Closed

This task proves the implemented Browser security policy resists controlled SSRF, DNS rebinding, redirect, unsafe method, WebSocket, popup, and egress bypass scenarios within the accepted test boundary.

## Security Invariant

No adversarial fixture may cause Browser traffic to reach an unapproved or unclassifiable destination, and no blocked Browser result may become Node HTTP truth.

## Dependencies

- P2-01 through P2-05 accepted.

## Production Seams

Production changes should be limited to defects exposed by the adversarial matrix. Prefer test/fixture additions and narrowly scoped fixes.

## Expected Files

Candidate files:

- `test-p2-adversarial-ssrf-security-matrix.mjs`
- controlled fixtures under `fixtures/dynamic-scan/` only if required
- targeted production files only if tests expose an implementation defect

## Fixture/Test Strategy

Use controlled localhost servers, secondary local origins, fake resolver sequences, fake route/request objects, and passive sensitive URL strings.

Never actively probe real metadata, private, link-local, government, internal production, or arbitrary sensitive third-party systems.

## Positive Tests

- Safe controlled destinations remain renderable.
- Successful CSR rendered discovery remains unchanged.
- Safe redirects and safe subresources pass when policy approves them.
- Safe subresource redirects remain allowed only when every security-relevant destination is approved.

## Negative/Adversarial Tests

Cover at minimum:

- Direct unsafe IP literal.
- Hostname to unsafe address.
- Mixed safe and unsafe answers.
- IPv4 loopback.
- IPv6 loopback.
- IPv4-mapped IPv6.
- Private IPv4.
- Unique-local IPv6.
- Link-local.
- Metadata address by passive/fake seam only.
- DNS resolution failure.
- DNS timeout.
- Safe-to-unsafe redirect.
- Multi-hop redirect.
- Allowed subresource URL redirecting to a blocked or unsafe destination.
- Representative subresource redirect cases for fetch/XHR, script or stylesheet, image, and iframe/frame where appropriate.
- DNS answer changes.
- Controlled rebind-like sequence.
- Unsafe subresource.
- Unsafe iframe/frame destination.
- Unsafe method.
- `ws:` WebSocket.
- `wss:` WebSocket where safely applicable.
- Popup/new navigation.
- Missing enforcement capability.
- Unknown request class.

## Fail-Closed Behavior

Every negative/adversarial case must either block before unsafe delivery or return a gate-blocking failure. Silent allow is a failure. Browser error, aborted page load, post-connection telemetry, or final HTTP failure is not proof of preventive blocking if the denied receiver was already contacted.

## Acceptance Criteria

- Matrix covers all required classes.
- Every security-relevant redirect destination is revalidated, including subresource redirects.
- When a test claims preventive blocking and receiver-count evidence is technically meaningful, the controlled denied receiver observes delivery/contact count `0`.
- No active sensitive-target probing occurs.
- Node HTTP truth remains authoritative.
- Report schema remains `1.3.0`.
- OQ-3 evidence is sufficient for P2-07 to decide, or gaps are explicitly listed.

## OQ Impact

Provides final OQ-3 evidence input for P2-07. Does not itself close OQ-3.

## Known Residual Risks

Real target environment compatibility and pacing are Phase 5/6 work unless a Phase 2 security defect blocks progression.

## Explicit Non-Goals

- Performance benchmarking.
- Browser request pacing.
- Phase 3 report fields.
- GUI, Analyzer, packaging.

## Validation Commands

Run focused P2-06 matrix tests, all P2 regressions, all P1 regressions, all root `test-*.mjs`, syntax checks, dependency check, and `git diff --check`.

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

- complete adversarial matrix;
- pass/fail evidence by scenario;
- unsafe delivery counts;
- fail-closed results;
- OQ-3 evidence summary;
- validation commands and evidence states;
- git status.

## NO-GO / Blocker Implication

Any reproducible Browser SSRF bypass that cannot be safely mitigated must be reported as a `NO_GO` candidate for P2-07.

Final readiness must be exactly one of:

```text
P2-06_READY_FOR_REVIEW
P2-06_BLOCKED
```
