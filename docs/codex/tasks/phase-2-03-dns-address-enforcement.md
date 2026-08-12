# P2-03 - DNS / Address Enforcement

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
7. accepted P2-01 and P2-02 outputs
8. this task packet
9. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
10. actual committed production code and tests

## Objective

Implement the DNS/address enforcement model selected by P2-02.

## Threat Closed

Browser requests must fail closed for unsafe, ambiguous, changing, or unapproved destinations before traffic reaches those destinations.

## Security Invariant

Every usable address for a Browser destination must be safe and approved, or the Browser request must be blocked before delivery.

## Dependencies

- P2-01 accepted.
- P2-02 outcome `FEASIBLE`.

If P2-02 did not produce `FEASIBLE`, do not execute this task.

## Production Seams

Use only the architecture approved by P2-02. Expected seams may include:

- Browser route handling in `dynamic-renderer.mjs`.
- URL/DNS/IP policy in `link-checker.mjs`.
- A new Browser network policy module if P2-02 selected that shape.

## Expected Files

Actual files depend on P2-02. Candidate files:

- `dynamic-renderer.mjs`
- `link-checker.mjs`
- `browser-network-policy.mjs`
- `test-p2-dns-address-enforcement.mjs`

No package changes unless P2-02 explicitly proved and approved a dependency need.

## Fixture/Test Strategy

Use deterministic resolver/classifier seams and controlled local observers. Real private, metadata, link-local, government, internal, and sensitive third-party targets remain prohibited.

## Positive Tests

- Public/safe address allowed.
- All-safe multi-answer hostname allowed only if selected architecture proves safe handling.
- Duplicate safe DNS answers are normalized or handled deterministically without changing the safe/unsafe decision.
- Safe IPv4 plus safe IPv6 answer set is allowed only if every usable address is security-safe and P2-02 destination binding remains intact.
- Existing CSR discovery still works.

## Negative/Adversarial Tests

- Direct unsafe IP literal blocked.
- Hostname resolving to private/loopback/link-local/metadata/reserved address blocked.
- Mixed safe and unsafe answers blocked.
- Safe IPv4 plus unsafe IPv6 answer set blocked.
- Unsafe IPv4 plus safe IPv6 answer set blocked.
- Duplicate unsafe DNS answers blocked and do not bypass classification.
- IPv4-mapped IPv6 unsafe address blocked.
- DNS timeout, empty answer, malformed answer, unsupported family, and resolver exception fail closed.
- Browser route continues only after approved destination enforcement.

## Fail-Closed Behavior

No DNS or address classification error may silently allow Browser traffic.

## Acceptance Criteria

- Address classification covers IPv4, IPv6, loopback, private, unique-local, link-local, metadata, unspecified, special-use/reserved, and IPv4-mapped IPv6.
- Mixed answer sets, mixed IPv4/IPv6 answer sets, duplicate answers, unsupported answers, malformed answers, ambiguous answers, and unclassifiable answers fail closed unless P2-02 approved a stricter equivalent rule.
- All usable resolved addresses must be security-safe.
- Missing enforcement capability fails closed.
- Node HTTP truth remains unchanged.
- Report schema remains `1.3.0`.

## OQ Impact

Advances OQ-3, but does not close it until P2-07 gate decision.

## Known Residual Risks

Redirect and complete Browser egress parity are owned by P2-04 and P2-05.

## Explicit Non-Goals

- Redirect security beyond hooks required by address enforcement.
- Browser request pacing.
- Phase 3 report schema.
- GUI, Analyzer, packaging.

## Validation Commands

Run focused P2-03 tests, all P1 dynamic render regressions, all root `test-*.mjs`, syntax checks, dependency check, and `git diff --check`.

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

- implemented enforcement model;
- protected address coverage;
- fail-closed results;
- exact DNS ownership behavior;
- OQ-3 impact;
- validation commands and evidence states;
- git status.

## NO-GO / Blocker Implication

If implementation cannot enforce the P2-02 approved destination-binding invariant, stop and report a Phase 2 blocker.

Final readiness must be exactly one of:

```text
P2-03_READY_FOR_REVIEW
P2-03_BLOCKED
```
