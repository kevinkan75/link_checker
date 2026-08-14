# P2-02 Iteration 2 - CONNECT Binding + Transport-Backed Rebinding Evidence

Date: 2026-08-14
Branch: `feature/js-dynamic-scan`
Start commit: `15b139b docs: add p2-02 iteration 2 binding proof task`

## Iteration State

```text
P2-02 iteration 1 = COMPLETE / COMMITTED
iteration 1 outcome = ADJUST_ARCHITECTURE
P2-02 iteration 2 = EXECUTED

Primary hypothesis = H2 CONNECT without MITM
Secondary hypothesis = H3 transport-backed rebinding / TOCTOU

Accepted Candidate = NONE
Preventive Guarantee = NOT PROVEN
FEASIBLE_ALLOWED = NO
P2-03 = BLOCKED
NODE_POLICY_UNCHANGED_DURING_P2_02
```

## H2 Result

`H2_UNRESOLVED`

The local proxy candidate demonstrated several required CONNECT-without-MITM properties:

- Edge and Chrome used the context-local proxy for the tested protected HTTPS target.
- The proxy observed CONNECT authority in `hostname:port` form.
- The proxy used a proof-owned resolver for the protected target.
- The proxy recorded resolver results, approved set, selection rule, selected approved endpoint, upstream connect argument, actual upstream TCP target, and receiver identity.
- The proxy connected upstream using the selected approved IP literal, not a hostname-only forwarding call.
- The proxy did not terminate TLS.
- The controlled receiver observed Browser TLS ClientHello bytes and SNI for the logical hostname.
- `ignoreHTTPSErrors=false` was preserved.
- No root CA, trust-store mutation, persistent profile, or TLS weakening was used.
- Controlled mixed-answer proof blocked the mixed safe/unsafe answer before upstream contact.

H2 remains unresolved because:

- no controlled Browser-trusted HTTPS fixture was available without TLS weakening or trust-store/root-CA mutation;
- successful HTTPS main document remains unresolved;
- successful representative HTTPS subresource remains unresolved;
- successful HTTPS redirect remains unresolved;
- certificate hostname validation remains unresolved;
- trust-chain validation remains unresolved;
- Browser direct-target bypass could not be independently excluded beyond observed proxy-path evidence.

No mandatory H2 architecture property was directly falsified. Under the task-packet precedence, unresolved mandatory H2 evidence forbids `H2_PROVEN` and yields `H2_UNRESOLVED`.

## H3 Result

`H3_PROVEN`

The local proxy candidate produced a deterministic transport-backed rebinding proof for the controlled fixture model:

```text
t0: proof resolver returned approved endpoint A
t1: security decision approved A
t2: proof resolver state changed to endpoint B before transport
t3: upstream transport used the previously selected approved endpoint A
```

For both Edge and Chrome:

- receiver A was instantiated with an independent counter;
- receiver B was instantiated with an independent counter;
- mutation to B was proven before upstream transport;
- actual upstream TCP target remained receiver A;
- receiver A observed expected transport;
- receiver B observed `0` contacts;
- no Browser bypass to B was observed.

This is a controlled loopback endpoint proof using separate local ports. It proves the proxy can preserve a selected approved transport endpoint across a deterministic post-approval resolver mutation in the proof harness. It does not by itself close parent DNS/SSRF parity or implement P2-03 all-address production policy.

## Iteration Recommendation

`ADJUST_ARCHITECTURE`

H3 survived the transport-backed rebinding question in the controlled proof. H2 did not fail, but required trusted HTTPS certificate/trust evidence remains unresolved. The proxy candidate remains worth further P2-02 work, but it is not an accepted production architecture.

## Browser Providers

| Provider | H2 provider result | H3 provider result | Evidence state |
| --- | --- | --- | --- |
| `msedge` | `UNRESOLVED` | `PASS` | `LOCAL_FIXTURE_PASS` |
| `chrome` | `UNRESOLVED` | `PASS` | `LOCAL_FIXTURE_PASS` |

No provider inherited evidence from the other provider.

## CONNECT Authority Evidence

| Provider | CONNECT authority form | CONNECT authority observed |
| --- | --- | --- |
| `msedge` | `hostname:port` | `h2-connect.p2-local.test:<controlled-port>` |
| `chrome` | `hostname:port` | `h2-connect.p2-local.test:<controlled-port>` |

The proof did not assume hostname form; it recorded what each Browser sent.

## DNS Ownership Evidence

Current production baseline remains:

```text
security-policy DNS owner = Node
actual Browser connection DNS owner = Browser/Chromium
classification = SEPARATE_RESOLUTION
DNS/SSRF parity not proven.
```

Iteration 2 proxy proof path:

| DNS question | Evidence |
| --- | --- |
| Browser DNS for proxy | Browser may resolve/reach the loopback proxy endpoint. This is not the protected target DNS question. |
| Browser DNS for protected CONNECT target | Not proven eliminated globally. CONNECT authority was observed at proxy as hostname form, but no direct Browser target DNS trace was available. |
| Proxy/security resolver for protected target | `CONTROLLED_RESOLVER_USED` for all tested protected targets. |
| Transport DNS owner for observed upstream path | Proxy-owned proof path, because upstream connect used the selected IP literal. |

Do not overread this as global Browser DNS elimination.

## Multi-Address Evidence

### Case A - All Resolved Answers Approved

| Provider | resolved | approved | denied | selection rule | selected | actual TCP target | receiver | policy status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `msedge` | `[A1, A2]` | `[A1, A2]` | `[]` | first approved after parent-compatible all-address policy | `A1` | `A1` | `multi-safe-A` | `PASS` |
| `chrome` | `[A1, A2]` | `[A1, A2]` | `[]` | first approved after parent-compatible all-address policy | `A1` | `A1` | `multi-safe-A` | `PASS` |

Observed receiver counts:

| Provider | A1 | A2 |
| --- | ---: | ---: |
| `msedge` | `>=1` | `0` |
| `chrome` | `>=1` | `0` |

### Case B - Mixed Safe/Unsafe Answer

| Provider | resolved | approved | denied | selection rule | selected | actual TCP target | receiver | policy status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `msedge` | `[A_safe, B_unsafe]` | `[A_safe]` | `[B_unsafe]` | parent-compatible mixed unsafe answer blocks before upstream | `NONE` | `NONE` | `NONE` | `PASS` |
| `chrome` | `[A_safe, B_unsafe]` | `[A_safe]` | `[B_unsafe]` | parent-compatible mixed unsafe answer blocks before upstream | `NONE` | `NONE` | `NONE` | `PASS` |

Observed receiver counts:

| Provider | A_safe | B_unsafe |
| --- | ---: | ---: |
| `msedge` | `0` | `0` |
| `chrome` | `0` | `0` |

The proof prevented:

```text
first safe answer => hostname safe
one approved answer => applicable unsafe answers ignored
```

## Approved-Address Binding Evidence

For the successful CONNECT transport probe:

| Provider | security resolver | approved set | selected IP | upstream connect argument | actual upstream target | receiver identity | independent later target resolution | binding result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `msedge` | proof-owned controlled resolver | `[127.0.0.1:<controlled-port>]` | `127.0.0.1:<controlled-port>` | `host=127.0.0.1`, selected receiver port | `127.0.0.1:<controlled-port>` | `h2-approved-A` | none in proxy path | `PASS` |
| `chrome` | proof-owned controlled resolver | `[127.0.0.1:<controlled-port>]` | `127.0.0.1:<controlled-port>` | `host=127.0.0.1`, selected receiver port | `127.0.0.1:<controlled-port>` | `h2-approved-A` | none in proxy path | `PASS` |

The proof rejected hostname-only upstream forwarding. The proxy passed the selected approved IP literal to `net.connect()`.

## Browser Bypass Evidence

| Provider | expected proxy-owned contact | unexpected Browser-direct contact | measurement mechanism | result |
| --- | --- | --- | --- | --- |
| `msedge` | approved receiver contacted through proxy-owned upstream path | not independently distinguishable from same loopback receiver alone | proxy CONNECT event, upstream connect argument, actual upstream target, receiver counter | `UNRESOLVED` for independent bypass exclusion |
| `chrome` | approved receiver contacted through proxy-owned upstream path | not independently distinguishable from same loopback receiver alone | proxy CONNECT event, upstream connect argument, actual upstream target, receiver counter | `UNRESOLVED` for independent bypass exclusion |

The proof observed the intended proxy path. It did not claim complete direct-target bypass exclusion.

## Trusted HTTPS Main Document

`UNRESOLVED`

The Browser attempted a tunneled HTTPS navigation with `ignoreHTTPSErrors=false`. The local receiver observed TLS ClientHello and SNI, then the navigation failed because no accepted trusted HTTPS fixture existed.

## Trusted HTTPS Subresource

`UNRESOLVED`

