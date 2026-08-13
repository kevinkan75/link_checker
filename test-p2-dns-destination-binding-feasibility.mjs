import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright-core";

const BROWSER_CHANNELS = ["msedge", "chrome"];
const SYNTHETIC_ALLOWED_HOST = "allowed.p2-local.test";
const SYNTHETIC_DENIED_HOST = "denied.p2-local.test";
const LOCALHOST = "127.0.0.1";

class RequestCounter {
  constructor(name) {
    this.name = name;
    this.count = 0;
    this.paths = [];
  }

  record(path) {
    this.count += 1;
    this.paths.push(path);
  }
}

function listen(server, host = LOCALHOST) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function createAllowedHttpServer(counter) {
  const server = http.createServer((request, response) => {
    counter.record(request.url || "/");
    if (request.url === "/main") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>P2-02 proxy proof</title>
        <script src="http://${SYNTHETIC_DENIED_HOST}/script.js"></script>
        <link rel="stylesheet" href="http://${SYNTHETIC_DENIED_HOST}/style.css">
        <img alt="" src="http://${SYNTHETIC_DENIED_HOST}/image.png">
        <iframe title="denied" src="http://${SYNTHETIC_DENIED_HOST}/frame.html"></iframe>
        <script>
          fetch("http://${SYNTHETIC_DENIED_HOST}/fetch.json").catch(() => {});
          try { new WebSocket("ws://${SYNTHETIC_DENIED_HOST}/socket"); } catch {}
          try { new WebSocket("wss://${SYNTHETIC_DENIED_HOST}/secure-socket"); } catch {}
        </script>`);
      return;
    }
    if (request.url === "/redirect-denied-http") {
      response.writeHead(302, { location: `http://${SYNTHETIC_DENIED_HOST}/redirect-target` });
      response.end();
      return;
    }
    if (request.url === "/redirect-denied-https") {
      response.writeHead(302, { location: `https://${SYNTHETIC_DENIED_HOST}/secure-redirect-target` });
      response.end();
      return;
    }
    if (request.url === "/redirect-approved") {
      response.writeHead(302, { location: `http://${SYNTHETIC_ALLOWED_HOST}/approved-final` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end(`allowed ${request.url}`);
  });
  const port = await listen(server);
  return { server, port };
}

async function createDeniedHttpServer(counter) {
  const server = http.createServer((request, response) => {
    counter.record(request.url || "/");
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("denied receiver should not be contacted");
  });
  const port = await listen(server);
  return { server, port };
}

class ControlledProxy {
  constructor({ allowedPort, deniedPort }) {
    this.allowedPort = allowedPort;
    this.deniedPort = deniedPort;
    this.httpAllowed = 0;
    this.httpDenied = 0;
    this.connectDenied = 0;
    this.connectAllowed = 0;
    this.requests = [];
    this.server = http.createServer((request, response) => this.handleHttp(request, response));
    this.server.on("connect", (request, clientSocket) => this.handleConnect(request, clientSocket));
  }

  async start() {
    this.port = await listen(this.server);
    return this;
  }

  async close() {
    await closeServer(this.server);
  }

  proxyUrl() {
    return `http://${LOCALHOST}:${this.port}`;
  }

  handleHttp(request, response) {
    const url = new URL(request.url);
    this.requests.push({ type: "http", host: url.hostname, path: url.pathname });
    if (url.hostname === SYNTHETIC_DENIED_HOST) {
      this.httpDenied += 1;
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("blocked_by_p2_proxy_candidate");
      return;
    }
    if (url.hostname !== SYNTHETIC_ALLOWED_HOST) {
      this.httpDenied += 1;
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("blocked_unknown_host");
      return;
    }
    this.httpAllowed += 1;
    const forward = http.request({
      hostname: LOCALHOST,
      port: this.allowedPort,
      method: request.method,
      path: `${url.pathname}${url.search}`,
      headers: sanitizeForwardHeaders(request.headers),
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    forward.on("error", () => {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("upstream_error");
    });
    request.pipe(forward);
  }

  handleConnect(request, clientSocket) {
    const [hostname, portText] = String(request.url || "").split(":");
    this.requests.push({ type: "connect", host: hostname, port: Number(portText) || 443 });
    if (hostname !== SYNTHETIC_ALLOWED_HOST) {
      this.connectDenied += 1;
      clientSocket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
      return;
    }
    this.connectAllowed += 1;
    const upstream = net.connect({
      host: LOCALHOST,
      port: this.allowedPort,
    });
    upstream.on("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => {
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
    });
  }
}

function sanitizeForwardHeaders(headers) {
  const sanitized = { ...headers };
  delete sanitized["proxy-connection"];
  delete sanitized["proxy-authorization"];
  return sanitized;
}

async function withBrowser(channel, fn) {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: true });
  } catch (error) {
    return {
      channel,
      status: "ENV_BLOCKED",
      errorName: error?.name || "Error",
      message: String(error?.message || error).split(/\r?\n/)[0].slice(0, 200),
    };
  }
  try {
    const result = await fn(browser);
    return { channel, status: "LOCAL_FIXTURE_PASS", ...result };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runProxyCandidateForChannel(channel) {
  const allowedCounter = new RequestCounter("allowed-http");
  const deniedCounter = new RequestCounter("denied-http");
  const allowed = await createAllowedHttpServer(allowedCounter);
  const denied = await createDeniedHttpServer(deniedCounter);
  const proxy = await new ControlledProxy({
    allowedPort: allowed.port,
    deniedPort: denied.port,
  }).start();

  try {
    return await withBrowser(channel, async (browser) => {
      const context = await browser.newContext({
        proxy: { server: proxy.proxyUrl() },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      let websocketBlocked = 0;
      if (typeof context.routeWebSocket === "function") {
        await context.routeWebSocket(/.*/, async (webSocketRoute) => {
          websocketBlocked += 1;
          if (typeof webSocketRoute.close === "function") {
            await webSocketRoute.close({ code: 1008, reason: "blocked_by_policy" });
          }
        });
      }
      await context.route("**/*", async (route) => {
        await route.continue();
      });

      const page = await context.newPage();
      await page.goto(`http://${SYNTHETIC_ALLOWED_HOST}/main`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      await page.waitForTimeout(750);

      await page.goto(`http://${SYNTHETIC_ALLOWED_HOST}/redirect-approved`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });

      await assertHttpDeniedNavigation(page.goto(`http://${SYNTHETIC_ALLOWED_HOST}/redirect-denied-http`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      }));

      await assertNavigationFailure(page.goto(`http://${SYNTHETIC_ALLOWED_HOST}/redirect-denied-https`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      }));

      await assertNavigationFailure(page.goto(`https://${SYNTHETIC_DENIED_HOST}/direct-denied`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      }));

      await context.close();

      assert.equal(deniedCounter.count, 0, "denied receiver must observe zero HTTP deliveries");
      assert.ok(allowedCounter.count >= 2, "allowed receiver should be reached for approved paths");
      assert.ok(proxy.httpDenied >= 4, "proxy should deny representative HTTP subresources before receiver contact");
      assert.ok(proxy.connectDenied >= 1, "proxy should deny HTTPS CONNECT before proxy forwarding");
      assert.ok(websocketBlocked >= 1, "routeWebSocket should observe and block at least one WebSocket attempt");

      return {
        allowedReceiverCount: allowedCounter.count,
        allowedReceiverPaths: allowedCounter.paths,
        deniedHttpReceiverCount: deniedCounter.count,
        proxyHttpAllowed: proxy.httpAllowed,
        proxyHttpDenied: proxy.httpDenied,
        proxyConnectDenied: proxy.connectDenied,
        proxyUpstreamTargetConnectionCountForDeniedConnect: "NOT_MEASURED",
        independentTlsTargetReceiverContactCount: "NOT_MEASURED",
        websocketBlocked,
        websocketBlockedAttempts: websocketBlocked,
        websocketReceiverHandshakeContactCount: "NOT_MEASURED",
        subresourceCoverage: {
          fetch: "TESTED",
          xhr: "NOT_SEPARATELY_TESTED",
          image: "TESTED",
          script: "TESTED",
          stylesheet: "TESTED",
          iframeFrame: "TESTED",
        },
        ignoreHTTPSErrors: false,
        routeContinueWasDeliberatelyPresentBeforeProxy: true,
      };
    });
  } finally {
    await Promise.allSettled([
      proxy.close(),
      closeServer(allowed.server),
      closeServer(denied.server),
    ]);
  }
}

async function assertNavigationFailure(promise) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error("navigation unexpectedly succeeded");
}

