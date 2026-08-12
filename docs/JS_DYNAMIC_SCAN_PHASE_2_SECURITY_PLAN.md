# Phase 2 Browser Network Security Plan

Status: P2-00 planning output for review.

This plan is grounded in the current committed implementation through P2-00. It does not authorize production code changes by itself.

## Authority

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-00-security-planning.md`
6. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
7. Actual committed production code and tests

## Security Gate State

`OQ-3 = Phase 2 hard blocker`

`DNS/SSRF parity not proven.`

The current implementation observes and blocks Browser requests by URL before `route.continue()`, but it does not prove that the Browser's actual network destination is constrained to the destination set approved by the security decision.

A reproducible Browser SSRF bypass with no safe and maintainable mitigation remains `NO_GO`.

## Repository Security Primitives

| Primitive | Current location | Current behavior | Phase 2 relevance |
| --- | --- | --- | --- |
| URL parsing and protocol allowlist | `link-checker.mjs` `evaluateUrlSecurity()` | Allows `http` and `https`, blocks malformed/unsupported URL strings. | Reuse as policy input, but URL approval alone is not destination binding. |
| DNS lookup for security classification | `link-checker.mjs` via `node:dns/promises.lookup()` | Resolves hostnames with `{ all: true, verbatim: true }` and classifies every returned address. | Security resolver is Node-owned. Browser connection resolver is not proven to use the same answer. |
| IP classification | `link-checker.mjs` `classifyIpAddress()` family | Covers IPv4/IPv6 loopback, private, unique-local, link-local, reserved/special-use, metadata IPv4, and IPv4-mapped IPv6. | Candidate policy base for Browser egress. Needs fail-closed and destination-binding proof. |
| Security decision | `link-checker.mjs` `securityDecisionForAddress()` | Blocks localhost/private-like destinations by default, with explicit options for localhost/private allowance. Metadata IPv4 is always blocked. | Existing Node policy must not be weakened for Browser. |
| Redirect revalidation | `link-checker.mjs` Node HTTP request loop | Revalidates each redirect target before following. | Browser redirect transitions need equivalent enforcement, not only initial URL approval. |
| Browser request hook | `dynamic-renderer.mjs` `installBoundaryHooks()` / `handleRoutedRequest()` | Installs `browserContext.route("**/*")` before page creation; records and blocks by method, main-frame origin, and URL security decision before `route.continue()`. | Provides observation and early block point. Does not prove actual DNS/destination binding after continue. |
| WebSocket hook | `dynamic-renderer.mjs` `routeWebSocket()` when available | Blocks WebSocket attempts and records telemetry. | HTTP route coverage does not cover WebSocket; Phase 2 must verify first-release block and fail-closed behavior when capability is missing. |
| Browser state defaults | `dynamic-renderer.mjs` | `serviceWorkers: "block"`, `acceptDownloads: false`, `ignoreHTTPSErrors: false`, fresh ephemeral contexts. | Preserve as baseline. Do not use profiles, credentials, or storage state. |

## Actual Node Security Path

1. Static scan resolves candidate URLs through existing extraction and ingestion.
2. Node HTTP validation calls the request path in `link-checker.mjs`.
3. Before each outbound Node request, `evaluateUrlSecurity(currentUrl, securityPolicy)` parses the URL and applies protocol, host, DNS, and IP classification.
4. For hostnames, Node resolves DNS with `dns.lookup(..., { all: true, verbatim: true })`.
5. Every resolved address is classified; unsafe or blocked classifications stop the request.
6. The raw request is then performed by Node `fetch()` or the legacy HTTP/TLS path.
7. Redirect responses are handled manually. Each redirect target is canonicalized and revalidated before the next request.

Current Node gaps to preserve for Phase 2 planning:

- DNS lookup exceptions currently become an allowed decision in the inspected Node policy path. Phase 2 must decide and implement fail-closed behavior where required.
- The Node HTTP path validates DNS answers before request dispatch, but P2-00 did not find an explicit TCP connect binding to the approved IP set in the raw request path. Phase 2 should document whether this is acceptable for Node or needs parity tightening while building Browser enforcement.

## Actual Browser Network Path

1. Dynamic Render is opt-in and creates one `DynamicRenderer` per scan.
2. Each render job creates a fresh ephemeral BrowserContext and installs Browser boundary hooks before creating the Page.
3. `browserContext.route("**/*", ...)` observes routed HTTP(S) requests.
4. For each routed request, Browser telemetry records the attempted URL, method, resource type, and sanitized path.
5. Unsafe methods are blocked before delivery. The first-release policy allows only `GET`, `HEAD`, and `OPTIONS`.
6. Main-frame navigation outside the allowed crawl origin is blocked by origin comparison using scheme, hostname, and port.
7. The existing `evaluateUrlSecurity()` is called with the Browser request URL.
8. If URL security allows the request, the route calls `route.continue()`.
9. After `route.continue()`, Chromium/Browser network code performs the actual connection. No current code pins that connection to Node-approved DNS answers.
10. WebSocket attempts are separately blocked with `browserContext.routeWebSocket()` when available.
11. Popups are closed and downloads are not intentionally persisted.

## DNS Ownership Finding

Classification: `SEPARATE_RESOLUTION`

Evidence:

- The security decision for Browser routed requests is Node-owned: `dynamic-renderer.mjs` calls the injected `evaluateUrlSecurity()` function before allowing a Browser route to continue.
- `evaluateUrlSecurity()` resolves hostnames with Node's DNS API.
- The actual Browser connection is delegated to the Browser after `route.continue()`.
- P2-00 found no current Browser launch, BrowserContext, route, proxy, or host-resolution binding that constrains Chromium's actual network destination to the exact Node-approved DNS result.

Therefore, `DNS/SSRF parity not proven.`

## Precise Current OQ-3 Gap

The current code can answer: "Does this Browser request URL pass the existing URL security evaluator before route continuation?"

The current code cannot prove: "Will the Browser connect only to an IP address that the security decision approved?"

Unproven cases include:

- Node security resolver sees safe IP, Browser resolver later sees unsafe IP.
- DNS answer changes between approval and connection.
- Hostname has mixed safe and unsafe answers and Browser selects an unapproved address.
- Redirect produces a new security-relevant destination transition that is not revalidated before actual Browser connection.
- Browser request classes not fully covered by `browserContext.route()` or `routeWebSocket()` still produce egress.
- Required enforcement capability is absent or partially supported.

## Destination-Binding Options

| Candidate | Control type | DNS owner | TCP connection owner | Approved address set bound? | Browser independent re-resolution? | HTTPS / SNI / certificate implications | Redirect implications | Subresource implications | WebSocket implications | Rebinding / TOCTOU prevention | Edge / Chrome viability | Windows / portable-build implications | Residual security gap | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Current route URL policy: `evaluateUrlSecurity(url)` then `route.continue()` | `PREVENTIVE` for URL/method route decisions only; not destination binding | Node security resolver | Browser/Chromium after `route.continue()` | No | Yes, not ruled out | Browser performs normal HTTPS/SNI/certificate validation. No evidence that validated host maps to Node-approved address. `ignoreHTTPSErrors: false` remains intact. | Route can observe redirect requests, but current URL approval does not bind each final connection destination. | Applies only to routed request classes; class coverage still needs proof. | Does not cover WebSocket destination binding; WebSocket handled separately. | No preventive rebinding protection after route continuation. | Works with current Edge/Chrome hooks, but not sufficient for OQ-3. | No new packaging issue, but security gap remains. | Browser can connect to a destination outside the Node-approved DNS answer set. | `NOT_VIABLE` as OQ-3 closure path. |
| BrowserContext local enforcing proxy | `PREVENTIVE` if proxy owns DNS and connection and Browser cannot bypass it | Proxy/Node-controlled resolver if designed that way | Local proxy | Potentially yes, if all Browser traffic is forced through proxy and proxy enforces approved destinations | Potentially no, if Browser does not perform direct DNS/connect outside proxy; must prove no bypass | HTTPS may use CONNECT or proxy-mediated TLS. SNI, certificate hostname validation, CONNECT handling, and `ignoreHTTPSErrors: false` must be proven without insecure workaround. | Proxy must revalidate every redirect/destination transition or guarantee route-level policy before proxy connection. | Must prove document, frame, fetch/XHR, image, script, stylesheet, font, media, and other subresources traverse the proxy. | Must prove `ws:` and `wss:` are blocked or proxy-enforced, and that routeWebSocket remains reliable. | Can be preventive if proxy pins/connects only approved destinations; must prove against DNS changes. | Requires proof on `msedge` and `chrome`. | Adds local proxy lifecycle, port, firewall, AV, enterprise, and portable packaging implications. | Proxy bypass, CONNECT/TLS fidelity, and WebSocket behavior unresolved. | `REQUIRES_SPIKE`. |
| Browser request fulfillment through Node-controlled fetch | `PREVENTIVE` if Browser network is aborted/fulfilled only from Node-approved transport | Node resolver | Node fetch/HTTP client | Potentially yes for fulfilled requests | Browser direct re-resolution avoided only if all real Browser network delivery is blocked and fulfilled by Node | HTTPS/SNI/certificate behavior shifts to Node. Must prove certificate validation, SNI, redirects, cookies, CORS, streaming, and binary response fidelity without weakening TLS. | Node-controlled fetch must revalidate every redirect and prevent Browser-side redirect escape. | Must prove representative Browser subresources can be faithfully fulfilled without enabling direct egress. | WebSocket cannot be treated as HTTP fulfillment; remains blocked or separately enforced. | Potentially preventive if Browser never directly connects and Node enforces approved destinations. | Requires proof on Edge/Chrome rendering behavior with fulfilled resources. | May increase implementation complexity but not browser packaging. | Response fidelity, cache, cookies, CORS, streaming, and non-HTTP channels unresolved. | `REQUIRES_SPIKE`. |
| Chromium host resolver rules / launch args | `PREVENTIVE` only if launch controls truly constrain all Browser DNS and cannot be bypassed | Browser/Chromium configured resolver | Browser/Chromium | Unknown | Unknown; must prove | HTTPS/SNI/certificate behavior may remain Browser-native, but host remapping can create certificate-name and SNI pitfalls. No insecure certificate workaround is acceptable. | Must prove redirects use the same enforced resolver/binding. | Must prove every request class obeys resolver rules. | Must prove WebSocket behavior or keep WebSocket blocked independently. | Unknown; resolver rules may not prevent DNS changes unless binding/pinning is proven. | Must prove support for local Edge and Chrome channels. | Launch flags may conflict with accepted minimal launch/security posture and enterprise policy; portable viability unknown. | Browser may still resolve or connect outside the approved set; launch-flag safety unproven. | `REQUIRES_SPIKE`. |
| OS hosts-file or system DNS manipulation | `OTHER` system-level mutation | Operating system | Browser/OS | Not safely maintainable | Browser may still use cache, DoH, proxy, or system variation | HTTPS/SNI/certificate behavior may break or become environment-dependent. | Redirects still need separate validation. | Coverage depends on whole OS/browser behavior. | WebSocket behavior depends on same system mutation. | Not reliable or local-tool safe. | Environment-dependent across Edge/Chrome. | Requires invasive system changes/elevation and is not acceptable for portable use. | Unsafe operational model; not scoped for this local tool. | `NOT_VIABLE`. |
| Browser CDP network events only | `DETECTIVE` / post-connection observation | Browser/Chromium | Browser/Chromium | No | Yes | May observe remote/address metadata after connection where available, but cannot prevent the sensitive connection. | Can observe redirects after or during network activity, not guarantee preventive blocking. | Observation coverage may vary by request class. | Observation does not equal WebSocket prevention. | No preventive rebinding protection. | API coverage may vary by Edge/Chrome versions. | Adds protocol dependency without closing SSRF. | Post-connection evidence cannot satisfy OQ-3 preventive requirement. | `NOT_VIABLE`. |
| Deterministic resolver seam for tests only | `TEST_ONLY` | Fake/injected test resolver | None, unless paired with a candidate architecture | No production binding | Not applicable | Can test classifier decisions, not Browser HTTPS/SNI/certificate behavior. | Can model redirect classifications, not actual Browser redirect binding. | Can model policy decisions, not actual Browser egress. | Can model WebSocket policy decisions, not actual Browser WebSocket binding. | Useful for proving DNS/address classifier and policy behavior. Not proof that Browser actual network destination is bound to the approved address set. | Browser-channel viability not proven by fake seam. | No production packaging effect. | Test infrastructure only; cannot close OQ-3 alone. | `VIABLE_FOR_PROOF` for policy tests only. |
| Native Playwright `routeWebSocket()` for first-release WebSocket block | `PREVENTIVE` for WebSocket only when API works before handshake | Browser hook, not DNS binding | Browser unless route closes before handshake | No for HTTP/HTTPS; not an address-binding mechanism | HTTP/HTTPS Browser DNS unaffected | Does not address HTTPS/SNI/certificate behavior for HTTP requests. | Does not address HTTP redirects. | Does not cover normal HTTP subresources. | Can prove/block first-release WebSocket behavior only; must cover `ws:` and `wss:` where safely applicable and fail closed if unavailable. | Does not establish HTTP/HTTPS Browser destination binding or DNS rebinding resistance. | Must prove on Edge and Chrome. | Capability/version differences may affect portability. | WebSocket-specific control only; OQ-3 HTTP/HTTPS gap remains. | `VIABLE_FOR_PROOF` for first-release WebSocket block only. |

P2-02 outcome: `P2-02_REQUIRED`

## Protected Destination Inventory

Phase 2 must preserve or strengthen coverage for:

- IPv4 public, loopback, RFC1918 private, link-local, shared/reserved/special-use, multicast/reserved, and metadata IPv4.
- IPv6 public, loopback, unique-local, link-local, unspecified, multicast/reserved, documentation ranges, and IPv4-mapped IPv6.
- Hostnames resolving to one address.
- Hostnames resolving to multiple addresses.
- Hostnames resolving to mixed safe and unsafe addresses.
- Malformed hosts, unsupported address families, empty DNS answers, DNS timeouts, NXDOMAIN, and resolver exceptions.
- Localhost names and bracketed IPv6 literals.
- Explicit ports, schemes, fragments, credentials, and query strings with sanitized diagnostics.

Fail-closed target for Phase 2:

- DNS failure: block unless task authority records a narrower safe exception.
- DNS timeout: block.
- Empty answer: block.
- Malformed/unsupported answer: block.
- Mixed safe and unsafe answer set: block.
- Security evaluator failure: block.
- Missing enforcement capability: block or fail the gate.

## Redirect Findings

Current Node HTTP validation revalidates each redirect target before following.

Current Browser rendering uses `page.goto()` plus route hooks. P2-00 did not find a proof that every Browser security-relevant redirect transition is revalidated against the actual destination before Browser connection. P2-04 must explicitly cover:

- Same-origin redirect.
- Cross-origin redirect.
- Safe-to-unsafe redirect.
- Multi-hop redirect.
- Redirect loop.
- Redirect limit.
- Redirect plus DNS answer change.
- Main-frame redirect and subresource redirect.
- Redirect interaction with route handler terminal outcomes and render outcome.

Initial URL validation alone is insufficient.

## Request-Class Matrix

| Request class | Current hook/evidence | Current gap | Phase 2 owner |
| --- | --- | --- | --- |
| Main document | `page.goto()` request passes through context route; main-frame origin boundary is checked. | Actual destination binding and redirect revalidation not proven. | P2-02/P2-03/P2-04 |
| Iframe/frame | Context route should observe HTTP(S) frame requests. | Need explicit policy and same destination safety; origin scope is not SSRF safety. | P2-03/P2-06 |
| Fetch/XHR | Context route observes and method policy applies. | DNS binding, fail-closed, redirect behavior, and diagnostics need proof. | P2-03/P2-05 |
| Image | Context route observes controlled burst fixture. | DNS binding and multi-answer behavior unproven. | P2-03/P2-06 |
| Script | Context route observes controlled burst fixture. | DNS binding and redirect behavior unproven. | P2-03/P2-04 |
| Stylesheet | Context route observes controlled burst fixture. | DNS binding and redirect behavior unproven. | P2-03/P2-04 |
| Other subresources | Routed if Playwright emits matching request. | Unknown request types require explicit fail-closed or documented behavior. | P2-05 |
| OPTIONS/preflight | Method policy allows OPTIONS. | Need evidence that preflight does not permit unsafe side effects or bypass diagnostics. | P2-01/P2-05 |
| Popup/new page | Popup pages are closed; context route is installed before page creation. | Must prove popup initial request coverage, no DOM ingestion, destination safety. | P2-05/P2-06 |
| WebSocket | `routeWebSocket()` blocks when available. | HTTP route does not cover WebSocket; missing API behavior and destination binding unresolved. | P2-05/P2-07 |
| Unknown/unclassified | No explicit class-specific matrix yet. | Must define fail-closed behavior or accepted diagnostic before gate pass. | P2-01/P2-05 |

## Safe Fixture Strategy

All active tests must use controlled localhost infrastructure or deterministic injected seams.

Allowed:

- Local fixture HTTP server on `127.0.0.1`.
- Secondary local origin using a different port.
- Deterministic fake resolver/classifier seams.
- Synthetic hostnames resolved by test seams.
- Passive DOM strings containing private/metadata URLs without active Browser requests.
- Controlled fake Browser/route/request objects for method, redirect, DNS, and capability behavior.

Prohibited:

- Real cloud metadata endpoints.
- Real RFC1918/private infrastructure.
- Link-local metadata services.
- Government or internal production systems.
- Arbitrary sensitive third-party targets.

## Adversarial Security Matrix

| Scenario | Safe mechanism | Expected security result | Owning task |
| --- | --- | --- | --- |
| Direct unsafe IP literal | Deterministic evaluator test | Block/fail closed. | P2-03 |
| Hostname to unsafe address | Fake resolver | Block/fail closed. | P2-03 |
| Mixed safe and unsafe DNS answers | Fake resolver | Block/fail closed. | P2-03 |
| IPv4 loopback | Fake resolver or controlled localhost with policy | Block unless explicit local allowance is task-owned. | P2-03 |
| IPv6 loopback | Fake resolver | Block unless explicit local allowance is task-owned. | P2-03 |
| IPv4-mapped IPv6 | Fake resolver | Classify mapped IPv4 and block if unsafe. | P2-03 |
| Private IPv4 | Fake resolver | Block. | P2-03 |
| Unique-local IPv6 | Fake resolver | Block. | P2-03 |
| Link-local | Fake resolver; no real link-local probe | Block. | P2-03 |
| Metadata address | Passive string or fake resolver | Block; no active metadata probe. | P2-03/P2-06 |
| DNS failure/timeout/empty answer | Fake resolver | Fail closed. | P2-03 |
| Safe-to-unsafe redirect | Controlled local redirect plus fake destination classification | Block before unsafe destination. | P2-04 |
| Multi-hop redirect | Controlled local redirect chain | Revalidate every hop; bounded redirect limit. | P2-04 |
| DNS answer changes | Fake resolver with sequence | Detect/avoid TOCTOU or fail gate if not enforceable. | P2-02/P2-03 |
| Controlled rebind-like sequence | Fake resolver sequence and local observer | Browser must not connect to unapproved destination. | P2-02/P2-06 |
| Unsafe subresource | Controlled page plus fake classified target | Block; no server delivery to unsafe target. | P2-03/P2-06 |
| Unsafe iframe/frame | Controlled page plus fake classified target | Block; no frame destination delivery. | P2-03/P2-06 |
| Unsafe method | Controlled fixture and fake route matrix | Attempt observed, delivery blocked. | P2-01/P2-06 |
| WebSocket | Controlled local WebSocket observer | Attempt observed, handshake delivery blocked. | P2-05/P2-06 |
| Popup/new navigation | Controlled popup fixture | Popup closed; no DOM ingestion; destination policy enforced. | P2-05/P2-06 |
| Missing enforcement capability | Fake context without required API | Fail closed or gate block. | P2-05/P2-07 |
| Unknown request class | Fake request type | Explicit policy outcome; no silent allow. | P2-01/P2-05 |

## Phase 2 Task Decomposition

1. `P2-01 - Browser Request Security Policy`
   - Define first-release Browser request security policy and fail-closed semantics for methods, request classes, capability absence, telemetry, and diagnostics.
2. `P2-02 - DNS / Destination Binding Feasibility Gate`
   - Prove or disprove a viable architecture that constrains Browser actual network destinations to approved destinations.
3. `P2-03 - DNS / Address Enforcement`
   - Implement the selected address/DNS enforcement model only after P2-02 produces a feasible architecture.
4. `P2-04 - Redirect / Re-resolution Security`
   - Enforce security revalidation for Browser redirect and destination transitions.
5. `P2-05 - Browser Egress Parity`
   - Cover Browser request classes, WebSocket, popup/new page, capability gaps, and egress channels within the selected policy.
6. `P2-06 - Adversarial SSRF Security Matrix`
   - Build deterministic adversarial tests and fixture seams proving Phase 2 security behavior.
7. `P2-07 - Browser Network Security Gate Decision`
   - Decide `PASS`, `ADJUST_AND_REPEAT`, or `NO_GO`.

Critical path:

```text
P2-00
  -> P2-01
  -> P2-02
  -> P2-03
  -> P2-04
  -> P2-05
  -> P2-06
  -> P2-07
