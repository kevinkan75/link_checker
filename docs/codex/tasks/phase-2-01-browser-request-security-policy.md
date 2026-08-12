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

P2-01 is an architecture-neutral Browser request security policy task. It may create/refactor a policy pipeline and a future transport-neutral integration seam, but it must not choose or implement a destination-binding architecture.

## Threat Closed

This task closes ambiguity in Browser request policy. It does not close DNS/SSRF parity.

## Security Invariant

Browser rendering must not silently allow a request class, method, capability gap, malformed policy decision, or policy-evaluation failure that has no accepted security behavior.

`DNS/SSRF parity not proven.`

P2-01 policy `ALLOW` only means the request has no P2-01 policy-layer reason to block and may advance to the next enforcement stage. It does not mean destination binding is proven, DNS/SSRF parity is proven, or the Browser's actual network destination is approved.

## Production Contract

P2-01 must define an internal, architecture-neutral Browser request-policy decision contract. Exact code names may differ, but the semantics must be deterministic and machine-testable.

### Normalized Inputs

The policy input must normalize at least:

- URL;
- HTTP method;
- request/resource class;
- main-frame versus non-main-frame context;
- current page or crawl origin where origin policy requires it;
- existing URL-security evaluation result.

The request-class model must be capable of representing at least:

- main document;
- iframe/frame;
- fetch;
- XHR;
- image;
- script;
- stylesheet;
- font;
- media;
- other Browser subresources.

Unknown or unclassified network-capable request classes must have explicit policy semantics. P2-01 does not need to prove complete Browser egress parity; P2-05 owns that final coverage.

### Decision Values

The policy must return a decision state equivalent to:

- `ALLOW`
- `BLOCK`
- `ERROR_OR_FAIL_CLOSED`

`ALLOW`:

- means the P2-01 policy layer found no policy-level reason to block;
- may advance the request to the next enforcement stage;
- under the current P2-01 architecture may eventually reach `route.continue()` only after all P2-01 policy checks pass;
- does not establish P2-02 destination binding.

`BLOCK`:

- means an intentional security policy rule denied the request;
- examples include unsafe HTTP method, main-frame origin escape, existing URL-security policy rejection, or unknown/unsupported security-critical request class when policy requires blocking.

`ERROR_OR_FAIL_CLOSED`:

- means the policy could not safely produce a normal allow/block result due to an internal, evaluator, or contract error;
- Browser request handling must fail closed;
- unrestricted `route.continue()` must not occur.

Examples include evaluator exception, malformed evaluator result, malformed internal decision state, or required security state unavailable.

### Route-Action Mapping

The implementation must map policy decisions deterministically:

```text
ALLOW
-> may advance to the next enforcement stage
-> under current P2-01 architecture this may eventually reach route.continue()
-> but only after all P2-01 policy checks pass
-> this does NOT establish P2-02 destination binding
```

```text
BLOCK
-> route.abort() or repository-equivalent preventive denial
-> no unrestricted continuation
```

```text
ERROR_OR_FAIL_CLOSED
-> route.abort() or repository-equivalent preventive denial
-> no unrestricted continuation
```

A policy error must never map to `route.continue()`.

The design must leave a clean seam conceptually equivalent to:

```text
Browser request
-> P2-01 policy decision
-> future destination-enforcement stage
-> Browser transport
```

P2-01 must not implement the future destination-enforcement stage.

### Reason Taxonomy

P2-01 must define stable internal reasons that are deterministic, JSON-safe, architecture-neutral, sanitized, and not a Phase 3 public report schema.

The taxonomy must distinguish reasons equivalent to:

- `unsafe_method`
- `main_frame_scope_blocked`
- `url_security_blocked`
- `security_evaluator_failed`
- `invalid_security_decision`
- `unknown_request_class`

Do not implement P2-02-owned reasons such as:

- `destination_binding_failed`
- `dns_binding_failed`
- `dns_rebinding_blocked`

If future reason namespaces are mentioned for later tasks, mark them `NOT_IMPLEMENTED_IN_P2_01`.

### Node DNS-Failure Boundary

P2-01 does not change existing Node HTTP-path DNS resolver exception semantics.

Current repository-grounded behavior from P2-00: for applicable non-IP, non-localhost hostnames, when the Node DNS resolver used by `evaluateUrlSecurity()` throws, the existing Node evaluator currently returns an allowed security decision, allowing the Node request path to proceed.

If `link-checker.mjs` must be touched solely to expose or reuse an architecture-neutral helper, P2-01 must preserve existing Node behavior with regression tests proving:

- existing Node URL-security behavior remains unchanged;
- DNS resolver exception behavior remains unchanged;
- existing Node request flow remains unchanged;
- relevant regressions pass.

Browser policy behavior may be stricter:

```text
Browser policy evaluation failure
-> fail closed
```

This is Browser request-policy fail-closed behavior, not Node/Browser parity and not a Node DNS-failure policy change. A later Phase 2 task may tighten Node behavior only if separately scoped, justified, and regression-tested.