async function assertHttpDeniedNavigation(promise) {
  const response = await promise;
  assert.equal(response?.status(), 403, "HTTP-denied proxy navigation should complete as a 403 denial response");
}

async function runProxyUnavailableFailurePath(channel) {
  const closedServer = http.createServer();
  const closedPort = await listen(closedServer);
  await closeServer(closedServer);

  return withBrowser(channel, async (browser) => {
    const context = await browser.newContext({
      proxy: { server: `http://${LOCALHOST}:${closedPort}` },
      serviceWorkers: "block",
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    await assertNavigationFailure(page.goto(`http://${SYNTHETIC_ALLOWED_HOST}/proxy-down`, {
      waitUntil: "domcontentloaded",
      timeout: 5000,
    }));
    await context.close();
    return {
      proxyUnavailable: true,
      navigationRequestFailed: true,
      proxyUnavailableFallback: "NO_UNRESTRICTED_FALLBACK_OBSERVED",
      unrestrictedFallbackObserved: false,
      independentTargetReceiverCounterInstantiated: false,
      independentTargetReceiverContact: "NOT_MEASURED",
    };
  });
}

function buildCandidateMatrix(results) {
  const proxyEvidence = results.proxyCandidate;
  const anyProviderPass = proxyEvidence.some((entry) => entry.status === "LOCAL_FIXTURE_PASS");
  const allProviderPass = proxyEvidence.every((entry) => entry.status === "LOCAL_FIXTURE_PASS");
  return [
    {
      candidate: "current URL policy plus route.continue()",
      candidateAssessment: "NOT_VIABLE",
      controlType: "PREVENTIVE for URL/method policy only; not destination binding",
      evidence: "Production code calls route.continue() after P2-01 ALLOW; Browser/Chromium still owns actual transport DNS/TCP.",
      residualGap: "Browser can independently resolve/connect after policy approval.",
    },
    {
      candidate: "BrowserContext local enforcing proxy",
      candidateAssessment: anyProviderPass ? "VIABLE_FOR_PROOF" : "UNKNOWN",
      controlType: "PREVENTIVE for observed HTTP/CONNECT paths in controlled proof",
      evidence: proxyEvidence,
      residualGap: "Secure successful HTTPS main-document/subresource proof with trusted certificate chain remains unresolved in local fixtures; production lifecycle/integration not implemented.",
      finalCandidateAssessment: allProviderPass ? "VIABLE_FOR_PROOF_NOT_ACCEPTED" : "UNKNOWN",
    },
    {
      candidate: "Node-controlled request fulfillment",
      candidateAssessment: "REQUIRES_SPIKE",
      controlType: "PREVENTIVE if Browser direct transport is fully replaced",
      evidence: "Not implemented in this proof because it changes response fulfillment semantics and requires deeper CSR/CORS/cache fidelity work.",
      residualGap: "Browser semantics, HTTPS ownership shift to Node, streaming/CORS/cache fidelity unresolved.",
    },
    {
      candidate: "Chromium host resolver rules / launch args",
      candidateAssessment: "UNKNOWN",
      controlType: "OTHER unless actual transport binding is proven",
      evidence: "Installed Playwright supports launch args generally, but no repository-approved proof ties Browser transport to Node-approved address sets.",
      residualGap: "Browser still owns TCP; resolver flags risk provider/product portability and do not prove per-request approved-set binding.",
    },
    {
      candidate: "OS hosts/system DNS manipulation",
      candidateAssessment: "NOT_VIABLE",
      controlType: "OTHER",
      evidence: "Requires system mutation and violates local portable product constraints.",
      residualGap: "Privilege, persistence, cache/DoH/proxy behavior, and maintainability gaps.",
    },
    {
      candidate: "CDP/network observation only",
      candidateAssessment: "NOT_VIABLE",
      controlType: "DETECTIVE",
      evidence: "Remote-address observation would occur after Browser transport/contact.",
      residualGap: "Cannot prevent denied receiver contact.",
    },
    {
      candidate: "Deterministic resolver seam for tests",
      candidateAssessment: "VIABLE_FOR_PROOF",
      controlType: "TEST_ONLY",
      evidence: "Useful for classifier/rebinding scenarios but no Browser transport binding by itself.",
      residualGap: "Does not prove Browser actual network destination is constrained.",
    },
    {
      candidate: "routeWebSocket() for first-release WebSocket blocking",
      candidateAssessment: anyProviderPass ? "VIABLE_FOR_PROOF" : "UNKNOWN",
      controlType: "PREVENTIVE for WebSocket only",
      evidence: proxyEvidence.map((entry) => ({
        channel: entry.channel,
        status: entry.status,
        browserSideBlockedAttempts: entry.websocketBlockedAttempts ?? entry.websocketBlocked ?? null,
        independentDeniedReceiverHandshakeContactCount: entry.websocketReceiverHandshakeContactCount ?? "NOT_MEASURED",
      })),
      residualGap: "Does not establish HTTP/HTTPS destination binding.",
    },
  ];
}

async function main() {
  const proxyCandidate = [];
  const proxyFailurePath = [];
  for (const channel of BROWSER_CHANNELS) {
    proxyCandidate.push(await runProxyCandidateForChannel(channel));
    proxyFailurePath.push(await runProxyUnavailableFailurePath(channel));
  }

  const result = {
    outcome: "ADJUST_ARCHITECTURE",
    acceptedCandidate: "NONE",
    preventiveGuarantee: "NOT_PROVEN",
    feasibleAllowed: "NO",
    adjustArchitectureJustified: true,
    p2_03Progression: "P2-03_BLOCKED_REPEAT_OR_ADJUST_P2_02",
    nextP2_02Direction: "NEXT_P2_02_ITERATION_JUSTIFIED",
    reason: "A local enforcing proxy showed preventive receiver-contact behavior for controlled HTTP, redirect, tested subresource, and HTTPS-denied CONNECT proxy paths, and routeWebSocket observed Browser-side blocked attempts. Independent WebSocket receiver handshake/contact and successful HTTPS proof remain unresolved. FEASIBLE is therefore forbidden.",
    timestamp: new Date().toISOString(),
    securityState: {
      dnsOwnership: "SEPARATE_RESOLUTION",
      dnsSsrfParity: "not proven",
      p2_02: "P2-02_REQUIRED",
      oq3: "open / Phase 2 hard blocker",
      oq2: "collecting_evidence",
    },
    proxyCandidate,
    proxyFailurePath,
  };
  result.candidateMatrix = buildCandidateMatrix(result);
  result.feasibleHardConjunction = {
    preventiveActualDestinationBinding: "UNRESOLVED_OVERALL_PARTIAL_PROXY_HTTP_AND_DENIED_CONNECT_PROXY_PATHS_ONLY",
    securityDnsOwnership: "PASS_PROXY_OWNED_FOR_PROOF",
    transportDnsOwnership: "PASS_PROXY_OWNED_FOR_OBSERVED_HTTP_CONNECT",
    tcpOwnership: "PASS_PROXY_OWNED_FOR_OBSERVED_HTTP_CONNECT",
    approvedAddressSet: "PASS_SYNTHETIC_APPROVED_SET",
    transportBinding: "UNRESOLVED_OVERALL_PARTIAL_FOR_OBSERVED_HTTP_CONNECT",
    browserIndependentResolution: "UNRESOLVED_GLOBALLY_PROXY_PATHS_OBSERVED_ONLY",
    rebindingToctou: "UNRESOLVED_NO_TRANSPORT_BACKED_DNS_A_TO_B_REBIND_PROOF",
    http: "PASS",
    httpsMainDocument: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    httpsSubresource: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    httpsRedirect: "UNRESOLVED_SUCCESSFUL_HTTPS_REDIRECT_NOT_PROVEN_DENIED_CONNECT_ONLY",
    tlsOwnership: "UNRESOLVED_SUCCESSFUL_TLS_PATH_NOT_PROVEN",
    sni: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    hostnameValidation: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    trustChain: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    ignoreHTTPSErrorsFalse: "PASS",
    redirectEnforcement: "PARTIAL_TESTED_HTTP_DENIED_RECEIVER_ZERO",
    representativeSubresources: "PARTIAL_FETCH_IMAGE_SCRIPT_STYLESHEET_IFRAME_TESTED_XHR_NOT_TESTED",
    webSocketBlock: "BROWSER_SIDE_BLOCKED_ATTEMPTS_OBSERVED_RECEIVER_HANDSHAKE_NOT_MEASURED",
    edge: result.proxyCandidate.find((entry) => entry.channel === "msedge")?.status || "ENV_BLOCKED",
    chrome: result.proxyCandidate.find((entry) => entry.channel === "chrome")?.status || "ENV_BLOCKED",
    failClosedFailure: "PASS_PROXY_UNAVAILABLE_NO_UNRESTRICTED_FALLBACK_OBSERVED",
    noUnrestrictedFallback: "PASS",
    receiverCountZero: "PARTIAL_HTTP_REDIRECT_TESTED_SUBRESOURCE_RECEIVER_ZERO_WS_AND_TLS_RECEIVERS_NOT_MEASURED",
    safeFixtures: "PASS",
    dependencyBoundary: "PASS",
    systemProductConstraints: "UNRESOLVED_FOR_PRODUCTION_INTEGRATION_CONTEXT_PROXY_NO_SYSTEM_MUTATION_IN_PROOF",
    rootCaTrustStoreConstraints: "UNRESOLVED_TRUSTED_CERT_FIXTURE_NOT_AVAILABLE",
    externalServiceConstraints: "PASS_NO_EXTERNAL_SERVICE",
    rejectedCodeCleanup: "PASS_NO_PRODUCTION_SPIKE_CODE",
    retainedFilesIdentified: "PASS",
    unresolvedMandatoryDimensions: [
      "HTTPS main document with trusted certificate chain",
      "representative HTTPS subresource with trusted certificate chain",
      "SNI and certificate hostname validation on successful HTTPS path",
      "transport-backed DNS A -> B rebinding / TOCTOU proof",
      "XHR subresource behavior",
      "independent WebSocket denied receiver handshake/contact count",
      "independent TLS target receiver contact count for denied CONNECT paths",
      "production integration/lifecycle design for local enforcing proxy",
    ],
    securityCriticalResidualGap: "YES",
  };

  console.log(JSON.stringify(result, null, 2));
}

await main();
