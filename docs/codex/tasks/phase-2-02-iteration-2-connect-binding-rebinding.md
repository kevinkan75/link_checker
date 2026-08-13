# P2-02 Iteration 2 - CONNECT Destination Binding + Transport-Backed Rebinding Proof

## Authority Order

1. `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
2. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLANNING_SPEC.md`
3. `docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`
4. `AGENTS.md`
5. `docs/codex/tasks/phase-2-02-dns-destination-binding-feasibility.md`
6. `docs/codex/evidence/P2-02_DNS_DESTINATION_BINDING_FEASIBILITY.md`
7. `docs/JS_DYNAMIC_SCAN_PHASE_2_SECURITY_PLAN.md`
8. this iteration task packet
9. `docs/codex/DYNAMIC_SCAN_EXECUTION.md`
10. actual committed production code and tests

## Objective

Continue P2-02 with a narrow proof of two architecture-critical questions:

```text
Primary = H2 CONNECT without MITM
Secondary = H3 transport-backed rebinding / TOCTOU
```

This task does not implement P2-03, does not select an accepted production architecture, and does not complete the parent P2-02 `FEASIBLE` hard conjunction by itself.

## Starting State

```text
P2-02 iteration 1 = COMPLETE / COMMITTED
iteration 1 outcome = ADJUST_ARCHITECTURE
P2-02 overall = IN_PROGRESS
P2-02 iteration 2 = CONNECT / rebinding proof

Accepted Candidate = NONE
Local enforcing proxy = VIABLE_FOR_PROOF
Preventive Guarantee = NOT PROVEN
FEASIBLE_ALLOWED = NO
P2-03 = BLOCKED

DNS ownership = SEPARATE_RESOLUTION
DNS/SSRF parity not proven.
P2-02_REQUIRED
OQ-3 = open / Phase 2 hard blocker
OQ-2 = collecting_evidence
NODE_POLICY_UNCHANGED_DURING_P2_02
```

Iteration 1 proved only partial local proxy evidence. It did not prove successful trusted HTTPS, TLS/SNI/certificate/trust behavior, transport-backed rebinding, XHR, direct WebSocket receiver contact, independent TLS receiver contact, or production lifecycle integration.

## Iteration Purpose

Primary question:

Can a context-local enforcing proxy using CONNECT tunneling without TLS interception preventively bind HTTPS transport to a security-approved destination set while preserving native Browser TLS/SNI/certificate validation?

Secondary question:

Can that same candidate prove transport-backed rebinding / TOCTOU resistance using controlled receivers?

Iteration 2 must determine whether the local proxy candidate survives these two questions. It must not broaden scope to all remaining P2-02 `FEASIBLE` dimensions.

## Explicit Non-Goal: MITM

MITM / TLS interception is not part of Iteration 2 execution.

Reason: under current product constraints, root CA, trust-store mutation, machine trust modification, and administrator requirements are not accepted as the preferred product direction.

Do not implement:

- certificate generation for MITM;
- HTTPS interception or decryption;
- root CA installation;
- trust-store modification;
- TLS verification bypass;
- `ignoreHTTPSErrors: true`.

A test-only TLS fixture may be used only if it does not weaken Browser TLS verification, silently alter machine trust, or rely on an undisclosed pretrusted certificate.

## H2 - CONNECT Without MITM

Hypothesis:

A Browser configured with a context-local enforcing HTTP proxy can send CONNECT for `hostname:port` to the proxy. The proxy can:

1. receive the CONNECT authority;
2. apply security policy before upstream connection;
3. resolve the hostname using a controlled security resolver;
4. select an approved address;
5. open upstream TCP only to that approved address;
6. tunnel bytes without terminating TLS;
7. allow Browser end-to-end TLS to the original hostname;
8. preserve SNI;
9. preserve certificate hostname validation;
10. preserve trust-chain validation;
11. avoid Browser direct connection to the target.

Do not assume any numbered claim is true. Iteration 2 must prove, falsify, or mark each claim unresolved.

### H2 Proof Questions

