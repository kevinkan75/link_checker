# P2-02 - DNS / Destination Binding Feasibility Evidence

Date: 2026-08-13
Branch: `feature/js-dynamic-scan`
Commit at start: `cc2d45e docs: tighten p2-02 destination binding feasibility gate`

## Outcome

`ADJUST_ARCHITECTURE`

```text
Accepted Candidate = NONE
Preventive Guarantee = NOT PROVEN
FEASIBLE_ALLOWED = NO
ADJUST_ARCHITECTURE_JUSTIFIED
P2-03_BLOCKED_REPEAT_OR_ADJUST_P2_02
NEXT_P2_02_ITERATION_JUSTIFIED
```

P2-02 produced controlled evidence that a BrowserContext local enforcing proxy can prevent receiver contact for observed HTTP, redirect, tested subresource, and HTTPS-denied CONNECT proxy paths while `route.continue()` is still present before the proxy boundary. The proxy-unavailable path separately showed navigation/request failure with no unrestricted fallback observed, but independent target receiver contact was not measured. WebSocket evidence is also separate: `routeWebSocket()` observed Browser-side blocked attempts, but an independent denied WebSocket receiver handshake/contact counter was not measured.

However, mandatory FEASIBLE dimensions remain unresolved:

- successful HTTPS main-document proof with a trusted certificate chain;
- successful representative HTTPS subresource proof with a trusted certificate chain;
- SNI and certificate hostname validation evidence on a successful HTTPS path;
- transport-backed DNS A -> B rebinding / TOCTOU proof;
- separate XHR subresource proof;
- independent WebSocket denied receiver handshake/contact proof;
- accepted production integration and lifecycle design for the local enforcing proxy.

Because any unresolved mandatory applicable condition forbids `FEASIBLE`, P2-03 remains blocked.

`DNS/SSRF parity not proven.`

## Starting Security State

```text
security-policy DNS owner = Node
actual Browser connection DNS owner = Browser/Chromium
shared DNS answer = NOT PROVEN
approved IP pinning = NOT PROVEN
Browser independent resolution = not ruled out
classification = SEPARATE_RESOLUTION
```

P2-01 did not change this relationship.

## Proof Artifacts

| File | Classification | Purpose |
| --- | --- | --- |
| `test-p2-dns-destination-binding-feasibility.mjs` | `PROOF_ONLY` | Controlled local feasibility harness for candidate evidence. |
| `docs/codex/evidence/P2-02_DNS_DESTINATION_BINDING_FEASIBILITY.md` | `PROOF_ONLY` | This evidence report. |

No production-path spike code was retained.

## Serious Candidates Evaluated

### Current URL Policy Plus `route.continue()`

| Field | Evidence |
| --- | --- |
| candidate | Current URL policy plus `route.continue()` |
| candidate assessment | `NOT_VIABLE` |
| control type | `PREVENTIVE` for URL/method policy only; not actual destination binding |
| security-policy DNS owner | Node via `evaluateUrlSecurity()` |
| actual transport DNS owner | Browser/Chromium after `route.continue()` |
| TCP connection owner | Browser/Chromium |
| security-approved address set | Node URL/security evaluator result |
| binding mechanism | None found |
| Browser independent re-resolution | Not constrained or eliminated |
| rebinding / TOCTOU | Not prevented |
| HTTP | URL/method policy can run before continuation; transport remains unbound |
| HTTPS | Browser-native TLS may occur after unbound continuation |
| TLS owner | Browser/Chromium |
| SNI | Browser/Chromium |
| certificate hostname validation | Browser-native, but not tied to Node-approved address set |
| trust chain | Browser-native |
| redirect | Initial and subsequent Browser requests may be routed, but actual destination binding is still absent |
| subresources | Routed classes can be observed, but actual destination binding is absent |
| WebSocket | Not covered by HTTP route; separate `routeWebSocket()` only |
| Edge/msedge | Existing hooks run, but not sufficient for OQ-3 |
| Chrome/chrome | Existing hooks run, but not sufficient for OQ-3 |
| Windows/product implications | No new system mutation |
| administrator/system mutation | None |
| proxy/system settings | None |
| root CA/trust store | None |
| external daemon/service | None |
| failure behavior | No destination-binding enforcement exists to fail closed |
| receiver-contact evidence | Not applicable; rejected by design evidence |
| Browser-semantics impact | Native Browser semantics preserved |
| operational complexity | Low |
| maintainability | High |
| residual security gap | Browser can connect outside Node-approved DNS answer set |

