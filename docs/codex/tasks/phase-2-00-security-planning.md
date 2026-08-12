# P2-00 — Browser Network Security Gate Planning

## Status

`NOT_STARTED`

## Phase

Phase 2 — Browser Network Security Gate

## Task Type

Repository reconnaissance + security planning only.

This task MUST NOT modify production code, tests, fixtures, dependencies, report schema, GUI, Analyzer, or packaging.

---

# 1. Objective

Ground the committed Phase 2 Security Planning Specification in the actual Local Link Checker repository.

P2-00 must determine:

1. how the current Node-side URL/DNS/security path actually works;
2. how the current Browser request/network path actually works;
3. who performs DNS resolution for security classification;
4. who performs DNS resolution for the Browser's actual connection;
5. whether the approved security destination can be bound to the Browser's actual network destination;
6. what DNS-rebinding / TOCTOU gap currently exists;
7. which production security primitives can be safely reused;
8. which Playwright/Chromium enforcement seams are actually available;
9. which controlled fixture/test architecture is required;
10. how Phase 2 should be decomposed into executable security tasks.

P2-00 must then produce a repository-grounded Phase 2 detailed security plan and P2-01 through P2-07 task packets.

P2-00 is not permitted to implement the resulting security architecture.

---

# 2. Authority

Follow this authority order:

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. this task packet
6. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
7. actual committed production code and tests for current implementation facts

If documentation and current production behavior disagree about an already-shipped implementation detail:

- preserve current production behavior;
- report the documentation drift;
- do not silently modify production code during P2-00.

The Phase 2 Security Planning Specification is security-specific authority and must not be weakened by P2-00.

---

# 3. Baseline

Phase 1 is closed.

Phase 1 decision:

`GO`

GO means only:

`ENTER_PHASE_2_SECURITY_GATE`

It does NOT mean:

- production-ready;
- release-ready;
- security-approved;
- DNS/SSRF parity proven;
- GUI-ready;
- portable-package-ready;
- Dynamic Render may be enabled by default.

Relevant accepted history includes:

```text
2ab063e docs: add phase 2 security planning specification
bb5a88f docs: record phase 1 dynamic render spike decision
b947aa4 feat: harden dynamic render failure handling
9a8ca31 feat: add browser boundary telemetry
1e12a0a feat: integrate rendered DOM discovery
132ce90 feat: add dynamic render lifecycle
b264f16 feat: add dynamic render browser provider
```

Expected branch:

`feature/js-dynamic-scan`

P2-00 starts from a clean working tree.

---

# 4. Primary Security Gate

OQ-3 — DNS / SSRF Parity

Current status:

`open`

OQ-3 is a Phase 2 hard blocker.

Required substantive statement throughout P2-00:

`DNS/SSRF parity not proven.`

A reproducible Browser SSRF bypass that cannot be safely closed under an acceptable architecture is:

`NO_GO`

P2-00 itself MUST NOT close OQ-3.

---

# 5. Critical Security Invariant

The following pattern is insufficient by itself:

```text
Browser request URL
→ evaluateUrlSecurity(url)
→ route.continue()
→ Browser independently resolves/connects
```

Browser URL-policy inspection alone does not prove DNS/SSRF parity.

The central Phase 2 architectural question is:

> Can the Browser's actual network destination be constrained to the destination set approved by the security decision?

P2-00 must treat URL approval and actual network destination enforcement as separate concepts.

---

# 6. Threat Model

Assume rendered page content and runtime JavaScript may be attacker-controlled.

The threat model must include Browser traffic initiated through, where applicable:

- top-level navigation;
- redirects;
- iframe/frame navigation;
- fetch;
- XHR;
- image;
- script;
- stylesheet;
- font;
- media;
- other Browser subresources;
- form-like or method-bearing requests;
- popup/new-page navigation;
- WebSocket;
- dynamically generated URLs.

The attacker may attempt to exploit:

- DNS rebinding;
- DNS answer changes over time;
- mixed safe/unsafe DNS answers;
- URL parsing ambiguity;
- hostname normalization ambiguity;
- IPv4/IPv6 representation differences;
- IPv4-mapped IPv6;
- Browser-versus-Node resolver differences;
- TOCTOU between policy evaluation and Browser connection;
- redirects;
- subresource behavior differing from main-frame behavior.

