# P2-04 - Redirect / Re-resolution Security

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
7. accepted P2-01 through P2-03 outputs
8. this task packet
9. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
10. actual committed production code and tests

## Objective

Enforce security revalidation for Browser redirects and destination transitions.

## Threat Closed

Initial URL validation must not allow a later redirect or DNS-answer change to move Browser traffic to an unsafe destination.

## Security Invariant

Every security-relevant Browser destination transition must be revalidated and constrained before the Browser connects to the next destination.

## Dependencies

- P2-01 accepted.
- P2-02 `FEASIBLE`.
- P2-03 accepted or explicitly integrated into this task by operator direction.

## Production Seams

Use the P2-02/P2-03 approved enforcement path. Relevant code may include Browser route handling, redirect observation, and selected network policy module.

## Expected Files

Candidate files:

- `dynamic-renderer.mjs`
- selected Browser network policy module
- `test-p2-redirect-reresolution-security.mjs`

## Fixture/Test Strategy

Use controlled local redirect fixtures and deterministic resolver seams.

Do not use external redirect targets or real sensitive destinations.

## Positive Tests

- Same-origin safe redirect succeeds when every hop is approved.
- Multi-hop safe redirect succeeds within the accepted redirect limit.
- Existing rendered DOM discovery works after safe redirects.

## Negative/Adversarial Tests

- Safe-to-unsafe redirect blocked before unsafe delivery.
- Cross-origin redirect policy matches accepted scope.
- Redirect loop bounded and fails safely.
- Redirect count limit enforced where owned.
- Redirect plus DNS answer change blocked/fails closed.
- Subresource redirect revalidated.
- Main-frame redirect revalidated.

## Fail-Closed Behavior

Ambiguous redirect target, failed redirect classification, missing redirect enforcement capability, or unapproved DNS transition must block Browser traffic.

## Acceptance Criteria

- Initial URL validation alone is not sufficient.
- Every hop receives security revalidation.
- Unsafe redirect destinations are not contacted.
- Render outcome remains structured and does not ingest Browser error page links.
- Node HTTP truth remains authoritative.
- Report schema remains `1.3.0`.

## OQ Impact

Advances OQ-3 evidence; does not close OQ-3 until P2-07.

## Known Residual Risks

Complete request-class parity and WebSocket/popup egress are finalized in P2-05/P2-06.

## Explicit Non-Goals

- Browser request pacing.
- Phase 3 report fields.
- GUI, Analyzer, packaging.

## Validation Commands

Run focused P2-04 tests, P2-03 regressions, P1 regressions, all root `test-*.mjs`, syntax checks, dependency check, and `git diff --check`.

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

- redirect model;
- revalidation points;
- safe and unsafe redirect evidence;
- DNS re-resolution behavior;
- OQ-3 impact;
- validation commands and evidence states;
- git status.

## NO-GO / Blocker Implication

If Browser redirects cannot be constrained to approved destinations, stop and report a Phase 2 blocker.

Final readiness must be exactly one of:

```text
P2-04_READY_FOR_REVIEW
P2-04_BLOCKED
```