### BrowserContext Local Enforcing Proxy

| Field | Evidence |
| --- | --- |
| candidate | BrowserContext local enforcing proxy |
| candidate assessment | `VIABLE_FOR_PROOF`; not FEASIBLE |
| control type | `PREVENTIVE` for observed HTTP and CONNECT paths in controlled proof |
| security-policy DNS owner | Proxy/Node-owned candidate policy in proof |
| actual transport DNS owner | Proxy for observed HTTP and CONNECT paths |
| TCP connection owner | Local proxy for observed forwarded HTTP and CONNECT paths |
| security-approved address set | Synthetic approved set: `allowed.p2-local.test -> 127.0.0.1:<allowed-port>` |
| binding mechanism | BrowserContext proxy routes Browser traffic to a local proxy; proxy forwards only approved host to approved receiver and denies denied host before receiver contact |
| Browser independent re-resolution | For observed HTTP and CONNECT paths, Browser sends proxy-form request or CONNECT to proxy; direct Browser DNS to synthetic host was not required |
| rebinding / TOCTOU | `UNRESOLVED` - no transport-backed DNS A -> B rebind sequence was executed. The proxy-owned synthetic mapping is useful candidate evidence, but fake/static mapping behavior is not Browser transport rebinding proof. |
| HTTP | `LOCAL_FIXTURE_PASS`; allowed receiver reached, denied receiver count remained `0` |
| HTTPS | Denied-CONNECT proxy behavior only; successful HTTPS with trusted certificate chain unresolved; independent TLS target receiver contact was not measured |
| TLS owner | `UNRESOLVED` for successful trusted HTTPS path; CONNECT-denial behavior does not prove successful TLS ownership |
| SNI | Unresolved for successful trusted HTTPS path |
| certificate hostname validation | Unresolved for successful trusted HTTPS path |
| trust chain | Unresolved for successful trusted HTTPS path |
| redirect | Approved-to-approved redirect reached approved final destination; approved-to-denied HTTP redirect denied with receiver count `0`; HTTP-to-HTTPS denied redirect denied at CONNECT, but independent TLS target receiver contact was not measured |
| subresources | Denied fetch, image, script, stylesheet, and iframe/frame attempts were denied before denied receiver delivery; XHR was not separately tested |
| WebSocket | `routeWebSocket()` observed two Browser-side blocked attempts per tested channel for `ws:` and `wss:`; independent denied receiver handshake/contact count was `NOT MEASURED` |
| Edge/msedge | `LOCAL_FIXTURE_PASS` |
| Chrome/chrome | `LOCAL_FIXTURE_PASS` |
| Windows/product implications | Context proxy proof required no hosts-file, system DNS, root certificate, user profile, bundled Chromium, or arbitrary executable path |
| administrator/system mutation | None in proof |
| proxy/system settings | Context-local proxy only; no persistent system proxy |
| root CA/trust store | None in proof; unresolved for successful local HTTPS trusted fixture |
| external daemon/service | None beyond test-local in-process proxy |
| failure behavior | Proxy-unavailable path produced no unrestricted fallback in both channels |
| receiver-contact evidence | Edge: allowed receiver `5`, denied HTTP receiver `0`, proxy HTTP denied `6`, proxy CONNECT denied `10`, Browser-side WebSocket blocked attempts `2`, WebSocket denied receiver handshake/contact `NOT MEASURED`, independent TLS target receiver contact `NOT MEASURED`; Chrome same counts |
| Browser-semantics impact | Native HTTP rendering works through proxy for controlled pages; full production semantics and HTTPS fidelity unresolved |
| operational complexity | Medium: local proxy lifecycle, port ownership, cleanup, and failure handling required |
| maintainability | Medium: feasible direction but requires production architecture design and audit |
| residual security gap | Mandatory successful HTTPS/SNI/certificate proof and production lifecycle design unresolved |
| final candidate assessment | `VIABLE_FOR_PROOF`; accepted production candidate = `NONE` |