Do not assume runtime JavaScript is benign.

---

# 7. Non-Negotiable Existing Boundaries

P2-00 must preserve the existing accepted architecture unless reconnaissance proves a conflict that must be reviewed later.

## HTTP truth

Browser remains discovery/evidence only.

Node HTTP validation remains authoritative for:

- `status`
- `ok`
- `classification`
- `issueType`
- confirmation
- redirect truth

## Dynamic Render

Remains explicit opt-in/default-off.

## Browser lifecycle

Preserve:

- local Edge first;
- local Chrome fallback;
- no bundled Chromium;
- no arbitrary executable path;
- one Browser per renderer/scan;
- fresh ephemeral BrowserContext per render job;
- fresh Page per render job;
- no persistent personal profile;
- no credentials/storageState injection;
- `serviceWorkers: "block"`;
- `acceptDownloads: false`;
- `ignoreHTTPSErrors: false`;
- no endless automatic Browser relaunch.

## Method policy

Accepted first-release policy:

ALLOW:

```text
GET
HEAD
OPTIONS
```

BLOCK:

```text
POST
PUT
PATCH
DELETE
CONNECT
TRACE
unknown/unsupported
```

## WebSocket

First-release policy remains:

`blocked`

unless later authoritative review changes it.

## Main-frame boundary

Current main-frame scope comparison uses origin semantics including:

- scheme;
- hostname;
- port.

Do not weaken it during planning.

---

# 8. Required Repository Reconnaissance

Before producing the Phase 2 plan, inspect the actual repository.

At minimum inspect:

- `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
- `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
- `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
- `AGENTS.md`
- `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
- `dynamic-renderer.mjs`
- `browser-provider.mjs`
- `link-checker.mjs`
- existing URL/security-policy helpers
- existing DNS helpers
- existing IP/address classification helpers
- existing redirect/security handling
- P0 boundary fixtures
- `test-p1-boundary-hooks-telemetry.mjs`
- `test-p1-stop-timeout-failure.mjs`
- other directly relevant tests/fixtures.

Inspect the locally installed pinned:

`playwright-core@1.62.1`

where its installed source/type definitions are needed to establish API capabilities.

Do not install or update anything.

---

# 9. Existing Security Primitive Inventory

P2-00 must inventory actual production security primitives.

For each relevant primitive/helper report:

```text
name
file
current caller
input
output
URL parsing responsibility
DNS responsibility
IP/address classification responsibility
redirect responsibility
failure semantics
currently reused by Browser path
safe to reuse unchanged
known limitation
```

At minimum trace the actual implementation behind:

`evaluateUrlSecurity()`

or its current equivalent.

Do not infer capabilities from names.

---

# 10. Current Node Security Path

Document the real current Node-side security flow using actual functions/files.

Conceptually inspect:

```text
candidate URL
→ parse/normalize
→ protocol policy
→ hostname/literal-IP handling
→ DNS resolution
→ address classification
→ redirect handling
→ network request
```

Determine:

- where DNS is performed;
- which resolver/API is used;
- whether all returned addresses are evaluated;
- IPv4 handling;
- IPv6 handling;
- IPv4-mapped IPv6 handling;
- loopback/private/link-local/special-use handling;
- DNS failure behavior;
- redirect destination revalidation;
- caching;
- possible Node-side TOCTOU.

Do not assume the existing Node path is perfect.

If a gap exists, label it:

`CURRENT_POLICY_GAP`

and do not silently fix it.

---

# 11. Current Browser Network Path

Document the actual Browser path using production functions.

At minimum map:

```text
render job
→ BrowserContext
→ request/security hook installation
→ Page creation
→ page.goto()
→ Browser request route
→ security decision
→ route continue/abort
→ Browser DNS/network connection
```

Also map:

- redirects;
- iframe/frame;
- fetch;
- XHR;
- image;
- script;
- stylesheet;
- other subresources;
- unsafe methods;
- WebSocket;
- popup/new page.

Separate:

`observed`

from:

`blocked`

from:

`security-bound to actual destination`.

---

# 12. DNS Ownership Finding

P2-00 must explicitly determine the current DNS ownership model.

For Browser network traffic determine:

- who resolves DNS for security classification;
- who resolves DNS for actual Browser connection;
- whether those operations use the same answer;
- whether approved IPs are bound/pinned;
- whether Browser performs an independent resolution;
- whether DNS may change between security check and connection.