For each tested Browser provider, record:

- Browser to proxy connection:
  - actual proxy endpoint;
  - actual CONNECT authority observed by proxy.
- CONNECT authority:
  - hostname or IP form;
  - port;
  - whether Browser DNS occurred before CONNECT.
- Proxy security decision:
  - hostname evaluated;
  - security-approved address set;
  - allow/block/error result.
- Proxy DNS:
  - resolver used;
  - addresses returned;
  - selected approved address.
- Proxy upstream TCP:
  - destination address actually used;
  - destination port actually used;
  - connection owner;
  - receiver identity.
- Browser direct target behavior:
  - whether Browser independently opens TCP to the protected target;
  - whether any bypass of the proxy occurs.
- TLS:
  - Browser remains TLS endpoint;
  - proxy does not decrypt TLS;
  - SNI sent by Browser;
  - certificate hostname validation;
  - trust-chain validation;
  - `ignoreHTTPSErrors=false`.

## Trusted HTTPS Fixture Problem

Successful HTTPS proof is invalid if it relies on:

- `ignoreHTTPSErrors=true`;
- disabled certificate verification;
- hidden root CA installation;
- persistent OS or Browser trust-store mutation;
- undisclosed pretrusted test certificate;
- personal Browser profile state;
- persistent Browser user data.

Execution must first determine whether a controlled HTTPS fixture can satisfy the proof contract without violating these constraints.

If trusted local HTTPS cannot be established safely under the current environment and product constraints, record:

```text
TRUSTED_HTTPS_FIXTURE_BLOCKED
```

Do not work around this by weakening TLS. `TRUSTED_HTTPS_FIXTURE_BLOCKED` may force `ADJUST_ARCHITECTURE`, but it must not be hidden.

## Trusted HTTPS Success Evidence

If a valid trusted HTTPS fixture is available, prove separately:

- HTTPS main document;
- HTTPS representative subresource;
- HTTPS redirect.

For each case, record:

- Browser provider;
- CONNECT authority;
- proxy DNS result;
- approved address set;
- selected address;
- upstream TCP destination;
- TLS success;
- SNI;
- certificate hostname validation;
- trust-chain result;
- `ignoreHTTPSErrors`;
- receiver identity;
- receiver contact count.

Browser "navigation succeeded" alone is insufficient.

## SNI Proof

Use a controlled mechanism to establish what SNI hostname the Browser sends on successful tunneled HTTPS.

Do not infer SNI solely from successful certificate validation.

Evidence must distinguish:

```text
CONNECT authority
SNI hostname
certificate hostname / SAN
logical request hostname
```

The product-safe relationship should preserve the original logical hostname. If direct SNI observation is unavailable, report:

```text
SNI = UNRESOLVED
```

Do not infer `PASS`.

## Certificate / Trust Proof

Evidence must prove:

```text
ignoreHTTPSErrors=false
```

and successful TLS depends on normal certificate validation.

Record:

- certificate subject or SAN relevance;
- logical hostname;
- hostname validation outcome;
- trust-chain outcome.

Do not log private keys, full certificate material, credentials, or unnecessary trust artifacts.

## Approved-Address Binding Proof

For the proxy candidate, prove:

```text
security-approved address set
-> proxy selected approved address
-> proxy upstream TCP destination
```

Required evidence:

```text
resolved addresses: [all resolver results relevant to the proof]
approved addresses: [A...]
denied / unsafe addresses: [B...] or []
selection rule: deterministic rule used to choose the transport target
selected approved address: A
actual upstream TCP target: A
actual receiver identity: receiver for A
mixed-answer policy status: PASS / FAIL / UNRESOLVED
```

The proxy must not resolve one address for policy and then resolve again independently for transport without binding or revalidation.

Hostname-only proxy forwarding is not approved-address binding proof if the underlying networking layer performs an uncontrolled later resolution.

Iteration 2 must not contradict the parent P2-02 / P2-03 address-security model. The proof must not use logic equivalent to:

```text
first DNS answer is safe
-> hostname is safe
```

