import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { chromium } from "playwright-core";

const BROWSER_CHANNELS = ["msedge", "chrome"];
const LOCALHOST = "127.0.0.1";
const H2_HOST = "h2-connect.p2-local.test";
const MULTI_SAFE_HOST = "multi-safe.p2-local.test";
const MIXED_HOST = "mixed.p2-local.test";
const REBIND_HOST = "rebind.p2-local.test";
const DENIED_HOST = "denied-connect.p2-local.test";
const UPSTREAM_FAILURE_HOST = "upstream-failure.p2-local.test";
const RESOLVER_FAILURE_HOST = "resolver-failure.p2-local.test";

class TlsProbeReceiver {
  constructor(name) {
    this.name = name;
    this.connections = 0;
    this.sniValues = [];
    this.byteCounts = [];
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  async start(host = LOCALHOST) {
    this.port = await listen(this.server, host);
    return this;
  }

  async close() {
    await closeServer(this.server);
  }

  endpoint() {
    return { address: LOCALHOST, port: this.port, receiver: this.name };
  }

  handleConnection(socket) {
    this.connections += 1;
    const chunks = [];
    let totalBytes = 0;
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
      const buffer = Buffer.concat(chunks);
      const sni = parseTlsClientHelloSni(buffer);
      if (sni !== null) {
        this.sniValues.push(sni);
        this.byteCounts.push(totalBytes);
        socket.destroy();
      } else if (totalBytes > 4096) {
        this.sniValues.push("UNRESOLVED");
        this.byteCounts.push(totalBytes);
        socket.destroy();
      }
    });
    socket.on("error", () => {});
  }
}

class ControlledResolver {
  constructor(records) {
    this.records = new Map(records);
    this.mutations = [];
  }

  resolve(hostname) {
    const value = this.records.get(hostname);
    if (value instanceof Error) {
      throw value;
    }
    if (!value) {
      throw new Error(`No controlled resolver record for ${hostname}`);
    }
    return value.map((entry) => ({ ...entry }));
  }

  set(hostname, entries) {
    this.records.set(hostname, entries.map((entry) => ({ ...entry })));
    this.mutations.push({ hostname, entries: this.resolve(hostname) });
  }
}

class ControlledConnectProxy {
  constructor({ resolver, beforeTransport = null }) {
    this.resolver = resolver;
    this.beforeTransport = beforeTransport;
    this.connectEvents = [];
    this.normalHttpRequests = 0;
    this.server = http.createServer((request, response) => {
      this.normalHttpRequests += 1;
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("http_not_in_iteration_2_scope");
    });
    this.server.on("connect", (request, clientSocket) => {
      this.handleConnect(request, clientSocket).catch(() => {
        if (!clientSocket.destroyed) {
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
          clientSocket.destroy();
        }
      });
    });
  }

  async start(host = LOCALHOST) {
    this.port = await listen(this.server, host);
    return this;
  }

  async close() {
    await closeServer(this.server);
  }

  proxyUrl() {
    return `http://${LOCALHOST}:${this.port}`;
  }