```

No downstream task may assume DNS/destination binding is solved before P2-02 proves it.

## P2-07 Gate Contract

P2-07 may return:

- `PASS`: OQ-3 has acceptable evidence, no reproducible unresolved Browser SSRF bypass remains, and all Phase 2 task-owned security invariants pass.
- `ADJUST_AND_REPEAT`: Fail-closed or implementation gaps are fixable inside Phase 2; repeat the required task(s) before Phase 3.
- `NO_GO`: Reproducible Browser SSRF bypass remains without safe/maintainable mitigation, or required destination-binding enforcement is not feasible.

`unresolved reproducible Browser SSRF bypass = NO_GO`

## OQ Status

| OQ | Current status | Resolution phase | Phase 2 impact |
| --- | --- | --- | --- |
| OQ-1 Local Browser Compatibility | `provisionally_acceptable` | Phase 6 | Not closed by Phase 2. |
| OQ-2 Unsafe-method Coverage | `collecting_evidence` | Phase 2 | First-release unsafe-method policy and diagnostics must be completed/evaluated. |
| OQ-3 DNS / SSRF Parity | `open` | Phase 2 hard blocker | Must reach acceptable evidence before leaving Phase 2. |
| OQ-4 Settle Tuning | `collecting_evidence` | Phase 5 | Not Phase 2. |
| OQ-5 Performance Budget | `collecting_evidence` | Phase 5 | Not Phase 2. |
| OQ-6 Traffic / Rate-limit Parity | `collecting_evidence` | Phase 5; unresolved blocks Phase 6 | Phase 2 may preserve telemetry, but pacing parity is Phase 5. |

## Phase Boundaries

Phase 2 is the Browser Network Security Gate. It is not release approval, default-on Dynamic Render approval, GUI rollout, report contract, performance budget finalization, or portable packaging.

Phase 3 remains report contract and diagnostics.

Phase 5 owns final settle tuning, performance budget, and Browser request pacing / HostScheduler parity.

Phase 6 owns target-environment Browser compatibility and portable/release gate validation.

## Documentation Drift

The master plan contains an older OQ blocking-phase table that labels OQ-2/OQ-3 blocking as Phase 3 and OQ-4/OQ-5 resolution as Phase 6. The accepted Phase 1 spike evidence and Phase 2 planning specification corrected this mapping:

- OQ-2 security resolution is Phase 2.
- OQ-3 is a Phase 2 hard blocker.
- OQ-4 and OQ-5 final decisions are Phase 5.
- OQ-6 final pacing/parity evaluation is Phase 5, and unresolved OQ-6 blocks Phase 6.
- OQ-1 final compatibility validation is Phase 6.

## Open Architecture Questions

1. Can a Playwright/Chromium-backed architecture bind Browser actual destinations to the approved IP set without browser downloads, user profiles, credentials, or unsafe launch options?
2. If a local proxy is required, can it safely support HTTPS, WebSocket, redirects, streaming responses, binary subresources, and diagnostics without creating a release or privacy burden?
3. If request fulfillment through Node is used, can it preserve enough Browser behavior for rendered DOM discovery while keeping Node HTTP validation as status truth?
4. How should missing Playwright capabilities fail closed across Edge/Chrome versions?
5. Should Node HTTP DNS failure behavior be tightened during Phase 2 to preserve parity with Browser fail-closed requirements?