### Node-Controlled Request Fulfillment

| Field | Evidence |
| --- | --- |
| candidate | Node-controlled request fulfillment/intermediation |
| candidate assessment | `REQUIRES_SPIKE` |
| control type | `PREVENTIVE` if Browser direct network is fully replaced by Node-approved fulfilled responses |
| security-policy DNS owner | Node |
| actual transport DNS owner | Node if implemented |
| TCP connection owner | Node if implemented |
| security-approved address set | Node policy result |
| binding mechanism | Not implemented in this proof |
| Browser independent re-resolution | Eliminated only if all direct Browser transport is blocked and fulfilled |
| rebinding / TOCTOU | Potentially preventable through Node transport, not proven |
| HTTP | Not proven |
| HTTPS | Not proven; TLS ownership shifts to Node |
| TLS owner | Node if implemented |
| SNI | Node if implemented |
| certificate hostname validation | Node if implemented |
| trust chain | Node if implemented |
| redirect | Would need Node redirect revalidation |
| subresources | Would need response fidelity proof |
| WebSocket | Must remain blocked separately |
| Edge/msedge | Not proven |
| Chrome/chrome | Not proven |
| Windows/product implications | No browser distribution change, but significant fidelity risk |
| administrator/system mutation | None expected |
| proxy/system settings | None expected |
| root CA/trust store | None expected if Node validates normally |
| external daemon/service | None expected |
| failure behavior | Not proven |
| receiver-contact evidence | None |
| Browser-semantics impact | High risk: CORS, cache, redirects, streaming, binary resources, cookies, and response headers |
| operational complexity | High |
| maintainability | Medium/low until proven |
| residual security gap | Full Browser semantics and HTTPS parity unresolved |

### Chromium Host Resolver Rules / Launch Args

| Field | Evidence |
| --- | --- |
| candidate | Chromium host resolver rules / launch args |
| candidate assessment | `UNKNOWN` |
| control type | `OTHER` unless actual transport binding is proven |
| security-policy DNS owner | Browser/Chromium configured resolver if used |
| actual transport DNS owner | Browser/Chromium |
| TCP connection owner | Browser/Chromium |
| security-approved address set | Not tied to Node policy by current code |
| binding mechanism | Not proven |
| Browser independent re-resolution | Not proven constrained |
| rebinding / TOCTOU | Not proven prevented |
| HTTP | Not proven |
| HTTPS | Not proven; host remapping can interact with certificate/SNI |
| TLS owner | Browser/Chromium |
| SNI | Browser/Chromium; risk if remapping changes host assumptions |
| certificate hostname validation | Not proven safely preserved |
| trust chain | Browser-native if no TLS interception |
| redirect | Not proven |
| subresources | Not proven |
| WebSocket | Not proven; separate block still required |
| Edge/msedge | Not proven |
| Chrome/chrome | Not proven |
| Windows/product implications | Launch flags may conflict with provider/product constraints |
| administrator/system mutation | None expected |
| proxy/system settings | None |
| root CA/trust store | None expected |
| external daemon/service | None |
| failure behavior | Not proven |
| receiver-contact evidence | None |
| Browser-semantics impact | Unknown |
| operational complexity | Medium |
| maintainability | Unknown |
| residual security gap | Browser still owns TCP; per-request approved-set binding unproven |

### OS Hosts / System DNS Manipulation