Return exactly one classification:

```text
SAME_BOUND_RESOLUTION
SEPARATE_RESOLUTION
PARTIALLY_BOUND
NOT_PROVEN
```

Do not choose a stronger classification than the implementation/API evidence supports.

---

# 13. DNS Rebinding / TOCTOU Analysis

Explicitly analyze:

```text
t0:
security resolver resolves attacker.example
→ safe public IP

t1:
security policy allows request

t2:
DNS answer changes

t3:
Browser independently resolves attacker.example
→ unsafe/private address

t4:
Browser connects
```

Determine whether current Phase 1 code prevents this.

Do not execute a real unsafe connection.

If prevention cannot be proven:

`DNS/SSRF parity not proven.`

must remain the conclusion.

---

# 14. Multi-Answer DNS Analysis

Inspect current Node behavior first.

Then determine the required Phase 2 contract.

The conservative expected security invariant is:

```text
all usable resolved addresses must be safe
```

Any answer that is:

- unsafe;
- ambiguous;
- unsupported;
- unclassifiable

should fail closed unless existing authoritative policy establishes another safe rule.

If the proposed conservative rule conflicts with current production behavior, document the conflict for review.

---

# 15. Destination-Binding Feasibility Study

P2-00 must evaluate realistic ways to bind Browser traffic to security-approved destinations.

Do not implement them.

Do not assume any candidate works.

For every plausible repository/API-supported option report:

```text
option
API/repository feasibility
who performs DNS
who opens TCP connection
whether approved destination set can be bound
whether Browser independently re-resolves
HTTPS/SNI implications
certificate-validation implications
redirect implications
subresource implications
WebSocket implications
DNS-rebinding resistance
Edge/Chrome implications
Windows/portable implications
implementation complexity
residual security gap
assessment
```

Assess each option as:

```text
VIABLE_FOR_PROOF
REQUIRES_SPIKE
NOT_VIABLE
UNKNOWN
```

Candidate categories may include only where actual installed APIs make them plausible:

- native Browser/Playwright routing controls;
- Chromium host-resolution controls;
- controlled local proxy;
- security-enforcing request proxy/fulfillment;
- another mechanism discovered through repository/API reconnaissance.

These are candidate categories, not approved designs.

---

# 16. P2-02 Early Feasibility Gate

Unless destination binding is already conclusively proven during reconnaissance, the final Phase 2 plan MUST include:

`P2-02 — DNS / Destination Binding Feasibility Gate`

This task must occur before downstream security implementation assumes destination binding is solved.

Expected possible P2-02 proof outcomes should distinguish:

```text
FEASIBLE
ADJUST_ARCHITECTURE
NO_GO_CANDIDATE
```

or equivalent task-approved terminology.

P2-00 must report:

`P2-02_REQUIRED`

unless repository/API evidence conclusively establishes otherwise.

---

# 17. Protected Destination Inventory

Inspect actual current policy for treatment of:

- supported schemes;
- literal IPv4;
- literal IPv6;
- loopback;
- RFC1918/private IPv4;
- unique-local IPv6;
- link-local;
- unspecified;
- multicast;
- reserved/special-use;
- IPv4-mapped IPv6;
- localhost aliases;
- DNS hostnames resolving to unsafe addresses;
- metadata-specific destinations if any.

For every category report:

```text
current behavior
production helper
Phase 2 relevance
gap
```

Do not invent existing protections.

---

# 18. URL Normalization Security Surface

Inspect actual Node/Browser URL parsing behavior used by the application.

Plan deterministic coverage, where the runtime accepts the representation, for security-relevant cases including:

- hostname case;
- trailing dot;
- explicit port;
- userinfo;
- IPv6 literals;
- IPv4-mapped IPv6;
- IDN/punycode;
- encoded components;
- malformed URLs;
- alternative textual IP forms accepted by the runtime.

Do not create tests for representations rejected before reaching the security path.

---

# 19. DNS Failure Contract Planning

The final plan must explicitly assign handling/tests for:

- NXDOMAIN;
- DNS timeout;
- empty answer;
- resolver exception;
- unsupported family;
- malformed resolver result.

Security classification errors must not silently allow Browser traffic.

Required principle:

`fail closed`

where reliable classification cannot be completed.

---