or:

```text
one approved address exists
-> proceed while ignoring other applicable unsafe answers
```

Applicable resolved answers must be handled according to the accepted address-security policy. Iteration 2 does not need to implement full P2-03 DNS/address enforcement, but its proof model must not establish a weaker security property than the parent architecture requires.

Where useful, include controlled multi-address cases:

```text
Case A:
resolved = [A1, A2]
approved = [A1, A2]
selected = A1 or A2 according to explicit rule
actual TCP target = selected approved address

Case B:
resolved = [A_safe, B_unsafe]
approved = [A_safe]
denied / unsafe = [B_unsafe]
```

The proof must not treat the existence of `A_safe` as sufficient to declare the hostname safe if the parent policy requires all applicable answers to be safe. If Iteration 2 cannot exercise or evaluate the mixed-answer rule without drifting into P2-03, report:

```text
MULTI_ADDRESS_POLICY_PROOF = UNRESOLVED
```

and do not hide that unresolved state behind aggregate H2 success.

Future execution must explicitly answer:

```text
Does the upstream TCP connect operation use the selected approved IP literal
or an equivalently binding mechanism?
```

If the answer is `NO` or `UNRESOLVED`, approved-address transport binding is not proven.

## H3 - Transport-Backed Rebinding / TOCTOU

Hypothesis:

The proxy candidate can prevent a controlled rebinding sequence from reaching a post-approval unapproved destination.

Controlled sequence:

```text
t0: security resolver returns approved endpoint A
t1: security decision approves address set containing A
t2: resolver state changes to B
t3: upstream transport is initiated
```

Acceptable outcomes:

- actual upstream transport remains bound to approved A; or
- security policy re-evaluates and fails closed before B contact.

Forbidden outcome:

- actual upstream transport reaches B without a new approved decision.

## H3 Controlled Receiver Design

Use:

- receiver A;
- receiver B.

Each receiver must have an independent connection/request counter.

Report:

```text
A receiver count:
B receiver count:
```

For a successful pinned or bound case:

```text
A = expected allowed contact
B = 0
```

For a fail-closed case:

```text
A = 0 or expected according to exact scenario
B = 0
```

The proof must establish actual transport outcome. Resolver-call sequence alone is insufficient.

## Rebind Timing Control

Use deterministic seams for:

- approval-time resolution;
- post-approval DNS mutation;
- transport-time action.

The proof must show that mutation occurred before the relevant transport step.

Avoid timing races that make the result nondeterministic. Do not use real hostile DNS infrastructure.

## Browser DNS Independence

Distinguish:

- Browser DNS for proxy connection;
- Browser DNS for CONNECT target hostname;
- proxy DNS for target hostname.

The Browser may legitimately resolve the proxy host. The OQ-3 question is whether the Browser independently resolves or connects to the protected target outside the enforcement path.

Do not overclaim global Browser DNS elimination.

## Browser Providers

Run H2 and H3 separately for:

- `msedge`;
- `chrome`.

Do not infer one provider from the other.

For each provider, record:

- CONNECT authority;
- proxy DNS ownership;
- proxy TCP ownership;
- TLS result;
- SNI result;
- certificate result;
- rebind result.

If a provider is unavailable in the environment, report `ENV_BLOCKED` or `HUMAN_WINDOWS_REQUIRED` and do not claim pass.

## Resource Scope

Focus on architecture-critical HTTPS proof.

If a trusted HTTPS fixture is viable, cover at minimum:

- HTTPS main document;
- one representative HTTPS subresource;
- one HTTPS redirect.

Do not spend Iteration 2 broadening all subresource classes. XHR remains follow-on evidence unless required to interpret HTTPS proxy behavior.

## Receiver Proof

Use actual receiver counters where technically possible.

At minimum:

- approved HTTPS target receiver;
- rebind receiver A;
- rebind receiver B.

If a denied CONNECT target receiver is introduced, measure it independently.

Do not confuse:

```text
proxy upstream-connect count
```

with:

```text
target receiver count
```

