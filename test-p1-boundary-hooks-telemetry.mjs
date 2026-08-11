#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  DYNAMIC_RENDER_OUTCOME,
  DynamicRenderer,
} from "./dynamic-renderer.mjs";
import {
  LinkChecker,
  REPORT_SCHEMA_VERSION,
} from "./link-checker.mjs";
import {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
} from "./fixtures/dynamic-scan/fixtures.mjs";

function pathWithSearch(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

class FakeRequest {
  constructor({
    url,
    method = "GET",
    resourceType = "fetch",
    navigation = false,
    mainFrame = false,
  }) {
    this._url = url;
    this._method = method;
    this._resourceType = resourceType;
    this._navigation = navigation;
    this._frame = {
      parentFrame: () => mainFrame ? null : {},
    };
  }

  url() {
    return this._url;
  }

  method() {
    return this._method;
  }

  resourceType() {
    return this._resourceType;
  }

  isNavigationRequest() {
    return this._navigation;
  }

  frame() {
    return this._frame;
  }
}

class FakeRoute {
  constructor(request) {
    this._request = request;
    this.continued = false;
    this.aborted = false;
    this.abortCode = null;
  }

  request() {
    return this._request;
  }

  async continue() {
    this.continued = true;
  }

  async abort(code) {
    this.aborted = true;
    this.abortCode = code;
  }
}

class FakeWebSocketRoute {
  constructor(url) {
    this._url = url;
    this.closeCount = 0;
    this.closeOptions = null;
  }

  url() {
    return this._url;
  }

  async close(options) {
    this.closeCount += 1;
    this.closeOptions = options;
  }
}

class FakePage {
  constructor(url = "about:blank") {
    this._url = url;
    this.handlers = new Map();
    this.closeCount = 0;
  }

  url() {
    return this._url;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async emit(eventName, value) {
    for (const handler of this.handlers.get(eventName) || []) {
      await handler(value);
    }
  }

  async close() {
    this.closeCount += 1;
  }
}

class FakeContext {
  constructor() {
    this.handlers = new Map();
    this.routeHandler = null;
    this.webSocketHandler = null;
    this.pages = [];
    this.closeCount = 0;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  emit(eventName, value) {
    for (const handler of this.handlers.get(eventName) || []) {
      handler(value);
    }
  }

  async route(_url, handler) {
    this.routeHandler = handler;
  }

  async routeWebSocket(_url, handler) {
    this.webSocketHandler = handler;
  }

  async newPage() {
    const page = new FakePage("http://example.test/source");
    this.pages.push(page);
    this.emit("page", page);
    return page;
  }

  async close() {
    this.closeCount += 1;
  }

  async dispatchRequest(options) {
    const request = new FakeRequest(options);
    const route = new FakeRoute(request);
    await this.routeHandler(route, request);
    if (route.continued && options.terminal === "finished") {
      this.emit("requestfinished", request);
    }
    if (route.continued && options.terminal === "failed") {
      this.emit("requestfailed", request);
    }
    return { request, route };
  }

  async dispatchWebSocket(url) {
    const webSocketRoute = new FakeWebSocketRoute(url);
    await this.webSocketHandler(webSocketRoute);
    return webSocketRoute;
  }
}

class FakeBrowser {
  constructor() {
    this.contexts = [];
    this.closeCount = 0;
  }

  async newContext() {
    const context = new FakeContext();
    this.contexts.push(context);
    return context;
  }

  async close() {
    this.closeCount += 1;
  }
}

class FakeBrowserProvider {
  constructor(browser) {
    this.browser = browser;
    this.launchCount = 0;
  }

  async launchFirstAvailable() {
    this.launchCount += 1;
    return {
      ok: true,
      browser: "msedge",
      browserChannel: "msedge",
      browserInstance: this.browser,
      status: "available",
      launchOutcome: "available",
      getStatus: () => "available",
      close: async () => {
        await this.browser.close();
        return { ok: true };
      },
    };
  }
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxPages: 4,
    maxDepth: 0,
    concurrency: 2,
    perHostConcurrency: 2,
    preferGet: true,
    checkExternal: false,
    spaLinks: "strict",
    dynamicRender: true,
    renderTimeoutMs: 5000,
    renderSettleMinMs: 100,
    renderSettleIntervalMs: 50,
    renderSettleStableSamples: 3,
    renderSettleMaxMs: 1200,
    renderMaxPages: 4,
    reporter: {
      start: () => {},
      stop: () => {},
      pageStarted: () => {},
      pageQueued: () => {},
      pageLinksFound: () => {},
      externalSkipped: () => {},
      requestQueued: () => {},
      requestFinished: () => {},
    },
    ...options,
  });
}

async function runFixture(server, fixtureId, options = {}) {
  const startUrl = new URL(dynamicScanFixtures[fixtureId].path, server.origin).toString();
  const checker = makeChecker(startUrl, options);
  const report = await checker.run();
  return { checker, report, startUrl };
}

function renderResult(checker) {
  return checker.dynamicRenderResults[0] || null;
}

function assertReportSchemaUnchanged(report) {
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(REPORT_SCHEMA_VERSION, "1.3.0");
  assert.equal(report.checked.some((item) => Object.hasOwn(item, "discovery")), false);
  assert.equal(Object.hasOwn(report.summary, "dynamicRender"), false);
  assert.equal(report.checked.some((item) => Object.hasOwn(item, "renderEvidence")), false);
}

function inventoryItem(checker, url) {
  return checker.inventory.get(checker.getCanonicalKey(url)) || null;
}

function sourceTypes(item) {
  return [...new Set((item?.sources || []).map((source) => source.sourceType))].sort();
}

async function assertDeterministicTelemetryAccounting() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(browser);
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: provider,
    renderConcurrency: 2,
    trafficNow: createFakeClock(),
    evaluateUrlSecurity: async (url) => ({
      allowed: !url.includes("/blocked-security"),
      reason: url.includes("/blocked-security") ? "blocked_test_security" : null,
    }),
  });

  const result = await renderer.withPage(async ({ context }) => {
    const first = await context.dispatchRequest({
      url: "http://Example.test/document",
      resourceType: "document",
      navigation: true,
      mainFrame: true,
    });
    const second = await context.dispatchRequest({
      url: "http://example.test/image",
      resourceType: "image",
    });
    context.emit("requestfinished", first.request);
    context.emit("requestfinished", first.request);
    context.emit("requestfailed", second.request);

    const methodBlocked = await context.dispatchRequest({
      url: "http://example.test/post",
      method: "POST",
      resourceType: "fetch",
    });
    context.emit("requestfailed", methodBlocked.request);

    const securityBlocked = await context.dispatchRequest({
      url: "http://example.test/blocked-security",
      method: "GET",
      resourceType: "fetch",
    });

    const originBlocked = await context.dispatchRequest({
      url: "http://other.test/escape",
      method: "GET",
      resourceType: "document",
      navigation: true,
      mainFrame: true,
    });

    const webSocket = await context.dispatchWebSocket("ws://example.test/socket");

    assert.equal(methodBlocked.route.aborted, true);
    assert.equal(securityBlocked.route.aborted, true);
    assert.equal(originBlocked.route.aborted, true);
    assert.equal(webSocket.closeCount, 1);
    return { ok: true };
  }, {
    renderPage: "http://example.test/source",
    allowedOrigin: "http://example.test",
  });
  await renderer.close();

  const traffic = result.value.traffic;
  assert.equal(provider.launchCount, 1);
  assert.equal(traffic.requestsStarted, 5);
  assert.equal(traffic.requestsFinished, 1);
  assert.equal(traffic.requestsFailed, 4);
  assert.equal(traffic.methodBlockedRequests, 1);
  assert.equal(traffic.securityBlockedRequests, 1);
  assert.equal(traffic.mainFrameNavigationBlocked, 1);
  assert.equal(traffic.websocketBlockedRequests, 1);
  assert.equal(traffic.peakInflight, 2);
  assert.equal(traffic.peakInflightByHost["example.test"], 2);
  assert.equal(traffic.requestsByMethod.GET, 4);
  assert.equal(traffic.requestsByMethod.POST, 1);
  assert.equal(traffic.requestsByResourceType.document, 2);
  assert.equal(traffic.requestsByResourceType.fetch, 2);
  assert(traffic.requestStartIntervals.length >= 2);
  assert.equal(traffic.inflightAtFinalize, 0);
}