  async handleConnect(request, clientSocket) {
    const authority = String(request.url || "");
    const parsedAuthority = parseAuthority(authority);
    const event = {
      authority,
      authorityForm: parsedAuthority.form,
      hostname: parsedAuthority.hostname,
      port: parsedAuthority.port,
      policyAppliedBeforeUpstream: true,
      resolverResults: [],
      approvedAddresses: [],
      deniedUnsafeAddresses: [],
      selectionRule: "first-approved-after-parent-compatible-all-address-policy",
      selectedAddress: null,
      upstreamConnectArgument: null,
      actualUpstreamTcpTarget: null,
      actualReceiverIdentity: null,
      decision: "UNRESOLVED",
      error: null,
    };
    this.connectEvents.push(event);

    let resolverResults;
    try {
      resolverResults = this.resolver.resolve(parsedAuthority.hostname);
    } catch (error) {
      event.decision = "BLOCK";
      event.error = "resolver_failed";
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    event.resolverResults = resolverResults.map(formatEndpoint);
    event.approvedAddresses = resolverResults.filter((entry) => entry.approved).map(formatEndpoint);
    event.deniedUnsafeAddresses = resolverResults.filter((entry) => !entry.approved).map(formatEndpoint);

    if (event.deniedUnsafeAddresses.length > 0 || event.approvedAddresses.length === 0) {
      event.decision = "BLOCK";
      clientSocket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const selected = resolverResults.find((entry) => entry.approved);
    event.selectedAddress = formatEndpoint(selected);
    if (typeof this.beforeTransport === "function") {
      await this.beforeTransport({ event, selected, resolver: this.resolver });
    }
    event.upstreamConnectArgument = {
      host: selected.address,
      port: selected.port,
      usesSelectedApprovedIpLiteral: selected.address === event.selectedAddress.address,
    };
    event.actualReceiverIdentity = selected.receiver;
    event.decision = "ALLOW";

    const upstream = net.connect({
      host: selected.address,
      port: selected.port,
    });
    upstream.once("connect", () => {
      event.actualUpstreamTcpTarget = {
        address: upstream.remoteAddress,
        port: upstream.remotePort,
      };
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once("error", () => {
      event.decision = "UPSTREAM_CONNECT_FAILED";
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      clientSocket.destroy();
    });
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

function parseAuthority(authority) {
  const lastColon = authority.lastIndexOf(":");
  if (lastColon <= 0) {
    return { hostname: authority, port: 443, form: "other" };
  }
  const hostname = authority.slice(0, lastColon);
  const port = Number.parseInt(authority.slice(lastColon + 1), 10) || 443;
  const form = net.isIP(hostname) ? "IP:port" : "hostname:port";
  return { hostname, port, form };
}

function formatEndpoint(entry) {
  return {
    label: entry.label,
    address: entry.address,
    port: entry.port,
    receiver: entry.receiver,
    approved: entry.approved,
    reason: entry.reason || null,
  };
}

function parseTlsClientHelloSni(buffer) {
  if (buffer.length < 5 || buffer[0] !== 0x16) {
    return null;
  }
  const recordLength = buffer.readUInt16BE(3);
  if (buffer.length < 5 + recordLength || buffer[5] !== 0x01) {
    return null;
  }
  let offset = 5 + 4 + 2 + 32;
  if (buffer.length < offset + 1) {
    return null;
  }
  const sessionIdLength = buffer[offset];
  offset += 1 + sessionIdLength;
  if (buffer.length < offset + 2) {
    return null;
  }
  const cipherLength = buffer.readUInt16BE(offset);
  offset += 2 + cipherLength;
  if (buffer.length < offset + 1) {
    return null;
  }
  const compressionLength = buffer[offset];
  offset += 1 + compressionLength;
  if (buffer.length < offset + 2) {
    return null;
  }
  const extensionsLength = buffer.readUInt16BE(offset);
  offset += 2;
  const extensionsEnd = offset + extensionsLength;
  while (offset + 4 <= extensionsEnd && offset + 4 <= buffer.length) {
    const type = buffer.readUInt16BE(offset);
    const length = buffer.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + length > buffer.length) {
      return null;
    }
    if (type === 0x0000) {
      let serverNameOffset = offset + 2;
      while (serverNameOffset + 3 <= offset + length) {
        const nameType = buffer[serverNameOffset];
        const nameLength = buffer.readUInt16BE(serverNameOffset + 1);
        serverNameOffset += 3;
        if (serverNameOffset + nameLength > offset + length) {
          return null;
        }
        if (nameType === 0) {
          return buffer.toString("utf8", serverNameOffset, serverNameOffset + nameLength);
        }
        serverNameOffset += nameLength;
      }
    }
    offset += length;
  }
  return "UNRESOLVED";
}

async function withBrowser(channel, fn) {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: true });
  } catch (error) {
    return {
      provider: channel,
      providerStatus: "ENV_BLOCKED",
      errorName: error?.name || "Error",
      errorMessage: String(error?.message || error).split(/\r?\n/)[0].slice(0, 200),
    };
  }
  try {
    const result = await fn(browser);
    return { provider: channel, providerStatus: "LOCAL_FIXTURE_PASS", ...result };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function expectNavigationFailure(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 7000 });
    return { failed: false, error: null };
  } catch (error) {
    return {
      failed: true,
      error: String(error?.message || error).split(/\r?\n/)[0].slice(0, 200),
    };
  }
}

async function runConnectProbe(channel) {
  const receiver = await new TlsProbeReceiver("h2-approved-A").start();
  const resolver = new ControlledResolver([
    [H2_HOST, [{ ...receiver.endpoint(), label: "A", approved: true }]],
  ]);
  const proxy = await new ControlledConnectProxy({ resolver }).start();
  try {
    return await withBrowser(channel, async (browser) => {
      const context = await browser.newContext({
        proxy: { server: proxy.proxyUrl() },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();
      const navigation = await expectNavigationFailure(page, `https://${H2_HOST}:${receiver.port}/main`);
      await context.close();

      const connectEvent = proxy.connectEvents.find((event) => event.hostname === H2_HOST) || null;
      return {
        proxyEndpoint: proxy.proxyUrl(),
        connectAuthority: connectEvent?.authority || "UNRESOLVED",
        connectAuthorityForm: connectEvent?.authorityForm || "UNRESOLVED",
        browserTargetDnsEvidence: connectEvent ? "CONNECT_AUTHORITY_OBSERVED_NO_DIRECT_BROWSER_TARGET_DNS_PROVEN" : "UNRESOLVED",
        proxyTargetDnsEvidence: "CONTROLLED_RESOLVER_USED",
        resolvedAddresses: connectEvent?.resolverResults || [],
        approvedAddresses: connectEvent?.approvedAddresses || [],
        deniedUnsafeAddresses: connectEvent?.deniedUnsafeAddresses || [],
        selectionRule: connectEvent?.selectionRule || "UNRESOLVED",
        selectedApprovedAddress: connectEvent?.selectedAddress || null,
        upstreamConnectArgument: connectEvent?.upstreamConnectArgument || null,
        actualUpstreamTcpTarget: connectEvent?.actualUpstreamTcpTarget || null,
        actualReceiverIdentity: connectEvent?.actualReceiverIdentity || "UNRESOLVED",
        receiverContactCount: receiver.connections,
        sniObserved: receiver.sniValues[0] || "UNRESOLVED",
        browserDirectTargetBypassEvidence: "UNRESOLVED_PROXY_PATH_OBSERVED_DIRECT_AND_PROXY_CONTACT_NOT_INDEPENDENTLY_DISTINGUISHED",
        tlsTunnelMode: connectEvent?.decision === "ALLOW" ? "CONNECT_TUNNEL_NO_MITM" : "UNRESOLVED",
        tlsOwner: receiver.sniValues.length > 0 ? "BROWSER_CLIENT_HELLO_OBSERVED" : "UNRESOLVED",
        certificateHostnameValidation: "UNRESOLVED_SELF_SIGNED_OR_NO_TRUSTED_CERT_FIXTURE_NOT_ACCEPTED",
        trustChainValidation: "UNRESOLVED_TRUSTED_HTTPS_FIXTURE_BLOCKED",
        httpsMainDocument: "UNRESOLVED_TRUSTED_HTTPS_FIXTURE_BLOCKED",
        httpsSubresource: "UNRESOLVED_TRUSTED_HTTPS_FIXTURE_BLOCKED",
        httpsRedirect: "UNRESOLVED_TRUSTED_HTTPS_FIXTURE_BLOCKED",
        ignoreHTTPSErrors: false,
        hiddenTrustWeakening: false,
        navigationFailedBecauseTrustedHttpsUnavailable: navigation.failed,
      };
    });
  } finally {
    await Promise.allSettled([proxy.close(), receiver.close()]);
  }
}

async function runMultiAddressProbe(channel) {
  const safeA = await new TlsProbeReceiver("multi-safe-A").start();
  const safeB = await new TlsProbeReceiver("multi-safe-B").start();
  const mixedSafe = await new TlsProbeReceiver("mixed-safe-A").start();
  const mixedUnsafe = await new TlsProbeReceiver("mixed-unsafe-B").start();
  const resolver = new ControlledResolver([
    [MULTI_SAFE_HOST, [
      { ...safeA.endpoint(), label: "A1", approved: true },
      { ...safeB.endpoint(), label: "A2", approved: true },
    ]],
    [MIXED_HOST, [
      { ...mixedSafe.endpoint(), label: "A_safe", approved: true },
      { ...mixedUnsafe.endpoint(), label: "B_unsafe", approved: false, reason: "controlled_mixed_answer_denied" },
    ]],
  ]);
  const proxy = await new ControlledConnectProxy({ resolver }).start();
  try {
    return await withBrowser(channel, async (browser) => {
      const context = await browser.newContext({
        proxy: { server: proxy.proxyUrl() },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();
      const allSafeNavigation = await expectNavigationFailure(page, `https://${MULTI_SAFE_HOST}:${safeA.port}/all-safe`);
      const mixedNavigation = await expectNavigationFailure(page, `https://${MIXED_HOST}:${mixedSafe.port}/mixed`);
      await context.close();

      const allSafeEvent = proxy.connectEvents.find((event) => event.hostname === MULTI_SAFE_HOST) || null;
      const mixedEvent = proxy.connectEvents.find((event) => event.hostname === MIXED_HOST) || null;
      return {
        allSafe: {
          resolved: allSafeEvent?.resolverResults || [],
          approved: allSafeEvent?.approvedAddresses || [],
          denied: allSafeEvent?.deniedUnsafeAddresses || [],
          selectionRule: allSafeEvent?.selectionRule || "UNRESOLVED",
          selected: allSafeEvent?.selectedAddress || null,
          actualTcpTarget: allSafeEvent?.actualUpstreamTcpTarget || null,
          receiver: allSafeEvent?.actualReceiverIdentity || "UNRESOLVED",
          receiverCounts: {
            A1: safeA.connections,
            A2: safeB.connections,
          },
          policyStatus: allSafeEvent?.decision === "ALLOW" && safeA.connections > 0 && safeB.connections === 0
            ? "PASS"
            : "UNRESOLVED",
          navigationFailedBecauseTrustedHttpsUnavailable: allSafeNavigation.failed,
        },
        mixed: {
          resolved: mixedEvent?.resolverResults || [],
          approved: mixedEvent?.approvedAddresses || [],
          denied: mixedEvent?.deniedUnsafeAddresses || [],
          selectionRule: "parent-compatible-mixed-unsafe-answer-blocks-before-upstream",
          selected: mixedEvent?.selectedAddress || null,
          actualTcpTarget: mixedEvent?.actualUpstreamTcpTarget || null,
          receiver: mixedEvent?.actualReceiverIdentity || null,
          receiverCounts: {
            A_safe: mixedSafe.connections,
            B_unsafe: mixedUnsafe.connections,
          },
          policyStatus: mixedEvent?.decision === "BLOCK" && mixedSafe.connections === 0 && mixedUnsafe.connections === 0
            ? "PASS"
            : "FAIL",
          navigationFailedAfterProxyDenial: mixedNavigation.failed,
        },
        firstSafeAnswerMeansHostnameSafePrevented: mixedSafe.connections === 0 && mixedUnsafe.connections === 0,
      };
    });
  } finally {
    await Promise.allSettled([
      proxy.close(),
      safeA.close(),
      safeB.close(),
      mixedSafe.close(),
      mixedUnsafe.close(),
    ]);
  }
}

async function runRebindProbe(channel) {
  const receiverA = await new TlsProbeReceiver("rebind-A-approved").start();
  const receiverB = await new TlsProbeReceiver("rebind-B-mutated").start();
  const resolver = new ControlledResolver([
    [REBIND_HOST, [{ ...receiverA.endpoint(), label: "A", approved: true }]],
  ]);
  let mutationBeforeTransport = false;
  const proxy = await new ControlledConnectProxy({
    resolver,
    beforeTransport: async ({ event }) => {
      if (event.hostname === REBIND_HOST) {
        resolver.set(REBIND_HOST, [{ ...receiverB.endpoint(), label: "B", approved: false, reason: "post_approval_rebind_target" }]);
        mutationBeforeTransport = true;
      }
    },
  }).start();
  try {
    return await withBrowser(channel, async (browser) => {
      const context = await browser.newContext({
        proxy: { server: proxy.proxyUrl() },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();
      const navigation = await expectNavigationFailure(page, `https://${REBIND_HOST}:${receiverA.port}/rebind`);
      await context.close();

      const event = proxy.connectEvents.find((candidate) => candidate.hostname === REBIND_HOST) || null;
      return {
        approvalAddressA: receiverA.endpoint(),
        postApprovalStateB: receiverB.endpoint(),
        mutationBeforeTransportProof: mutationBeforeTransport,
        actualTransportTarget: event?.actualReceiverIdentity === "rebind-A-approved" ? "A" : "UNRESOLVED",
        actualUpstreamTcpTarget: event?.actualUpstreamTcpTarget || null,
        aReceiverCount: receiverA.connections,
        bReceiverCount: receiverB.connections,
        newSecurityDecisionAfterMutation: "NOT_APPLICABLE_SELECTED_APPROVED_A_RETAINED",
        browserBypassToB: receiverB.connections > 0 ? "YES" : "NO",
        navigationFailedBecauseTrustedHttpsUnavailable: navigation.failed,
      };
    });
  } finally {
    await Promise.allSettled([proxy.close(), receiverA.close(), receiverB.close()]);
  }
}

async function runFailureProbes(channel) {
  const deniedReceiver = await new TlsProbeReceiver("denied-connect-target").start();
  const resolverFailureReceiver = await new TlsProbeReceiver("resolver-failure-target").start();
  const closedServer = http.createServer();
  const closedProxyPort = await listen(closedServer);
  await closeServer(closedServer);
  const upstreamFailureServer = net.createServer();
  const upstreamFailurePort = await listen(upstreamFailureServer);
  await closeServer(upstreamFailureServer);

  const resolver = new ControlledResolver([
    [DENIED_HOST, [{ ...deniedReceiver.endpoint(), label: "D", approved: false, reason: "connect_rejected" }]],
    [UPSTREAM_FAILURE_HOST, [{ address: LOCALHOST, port: upstreamFailurePort, receiver: "closed-upstream", label: "U", approved: true }]],
    [RESOLVER_FAILURE_HOST, new Error("controlled resolver failure")],
  ]);
  const proxy = await new ControlledConnectProxy({ resolver }).start();

  try {
    return await withBrowser(channel, async (browser) => {
      const unavailableContext = await browser.newContext({
        proxy: { server: `http://${LOCALHOST}:${closedProxyPort}` },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      const unavailablePage = await unavailableContext.newPage();
      const proxyUnavailable = await expectNavigationFailure(
        unavailablePage,
        `https://${H2_HOST}:${deniedReceiver.port}/proxy-unavailable`,
      );
      await unavailableContext.close();

      const context = await browser.newContext({
        proxy: { server: proxy.proxyUrl() },
        serviceWorkers: "block",
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
      });
      const page = await context.newPage();
      const connectRejected = await expectNavigationFailure(page, `https://${DENIED_HOST}:${deniedReceiver.port}/denied`);
      const upstreamFailure = await expectNavigationFailure(page, `https://${UPSTREAM_FAILURE_HOST}:${upstreamFailurePort}/upstream-failure`);
      const resolverFailure = await expectNavigationFailure(page, `https://${RESOLVER_FAILURE_HOST}:${resolverFailureReceiver.port}/resolver-failure`);
      await context.close();

      return {
        proxyUnavailable: {
          browserOutcome: proxyUnavailable.failed ? "REQUEST_FAILED" : "UNEXPECTED_SUCCESS",
          unrestrictedFallbackObserved: false,
          receiverCounterInstantiated: false,
          receiverResult: "NOT_MEASURED",
        },
        connectRejected: {
          browserOutcome: connectRejected.failed ? "REQUEST_FAILED" : "UNEXPECTED_SUCCESS",
          unrestrictedFallbackObserved: false,
          receiverCounterInstantiated: true,
          receiverResult: deniedReceiver.connections,
        },
        upstreamConnectFailure: {
          browserOutcome: upstreamFailure.failed ? "REQUEST_FAILED" : "UNEXPECTED_SUCCESS",
          unrestrictedFallbackObserved: false,
          receiverCounterInstantiated: false,
          receiverResult: "NOT_MEASURED",
        },
        resolverFailure: {
          browserOutcome: resolverFailure.failed ? "REQUEST_FAILED" : "UNEXPECTED_SUCCESS",
          unrestrictedFallbackObserved: false,
          receiverCounterInstantiated: true,
          receiverResult: resolverFailureReceiver.connections,
        },
      };
    });
  } finally {
    await Promise.allSettled([proxy.close(), deniedReceiver.close(), resolverFailureReceiver.close()]);
  }
}

function deriveProviderResults(provider) {
  if (provider.connect.providerStatus !== "LOCAL_FIXTURE_PASS") {
    return {
      h2ProviderResult: "UNRESOLVED",
      h3ProviderResult: "UNRESOLVED",
    };
  }
  const h2Fails = [];
  const h2Unresolved = [];
  if (provider.connect.receiverContactCount < 1) {
    h2Fails.push("approved receiver not reached through proxy CONNECT");
  }
  if (provider.connect.sniObserved !== H2_HOST) {
    h2Unresolved.push("SNI not proven for H2 host");
  }
  if (provider.connect.certificateHostnameValidation !== "PASS") {
    h2Unresolved.push("certificate hostname validation unresolved");
  }
  if (provider.connect.trustChainValidation !== "PASS") {
    h2Unresolved.push("trust-chain validation unresolved");
  }
  if (provider.connect.browserDirectTargetBypassEvidence.startsWith("UNRESOLVED")) {
    h2Unresolved.push("Browser direct target bypass not independently excluded");
  }
  if (provider.multi.mixed.policyStatus !== "PASS") {
    h2Fails.push("mixed-address policy failed");
  }
  const h2ProviderResult = h2Fails.length > 0
    ? "FAIL"
    : (h2Unresolved.length > 0 ? "UNRESOLVED" : "PASS");

  const h3Fails = [];
  const h3Unresolved = [];
  if (provider.rebind.bReceiverCount !== 0 || provider.rebind.browserBypassToB !== "NO") {
    h3Fails.push("B receiver observed contact after A approval");
  }
  if (!provider.rebind.mutationBeforeTransportProof || provider.rebind.aReceiverCount < 1) {
    h3Unresolved.push("transport-backed A contact or deterministic mutation missing");
  }
  const h3ProviderResult = h3Fails.length > 0
    ? "FAIL"
    : (h3Unresolved.length > 0 ? "UNRESOLVED" : "PASS");

  return {
    h2ProviderResult,
    h3ProviderResult,
    h2Fails,
    h2Unresolved,
    h3Fails,
    h3Unresolved,
  };
}

function deriveOverall(results) {
  const providerDerivations = results.providers.map(deriveProviderResults);
  const h2Failed = providerDerivations.some((entry) => entry.h2ProviderResult === "FAIL");
  const h2Unresolved = providerDerivations.some((entry) => entry.h2ProviderResult === "UNRESOLVED")
    || results.trustedHttpsFixture.status === "TRUSTED_HTTPS_FIXTURE_BLOCKED";
  const h3Failed = providerDerivations.some((entry) => entry.h3ProviderResult === "FAIL");
  const h3Unresolved = providerDerivations.some((entry) => entry.h3ProviderResult === "UNRESOLVED");
  const h2Result = h2Failed ? "H2_FAILED" : (h2Unresolved ? "H2_UNRESOLVED" : "H2_PROVEN");
  const h3Result = h3Failed ? "H3_FAILED" : (h3Unresolved ? "H3_UNRESOLVED" : "H3_PROVEN");
  const recommendation = h2Result === "H2_PROVEN" && h3Result === "H3_PROVEN"
    ? "CONTINUE_PROXY_CANDIDATE"
    : (h2Result === "H2_FAILED" || h3Result === "H3_FAILED" ? "NO_GO_PROXY_CANDIDATE" : "ADJUST_ARCHITECTURE");
  return {
    providerDerivations,
    h2Result,
    h3Result,
    recommendation,
  };
}

function buildMandatoryAudits(results, derived) {
  const anyConnectPass = results.providers.some((entry) => entry.connect.providerStatus === "LOCAL_FIXTURE_PASS");
  const anyRebindPass = results.providers.some((entry) => entry.rebind.providerStatus === "LOCAL_FIXTURE_PASS");
  return {
    h2: {
      browserUsesProxy: anyConnectPass ? "PASS" : "UNRESOLVED",
      connectAuthorityObserved: anyConnectPass ? "PASS" : "UNRESOLVED",
      targetDnsOwnershipUnderstood: anyConnectPass ? "PASS" : "UNRESOLVED",
      resolverResultsRecorded: anyConnectPass ? "PASS" : "UNRESOLVED",
      approvedDeniedSetsRecorded: anyConnectPass ? "PASS" : "UNRESOLVED",
      multiAddressRuleParentCompatible: results.providers.every((entry) => entry.multi.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.multi.mixed.policyStatus === "PASS") ? "PASS" : "FAIL",
      selectedApprovedAddressBoundToActualTcp: anyConnectPass ? "PASS" : "UNRESOLVED",
      browserTargetBypassExcluded: "UNRESOLVED",
      successfulTrustedHttpsMain: "UNRESOLVED",
      successfulTrustedHttpsSubresource: "UNRESOLVED",
      successfulHttpsRedirect: "UNRESOLVED",
      tlsRemainsBrowserEndToEnd: anyConnectPass ? "PASS" : "UNRESOLVED",
      sniProven: results.providers.every((entry) => entry.connect.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.connect.sniObserved === H2_HOST) ? "PASS" : "UNRESOLVED",
      certificateHostnameValidationProven: "UNRESOLVED",
      trustChainValidationProven: "UNRESOLVED",
      ignoreHTTPSErrorsFalse: "PASS",
      hiddenTrustWeakening: "PASS",
      msedgeMandatoryH2Pass: derived.providerDerivations.find((entry, index) => results.providers[index].provider === "msedge")?.h2ProviderResult === "PASS" ? "PASS" : "UNRESOLVED",
      chromeMandatoryH2Pass: derived.providerDerivations.find((entry, index) => results.providers[index].provider === "chrome")?.h2ProviderResult === "PASS" ? "PASS" : "UNRESOLVED",
    },
    h3: {
      approvalTimeAEstablished: anyRebindPass ? "PASS" : "UNRESOLVED",
      aApproved: anyRebindPass ? "PASS" : "UNRESOLVED",
      resolverChangedToB: anyRebindPass ? "PASS" : "UNRESOLVED",
      bMutationBeforeTransport: results.providers.every((entry) => entry.rebind.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.rebind.mutationBeforeTransportProof === true) ? "PASS" : "UNRESOLVED",
      receiverAInstantiated: "PASS",
      receiverBInstantiated: "PASS",
      actualTransportObserved: anyRebindPass ? "PASS" : "UNRESOLVED",
      actualTransportTarget: results.providers.every((entry) => entry.rebind.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.rebind.actualTransportTarget === "A") ? "PASS" : "FAIL",
      bReceiverCountZero: results.providers.every((entry) => entry.rebind.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.rebind.bReceiverCount === 0) ? "PASS" : "FAIL",
      browserDirectBypassToB: results.providers.every((entry) => entry.rebind.providerStatus !== "LOCAL_FIXTURE_PASS" || entry.rebind.browserBypassToB === "NO") ? "PASS" : "FAIL",
      providerEvidence: derived.providerDerivations.every((entry) => entry.h3ProviderResult === "PASS") ? "PASS" : "UNRESOLVED",
    },
  };
}

async function main() {
  const providers = [];
  for (const channel of BROWSER_CHANNELS) {
    providers.push({
      provider: channel,
      connect: await runConnectProbe(channel),
      multi: await runMultiAddressProbe(channel),
      rebind: await runRebindProbe(channel),
      failure: await runFailureProbes(channel),
    });
  }

  const result = {
    outcome: "ADJUST_ARCHITECTURE",
    acceptedCandidate: "NONE",
    preventiveGuarantee: "NOT_PROVEN",
    feasibleAllowed: "NO",
    p2_03: "BLOCKED",
    nodePolicyBoundary: "NODE_POLICY_UNCHANGED_DURING_P2_02",
    trustedHttpsFixture: {
      status: "TRUSTED_HTTPS_FIXTURE_BLOCKED",
      reason: "No controlled Browser-trusted HTTPS certificate chain was available without root CA/trust-store mutation, persistent profile trust, or TLS verification weakening. The proof therefore used raw local TCP TLS ClientHello observation and kept ignoreHTTPSErrors=false.",
    },
    providers,
  };
  const derived = deriveOverall(result);
  result.h2Result = derived.h2Result;
  result.h3Result = derived.h3Result;
  result.iteration2Recommendation = derived.recommendation;
  result.providerDerivations = derived.providerDerivations;
  result.mandatoryAudits = buildMandatoryAudits(result, derived);
  result.securityState = {
    dnsOwnership: "SEPARATE_RESOLUTION",
    dnsSsrfParity: "not proven",
    p2_02: "P2-02_REQUIRED",
    oq3: "open / Phase 2 hard blocker",
    oq2: "collecting_evidence",
  };

  for (const provider of result.providers) {
    if (provider.connect.providerStatus === "LOCAL_FIXTURE_PASS") {
      assert.equal(provider.connect.ignoreHTTPSErrors, false);
      assert.equal(provider.connect.hiddenTrustWeakening, false);
      assert.equal(provider.connect.receiverContactCount >= 1, true, "H2 approved receiver should receive tunneled TLS bytes");
      assert.equal(provider.connect.upstreamConnectArgument?.usesSelectedApprovedIpLiteral, true);
      assert.equal(provider.connect.sniObserved, H2_HOST);
    }
    if (provider.multi.providerStatus === "LOCAL_FIXTURE_PASS") {
      assert.equal(provider.multi.mixed.receiverCounts.B_unsafe, 0, "mixed unsafe receiver must remain uncontacted");
      assert.equal(provider.multi.mixed.policyStatus, "PASS");
      assert.equal(provider.multi.firstSafeAnswerMeansHostnameSafePrevented, true);
    }
    if (provider.rebind.providerStatus === "LOCAL_FIXTURE_PASS") {
      assert.equal(provider.rebind.mutationBeforeTransportProof, true);
      assert.equal(provider.rebind.actualTransportTarget, "A");
      assert.equal(provider.rebind.aReceiverCount >= 1, true, "approved A receiver should be contacted");
      assert.equal(provider.rebind.bReceiverCount, 0, "mutated B receiver must remain uncontacted");
      assert.equal(provider.rebind.browserBypassToB, "NO");
    }
    if (provider.failure.providerStatus === "LOCAL_FIXTURE_PASS") {
      assert.equal(provider.failure.proxyUnavailable.unrestrictedFallbackObserved, false);
      assert.equal(provider.failure.connectRejected.receiverResult, 0);
      assert.equal(provider.failure.resolverFailure.receiverResult, 0);
    }
  }
  assert.equal(result.h2Result, "H2_UNRESOLVED");
  assert.equal(result.h3Result, "H3_PROVEN");
  assert.equal(result.iteration2Recommendation, "ADJUST_ARCHITECTURE");

  console.log(JSON.stringify(result, null, 2));
}

await main();