# 20. Redirect Security Planning

Inspect actual Node and Browser redirect behavior.

The Phase 2 plan must require security revalidation for every security-relevant destination transition.

Plan coverage for:

- same-origin redirect;
- cross-origin redirect;
- safe → unsafe redirect;
- multi-hop redirect;
- redirect loop;
- `maxRedirects`;
- redirect plus DNS-answer change;
- final destination revalidation.

Initial URL validation alone is insufficient.

---

# 21. Request-Class Coverage Matrix

Produce a matrix for:

```text
main document
iframe/frame
fetch
XHR
image
script
stylesheet
font/media/other
OPTIONS/preflight
popup/new page
WebSocket
```

Columns:

```text
request class
current observation hook
current enforcement
destination validation
method validation
redirect validation
known gap
Phase 2 required behavior
owning task
```

Unknown/unclassified request classes must have explicit security behavior.

---

# 22. Unsafe-Method Planning

OQ-2 remains:

`collecting_evidence`

P2-00 must identify which Phase 2 task owns final first-release method-policy evaluation.

Preserve:

```text
ALLOW: GET HEAD OPTIONS
BLOCK: POST PUT PATCH DELETE CONNECT TRACE unknown
```

Required planning must cover:

- normalization;
- attempted-vs-blocked semantics;
- fail closed for unknown methods;
- redirect interactions;
- request-class interactions;
- diagnostics/reason codes.

P2-00 must not close OQ-2.

---

# 23. WebSocket Planning

First-release WebSocket behavior remains blocked.

Determine:

- whether current `routeWebSocket()` enforcement is sufficient for the intended architecture;
- whether destination-binding architecture introduces any alternate WebSocket path;
- how failure/unsupported API behavior should fail closed.

Assign final verification to a concrete Phase 2 task.

---

# 24. Main-Frame / Frame Planning

Preserve same-origin main-frame boundary.

Plan interaction with:

- redirects;
- hostname normalization;
- destination/IP policy;
- DNS changes;
- iframe/frame behavior;
- Browser error pages.

Do not conflate origin scope with SSRF destination safety.

Both must be satisfied.

---

# 25. Service Worker and Context Security

Preserve:

```text
serviceWorkers: "block"
acceptDownloads: false
ignoreHTTPSErrors: false
```

Preserve:

- fresh ephemeral context;
- no personal profile;
- no credentials;
- no storageState.

P2-00 must determine whether any intended Browser network class can bypass the route/security interception surface despite these settings.

---

# 26. Safe Test Infrastructure

Phase 2 security tests MUST NOT contact real sensitive/private systems.

Forbidden active targets include:

- cloud metadata endpoints;
- real RFC1918/private infrastructure;
- link-local metadata services;
- government/internal production systems;
- arbitrary sensitive third-party systems.

Use only:

- controlled loopback fixture servers;
- deterministic fake/injected resolvers;
- classifier seams;
- controlled destination observers;
- synthetic hostnames;
- other explicitly safe deterministic infrastructure.

A test is invalid if its security conclusion depends on a dangerous endpoint simply being unreachable.

---

# 27. Required Adversarial Matrix

The final plan must safely cover applicable cases including:

```text
direct unsafe IP literal
hostname resolving to unsafe address
mixed safe + unsafe DNS answers
IPv4 loopback
IPv6 loopback
IPv4-mapped IPv6
private IPv4
unique-local IPv6
link-local
unspecified/special-use
DNS NXDOMAIN
DNS timeout
resolver exception
safe → unsafe redirect
multi-hop redirect
redirect limit
DNS answer changes
controlled rebind-like sequence
unsafe subresource
unsafe iframe/frame destination
unsafe HTTP method
WebSocket
popup/new navigation
security evaluator failure
missing enforcement capability
unknown request class
Browser failure during security evaluation
```

For each planned test document:

```text
threat
fixture/seam
expected decision
expected receiver count
expected reason
owning task
OQ impact
```

---

# 28. Security Evidence / Data Minimization

Phase 2 may plan internal security evidence required for tests and later Phase 3 reporting.

Do not implement Phase 3 schema.

Do not persist:

- Authorization;
- cookies;
- credentials;
- request body;
- response body;
- sensitive query values;
- full DOM;
- screenshot;
- video;
- trace;
- HAR.

Internal evidence should be compact and JSON-safe.