async function assertTelemetryIsolation() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(browser);
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: provider,
    renderConcurrency: 2,
    trafficNow: createFakeClock(),
  });

  const [left, right] = await Promise.all([
    renderer.withPage(async ({ context }) => {
      await context.dispatchRequest({
        url: "http://left.test/resource",
        resourceType: "fetch",
        terminal: "finished",
      });
      return { side: "left" };
    }, { renderPage: "http://left.test/page", allowedOrigin: "http://left.test" }),
    renderer.withPage(async ({ context }) => {
      await context.dispatchRequest({
        url: "http://right.test/resource",
        resourceType: "fetch",
        terminal: "finished",
      });
      return { side: "right" };
    }, { renderPage: "http://right.test/page", allowedOrigin: "http://right.test" }),
  ]);
  await renderer.close();

  assert.deepEqual(Object.keys(left.value.traffic.requestsStartedByHost), ["left.test"]);
  assert.deepEqual(Object.keys(right.value.traffic.requestsStartedByHost), ["right.test"]);
  assert.equal(provider.launchCount, 1);
}

async function assertMonotonicTiming() {
  const browser = new FakeBrowser();
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(browser),
    trafficNow: createSequenceClock([100, 110, 125, 120]),
  });

  const result = await renderer.withPage(async ({ context }) => {
    for (let index = 1; index <= 4; index += 1) {
      await context.dispatchRequest({
        url: `http://timing.test/resource-${index}`,
        resourceType: "fetch",
        terminal: "finished",
      });
    }
    return { ok: true };
  }, {
    renderPage: "http://timing.test/page",
    allowedOrigin: "http://timing.test",
  });
  await renderer.close();

  const intervals = result.value.traffic.requestStartIntervals.map((entry) => entry.intervalMs);
  assert.deepEqual(intervals, [10, 15, 0]);
  assert.equal(Math.min(...intervals), 0);
  assert.equal(result.value.traffic.timingUnit, "milliseconds_from_monotonic_process_clock");
}

