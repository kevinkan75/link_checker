# P2-02 - DNS / Destination Binding Feasibility Gate

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

Prove whether the Browser's actual network destination can be constrained to the destination set approved by the security decision.

This is the early Phase 2 feasibility gate. Downstream tasks must not assume destination binding before this task succeeds.

## Threat Closed

This task determines whether the architecture can close DNS/SSRF parity gaps such as DNS rebinding, TOCTOU, mixed DNS answers, and Browser independent resolution.

## Security Invariant

An allowed Browser request may connect only to a destination that has been approved by the security decision for that exact request and destination transition.

`DNS/SSRF parity not proven.`

## Dependencies

- P2-00 accepted.
- P2-01 accepted or explicitly waived only if repository reconnaissance proves policy surface is already complete.

## Production Seams

Inspect and prototype only as authorized by this task:

- Playwright `browserContext.route()`.
- Playwright `browserContext.proxy` / Browser launch proxy support.
- Playwright WebSocket routing.
- Current BrowserProvider launch options.
- Current Node URL/DNS/IP policy.
- Any controlled local proxy or fulfillment seam proposed by this task.

Do not ship a broad Phase 2 implementation from this feasibility task unless the operator explicitly scopes it.

## Expected Files

Expected outputs may include a feasibility evidence document and focused tests/prototypes. Production changes are allowed only if this task explicitly approves a narrow proof seam and the implementation remains reviewable.

Likely candidates:

- `docs/codex/evidence/P2-02_DNS_DESTINATION_BINDING_FEASIBILITY.md`
- `test-p2-dns-destination-binding-feasibility.mjs`

## Fixture/Test Strategy

Use deterministic fake resolvers, fake route/request objects, and controlled local fixture servers.

Do not actively probe real cloud metadata, real private infrastructure, link-local metadata, government/internal systems, or arbitrary sensitive third parties.

## Positive Tests

- Safe hostname with stable safe address is allowed only when the actual Browser destination is proven bound or controlled.
- Multiple safe answers remain safe only if all usable destinations are approved or an equivalent safe binding rule is proven.
- HTTPS navigation/request behavior preserves SNI and certificate hostname validation without weakening `ignoreHTTPSErrors: false`.
- Representative Browser-initiated traffic is governed, with examples from fetch/XHR, script or stylesheet, image, and iframe/frame.
- First-release WebSocket blocking remains independent and reliable for the candidate architecture.
- Candidate viability is shown for local Edge `msedge` and Chrome `chrome` channels without violating the accepted BrowserProvider contract.
- Selected architecture preserves normal successful CSR discovery.

## Negative/Adversarial Tests

- Safe DNS answer at approval time, unsafe DNS answer at Browser connect time.
- Mixed safe and unsafe DNS answers.
- Browser re-resolution after policy approval.
- Redirect to unsafe host/IP.
- Representative redirect behavior proves the candidate can support per-destination security enforcement; P2-04 may implement final redirect policy only after this feasibility is shown.
- HTTPS/SNI/certificate workaround attempts that require `ignoreHTTPSErrors: true`, certificate validation bypass, or insecure host-name mismatch are rejected.
- WebSocket interception unavailable or ineffective does not silently permit `ws:` or `wss:` egress.
- Missing enforcement capability.
- Destination-binding mechanism initialization failure, proxy/control path failure, resolver/control API failure, candidate disconnect, or candidate termination cannot fall back to unrestricted Browser egress.
- Attempt to rely only on `evaluateUrlSecurity(url)` then `route.continue()`.

## Fail-Closed Behavior

If actual destination binding cannot be proven, the task must return `ADJUST_ARCHITECTURE` or `NO_GO_CANDIDATE`; it must not declare OQ-3 pass.

If the selected candidate cannot initialize, loses its control path, cannot resolve/classify safely, lacks a required Browser capability, or disconnects while Browser traffic may still occur, Browser egress must fail closed or the task must report a gate-blocking outcome.

## Acceptance Criteria

Return exactly one feasibility outcome:

```text
FEASIBLE
ADJUST_ARCHITECTURE
NO_GO_CANDIDATE
```

`FEASIBLE` requires reproducible proof that actual Browser destinations are constrained to approved destinations across task-owned request classes and redirect transitions.

`FEASIBLE` also requires evidence for all mandatory proof dimensions:

- who performs security DNS resolution;
- who performs actual connection DNS resolution;
- who owns the TCP connection;
- whether the Browser can independently re-resolve;
- whether the approved address set is preventively bound;
- DNS rebinding / TOCTOU resistance;
- HTTPS navigation/request behavior;
- SNI implications;
- certificate hostname validation;
- preservation of `ignoreHTTPSErrors: false`;
- representative redirect capability sufficient to support P2-04;
- representative subresources including fetch/XHR, script or stylesheet, image, and iframe/frame;
- WebSocket implications and first-release hard block behavior;
- Edge `msedge` viability;
- Chrome `chrome` viability;
- failure behavior for initialization, proxy/control path, resolver/control API, missing Browser capability, disconnect, and termination.

Blocking localhost or passing URL-policy tests alone is not sufficient for `FEASIBLE`.

## OQ Impact

- OQ-3 may advance only if the proof is accepted.
- OQ-3 must not be marked closed by assumption.

## Known Residual Risks

A feasibility proof may still require P2-03 through P2-06 to implement and verify complete enforcement.

## Explicit Non-Goals

- Phase 3 report schema.
- Browser request pacing.
- GUI, Analyzer, packaging, or release readiness.
- Real sensitive-network probing.

## Validation Commands

Run deterministic feasibility tests and relevant P1 regressions. Also run:

```bash
npm.cmd ls playwright-core --depth=0
git diff --check
```

Do not install or download Browsers.

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

- tested architecture candidates;
- feasibility outcome;
- DNS ownership proof;
- destination-binding proof or gap;
- rebind/TOCTOU evidence;
- redirect implications;
- selected path for P2-03 or blocker reason;
- OQ-3 impact;
- validation commands and evidence states;
- git status.

## NO-GO / Blocker Implication

If no safe and maintainable destination-binding architecture is feasible, report:

```text
NO_GO_CANDIDATE
```

and do not proceed to downstream implementation.

Final readiness must be exactly one of:

```text
P2-02_READY_FOR_REVIEW
P2-02_BLOCKED
```
