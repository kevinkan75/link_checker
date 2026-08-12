# P2-01 - Browser Request Security Policy

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
7. this task packet
8. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
9. actual committed production code and tests

## Objective

Define and implement the first-release Browser request security policy surface for Dynamic Render without closing OQ-3. This task formalizes which Browser request classes, methods, terminal outcomes, diagnostics, and fail-closed cases are allowed to proceed to the P2-02 destination-binding feasibility gate.

## Threat Closed

This task closes ambiguity in Browser request policy. It does not close DNS/SSRF parity.

## Security Invariant

Browser rendering must not silently allow a request class, method, capability gap, or policy-evaluation failure that has no accepted security behavior.

`DNS/SSRF parity not proven.`

## Dependencies

- P2-00 complete and accepted.
- `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md` available.
- No P2-02 implementation assumptions.

## Production Seams

Inspect and, if accepted by this task, minimally update:

- `dynamic-renderer.mjs` Browser route handling.
- `link-checker.mjs` existing URL security evaluator only if policy integration requires it.

Do not change report schema.

## Expected Files

Expected production/test files are to be confirmed by implementation inspection. Likely candidates:

- `dynamic-renderer.mjs`
- `link-checker.mjs`
- `test-p2-browser-request-security-policy.mjs`

Package files are not expected to change.

## Fixture/Test Strategy

Use controlled localhost fixtures and deterministic fake request/route objects.

Do not contact real private, metadata, government, internal production, or arbitrary sensitive third-party systems.

## Positive Tests

- `GET` allowed by method policy.
- `HEAD` allowed by method policy.
- `OPTIONS` allowed by method policy.
- Known safe request classes have explicit policy outcomes.
- Policy diagnostics remain sanitized.
- Existing P1-03 successful rendered discovery still works for allowed traffic.

## Negative/Adversarial Tests

- `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, and unknown/custom methods are blocked.
- Unknown request class does not silently proceed without explicit accepted behavior.
- Missing required enforcement capability fails closed or returns an explicit gate-blocking outcome.
- Policy evaluator exception fails closed.
- WebSocket policy is not treated as covered by HTTP route policy.

## Fail-Closed Behavior

Ambiguous policy classification, unsupported method, unsupported request class, policy-evaluation failure, or missing required Browser enforcement capability must not silently allow Browser traffic.

## Acceptance Criteria

- Method policy is exact:
  - Allow: `GET`, `HEAD`, `OPTIONS`
  - Block: `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, unknown/unsupported
- Every Browser request class listed in the Phase 2 plan has an explicit policy.
- Blocked attempts remain observable in sanitized telemetry.
- Browser response/route outcomes do not set Node HTTP truth.
- Dynamic Render remains opt-in and default-off.
- OQ-2 remains open until this task's evidence is reviewed; OQ-3 remains open.

## OQ Impact

- OQ-2: advances toward Phase 2 resolution.
- OQ-3: unchanged, still open.
- OQ-6: may preserve telemetry evidence only; no pacing parity claim.

## Known Residual Risks

Even a complete URL/method policy does not prove Browser DNS destination binding. P2-02 remains mandatory.

## Explicit Non-Goals

- DNS/address enforcement.
- Destination binding proof.
- Redirect security implementation.
- Browser request pacing.
- Phase 3 report schema.
- GUI, Analyzer, or packaging changes.

## Validation Commands

Run task-specific deterministic tests, then the maintained root regression set required by `docs/codex/DYNAMIC_SCAN_EXECUTION.md`.

Also run:

```bash
npm.cmd ls playwright-core --depth=0
git diff --check
```

Do not run `npm install`, `npm update`, or `npx playwright install`.

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

- policy summary;
- method matrix;
- request-class matrix;
- fail-closed cases;
- telemetry sanitization;
- P1 regression status;
- OQ impact;
- validation commands and evidence states;
- git status;
- final readiness.

## NO-GO / Blocker Implication

If a required request class or capability cannot be made fail-closed or explicitly policy-controlled, stop and report a Phase 2 blocker. Do not proceed to P2-02 as if policy coverage is complete.

Final readiness must be exactly one of:

```text
P2-01_READY_FOR_REVIEW
P2-01_BLOCKED
```