async function assertMethodPolicyMatrix() {
  const browser = new FakeBrowser();
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(browser),
    trafficNow: createFakeClock(),
  });
  const cases = [
    { method: "get", expectedBlocked: false },
    { method: "HEAD", expectedBlocked: false },
    { method: "options", expectedBlocked: false },
    { method: "POST", expectedBlocked: true },
    { method: "put", expectedBlocked: true },
    { method: "PATCH", expectedBlocked: true },
    { method: "DELETE", expectedBlocked: true },
    { method: "CONNECT", expectedBlocked: true },
    { method: "TRACE", expectedBlocked: true },
    { method: "CUSTOM", expectedBlocked: true },
  ];

  const result = await renderer.withPage(async ({ context }) => {
    const outcomes = [];
    for (const testCase of cases) {
      const outcome = await context.dispatchRequest({
        url: `http://methods.test/${testCase.method.toLowerCase()}`,
        method: testCase.method,
        resourceType: "fetch",
        terminal: "finished",
      });
      outcomes.push({
        method: testCase.method,
        continued: outcome.route.continued,
        aborted: outcome.route.aborted,
      });
    }
    return { outcomes };
  }, {
    renderPage: "http://methods.test/page",
    allowedOrigin: "http://methods.test",
  });
  await renderer.close();

  for (const [index, testCase] of cases.entries()) {
    const outcome = result.value.outcomes[index];
    assert.equal(outcome.aborted, testCase.expectedBlocked, `${testCase.method} blocked state`);
    assert.equal(outcome.continued, !testCase.expectedBlocked, `${testCase.method} continued state`);
  }
  assert.equal(result.value.traffic.methodBlockedRequests, cases.filter((entry) => entry.expectedBlocked).length);
  assert.equal(result.value.traffic.requestsByMethod.GET, 1);
  assert.equal(result.value.traffic.requestsByMethod.HEAD, 1);
  assert.equal(result.value.traffic.requestsByMethod.OPTIONS, 1);
  assert.equal(result.value.traffic.requestsByMethod.PUT, 1);
  assert.equal(result.value.traffic.requestsFinished, 3);
  assert.equal(result.value.traffic.requestsFailed, 7);
  assert.equal(result.value.traffic.requestsFinished + result.value.traffic.requestsFailed, result.value.traffic.requestsStarted);
  return result.value.traffic;
}

