# P2-00 — Browser Network Security Gate Planning Specification

## 1. Purpose

Phase 2 exists to determine whether Dynamic Render can enforce Browser network behavior with security guarantees sufficiently equivalent to the existing Node-side URL/security policy.

Phase 2 is a **security gate**, not a feature-expansion phase.

The principal unresolved question is:

**OQ-3 — DNS / SSRF Parity**

Current status:

`open`

Required conclusion before Phase 2 gate exit:

`DNS/SSRF parity proven to the accepted security contract, or the architecture fails closed.`

A reproducible Browser SSRF bypass that cannot be safely closed is a:

`NO_GO`

condition.

Phase 1 `GO` authorizes entry into Phase 2 only. It does not imply security approval or release readiness.

---

# 2. Non-negotiable security principle

The following statement is mandatory:

`Browser URL-policy inspection alone does not prove DNS/SSRF parity.`

A design equivalent only to:

```text
Browser requests URL
→ Node evaluates URL/hostname
→ route.continue()
→ Browser independently resolves/connects
```

must NOT be described as DNS/SSRF parity unless the plan can prove that the Browser cannot connect to a destination outside the set that was security-approved.

The fundamental security question is:

```text
Can the implementation prove that the network destination
the Browser actually reaches is constrained by the same
security decision that approved the URL?
```

This includes TOCTOU and DNS rebinding concerns.

---

# 3. Threat model

Assume scanned page content can be attacker-controlled.

Attacker-controlled runtime JavaScript may attempt to create network activity through:

- top-level navigation;
- HTTP redirects;
- iframe/frame navigation;
- fetch;
- XHR;
- image;
- script;
- stylesheet;
- font/media or other Browser resource types;
- form submission;
- unsafe HTTP methods;
- WebSocket;
- popup/new window;
- dynamically generated URLs;
- repeated requests;
- hostname aliases;
- IPv4;
- IPv6;
- unusual but valid URL representations;
- DNS answers that differ over time.

Assume a hostile destination may attempt to exploit:

- DNS rebinding;
- DNS answer changes;
- mixed public/private DNS answers;
- redirect chains;
- URL parsing ambiguity;
- hostname normalization ambiguity;
- IPv4/IPv6 representation differences;
- browser-versus-Node resolver differences;
- TOCTOU between policy evaluation and connection;
- subresource behavior different from main-frame behavior.

Do not assume page JavaScript is benign.

---

# 4. Protected destination classes

Phase 2 must map Browser enforcement to the existing production security policy rather than inventing a parallel incompatible policy.

The plan must inspect the current code and enumerate the exact classes already treated as unsafe.

At minimum determine existing treatment of:

- loopback;
- private IPv4;
- private IPv6 / unique-local;
- link-local;
- unspecified addresses;
- multicast;
- reserved/special-use address space;
- IPv4-mapped IPv6;
- metadata-looking destinations;
- localhost aliases;
- literal IP addresses;
- DNS hostnames resolving to unsafe addresses.

Do not change existing Node security semantics during P2-00.

If current policy has gaps, document them rather than silently redesigning it.

---

# 5. Fail-closed rule

Where security classification cannot be completed reliably, Phase 2 must prefer fail-closed behavior for Browser network access.

The detailed plan must explicitly define handling of:

- DNS resolution failure;
- DNS timeout;
- empty answer;
- malformed answer;
- unsupported address family;
- ambiguous address classification;
- mixed safe/unsafe DNS answer set;
- security-evaluator exception;
- Browser interception failure;
- missing required Playwright enforcement capability.

No silent allow-on-error behavior.

---

# 6. Multi-address DNS rule

P2-00 must determine and document the production rule for hostnames resolving to multiple addresses.

The conservative expected model is:

```text
hostname resolves to N candidate addresses
→ every usable candidate must satisfy security policy
→ any unsafe/ambiguous candidate
→ Browser request blocked
```

Do not finalize this rule without checking the existing Node policy and architecture.

If Browser could independently choose an address outside the security-approved set, that is an OQ-3 gap.

---

# 7. DNS rebinding / TOCTOU hard question

P2-00 must explicitly analyze this sequence:

```text
t0:
Node/security layer resolves example.test
→ public safe IP

t1:
security decision allows URL

t2:
Browser independently resolves example.test
→ private/unsafe IP

t3:
Browser connects
```

A plan that does not close or fail closed on this class of gap cannot mark OQ-3 resolved.

P2-00 must identify what mechanism, if any, can bind Browser network activity to the approved destination set.

Do not assume such a mechanism exists.

---

# 8. Browser destination-binding feasibility

P2-00 must inspect the actual repo, pinned `playwright-core@1.62.1`, and available Browser integration seams.

It must evaluate feasible architectural approaches without implementing them.

Potential classes of approach may include, but are not limited to:

- native Browser routing/interception plus verified destination controls;
- Browser DNS/host-resolver pinning if actually supportable and secure;
- controlled local proxy architecture;
- request fulfillment/proxying through an enforcing transport;
- another repo-compatible mechanism discovered during reconnaissance.

These are investigation categories, not approved solutions.

For each viable candidate, document:

```text
mechanism
what destination is security-checked
who performs DNS
who opens the TCP connection
whether Browser performs an independent DNS lookup
HTTPS/SNI/certificate implications
redirect implications
subresource implications
WebSocket implications
DNS rebinding implications
failure behavior
portability implications
residual gap
```

Do not select an architecture solely because it passes a simple localhost test.

---

# 9. Redirect invariant

Every security-relevant destination transition must be revalidated.

The plan must determine how the implementation can enforce:

```text
initial URL
→ redirect 1
→ redirect 2
→ final destination
```

such that no redirect can transition from an allowed target to an unsafe target without a new security decision.

Existing `maxRedirects` semantics must also be inspected and preserved where applicable.

Do not rely only on validating the initial URL.

---

# 10. Request-class coverage

The plan must inventory how security policy applies to:

- main document;
- frame/iframe;
- fetch;
- XHR;
- image;
- script;
- stylesheet;
- font;
- media;
- other Browser subresources;
- preflight OPTIONS;
- popup/new-page requests;
- WebSocket.

Unknown/unclassified request classes must have explicit behavior.

---

# 11. HTTP method invariant

Existing accepted Phase 1 policy:

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

P2-00 must verify how this policy interacts with the final Browser security architecture.

OQ-2 is Phase 2-owned and remains:

`collecting_evidence`

until the security gate evaluates the complete policy.

---

# 12. WebSocket invariant

WebSockets remain blocked for the first release unless the authoritative plan explicitly changes that later.

Phase 2 must verify that the chosen network architecture cannot bypass WebSocket policy.

Do not treat HTTP route enforcement alone as proof of WebSocket coverage.

---

# 13. Main-frame invariant

Browser runtime rendering must not allow the main frame to escape the permitted crawl origin/scope.

Origin comparison must continue to account for:

- scheme;
- hostname;
- port.

Redirect and navigation behavior must be reviewed under the Phase 2 destination policy.

---

# 14. Service-worker invariant

Existing:

`serviceWorkers: "block"`

must remain part of the security model.

P2-00 must verify whether any Browser networking path can escape interception despite service workers being blocked.

Do not enable service workers as part of Phase 2.

---

# 15. State isolation

Preserve Phase 1 lifecycle:

- fresh ephemeral BrowserContext per render job;
- no persistent user profile;
- no credentials;
- no `storageState`;
- no imported cookies;
- no arbitrary Browser executable path;
- no personal Browser profile access;
- `ignoreHTTPSErrors: false`.

Security work must not weaken these guarantees.

---

# 16. Sensitive test safety

Phase 2 tests must not probe real sensitive systems.

Do not actively contact:

- cloud metadata services;
- real RFC1918 infrastructure;
- link-local metadata addresses;
- government/internal production services;
- arbitrary third-party endpoints.

Use controlled infrastructure only.

Loopback fixture servers may be used where explicitly controlled.

For unsafe-address classification that cannot safely be exercised through a real connection, use deterministic resolver/classifier/test seams.

A test passing because an unsafe external endpoint happened to be unreachable is not valid security evidence.

---

# 17. Required adversarial classes

The final Phase 2 plan must include safe deterministic coverage for, where technically applicable:

- direct unsafe IP literal;
- hostname resolving to unsafe address;
- mixed safe + unsafe DNS answers;
- IPv4 loopback;
- IPv6 loopback;
- IPv4-mapped IPv6;
- private IPv4;
- unique-local IPv6;
- link-local;
- unspecified/special-use;
- hostname normalization edge cases;
- redirect from safe to unsafe;
- multi-hop redirect;
- redirect limit;
- DNS answer changing between evaluations;
- controlled rebind-like scenario;
- subresource destination change;
- iframe destination change;
- unsafe HTTP methods;
- WebSocket;
- popup/new navigation;
- Browser disconnect/failure during security decision;
- DNS resolution timeout/failure.

Only safe controlled simulations may be used.

---

# 18. Security decision evidence

The eventual implementation should be capable of producing compact internal evidence such as:

- request attempted;
- normalized destination;
- policy stage;
- allow/block decision;
- reason code;
- request class;
- method;
- redirect/navigation context;
- DNS/security classification outcome.

Do not add Phase 3 report schema in Phase 2 planning.

Do not persist:

- Authorization;
- cookies;
- request body;
- response body;
- credentials;
- sensitive query values;
- full DOM.

---

# 19. Security reason-code planning

P2-00 must define or propose a stable internal reason taxonomy sufficient to distinguish at least:

- unsafe scheme/protocol;
- unsafe method;
- main-frame scope violation;
- DNS resolution failure;
- unsafe resolved address;
- ambiguous/mixed DNS answer;
- redirect security block;
- WebSocket block;
- security evaluator failure;
- destination-binding failure;
- unsupported enforcement path.

Exact names must be repository-compatible.

Do not create public Phase 3 schema yet.

---

# 20. OQ-3 evidence standard

OQ-3 cannot be closed merely because:

- `evaluateUrlSecurity()` is called;
- hostname validation passes;
- DNS was resolved once;
- Browser route interception runs;
- localhost fixtures are blocked;
- Browser did not happen to reach an unsafe server.

OQ-3 requires evidence that the Browser cannot escape the approved destination policy through an independent resolution/connection path covered by the threat model.

If that guarantee cannot be demonstrated, status remains:

`blocked`

or another task-authorized unresolved state.

---

# 21. Phase 2 No-Go rule

The security plan must preserve:

```text
reproducible Browser SSRF bypass
+
no safe/maintainable mitigation under accepted architecture
=
NO_GO
```

P2-00 must define what evidence qualifies as a reproducible bypass.

Do not postpone a demonstrated OQ-3 architectural bypass into Phase 3, Phase 5, or Phase 6.

---

# 22. Provisional Phase 2 decomposition

P2-00 must validate or refine this decomposition against the actual repository.

Recommended structure:

### P2-01 — Browser Request Security Policy

Purpose:

- normalize security decision pipeline;
- enumerate request classes;
- define reason codes;
- centralize fail-closed decisions;
- preserve existing Node policy semantics.

### P2-02 — DNS / Destination Binding Feasibility Gate

Purpose:

- answer the Browser actual-destination binding question early;
- inspect Playwright/Chromium/repo enforcement seams;
- prove an implementable direction exists before investing in downstream security code.

If no viable binding model exists, this task may block the rest of Phase 2.

### P2-03 — DNS / Address Enforcement

Purpose:

- DNS resolution;
- full answer-set classification;
- IPv4/IPv6 normalization;
- private/special address enforcement;
- deterministic fail-closed behavior.

### P2-04 — Redirect / Re-resolution Security

Purpose:

- revalidate every redirect/destination transition;
- enforce redirect limits;
- address rebinding/TOCTOU according to the selected binding architecture.

### P2-05 — Browser Egress Parity

Purpose:

- document/subresource/frame coverage;
- unsafe methods;
- WebSocket;
- popup/navigation boundaries;
- service-worker assumptions;
- unknown request classes.

### P2-06 — Adversarial SSRF Security Matrix

Purpose:

- controlled attack fixtures;
- negative tests;
- DNS/rebind/redirect/mixed-address scenarios;
- bypass hunting;
- complete gate evidence.

### P2-07 — Browser Network Security Gate Decision

Decision vocabulary must be defined by the authoritative plan.

It must produce a security-gate conclusion before Phase 3 progression.

P2-00 may rename/reorder these tasks only when repo reconnaissance provides a concrete reason.

Do not silently remove the early destination-binding feasibility gate.

---

# 23. Task packet contract

Every Phase 2 implementation task packet must contain:

```text
objective
threat closed
security invariant
production seams
files likely touched
fixture/test strategy
negative tests
fail-closed behavior
acceptance criteria
known residual risk
OQ impact
dependencies
explicit non-goals
validation commands
Git restrictions
completion evidence
```

Security tasks must not be accepted solely on positive-path tests.

---

# 24. P2-00 deliverables

P2-00 should produce, subject to repository conventions:

1. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
2. detailed P2-01 through P2-07 task packets under `docs/codex/tasks/`
3. any task index/documentation update required by existing repository conventions.

P2-00 itself must not modify production code.

---

# 25. P2-00 acceptance criteria

P2-00 passes only if:

- threat model is explicit;
- OQ-3 is preserved as Phase 2 hard blocker;
- actual repository security primitives are inventoried;
- Browser interception seams are inventoried;
- DNS ownership is identified;
- actual Browser destination-binding question is explicitly analyzed;
- no unsupported security guarantee is claimed;
- redirect/re-resolution is explicitly planned;
- multi-answer DNS is explicitly planned;
- IPv4/IPv6 normalization is explicitly planned;
- safe fixture architecture is defined;
- task dependencies and early blockers are explicit;
- every task has measurable security acceptance criteria;
- P2-07 has explicit PASS/ADJUST/NO-GO-style gate rules according to the master plan;
- no production code changes occur.

If destination-binding feasibility cannot yet be established from inspection alone, the plan must say so and make P2-02 an explicit proof task.

It must not fake certainty.

---

# 26. P2-00 prohibited conclusions

P2-00 must not conclude:

`OQ-3 PASS`

based only on planning/reconnaissance.

P2-00 must not conclude:

`Dynamic Render security approved`

P2-00 must not authorize:

- release;
- default-on;
- GUI rollout;
- portable packaging.

Its output is a reviewed security execution plan only.