| Field | Evidence |
| --- | --- |
| candidate | OS hosts-file or system DNS manipulation |
| candidate assessment | `NOT_VIABLE` |
| control type | `OTHER` |
| security-policy DNS owner | OS/system |
| actual transport DNS owner | Browser/OS |
| TCP connection owner | Browser/OS |
| security-approved address set | Not safely maintained per request |
| binding mechanism | System mutation |
| Browser independent re-resolution | Not reliably constrained due cache, DoH, proxy, or policy |
| rebinding / TOCTOU | Not reliably prevented |
| HTTP | Environment-dependent |
| HTTPS | Environment-dependent and certificate-risk prone |
| TLS owner | Browser/OS |
| SNI | Browser/OS |
| certificate hostname validation | Environment-dependent |
| trust chain | Environment-dependent |
| redirect | Still requires separate validation |
| subresources | Environment-dependent |
| WebSocket | Environment-dependent |
| Edge/msedge | Environment-dependent |
| Chrome/chrome | Environment-dependent |
| Windows/product implications | Violates local portable product constraints |
| administrator/system mutation | Required or likely |
| proxy/system settings | Possible |
| root CA/trust store | Possible if TLS workaround attempted |
| external daemon/service | Possible |
| failure behavior | Not reliably fail-closed |
| receiver-contact evidence | None |
| Browser-semantics impact | High environment coupling |
| operational complexity | High |
| maintainability | Low |
| residual security gap | Unsafe operational model |

### CDP / Network Observation Only

| Field | Evidence |
| --- | --- |
| candidate | CDP/network observation only |
| candidate assessment | `NOT_VIABLE` |
| control type | `DETECTIVE` |
| security-policy DNS owner | Browser/Chromium observation after activity |
| actual transport DNS owner | Browser/Chromium |
| TCP connection owner | Browser/Chromium |
| security-approved address set | Not bound |
| binding mechanism | None |
| Browser independent re-resolution | Not constrained |
| rebinding / TOCTOU | Not prevented |
| HTTP | Detective only |
| HTTPS | Detective only |
| TLS owner | Browser/Chromium |
| SNI | Browser/Chromium |
| certificate hostname validation | Browser-native but not preventive |
| trust chain | Browser-native |
| redirect | Detective only |
| subresources | Coverage varies; detective only |
| WebSocket | Detective only |
| Edge/msedge | API behavior may vary |
| Chrome/chrome | API behavior may vary |
| Windows/product implications | No system mutation, but no security closure |
| administrator/system mutation | None |
| proxy/system settings | None |
| root CA/trust store | None |
| external daemon/service | None |
| failure behavior | Cannot fail closed before contact |
| receiver-contact evidence | Contact may already have occurred |
| Browser-semantics impact | Low |
| operational complexity | Medium |
| maintainability | Medium |
| residual security gap | Detective evidence cannot satisfy OQ-3 |

### Deterministic Resolver Seam

| Field | Evidence |
| --- | --- |
| candidate | Deterministic resolver seam for tests |
| candidate assessment | `VIABLE_FOR_PROOF` |
| control type | `TEST_ONLY` |
| security-policy DNS owner | Fake/injected resolver |
| actual transport DNS owner | Not applicable by itself |
| TCP connection owner | None by itself |
| security-approved address set | Synthetic |
| binding mechanism | None by itself |
| Browser independent re-resolution | Not addressed |
| rebinding / TOCTOU | Can model sequences but cannot bind Browser transport |
| HTTP | Policy/model proof only |
| HTTPS | Policy/model proof only |
| TLS owner | Not applicable |
| SNI | Not applicable |
| certificate hostname validation | Not applicable |
| trust chain | Not applicable |
| redirect | Policy/model proof only |
| subresources | Policy/model proof only |
| WebSocket | Policy/model proof only |
| Edge/msedge | Not proven |
| Chrome/chrome | Not proven |
| Windows/product implications | Low |
| administrator/system mutation | None |
| proxy/system settings | None |
| root CA/trust store | None |
| external daemon/service | None |
| failure behavior | Only model behavior |
| receiver-contact evidence | None by itself |
| Browser-semantics impact | None |
| operational complexity | Low |
| maintainability | High as test infrastructure |
| residual security gap | Not actual destination binding |