Only report numeric zero where an independent receiver counter exists.

## Proxy Failure Proof

Include only narrow architecture-relevant failure checks:

- proxy unavailable before request;
- proxy rejects CONNECT;
- proxy upstream connect fails;
- security resolver fails.

Required:

```text
no unrestricted Browser direct fallback observed
```

Where an independent target receiver exists:

```text
target receiver count = 0
```

Where no independent target receiver exists:

```text
NOT_MEASURED
```

Full production lifecycle and performance matrices remain deferred until H2/H3 survive.

## Stop Conditions

Stop H2 and downgrade or fail the proxy candidate if:

- trusted HTTPS requires TLS verification weakening;
- trusted HTTPS requires unacceptable root CA or trust-store mutation;
- CONNECT target cannot be resolved by the proxy;
- CONNECT target cannot be bound to an approved address set;
- Browser bypasses the enforcement path;
- SNI semantics break;
- certificate hostname validation breaks;
- trust-chain validation breaks;
- Edge/Chrome incompatibility is fundamental under product constraints.

Stop H3 and downgrade or fail the proxy candidate if:

- B receives transport after only A was approved;
- actual transport destination cannot be observed;
- the test cannot distinguish approved A from mutated B;
- resolver mutation timing cannot be proven before transport.

Do not keep expanding scope after an architecture-fatal result.

## Iteration 2 Outcomes

Report H2 and H3 independently.

H2 result must be exactly one:

```text
H2_PROVEN
H2_FAILED
H2_UNRESOLVED
```

H3 result must be exactly one:

```text
H3_PROVEN
H3_FAILED
H3_UNRESOLVED
```

Then derive an Iteration 2 recommendation:

```text
CONTINUE_PROXY_CANDIDATE
ADJUST_ARCHITECTURE
NO_GO_PROXY_CANDIDATE
```

Do not return parent P2-02 overall `FEASIBLE` merely because H2/H3 pass. Passing H2/H3 only means the proxy candidate survives these architecture-critical questions.

### H2 Status Semantics

`H2_PROVEN` may be returned only when all mandatory H2 dimensions required by this packet are demonstrated for all required providers and applicable proof paths. At minimum:

- Browser uses the intended context-local proxy;
- actual CONNECT authority is observed;
- target DNS ownership is understood;
- resolver results are recorded;
- multi-address semantics do not contradict the parent security policy;
- approved address set is explicit;
- denied / unsafe address set is explicit where applicable;
- selection rule is explicit;
- selected approved address is explicit;
- actual upstream TCP target is proven bound to the selected approved address;
- actual receiver identity is known;
- Browser protected-target direct bypass is not demonstrated;
- TLS is tunneled without MITM;
- Browser remains TLS endpoint;
- successful trusted HTTPS evidence is available where required;
- `ignoreHTTPSErrors=false`;
- SNI evidence satisfies this packet;
- certificate hostname validation satisfies this packet;
- trust-chain validation satisfies this packet;
- no hidden root CA, trust-store, profile, launch-flag, or TLS weakening occurred;
- `msedge` evidence passes;
- `chrome` evidence passes;
- no H2 architecture-fatal stop condition is triggered.

If any mandatory H2 dimension is `FAIL` or `UNRESOLVED`, `H2_PROVEN` is forbidden.

`H2_FAILED` means evidence falsifies a required architectural property of the CONNECT-without-MITM candidate under current accepted constraints. Examples include:

- Browser bypasses the proxy and contacts the protected target directly;
- proxy cannot own or bind actual upstream target transport;
- actual transport reaches an address outside the approved set;
- CONNECT semantics fundamentally prevent required target enforcement;
- trusted HTTPS can work only by disabling TLS verification;
- trusted HTTPS can work only through unacceptable MITM, root CA, or trust-store mutation under current product constraints;
- SNI, certificate hostname, or trust-chain semantics are broken by the candidate;
- required Edge/Chrome provider compatibility is fundamentally unavailable;
- a security-critical H2 invariant is directly falsified.