async function assertTelemetrySanitization() {
  const browser = new FakeBrowser();
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(browser),
    trafficNow: createFakeClock(),
  });

  const result = await renderer.withPage(async ({ context, page }) => {
    await context.dispatchRequest({
      url: "https://user:password@example.test/path/to/item?token=SECRET&x=1#fragment",
      resourceType: "fetch",
      terminal: "finished",
    });
    let cancelCount = 0;
    await page.emit("download", {
      url: () => "https://user:password@example.test/download/file?token=SECRET#fragment",
      cancel: async () => {
        cancelCount += 1;
      },
    });
    return { cancelCount };
  }, {
    renderPage: "https://example.test/source",
    allowedOrigin: "https://example.test",
  });
  await renderer.close();

  const traffic = result.value.traffic;
  assert.equal(traffic.requests[0].path, "/path/to/item");
  assert.equal(traffic.blockedRequests.find((entry) => entry.reason === "download").path, "/download/file");
  assert.equal(result.value.cancelCount, 1);
  const serialized = JSON.stringify(traffic);
  for (const forbidden of ["SECRET", "token=", "password", "user:", "#fragment", "Authorization", "Cookie"]) {
    assert.equal(serialized.includes(forbidden), false, `telemetry leaked ${forbidden}`);
  }
}

async function assertTelemetrySampleBounds() {
  const normalTraffic = await runRequestVolumeScenario({
    total: 230,
    method: "GET",
    terminal: "finished",
  });
  assert.equal(normalTraffic.requestsStarted, 230);
  assert.equal(normalTraffic.requestsFinished, 230);
  assert.equal(normalTraffic.requestsFailed, 0);
  assert.equal(normalTraffic.requests.length, normalTraffic.requestSampleLimit);
  assert.equal(normalTraffic.requestSamplesDropped, 30);
  assert.equal(normalTraffic.requestStartIntervals.length, normalTraffic.requestStartIntervalSampleLimit);
  assert.equal(normalTraffic.requestStartIntervalSamplesDropped, 29);
  assert.equal(normalTraffic.requestsByMethod.GET, 230);
  assert.equal(normalTraffic.requestsByResourceType.fetch, 230);
  assert.equal(normalTraffic.requestsStartedByHost["volume.test"], 230);
  assert.equal(normalTraffic.requestsFinishedByHost["volume.test"], 230);
  assert.equal(normalTraffic.inflightAtFinalize, 0);
  assert.equal(Math.min(...normalTraffic.requestStartIntervals.map((entry) => entry.intervalMs)) >= 0, true);

  const blockedTraffic = await runRequestVolumeScenario({
    total: 130,
    method: "POST",
  });
  assert.equal(blockedTraffic.requestsStarted, 130);
  assert.equal(blockedTraffic.requestsFinished, 0);
  assert.equal(blockedTraffic.requestsFailed, 130);
  assert.equal(blockedTraffic.methodBlockedRequests, 130);
  assert.equal(blockedTraffic.blockedRequests.length, blockedTraffic.blockedRequestSampleLimit);
  assert.equal(blockedTraffic.blockedRequestSamplesDropped, 30);
  assert.equal(blockedTraffic.requestsByMethod.POST, 130);
  assert.equal(blockedTraffic.inflightAtFinalize, 0);
  return { normalTraffic, blockedTraffic };
}

async function runRequestVolumeScenario({ total, method, terminal = null }) {
  const browser = new FakeBrowser();
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(browser),
    trafficNow: createFakeClock(),
  });
  const result = await renderer.withPage(async ({ context }) => {
    for (let index = 0; index < total; index += 1) {
      await context.dispatchRequest({
        url: `http://volume.test/resource-${index}?token=SECRET`,
        method,
        resourceType: "fetch",
        terminal,
      });
    }
    return { ok: true };
  }, {
    renderPage: "http://volume.test/page",
    allowedOrigin: "http://volume.test",
  });
  await renderer.close();
  return result.value.traffic;
}