### `routeWebSocket()` First-Release WebSocket Block

| Field | Evidence |
| --- | --- |
| candidate | `routeWebSocket()` for first-release WebSocket blocking |
| candidate assessment | `VIABLE_FOR_PROOF` for WebSocket only |
| control type | `PREVENTIVE` for WebSocket only in observed proof |
| security-policy DNS owner | Not an HTTP/HTTPS DNS-binding mechanism |
| actual transport DNS owner | Browser unless closed before handshake |
| TCP connection owner | Browser unless closed before handshake |
| security-approved address set | None for HTTP/HTTPS |
| binding mechanism | WebSocket route close |
| Browser independent re-resolution | HTTP/HTTPS unaffected |
| rebinding / TOCTOU | HTTP/HTTPS unaffected |
| HTTP | Not covered |
| HTTPS | Not covered |
| TLS owner | Not applicable for HTTP/HTTPS binding |
| SNI | Not applicable for HTTP/HTTPS binding |
| certificate hostname validation | Not applicable |
| trust chain | Not applicable |
| redirect | Not covered |
| subresources | Not covered |
| WebSocket | Edge `2` Browser-side blocked attempts; Chrome `2` Browser-side blocked attempts; independent denied receiver handshake/contact `NOT MEASURED` |
| Edge/msedge | `LOCAL_FIXTURE_PASS` |
| Chrome/chrome | `LOCAL_FIXTURE_PASS` |
| Windows/product implications | Uses installed Playwright API |
| administrator/system mutation | None |
| proxy/system settings | None |
| root CA/trust store | None |
| external daemon/service | None |
| failure behavior | Missing API must fail closed in later P2-05/P2-06 work |
| receiver-contact evidence | Browser-side WebSocket blocked attempts observed; independent denied receiver handshake/contact count `NOT MEASURED` |
| Browser-semantics impact | First-release WebSocket egress remains blocked |
| operational complexity | Low |
| maintainability | Medium; API support must remain verified |
| residual security gap | WebSocket-only; does not establish HTTP/HTTPS destination binding |

## Local Proxy Proof Results

Focused command:

```powershell
node .\test-p2-dns-destination-binding-feasibility.mjs
```

Evidence state: `LOCAL_FIXTURE_PASS`

| Browser channel | Allowed receiver | Denied HTTP receiver | Proxy HTTP denied | Proxy CONNECT denied | Browser WS blocked attempts | WS receiver handshake/contact | TLS target receiver contact | `ignoreHTTPSErrors` |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| `msedge` | 5 | 0 | 6 | 10 | 2 | `NOT MEASURED` | `NOT MEASURED` | `false` |
| `chrome` | 5 | 0 | 6 | 10 | 2 | `NOT MEASURED` | `NOT MEASURED` | `false` |

Allowed receiver paths for each channel:

```text
/main
/redirect-approved
/approved-final
/redirect-denied-http
/redirect-denied-https
```

Denied HTTP receiver contact count stayed `0` for controlled HTTP denied subresources and the approved-to-denied HTTP redirect destination. HTTPS denied CONNECT was observed as proxy-side CONNECT denial before proxy forwarding; an independent TLS target receiver counter was not instantiated. WebSocket blocked-attempt counts are Browser-side route observations, not independent receiver handshake/contact counts.

Receiver-evidence precision:

| Case | Evidence |
| --- | --- |
| HTTP denied receiver | direct receiver contact count = `0` |
| HTTPS denied CONNECT | proxy CONNECT denial observed; proxy upstream target connection count = `NOT MEASURED`; independent TLS target receiver contact count = `NOT MEASURED` |
| redirect denied destination | direct receiver contact count = `0` for tested HTTP denied redirect |
| denied tested subresource | direct HTTP receiver contact count = `0` for fetch, image, script, stylesheet, and iframe/frame; XHR = `NOT SEPARATELY TESTED` |
| WebSocket | Browser-side blocked-attempt count = `2` per channel; independent denied receiver handshake/contact count = `NOT MEASURED` |