`H2_FAILED` means candidate property disproven, not merely that proof could not be completed.

`H2_UNRESOLVED` means a required architectural property was not disproven, but mandatory evidence could not be established. Examples include:

- trusted local HTTPS fixture cannot be established without changing environment trust, but this does not itself prove production architecture impossible;
- SNI observation mechanism is unavailable;
- certificate or trust proof cannot be obtained in the controlled environment;
- one Browser provider is unavailable locally;
- transport identity cannot be observed with sufficient confidence;
- multi-address behavior cannot be proven without drifting into later policy work;
- evidence remains ambiguous.

Environment, fixture, or proof limitation is not `H2_FAILED` unless the limitation itself proves incompatibility with current product constraints.

H2 precedence:

```text
if a mandatory H2 dimension is directly falsified:
-> H2_FAILED
else if no mandatory dimension is falsified but one or more mandatory dimensions remain unproven:
-> H2_UNRESOLVED
else if all mandatory dimensions pass:
-> H2_PROVEN
```

### H3 Status Semantics

`H3_PROVEN` requires an actual transport-backed deterministic rebind proof. At minimum:

- approval-time resolver state produces A;
- security decision approves A according to the proof contract;
- post-approval resolver state changes to B;
- the test proves B mutation occurred before the relevant transport step;
- receiver A exists with an independent counter;
- receiver B exists with an independent counter;
- actual transport destination is observed;
- actual transport either remains bound to approved A or a new security decision occurs and fails closed before B contact;
- B receiver count is `0`;
- no uncontrolled Browser direct bypass reaches B;
- result is obtained for required Browser providers where applicable.

Resolver-call order alone is insufficient. If any mandatory H3 dimension is `FAIL` or `UNRESOLVED`, `H3_PROVEN` is forbidden.

`H3_FAILED` means actual evidence falsifies the rebinding safety property. Examples include:

- only A was approved, but actual transport reaches B;
- B receiver receives protected contact without a new approved security decision;
- transport mechanism performs an uncontrolled post-approval resolution that can escape the approved set;
- candidate architecture cannot bind or revalidate the target at transport time;
- deterministic test proves the candidate is vulnerable to the tested A -> B transition.

`H3_FAILED` requires an actual architectural or security failure, not merely missing observability.

`H3_UNRESOLVED` means:

- actual transport destination cannot be observed;
- deterministic mutation timing cannot be established;
- receiver A/B proof cannot be constructed;
- required provider environment is unavailable;
- proof cannot distinguish A contact from B contact;
- evidence is insufficient to establish binding, but no unsafe B contact was demonstrated.

Resolver mutation observed without transport proof is `H3_UNRESOLVED`, not `H3_PROVEN`. Test infrastructure limitation without demonstrated unsafe transport is `H3_UNRESOLVED`, not automatically `H3_FAILED`.

H3 precedence:

```text
if transport-backed evidence demonstrates violation of the approved-set/rebind invariant:
-> H3_FAILED
else if no violation is demonstrated but one or more mandatory transport-proof dimensions remain unresolved:
-> H3_UNRESOLVED
else if all mandatory transport-backed proof dimensions pass:
-> H3_PROVEN
```

Iteration recommendation mapping remains distinct from H2/H3 status. A reasonable mapping is:

```text
H2_PROVEN + H3_PROVEN
-> CONTINUE_PROXY_CANDIDATE

H2/H3 unresolved due fixable proof, fixture, or architecture gaps
-> ADJUST_ARCHITECTURE

architecture-fatal proxy property demonstrated
-> NO_GO_PROXY_CANDIDATE
```

Use evidence-based nuance. Do not turn an environment-only `UNRESOLVED` status into `NO_GO_PROXY_CANDIDATE` automatically.

Even:

```text
H2_PROVEN
+ H3_PROVEN
+ CONTINUE_PROXY_CANDIDATE
```

does not mean:

```text
P2-02 FEASIBLE
DNS/SSRF parity proven
OQ-3 closed
P2-03 may start
```