Not executed as a successful trusted HTTPS subresource because the trusted fixture was blocked.

## Trusted HTTPS Redirect

`UNRESOLVED`

Not executed as a successful trusted HTTPS redirect because the trusted fixture was blocked.

## TLS Ownership

`PASS` for observed TLS ClientHello ownership on the CONNECT tunnel.

The proxy did not decrypt TLS and did not present a certificate. The controlled receiver observed Browser-originated TLS ClientHello bytes after CONNECT establishment. Successful TLS session ownership remains limited by the missing trusted fixture.

## SNI Evidence

| Provider | CONNECT authority | SNI observed | certificate logical hostname |
| --- | --- | --- | --- |
| `msedge` | `h2-connect.p2-local.test:<controlled-port>` | `h2-connect.p2-local.test` | `UNRESOLVED` |
| `chrome` | `h2-connect.p2-local.test:<controlled-port>` | `h2-connect.p2-local.test` | `UNRESOLVED` |

SNI was observed directly from ClientHello bytes at the controlled TCP receiver. It was not inferred from navigation success or certificate acceptance.

## Certificate Hostname Validation

`UNRESOLVED`

No accepted controlled Browser-trusted certificate chain was available without root CA/trust-store mutation or TLS weakening.

## Trust-Chain Evidence

`UNRESOLVED`

`ignoreHTTPSErrors=false` was preserved. The proof did not use:

- disabled certificate verification;
- `--ignore-certificate-errors`;
- root CA installation;
- persistent trust-store mutation;
- persistent profile trust;
- certificate substitution;
- MITM/TLS interception.

Because trusted HTTPS success was unavailable under these constraints, trust-chain validation remains unresolved rather than failed.

## Rebinding / TOCTOU Evidence

| Provider | approval address A | post-approval state B | mutation before transport | actual transport target | A receiver count | B receiver count | new security decision | Browser bypass to B | H3 result |
| --- | --- | --- | --- | --- | ---: | ---: | --- | --- | --- |
| `msedge` | `rebind-A-approved` | `rebind-B-mutated` | `YES` | `A` | `1` | `0` | `NOT_APPLICABLE_SELECTED_APPROVED_A_RETAINED` | `NO` | `PASS` |
| `chrome` | `rebind-A-approved` | `rebind-B-mutated` | `YES` | `A` | `1` | `0` | `NOT_APPLICABLE_SELECTED_APPROVED_A_RETAINED` | `NO` | `PASS` |

Resolver-call order alone was not used as proof. Receiver A and B had independent counters, and the actual upstream target was recorded from the proxy-owned transport path.

## Receiver Evidence

| Case | Counter instantiated | Receiver result |
| --- | --- | --- |
| H2 approved CONNECT target | `YES` | Edge `>=1`, Chrome `>=1` |
| Multi-address all-safe selected receiver A1 | `YES` | Edge `>=1`, Chrome `>=1` |
| Multi-address all-safe unselected receiver A2 | `YES` | Edge `0`, Chrome `0` |
| Mixed-answer safe receiver | `YES` | Edge `0`, Chrome `0` |
| Mixed-answer unsafe receiver | `YES` | Edge `0`, Chrome `0` |
| H3 approved receiver A | `YES` | Edge `1`, Chrome `1` |
| H3 mutated receiver B | `YES` | Edge `0`, Chrome `0` |
| CONNECT rejected target receiver | `YES` | Edge `0`, Chrome `0` |
| Resolver-failure target receiver | `YES` | Edge `0`, Chrome `0` |
| Proxy unavailable target receiver | `NO` | `NOT_MEASURED` |
| Upstream connect failure receiver | `NO` | `NOT_MEASURED` |

Numeric zero is reported only where an independent controlled receiver counter existed.

## Failure / Fail-Closed Evidence

| Failure case | Browser outcome | unrestricted fallback observed | receiver counter instantiated | receiver result |
| --- | --- | --- | --- | --- |
| proxy unavailable before request | request failed | `NO` | `NO` | `NOT_MEASURED` |
| CONNECT rejected | request failed | `NO` | `YES` | `0` |
| upstream connect failure | request failed | `NO` | `NO` | `NOT_MEASURED` |
| security resolver failure | request failed | `NO` | `YES` | `0` |

`NO_UNRESTRICTED_FALLBACK_OBSERVED` is not the same as target receiver count `0` unless a receiver counter exists.

## Product / Trust Constraints