async function assertPopupDeduplication() {
  const browser = new FakeBrowser();
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(browser),
    trafficNow: createFakeClock(),
  });

  const result = await renderer.withPage(async ({ context, page }) => {
    const popup = new FakePage("http://example.test/popup?token=SECRET");
    context.emit("page", popup);
    await page.emit("popup", popup);
    return { popupCloseCount: popup.closeCount };
  }, {
    renderPage: "http://example.test/page",
    allowedOrigin: "http://example.test",
  });
  await renderer.close();

  assert.equal(result.value.traffic.popupClosed, 1);
  assert.equal(result.value.popupCloseCount, 1);
  assert.equal(result.value.traffic.blockedRequests.filter((entry) => entry.reason === "popup").length, 1);
  assert.equal(result.value.traffic.blockedRequests.some((entry) => JSON.stringify(entry).includes("token=")), false);
}

function createFakeClock() {
  let current = 1000;
  return () => {
    current += 7;
    return current;
  };
}

function createSequenceClock(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

async function assertCsrRegression(server) {
  const { checker, report } = await runFixture(server, "csr-basic");
  assertReportSchemaUnchanged(report);
  if (renderResult(checker)?.outcome === DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE) {
    return false;
  }
  const targetUrl = new URL("/csr-basic-same-origin", server.origin).toString();
  const item = inventoryItem(checker, targetUrl);
  assert.ok(item);
  assert.deepEqual(sourceTypes(item), ["rendered_dom"]);
  assert.equal(report.checked.some((entry) => entry.url === targetUrl && entry.ok === true), true);
  assert(renderResult(checker).traffic.requestsStarted >= 1);
  return true;
}

async function assertBurstTelemetry(server) {
  server.resetState();
  const { checker } = await runFixture(server, "browser-request-burst");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  const traffic = result.traffic;
  const byType = traffic.requestsByResourceType;
  assert.equal(byType.document, 1);
  assert.equal(byType.image, 4);
  assert.equal(byType.script, 1);
  assert.equal(byType.stylesheet, 1);
  assert.equal(byType.fetch, 3);
  assert(traffic.requestsStarted >= 10);
  assert.equal(traffic.requestsFinished + traffic.requestsFailed, traffic.requestsStarted);
  assert(traffic.peakInflight >= 1);
  assert(traffic.peakInflightByHost[new URL(server.origin).host] >= 1);
  assert(traffic.requestStartIntervals.length >= 1);
  return traffic;
}

async function assertSideEffectMethodBlocked(server) {
  server.resetState();
  const { checker } = await runFixture(server, "side-effect-method");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  const traffic = result.traffic;
  assert.equal(traffic.requestsByMethod.POST, 1);
  assert.equal(traffic.requestsByMethod.PUT, 1);
  assert.equal(traffic.methodBlockedRequests, 2);
  const serverUnsafeMethods = server.getState().unsafeMethods.filter((request) => (
    request.method === "POST" || request.method === "PUT"
  )).length;
  assert.equal(serverUnsafeMethods, 0);
  return { traffic, serverUnsafeMethods };
}

async function assertWebSocketBlocked(server) {
  server.resetState();
  const { checker } = await runFixture(server, "websocket-egress");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(result.traffic.websocketBlockedRequests, 1);
  const serverHandshakes = server.getState().websocketHandshakes.length;
  assert.equal(serverHandshakes, 0);
  return { traffic: result.traffic, serverHandshakes };
}

async function assertCrossOriginNavigationBlocked(server) {
  server.resetState();
  const { checker } = await runFixture(server, "render-cross-origin-navigation");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(result.traffic.mainFrameNavigationBlocked, 1);
  assert.equal(result.links.length, 0);
  const serverCrossOriginNavigations = server.getState().crossOriginNavigations.length;
  assert.equal(serverCrossOriginNavigations, 0);
  return { traffic: result.traffic, serverCrossOriginNavigations };
}

async function assertSecurityPrivateUrlPassive(server) {
  server.resetState();
  const { checker } = await runFixture(server, "security-private-url");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(result.traffic.securityBlockedRequests, 0);
  assert.equal(server.getState().securityRequests.length, 1);
  assert.equal(server.getState().requests.some((request) => request.path.includes("__dynamic_scan_private_probe__")), false);
  assert.equal(server.getState().requests.some((request) => request.path.includes("meta-data")), false);
}

async function assertPopupDownloadBoundary(server) {
  server.resetState();
  const localDownloadName = "dynamic-scan-empty-download.txt";
  assert.equal(existsSync(localDownloadName), false);
  const { checker } = await runFixture(server, "popup-download");
  const result = renderResult(checker);
  assert.notEqual(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(result.traffic.popupClosed, 1);
  assert.equal(result.traffic.downloadCancelled, 1);
  assert.equal(result.traffic.blockedRequests.filter((entry) => entry.reason === "popup").length, 1);
  assert.equal(result.traffic.blockedRequests.filter((entry) => entry.reason === "download").length, 1);
  assert.equal(JSON.stringify(result.traffic).includes(localDownloadName), false);
  assert.equal(existsSync(localDownloadName), false);
  return {
    popupClosed: result.traffic.popupClosed,
    downloadCancelled: result.traffic.downloadCancelled,
    popupRequests: server.getState().popupRequests.length,
    downloadRequests: server.getState().downloadRequests.length,
  };
}

await assertDeterministicTelemetryAccounting();
await assertTelemetryIsolation();
await assertMonotonicTiming();
const methodMatrix = await assertMethodPolicyMatrix();
await assertTelemetrySanitization();
const sampleBounds = await assertTelemetrySampleBounds();
await assertPopupDeduplication();

const fixtureFactory = createDynamicScanFixtureServer();
const server = await fixtureFactory.start();
try {
  const browserAvailable = await assertCsrRegression(server);
  if (!browserAvailable) {
    console.log("p1 boundary hooks telemetry ENV_BLOCKED: supported local Browser unavailable.");
  } else {
    const burst = await assertBurstTelemetry(server);
    const methods = await assertSideEffectMethodBlocked(server);
    const websocket = await assertWebSocketBlocked(server);
    const crossOrigin = await assertCrossOriginNavigationBlocked(server);
    const popupDownload = await assertPopupDownloadBoundary(server);
    await assertSecurityPrivateUrlPassive(server);
    console.log("p1 boundary hooks telemetry", JSON.stringify({
      burst: {
        requestsByResourceType: burst.requestsByResourceType,
        requestsStarted: burst.requestsStarted,
        requestsFinished: burst.requestsFinished,
        requestsFailed: burst.requestsFailed,
        peakInflight: burst.peakInflight,
        peakInflightByHost: burst.peakInflightByHost,
        requestStartIntervals: burst.requestStartIntervals,
      },
      methods: {
        requestsByMethod: methods.traffic.requestsByMethod,
        methodBlockedRequests: methods.traffic.methodBlockedRequests,
        serverUnsafeMethods: methods.serverUnsafeMethods,
      },
      websocket: {
        websocketBlockedRequests: websocket.traffic.websocketBlockedRequests,
        serverHandshakes: websocket.serverHandshakes,
      },
      crossOrigin: {
        mainFrameNavigationBlocked: crossOrigin.traffic.mainFrameNavigationBlocked,
        serverCrossOriginNavigations: crossOrigin.serverCrossOriginNavigations,
      },
      popupDownload,
      methodMatrix: {
        methodBlockedRequests: methodMatrix.methodBlockedRequests,
        requestsByMethod: methodMatrix.requestsByMethod,
      },
      sampleBounds: {
        normalRequestsStarted: sampleBounds.normalTraffic.requestsStarted,
        normalRequestSamplesDropped: sampleBounds.normalTraffic.requestSamplesDropped,
        normalIntervalSamplesDropped: sampleBounds.normalTraffic.requestStartIntervalSamplesDropped,
        blockedRequestsStarted: sampleBounds.blockedTraffic.requestsStarted,
        blockedRequestSamplesDropped: sampleBounds.blockedTraffic.blockedRequestSamplesDropped,
      },
    }));
  }
} finally {
  await server.close();
}