## Dependencies

- P2-00 complete and accepted.
- `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md` available.
- No P2-02 implementation assumptions.

## Production Seams

Inspect and, if accepted by this task, minimally update:

- `dynamic-renderer.mjs` Browser route handling.
- `dynamic-renderer.mjs` internal Browser request telemetry/reason handling if needed for deterministic policy evidence.
- `link-checker.mjs` existing URL security evaluator only if policy integration genuinely requires exposing or reusing an existing security primitive.

Preferred production scope is `dynamic-renderer.mjs`.

Do not refactor Node HTTP security policy merely for stylistic consistency. If `link-checker.mjs` is modified, acceptance must prove existing Node URL-security behavior, DNS resolver exception behavior, and Node request flow are unchanged.

Do not change report schema.

## Expected Files

Expected production/test files are to be confirmed by implementation inspection. Likely candidates:

- `dynamic-renderer.mjs`
- `test-p2-browser-request-security-policy.mjs`

Conditional candidate:

- `link-checker.mjs`, only if genuinely necessary to expose/reuse an existing architecture-neutral security primitive without changing Node semantics.

Package files are not expected to change.

## Fixture/Test Strategy

Use controlled localhost fixtures and deterministic fake request/route objects.

The implementation should create or use a focused deterministic test suite, conventionally:

```bash
node test-p2-browser-request-security-policy.mjs
```

Do not contact real private, metadata, government, internal production, link-local, or arbitrary sensitive third-party systems.

Policy tests must prove policy decisions and route behavior. They must not claim actual Browser destination binding.

## Focused Test Matrix

| Case | Expected decision | Expected route behavior |
| --- | --- | --- |
| GET safe policy path | `ALLOW` | may continue to next stage |
| HEAD safe policy path | `ALLOW` | may continue to next stage |
| OPTIONS safe policy path | `ALLOW` | may continue to next stage |
| POST | `BLOCK` | no continue |
| PUT | `BLOCK` | no continue |
| PATCH | `BLOCK` | no continue |
| DELETE | `BLOCK` | no continue |
| CONNECT | `BLOCK` | no continue |
| TRACE | `BLOCK` | no continue |
| unknown method | `BLOCK` or fail-closed equivalent | no continue |
| main-frame origin escape | `BLOCK` | no continue |
| URL-security rejection | `BLOCK` | no continue |
| evaluator exception | `ERROR_OR_FAIL_CLOSED` | no continue |
| malformed evaluator/decision result | `ERROR_OR_FAIL_CLOSED` | no continue |

Exact code-level names may differ. `ALLOW` in this matrix does not prove actual-destination safety.

## Positive Tests

- `GET` allowed by method policy.
- `HEAD` allowed by method policy.
- `OPTIONS` allowed by method policy.
- Same-origin main-frame navigation is allowed at the origin-policy layer.
- Known safe request classes have explicit policy outcomes.
- Policy diagnostics remain sanitized.
- Existing P1-03 successful rendered discovery still works for allowed traffic.

## Negative/Adversarial Tests