| Requirement | Iteration 2 proof result |
| --- | --- |
| root CA | `NO` |
| trust-store mutation | `NO` |
| administrator rights | `NO` |
| system proxy | `NO` |
| system DNS/hosts | `NO` |
| persistent profile | `NO` |
| bundled Browser | `NO` |
| arbitrary executable path | `NO` |
| external daemon | `NO` |
| new dependency | `NO` |

Trusted HTTPS remains unresolved because the proof did not accept root CA/trust-store mutation, hidden trust, or TLS weakening.

## Dependency State

`playwright-core@1.62.1`

`NO_NEW_DEPENDENCY`

No package file changed.

## Production Scope

No production file changed.

| File | Classification | Purpose |
| --- | --- | --- |
| `test-p2-connect-binding-rebinding.mjs` | `PROOF_ONLY` | Iteration 2 focused CONNECT binding and rebinding harness. |
| `docs/codex/evidence/P2-02_ITERATION_2_CONNECT_BINDING_REBINDING.md` | `PROOF_ONLY` | Iteration 2 evidence report. |

No `EXPERIMENTAL_P2_02_SPIKE` production code was created.

## Unresolved Dimensions

- H2 successful trusted HTTPS main document.
- H2 successful trusted HTTPS representative subresource.
- H2 successful trusted HTTPS redirect.
- H2 certificate hostname validation.
- H2 trust-chain validation.
- Independent Browser direct-target bypass exclusion for the same loopback receiver path.
- Parent P2-02 complete FEASIBLE hard conjunction.
- Production lifecycle/integration of a context-local enforcement mechanism.
- Complete production failure-mode matrix.
- P2-03 address enforcement implementation.

## Residual Security Gaps

- DNS/SSRF parity remains not proven.
- H2 is not proven because trusted HTTPS/certificate/trust evidence is unresolved.
- H3 proof is controlled and endpoint-backed, but it is not a complete production DNS/address policy.
- Local proxy is still only a proxy candidate, not an accepted production architecture.
- P2-03 remains blocked until parent P2-02 FEASIBLE is separately accepted.

## Parent P2-02 Boundary

Iteration 2 does not mean:

```text
P2-02 FEASIBLE
DNS/SSRF parity proven
OQ-3 closed
P2-03 may start
```

Parent P2-02 hard conjunction remains authoritative.

## P2-03 Boundary

`P2-03 = BLOCKED`

## H2 Mandatory-Dimension Audit

| Dimension | Result |
| --- | --- |
| Browser uses proxy | `PASS` |
| CONNECT authority observed | `PASS` |
| target DNS owner understood | `PASS` |
| resolved addresses recorded | `PASS` |
| approved/denied sets recorded | `PASS` |
| multi-address rule parent-compatible | `PASS` |
| selected approved address bound to actual TCP | `PASS` |
| Browser target bypass excluded | `UNRESOLVED` |
| successful trusted HTTPS main | `UNRESOLVED` |
| successful trusted HTTPS subresource | `UNRESOLVED` |
| successful HTTPS redirect | `UNRESOLVED` |
| TLS remains Browser end-to-end | `PASS` |
| SNI proven | `PASS` |
| certificate hostname validation proven | `UNRESOLVED` |
| trust-chain validation proven | `UNRESOLVED` |
| `ignoreHTTPSErrors=false` | `PASS` |
| hidden trust weakening | `PASS` |
| `msedge` mandatory H2 pass | `UNRESOLVED` |
| `chrome` mandatory H2 pass | `UNRESOLVED` |

H2 precedence:

```text
no mandatory H2 property directly falsified
one or more mandatory H2 dimensions unresolved
=> H2_UNRESOLVED
```

## H3 Mandatory-Dimension Audit

| Dimension | Result |
| --- | --- |
| approval-time A established | `PASS` |
| A approved | `PASS` |
| resolver changed to B | `PASS` |
| B mutation before transport | `PASS` |
| receiver A instantiated | `PASS` |
| receiver B instantiated | `PASS` |
| actual transport observed | `PASS` |
| actual transport target | `PASS` |
| B receiver count zero | `PASS` |
| Browser direct bypass to B | `PASS` |
| provider evidence | `PASS` |

H3 precedence:

```text
no transport-backed invariant violation
no mandatory H3 transport-proof dimension unresolved
all mandatory dimensions pass
=> H3_PROVEN
```

## Security State

```text
DNS ownership = SEPARATE_RESOLUTION
DNS/SSRF parity not proven.
P2-02_REQUIRED
OQ-3 = open / Phase 2 hard blocker
OQ-2 = collecting_evidence
```