---

# 29. Security Reason Taxonomy Planning

Define or propose repository-compatible internal reason categories sufficient to distinguish at least:

- unsafe scheme/protocol;
- unsafe method;
- main-frame scope violation;
- DNS resolution failure;
- unsafe resolved address;
- mixed/ambiguous DNS answer;
- redirect destination block;
- WebSocket block;
- security evaluator failure;
- destination-binding failure;
- unsupported enforcement path.

Do not create formal public report fields during P2-00.

---

# 30. Phase 2 Detailed Plan Deliverable

Create:

`docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`

This document must be based on actual repository reconnaissance.

It must include at least:

1. scope;
2. threat model;
3. current Node security architecture;
4. current Browser security architecture;
5. current gaps;
6. DNS ownership finding;
7. destination-binding feasibility;
8. selected/provisional architecture direction;
9. protected destination policy;
10. DNS/multi-answer policy;
11. redirect/re-resolution policy;
12. request-class policy;
13. method/WebSocket/frame policy;
14. safe fixture architecture;
15. reason taxonomy;
16. task decomposition;
17. critical path;
18. OQ mapping;
19. Phase 2 gate rules;
20. known residual risks;
21. explicit Phase 3/5/6 deferrals.

Do not claim implementation exists merely because it is specified in the plan.

---

# 31. Required Task Decomposition

Validate/refine the following decomposition against the repository.

## P2-01 — Browser Request Security Policy

Purpose:

- centralize Browser security decisions;
- establish request-class policy;
- define reason taxonomy;
- define fail-closed semantics;
- preserve existing Node security semantics where appropriate.

## P2-02 — DNS / Destination Binding Feasibility Gate

Purpose:

- prove or reject a mechanism that binds Browser network traffic to approved destinations;
- explicitly address independent Browser DNS, TOCTOU, HTTPS, redirects, subresources, and WebSocket implications.

This is an early architecture proof gate.

## P2-03 — DNS / Address Enforcement

Purpose:

- implement approved DNS/address policy;
- classify complete answer sets;
- normalize IPv4/IPv6;
- enforce unsafe/private/special destination blocks;
- fail closed.

## P2-04 — Redirect / Re-resolution Security

Purpose:

- revalidate each destination transition;
- enforce redirect limits;
- handle re-resolution/rebinding according to the selected destination-binding architecture.

## P2-05 — Browser Egress Parity

Purpose:

- complete main-document/subresource/frame policy;
- unsafe methods;
- WebSocket;
- popup/navigation;
- unknown request classes;
- enforcement parity.

## P2-06 — Adversarial SSRF Security Matrix

Purpose:

- execute controlled security matrix;
- attempt safe bypasses;
- verify reason/evidence;
- identify remaining OQ-2/OQ-3 gaps.

## P2-07 — Browser Network Security Gate Decision

Purpose:

- consolidate Phase 2 evidence;
- evaluate OQ-2/OQ-3;
- determine whether Dynamic Render may leave Phase 2.

Task names/order may be refined only with explicit repository-grounded justification.

P2-02 must not be removed unless destination binding is already conclusively proven.

---

# 32. Task Packet Requirements

Create task packets under repository conventions for P2-01 through P2-07.

Each packet must contain:

```text
Objective
Threat closed
Security invariant
Dependencies
Production seams
Expected files
Fixture/test strategy
Positive tests
Negative/adversarial tests
Fail-closed behavior
Acceptance criteria
OQ impact
Known residual risks
Explicit non-goals
Validation commands
Evidence states
Git restrictions
Completion report contract
NO-GO/blocker implication where relevant
```

Each security implementation task must include negative-path tests.

Positive-path tests alone are insufficient.

---

# 33. Expected Task Packet Paths

Unless repository naming conventions require a justified variation:

```text
docs/codex/tasks/phase-2-01-browser-request-security-policy.md
docs/codex/tasks/phase-2-02-dns-destination-binding-feasibility.md
docs/codex/tasks/phase-2-03-dns-address-enforcement.md
docs/codex/tasks/phase-2-04-redirect-reresolution-security.md
docs/codex/tasks/phase-2-05-browser-egress-parity.md
docs/codex/tasks/phase-2-06-adversarial-ssrf-security-matrix.md
docs/codex/tasks/phase-2-07-security-gate-decision.md
```