Proxy-unavailable failure path:

| Browser channel | navigation/request failed | unrestricted fallback observed | independent target receiver counter instantiated | independent target receiver contact |
| --- | --- | --- | --- | --- |
| `msedge` | `YES` | `NO` | `NO` | `NOT MEASURED` |
| `chrome` | `YES` | `NO` | `NO` | `NOT MEASURED` |

`NO_UNRESTRICTED_FALLBACK_OBSERVED` is not the same claim as `TARGET RECEIVER COUNT = 0`.

## DNS / Transport Ownership

For the current production implementation:

```text
security-policy DNS owner: Node
actual transport DNS owner: Browser/Chromium
TCP owner: Browser/Chromium
approved address set: Node URL-security evaluator result
binding mechanism: none
Browser independent resolution behavior: not ruled out
```

For the tested local enforcing proxy candidate:

```text
security-policy DNS owner: proxy/Node-owned candidate policy in proof
actual transport DNS owner: proxy for observed HTTP and CONNECT paths
TCP owner: proxy for observed forwarded HTTP and CONNECT paths
approved address set: synthetic allowed host mapped to controlled receiver
binding mechanism: context-local proxy forwarding only approved host to approved receiver
Browser independent resolution behavior: constrained for observed HTTP and CONNECT proxy paths
```

## Rebinding / TOCTOU Evidence

The proof used synthetic hostnames and a proxy-owned approved mapping. The Browser request was allowed to reach `route.continue()`, then the context-local proxy made the actual destination decision and forwarded only to the approved receiver.

Observed result:

- approved target reached when hostname matched the proxy-approved set;
- denied target never received HTTP delivery;
- denied HTTPS CONNECT was refused by proxy before proxy forwarding; independent TLS target receiver contact was not measured;
- proxy unavailable produced no unrestricted fallback in the tested Browser path; independent target receiver contact was not measured.

DNS rebinding / TOCTOU status is `UNRESOLVED`. No transport-backed sequence equivalent to `security approval -> endpoint A`, later DNS answer -> `endpoint B`, and actual Browser/proxy transport constrained to the approved destination was executed. The deterministic synthetic mapping remains test infrastructure useful for a future controlled rebinding proof; fake resolver or static mapping behavior is not Browser transport binding proof by itself.

## HTTPS / TLS Evidence

| Dimension | Result |
| --- | --- |
| HTTPS main document | `UNRESOLVED` - no trusted local HTTPS certificate-chain fixture was introduced |
| HTTPS subresource | `UNRESOLVED` - no trusted local HTTPS certificate-chain fixture was introduced |
| HTTPS redirect | `UNRESOLVED`; denied CONNECT proxy refusal was observed, but successful trusted HTTPS redirect is unresolved |
| TLS owner | `UNRESOLVED`; denied CONNECT does not prove successful TLS ownership |
| SNI | `UNRESOLVED` for successful trusted HTTPS path |
| certificate hostname validation | `UNRESOLVED` for successful trusted HTTPS path |
| trust-chain validation | `UNRESOLVED` for successful trusted HTTPS path |
| `ignoreHTTPSErrors` | `false` in both Edge and Chrome proof contexts |

P2-02 did not disable TLS verification.

## Redirect Evidence

| Scenario | Result |
| --- | --- |
| approved -> approved | `LOCAL_FIXTURE_PASS`; approved final path reached |
| approved -> denied HTTP | `LOCAL_FIXTURE_PASS`; proxy returned denial, denied receiver count `0` |
| HTTP -> denied HTTPS | `LOCAL_FIXTURE_PASS` for proxy CONNECT denial only; independent TLS target receiver contact count = `NOT MEASURED` |
| denied HTTP receiver count | `0` for the tested HTTP denied redirect |