- `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, and unknown/custom methods are blocked.
- Unknown or malformed method paths fail closed where representable by the test seam.
- Unknown request class does not silently proceed without explicit accepted behavior.
- Main-frame navigation outside the accepted origin is blocked with deterministic `main_frame_scope_blocked`-equivalent reason evidence.
- Origin semantics remain scheme plus hostname plus port.
- Existing URL-security evaluator rejection blocks with deterministic `url_security_blocked`-equivalent reason evidence.
- Policy evaluator exception fails closed with deterministic `security_evaluator_failed`-equivalent reason evidence.
- Malformed evaluator or malformed internal decision result fails closed with deterministic `invalid_security_decision`-equivalent reason evidence.
- Missing required enforcement capability fails closed or returns an explicit gate-blocking outcome.
- WebSocket policy is not treated as covered by HTTP route policy.

For every P2-01-owned blocked/error case, tests must verify unrestricted continuation does not occur. At minimum, route continuation count must be `0` for:

- unsafe method;
- main-frame origin escape;
- URL-security rejection;
- security evaluator failure;
- malformed policy decision.

Telemetry showing "blocked" is insufficient if `route.continue()` was still invoked.

Do not conflate origin acceptance with SSRF destination safety:

```text
same-origin != destination-safe
destination-safe != crawl-origin-allowed
```

## Fail-Closed Behavior

Ambiguous policy classification, unsupported method, unsupported request class, policy-evaluation failure, malformed policy decision, or missing required Browser enforcement capability must not silently allow Browser traffic.

P2-01-owned policy failures must map to `ERROR_OR_FAIL_CLOSED` or an equivalent gate-blocking denial. They must not call unrestricted `route.continue()`.

Do not require P2-01 to solve destination-binding mechanism failures that belong to P2-02. The decision model must remain extensible for later destination-enforcement failures without redesign.

## Acceptance Criteria

P2-01 may be accepted only if:

1. one normalized architecture-neutral Browser request security decision pipeline exists;
2. decision semantics equivalent to `ALLOW`, `BLOCK`, and `ERROR_OR_FAIL_CLOSED` are deterministic;
3. stable internal reason values exist;
4. `GET`, `HEAD`, and `OPTIONS` remain allowed at the P2-01 policy layer;
5. `POST`, `PUT`, `PATCH`, `DELETE`, `CONNECT`, `TRACE`, and unknown/unsupported methods are blocked;
6. blocked methods do not call unrestricted continuation;
7. main-frame origin escape remains blocked;
8. main-frame origin blocking has deterministic reason evidence;
9. existing URL-security rejection remains blocked;
10. URL-security rejection has deterministic reason evidence;
11. evaluator/internal-policy errors fail closed;
12. evaluator failure does not call unrestricted continuation;
13. existing Node DNS resolver-exception behavior is unchanged;
14. request-class model remains extensible for P2-05;
15. no WebSocket parity claim is made;
16. no destination-binding implementation is introduced;
17. OQ-2 remains `collecting_evidence`;
18. OQ-3 remains open;
19. `DNS/SSRF parity not proven.` remains explicit in completion evidence;
20. P2-02 remains required;
21. relevant Phase 1 regression tests pass;
22. no Phase 3, Phase 5, or Phase 6 work occurs.

## OQ Impact

- OQ-2: advances toward Phase 2 resolution but remains `collecting_evidence` until reviewed.
- OQ-3: unchanged, still open.
- OQ-6: may preserve telemetry evidence only; no pacing parity claim.

## Known Residual Risks

Even a complete URL/method/request-class policy does not prove Browser DNS destination binding. P2-02 remains mandatory.

## Explicit Non-Goals

- actual Browser destination binding;
- DNS pinning;
- DNS rebinding prevention;
- TOCTOU closure;
- proxy selection;
- Node fulfillment selection;
- Chromium resolver-rule selection;
- OS DNS/hosts manipulation;
- IP rewriting;
- final DNS/address enforcement;
- full redirect/re-resolution enforcement;
- complete Browser egress parity;
- WebSocket parity certification;
- OQ-2 closure;
- OQ-3 closure;
- Node DNS-failure policy change;
- Browser request pacing;
- Phase 3 report schema;
- Phase 5 performance/pacing;
- Phase 6 packaging/release;
- GUI or Analyzer changes.

## Context Security

P2-01 must not weaken:

```text
serviceWorkers: "block"
acceptDownloads: false
ignoreHTTPSErrors: false
fresh ephemeral BrowserContext
```

Also preserve:

- no persistent profile;
- no credentials;
- no storageState;
- no arbitrary executable path.

## Evidence Boundary

P2-01 may preserve or refine sanitized internal policy evidence such as:

- decision;
- reason;
- method;
- request class;
- render page;
- host or sanitized destination identity where already permitted.

Do not add Phase 3 public report contract. Do not add:

- `renderEvidence`;
- `summary.dynamicRender`;
- formal report schema fields;
- schema bump.

Current report schema remains `1.3.0`.

Do not persist sensitive request data, including Authorization, cookies, credentials, request body, response body, sensitive query values, full DOM, HAR, trace, video, or browser profile data.

## WebSocket Boundary

WebSocket is a separate Browser network channel.

P2-01 HTTP request-policy implementation must not claim WebSocket coverage. First-release WebSockets remain blocked under the existing or later Phase 2 WebSocket enforcement path. Final WebSocket parity remains owned by P2-05/P2-06.

## Validation Commands

Run the focused deterministic P2-01 test if created:

```bash
node test-p2-browser-request-security-policy.mjs
```

Run relevant Phase 1 regressions affected by Browser route policy, including P1-03 rendered discovery, P1-04 boundary telemetry, and P1-05 stop/timeout/failure tests.

Run the maintained root regression set required by `docs/codex/DYNAMIC_SCAN_EXECUTION.md`, including syntax checks over root `.mjs` and `public/*.js` and all root `test-*.mjs`.

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

- files changed;
- P2-01 policy pipeline implemented;
- destination binding NOT implemented;
- `DNS/SSRF parity not proven.`;
- `P2-02_REQUIRED`;
- OQ-3 remains open;
- OQ-2 remains `collecting_evidence`;
- decision contract;
- reason taxonomy;
- method matrix;
- request-class matrix;
- origin-policy evidence;
- URL-policy rejection evidence;
- evaluator-failure evidence;
- blocked route-continuation counts;
- fail-closed cases;
- telemetry sanitization;
- Node DNS-failure behavior regression result;
- focused test results;
- relevant Phase 1 regression results;
- syntax checks;
- dependency state;
- git status;
- final readiness.

Implementation must leave changes uncommitted for read-only audit.

## NO-GO / Blocker Implication

If a required request class or capability cannot be made fail-closed or explicitly policy-controlled, stop and report a Phase 2 blocker. Do not proceed to P2-02 as if policy coverage is complete.

Final readiness must be exactly one of:

```text
P2-01_READY_FOR_REVIEW
P2-01_BLOCKED
```