The parent P2-02 hard conjunction still controls.

## P2-03 Boundary

P2-03 remains blocked regardless of H2/H3 success until:

- Iteration 2 evidence is audited;
- parent P2-02 gate is reassessed;
- parent `FEASIBLE` hard conjunction is satisfied.

Do not execute P2-03 from this task.

## Candidate Boundary

Before execution:

```text
Accepted Candidate = NONE
Preventive Guarantee = NOT PROVEN
FEASIBLE_ALLOWED = NO
```

If H2/H3 pass, completion may say:

```text
proxy candidate remains viable for further P2-02 work
```

It must not say:

```text
accepted production architecture
```

unless a later parent P2-02 decision explicitly does so.

## Production Scope

Prefer proof-only implementation.

Expected proof file:

```text
test-p2-connect-binding-rebinding.mjs
```

Possible proof/helper files:

- controlled proxy helper;
- controlled TLS fixture helper;
- controlled receiver A/B helper;
- deterministic resolver / rebind helper.

Preferred evidence file:

```text
docs/codex/evidence/P2-02_ITERATION_2_CONNECT_BINDING_REBINDING.md
```

Normally avoid modifying:

- `dynamic-renderer.mjs`;
- `browser-provider.mjs`;
- `link-checker.mjs`.

If production-path changes become necessary, mark them:

```text
EXPERIMENTAL_P2_02_SPIKE
```

and leave them uncommitted for audit. Rejected spike code must be removed before acceptance.

## Node Policy Boundary

```text
NODE_POLICY_UNCHANGED_DURING_P2_02
```

Do not modify `link-checker.mjs` merely to facilitate H2/H3 proof.

If a test needs a controlled resolver, use proof/test-owned seams rather than changing production Node DNS failure semantics.

## Dependency Boundary

Baseline:

```text
playwright-core@1.62.1
```

Do not run:

```text
npm install
npm update
npx playwright install
```

Prefer Node built-ins. If a trusted certificate, proxy, DNS, or TLS helper requires a new dependency, stop and report:

```text
DEPENDENCY_APPROVAL_REQUIRED
```

Do not install it.

## Safe Fixture Boundary

Use only controlled infrastructure:

- `127.0.0.1`;
- `::1`;
- synthetic hostnames;
- controlled proxy;
- controlled TCP receiver;
- controlled TLS server;
- controlled HTTPS server;
- controlled redirect;
- deterministic resolver;
- receiver A/B.

Do not probe:

- `169.254.169.254`;
- real private networks;
- real metadata endpoints;
- government/internal production services;
- arbitrary third parties.

Loopback fixtures are proof infrastructure, not evidence that private-network SSRF parity is solved.

## Focused Validation

The authorized focused Iteration 2 command is:

```powershell
node .\test-p2-connect-binding-rebinding.mjs
```

Do not leave the focused command ambiguous. If execution determines that extending the existing P2-02 proof suite is necessary instead, report the deviation and exact command before review.

## Required Evidence Output

Future execution must report per provider:

```text
Browser:
msedge / chrome

H2:
CONNECT authority:
Browser target DNS behavior:
proxy resolver result:
resolved addresses:
approved addresses:
denied/unsafe addresses:
selection rule:
selected address:
actual upstream TCP target:
actual receiver reached:
mixed-answer policy status:
direct Browser target bypass:
HTTPS main document:
HTTPS subresource:
HTTPS redirect:
TLS owner:
SNI:
hostname validation:
trust chain:
ignoreHTTPSErrors:
H2 result:

H3:
approval address A:
post-approval resolver state B:
actual transport target:
A receiver count:
B receiver count:
new security decision occurred:
H3 result:

Failure:
proxy unavailable:
CONNECT rejection:
upstream connect failure:
resolver failure:
unrestricted fallback:
receiver evidence:
```

## Regression Contract

Future execution must run:

```powershell
node .\test-p2-connect-binding-rebinding.mjs
node .\test-p2-dns-destination-binding-feasibility.mjs
node .\test-p2-browser-request-security-policy.mjs
node .\test-p1-boundary-hooks-telemetry.mjs
node .\test-p1-rendered-dom-integration.mjs
node .\test-p1-stop-timeout-failure.mjs
```

Also run:

- all root `test-*.mjs`;
- syntax checks over root `.mjs`;
- syntax checks over `public/*.js`;
- `npm.cmd ls playwright-core --depth=0`;
- `git diff --check`;
- `git status --short`.

If production Browser provider code is touched, require explicit `msedge` and `chrome` provider regression/smoke evidence.

## Evidence Document Ownership

Create a distinct Iteration 2 evidence file rather than overwriting Iteration 1:

```text
docs/codex/evidence/P2-02_ITERATION_2_CONNECT_BINDING_REBINDING.md
```

Iteration 1 evidence remains immutable historical evidence.

## Completion Report Contract

Future execution must return:

### H2 Result

Exactly one:

```text
H2_PROVEN
H2_FAILED
H2_UNRESOLVED
```

### H3 Result

Exactly one:

```text
H3_PROVEN
H3_FAILED
H3_UNRESOLVED
```

### Iteration 2 Recommendation

Exactly one:

```text
CONTINUE_PROXY_CANDIDATE
ADJUST_ARCHITECTURE
NO_GO_PROXY_CANDIDATE
```

### Trusted HTTPS

Report separately:

- main document;
- subresource;
- redirect;
- TLS owner;
- SNI;
- hostname validation;
- trust chain;
- `ignoreHTTPSErrors`.

### CONNECT Binding

Report:

- authority;
- proxy DNS;
- resolved addresses;
- approved set;
- denied / unsafe set;
- selection rule;
- selected IP;
- actual upstream target;
- actual receiver reached;
- mixed-answer policy status;
- Browser bypass evidence.

### Rebinding

Report:

- A;
- B;
- actual transport;
- A receiver;
- B receiver;
- security re-evaluation.

### Product Constraints

Report whether proof required:

- root CA;
- trust-store mutation;
- administrator rights;
- system proxy;
- system DNS or hosts changes;
- persistent profile;
- external daemon;
- new dependency.

### Accepted Candidate

Expected:

```text
NONE
```

unless separately authorized by a later parent P2-02 decision.

### Preventive Guarantee

Do not upgrade the overall P2-02 preventive guarantee merely from H2/H3.

### P2-03

Expected:

```text
BLOCKED
```

until the parent P2-02 gate decision changes.

## Task Packet Acceptance Criteria

This Iteration 2 task packet is ready only if it provides measurable answers for:

- H2 hypothesis;
- H3 hypothesis;
- trusted HTTPS trust model;
- CONNECT authority;
- proxy DNS ownership;
- proxy TCP ownership;
- approved-address binding;
- Browser target bypass;
- SNI;
- certificate validation;
- trust chain;
- rebinding A/B receiver proof;
- no TLS weakening;
- Edge;
- Chrome;
- failure no-fallback;
- dependency boundary;
- safe fixture boundary;
- production-scope boundary;
- explicit stop conditions;
- no automatic P2-03 progression.

## Explicit Non-Goals

- Executing P2-02 Iteration 2 from this packet preparation task.
- Executing P2-03.
- Selecting an accepted production architecture.
- Completing the parent P2-02 `FEASIBLE` hard conjunction.
- MITM/TLS interception.
- Root CA or trust-store mutation.
- Browser distribution changes.
- Package/dependency installation.
- Phase 3 report schema.
- GUI, Analyzer, packaging, Phase 5, or Phase 6 work.

## Git Restrictions

Do not stage, commit, push, merge, rebase, reset, clean, stash, or switch branches unless explicitly authorized after review.

## Final Security State

Completion must preserve:

```text
DNS ownership = SEPARATE_RESOLUTION
DNS/SSRF parity not proven.
P2-02_REQUIRED
OQ-3 = open / Phase 2 hard blocker
OQ-2 = collecting_evidence
NODE_POLICY_UNCHANGED_DURING_P2_02
```