P2-04 still owns complete redirect/re-resolution policy implementation.

## Subresource Evidence

| Representative class | Result |
| --- | --- |
| fetch | `TESTED`; denied synthetic host was proxy-blocked; denied receiver count `0` |
| XHR | `NOT SEPARATELY TESTED` / `UNRESOLVED` |
| image | Denied synthetic host was proxy-blocked; denied receiver count `0` |
| script/stylesheet | Denied synthetic host was proxy-blocked; denied receiver count `0` |
| iframe/frame | Denied synthetic host was proxy-blocked; denied receiver count `0` |

P2-05 still owns final complete Browser egress parity.

## WebSocket Evidence

| Dimension | Result |
| --- | --- |
| `ws:` | `routeWebSocket()` observed/blocked attempt in both Edge and Chrome |
| `wss:` | `routeWebSocket()` observed/blocked attempt in both Edge and Chrome |
| Browser-side blocked-attempt count | Edge `2`, Chrome `2` |
| independent denied receiver handshake/contact count | `NOT MEASURED` |
| failure behavior | Missing/ineffective WebSocket interception remains later P2-05/P2-06 fail-closed work |

## Failure / Fail-Closed Evidence

| Failure case | Result |
| --- | --- |
| context-local proxy unavailable | Browser navigation/request failed; no unrestricted fallback observed; independent target receiver contact `NOT MEASURED` |
| denied HTTP destination | proxy denial response; denied receiver count `0` |
| denied HTTPS CONNECT | proxy refusal observed; independent TLS target receiver contact count `NOT MEASURED` |

Production fail-closed behavior is not implemented by P2-02 and remains downstream architecture work if the proxy direction is repeated.

## Portability / Product Evidence

| Constraint | Local proxy proof |
| --- | --- |
| admin rights | No |
| hosts modification | No |
| system DNS | No |
| persistent proxy | No; context-local proxy only |
| root certificate | No in proof; successful trusted HTTPS fixture unresolved |
| trust store | No in proof; successful trusted HTTPS fixture unresolved |
| profile/user-data | No persistent profile or user data |
| bundled Chromium | No |
| arbitrary executable | No |
| external service | No |
| elevated service | No |
| manual configuration | No for proof |
| portable build | Potentially compatible, but local proxy lifecycle/port integration unresolved |
| Windows local user | Proof ran locally for Edge and Chrome without admin/system mutation |

## Dependency State

`playwright-core@1.62.1`

No dependency installation occurred. No candidate installed or required a new dependency during P2-02 execution.

## Node Policy Boundary

`NODE_POLICY_UNCHANGED_DURING_P2_02`

`link-checker.mjs` was not modified. Existing Node DNS resolver-exception behavior was not changed.

## Spike Ownership

```text
proof-only files retained:
- test-p2-dns-destination-binding-feasibility.mjs
- docs/codex/evidence/P2-02_DNS_DESTINATION_BINDING_FEASIBILITY.md

temporary production spike files removed:
- NONE

accepted production candidate files retained:
- NONE

rejected candidate code remaining:
- NONE
```

## FEASIBLE Hard-Conjunction Audit