Report any naming change and why.

---

# 34. Critical Path Requirement

The final Phase 2 plan must show task dependencies explicitly.

Expected conceptual critical path:

```text
P2-00 reconnaissance/planning
        ↓
P2-01 security decision contract
        ↓
P2-02 destination-binding feasibility proof
        ↓
[proof succeeds / architecture selected]
        ↓
P2-03 DNS/address enforcement
        ↓
P2-04 redirect/re-resolution
        ↓
P2-05 complete egress parity
        ↓
P2-06 adversarial security matrix
        ↓
P2-07 security gate decision
```

If repository evidence requires a different ordering, explain it.

No downstream task may assume destination binding is solved before the proof gate.

---

# 35. P2-07 Gate Contract

P2-07 must distinguish at least three outcomes according to the master-plan semantics.

## PASS / proceed

Allowed only if:

- OQ-3 has acceptable evidence;
- required DNS/address/redirect/egress invariants are enforced;
- no reproducible unresolved Browser SSRF bypass remains;
- security failure paths fail closed as required.

## ADJUST / repeat

Use when:

- architecture remains viable;
- security implementation or evidence remains incomplete;
- identified defects appear safely fixable.

## NO-GO

Use when:

```text
reproducible Browser SSRF bypass
+
no safe/maintainable mitigation
=
NO_GO
```

Do not allow a majority of passing tests to override a hard SSRF bypass.

---

# 36. OQ Ownership

Preserve:

```text
OQ-1: provisionally_acceptable
       final validation Phase 6

OQ-2: collecting_evidence
       resolution Phase 2

OQ-3: open
       Phase 2 hard blocker

OQ-4: collecting_evidence
       final tuning Phase 5

OQ-5: collecting_evidence
       final budget Phase 5

OQ-6: collecting_evidence
       final pacing/parity Phase 5
       unresolved blocks Phase 6
```

P2-00 must not close any OQ.

---

# 37. Phase Boundaries

P2-00 must not perform:

## Phase 2 implementation

No security production code yet.

## Phase 3

No:

- `renderEvidence`;
- `summary.dynamicRender`;
- formal `checked[].discovery.sourceTypes[]`;
- security report schema;
- report schema bump.

Current schema remains:

`1.3.0`

## Phase 5

No:

- performance tuning;
- settle tuning;
- Browser request pacing;
- HostScheduler parity implementation.

## Phase 6

No:

- portable packaging;
- final deployment compatibility;
- release gate.

---

# 38. Dependency Boundary

Keep:

`playwright-core@1.62.1`

Do not run:

```text
npm install
npm update
npx playwright install
```

Do not add:

- proxy libraries;
- DNS libraries;
- security libraries;
- Browser binaries.

If a future architecture might require a dependency, record it as an option requiring explicit later approval.

---

# 39. P2-00 Production-Code Prohibition

P2-00 may create/modify planning documentation only.

Do not modify:

- `dynamic-renderer.mjs`
- `browser-provider.mjs`
- `link-checker.mjs`
- any `test-*.mjs`
- fixtures
- package files
- public JS
- GUI
- Analyzer
- packaging
- report schema.

If reconnaissance identifies an actual production security defect:

- document it;
- assign it to the correct Phase 2 task;
- do not fix it.

Any production/test/package modification during P2-00 is:

`P2-00_SCOPE_FAILURE`

---

# 40. Deliverables

P2-00 must produce:

1. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
2. P2-01 task packet
3. P2-02 task packet
4. P2-03 task packet
5. P2-04 task packet
6. P2-05 task packet
7. P2-06 task packet
8. P2-07 task packet
9. any existing task/index documentation update strictly required by repository convention.

Do not create duplicate competing plans.

---

# 41. Acceptance Criteria

P2-00 passes only if all of the following are true.

## Repository grounding

- actual production security primitives identified;
- actual Node security path documented;
- actual Browser request path documented;
- installed Playwright capabilities inspected where necessary.

## DNS ownership

- security-resolution owner identified;
- Browser connection-resolution owner identified;
- binding relationship classified.

## OQ-3

- remains unresolved;
- `DNS/SSRF parity not proven.` remains explicit;
- actual gap precisely described.

## Destination binding

- URL approval is distinguished from actual connection enforcement;
- feasible architectures are compared;
- uncertainty is explicit;
- P2-02 remains an early proof task unless binding is already conclusively proven.

## DNS/address policy

- multi-answer behavior planned;
- IPv4/IPv6 normalization planned;
- unsafe/private/special classes planned;
- DNS failures planned fail-closed.

## Redirects

- every relevant destination transition planned for revalidation;
- redirect limit and safe→unsafe transition covered.

## Request classes

- main document;
- frames;
- subresources;
- unsafe methods;
- WebSocket;
- popup/navigation

are assigned explicit security ownership.

## Safe testing

- no real sensitive destination required;
- controlled resolver/network seams defined;
- adversarial matrix is measurable.

## Task decomposition

- P2-01 through P2-07 exist;
- dependencies explicit;
- each packet has security invariant + negative tests + acceptance criteria;
- hard blockers are explicit.

## Scope

- documentation only;
- no production/test/package changes.

---

# 42. Failure Conditions

P2-00 is not acceptable if it:

- claims OQ-3 is solved;
- treats URL-policy inspection as actual-destination enforcement;
- ignores DNS rebinding/TOCTOU;
- ignores multi-answer DNS;
- validates only initial navigation URL;
- lacks redirect revalidation planning;
- relies on real metadata/private systems in tests;
- removes the destination-binding feasibility proof without evidence;
- invents Playwright guarantees unsupported by installed APIs;
- changes production code;
- starts P2-01 implementation;
- starts Phase 3 report work.

---

# 43. Git Restrictions

During P2-00:

Do not:

- stage;
- commit;
- push;
- merge;
- rebase;
- reset;
- clean;
- stash;
- switch/create branches.

Leave all P2-00 planning output uncommitted for security review.

---

# 44. Completion Report Contract

Return:

## Summary

What P2-00 established.

## Files changed

Every created/modified documentation file.

## Repository security primitives

For each major primitive:

```text
name:
file:
purpose:
DNS involvement:
address classification:
redirect involvement:
Browser reuse:
known gap:
```

## Current Node security path

Actual production flow.

## Current Browser network path

Actual production flow.

## DNS ownership finding

Return exactly one:

```text
SAME_BOUND_RESOLUTION
SEPARATE_RESOLUTION
PARTIALLY_BOUND
NOT_PROVEN
```

with supporting evidence.

## OQ-3 conclusion

Return:

`DNS/SSRF parity not proven.`

Explain the exact current gap.

## Destination-binding options

For every evaluated architecture:

```text
option:
assessment:
DNS owner:
TCP owner:
binding guarantee:
HTTPS implications:
redirect implications:
subresource implications:
WebSocket implications:
rebinding implications:
residual risk:
```

Assessment must be one of:

```text
VIABLE_FOR_PROOF
REQUIRES_SPIKE
NOT_VIABLE
UNKNOWN
```

## P2-02 requirement

Return exactly one:

`P2-02_REQUIRED`

or:

`P2-02_NOT_REQUIRED`

If NOT_REQUIRED, provide conclusive evidence.

## Protected destination inventory

Current policy and gaps.

## Redirect findings

Current Node/Browser behavior and planned correction ownership.

## Request-class matrix

Current and planned coverage.

## Safe fixture strategy

How Phase 2 tests remain controlled and non-dangerous.

## Adversarial security matrix

Threat → test seam → expected decision → owning task.

## Proposed Phase 2 tasks

For P2-01 through P2-07:

```text
task:
objective:
dependency:
security invariant:
production scope:
test scope:
OQ impact:
blocker implication:
```

## Critical path

Show task dependency sequence.

## P2-07 decision contract

PASS / ADJUST / NO-GO semantics.

Must include:

`unresolved reproducible Browser SSRF bypass = No-Go`

## OQ status

Confirm no OQ was closed.

## Phase boundaries

Confirm no Phase 3/5/6 implementation.

## Production changes

Expected:

`NONE`

Otherwise:

`P2-00_SCOPE_FAILURE`

## Documentation drift

If none:

`None observed.`

## Open architecture questions

List only unresolved questions that require later proof.

## Git status

Run and report:

```text
git status --short
git diff --stat
git diff --check
```

Account for every planning/task document.

## Final readiness

Return exactly one:

`P2-00_READY_FOR_REVIEW`

or:

`P2-00_BLOCKED`

Do not commit.
Do not start P2-01.
Do not implement security code.