| Dimension | Result |
| --- | --- |
| preventive actual-destination binding | `UNRESOLVED` overall; partial proxy HTTP evidence only, denied CONNECT proxy behavior only |
| security DNS ownership | `PASS` for proxy-owned proof |
| transport DNS ownership | `PASS` for observed proxy HTTP/CONNECT paths |
| TCP ownership | `PASS` for observed proxy HTTP/CONNECT paths |
| approved address set | `PASS` synthetic approved set |
| transport binding | `UNRESOLVED` overall; partial observed HTTP proxy path only |
| Browser independent resolution | `UNRESOLVED` globally; constrained only for observed proxy paths |
| rebinding/TOCTOU | `UNRESOLVED`; no transport-backed DNS A -> B rebind proof executed |
| HTTP | `PASS` |
| HTTPS main document | `UNRESOLVED` |
| HTTPS subresource | `UNRESOLVED` |
| HTTPS redirect | `UNRESOLVED`; denied CONNECT proxy behavior only |
| TLS ownership | `UNRESOLVED` |
| SNI | `UNRESOLVED` |
| hostname validation | `UNRESOLVED` |
| trust chain | `UNRESOLVED` |
| `ignoreHTTPSErrors=false` | `PASS` |
| redirect enforcement | `PARTIAL`; tested HTTP denied redirect receiver count `0`, HTTPS redirect success unresolved |
| representative subresources | `PARTIAL` / `UNRESOLVED`; fetch, image, script, stylesheet, iframe/frame tested; XHR not separately tested |
| WebSocket block | `PARTIAL`; Browser-side blocked attempts observed, independent denied receiver handshake/contact `NOT MEASURED` |
| Edge | `PASS` |
| Chrome | `PASS` |
| fail-closed failure | `PASS` for proxy-unavailable proof |
| no unrestricted fallback | `PASS` |
| receiver count=0 | `PARTIAL`; measured for denied HTTP receiver, HTTP redirect, and tested HTTP subresources; WebSocket receiver and independent TLS target receiver not measured |
| safe fixtures | `PASS` |
| dependency boundary | `PASS` |
| system/product constraints | `UNRESOLVED` for production integration; proof used context-local proxy without system mutation |
| root CA/trust-store constraints | `UNRESOLVED` |
| external service constraints | `PASS` |
| rejected code cleanup | `PASS` |
| retained files identified | `PASS` |
| unresolved mandatory dimensions | `FAIL` - unresolved dimensions listed below |
| security-critical residual gap | `FAIL` - HTTPS/certificate and production integration gaps remain |

## Unresolved Mandatory Proof Dimensions

- HTTPS main document with trusted certificate chain.
- Representative HTTPS subresource with trusted certificate chain.
- SNI and certificate hostname validation on a successful HTTPS path.
- Full successful HTTPS redirect through the candidate architecture.
- TLS ownership on a successful trusted HTTPS path.
- Certificate trust-chain validation on a successful trusted HTTPS path.
- Transport-backed DNS A -> B rebinding / TOCTOU proof.
- Overall approved-address transport binding.
- Global Browser independent re-resolution behavior.
- XHR subresource behavior.
- Independent WebSocket denied receiver handshake/contact count.
- Independent TLS target receiver contact count for denied CONNECT paths.
- Root CA/trust-store/product acceptability if successful local HTTPS proof requires TLS interception or local CA trust.
- Production integration and lifecycle design for context-local proxy enforcement.
- Complete failure-mode matrix for a production proxy/control path.
- No security-critical residual gap invalidating the preventive guarantee.

## Residual Security Gaps

- Local proxy direction is promising but not accepted as production architecture.
- FEASIBLE cannot be returned without trusted successful HTTPS evidence.
- FEASIBLE cannot be returned without transport-backed rebinding / TOCTOU proof.
- FEASIBLE cannot be returned from Browser-side WebSocket blocked-attempt counts without the required receiver-contact proof where meaningful.
- FEASIBLE cannot be returned from fetch-only subresource evidence as if XHR was also tested.
- FEASIBLE cannot be returned from denied CONNECT proxy behavior as if successful HTTPS/TLS/SNI/certificate behavior was proven.
- P2-03 cannot start because the selected DNS/address enforcement architecture is not accepted.
- OQ-3 remains open and DNS/SSRF parity remains unproven.

## P2-03 Progression

`P2-03_BLOCKED_REPEAT_OR_ADJUST_P2_02`

## Preserved Security State

```text
DNS ownership = SEPARATE_RESOLUTION
DNS/SSRF parity not proven.
P2-02_REQUIRED
OQ-3 = open / Phase 2 hard blocker
OQ-2 = collecting_evidence
```
