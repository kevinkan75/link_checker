#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  BROWSER_PROVIDER_STATUS,
} from "./browser-provider.mjs";
import {
  DEFAULT_RENDER_OPTIONS,
  DYNAMIC_RENDER_OUTCOME,
  DYNAMIC_RENDERER_STATUS,
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

const SOURCE_URL = "http://127.0.0.1/render-source";

class FakePage {
  constructor(context, {
    url = SOURCE_URL,
    gotoImpl = null,
    contentImpl = null,
    evaluateImpl = null,
  } = {}) {
    this.context = context;
    this._url = url;
    this.gotoImpl = gotoImpl;
    this.contentImpl = contentImpl;
    this.evaluateImpl = evaluateImpl;
    this.gotoCount = 0;
    this.contentCount = 0;
    this.evaluateCount = 0;
    this.closeCount = 0;
    this.closed = false;
    this.handlers = new Map();
  }

  url() {
    return this._url;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async goto(url) {
    this.gotoCount += 1;
    this._url = url;
    if (this.gotoImpl) {
      return this.gotoImpl(url);
    }
    return { status: () => 200 };
  }

  async content() {
    this.contentCount += 1;
    if (this.contentImpl) {
      return this.contentImpl();
    }
    return "<!doctype html><a href=\"/rendered-target\">rendered</a>";
  }

  async evaluate() {
    this.evaluateCount += 1;
    if (this.evaluateImpl) {
      return this.evaluateImpl();
    }
    return `signature-${this.evaluateCount}`;
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeCount += 1;
  }
}

class FakeContext {
  constructor(browser, pageOptions = {}) {
    this.browser = browser;
    this.pageOptions = pageOptions;
    this.pages = [];
    this.closeCount = 0;
    this.closed = false;
    this.handlers = new Map();
    this.newPageError = browser.nextNewPageError;
    this.newPageDeferred = browser.nextNewPageDeferred;
    browser.nextNewPageError = null;
    browser.nextNewPageDeferred = null;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  async route() {}

  async routeWebSocket() {}

  async newPage() {
    if (this.newPageError) {
      throw this.newPageError;
    }
    if (this.newPageDeferred) {
      const page = await this.newPageDeferred.promise;
      page.context = this;
      this.pages.push(page);
      this.browser.pages.push(page);
      return page;
    }
    const page = new FakePage(this, this.pageOptions);
    this.pages.push(page);
    this.browser.pages.push(page);
    return page;
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeCount += 1;
    this.browser.closedContexts.push(this);
  }
}

class FakeBrowser {
  constructor({ pageOptions = {}, newContextError = null } = {}) {
    this.pageOptions = pageOptions;
    this.newContextError = newContextError;
    this.nextNewPageError = null;
    this.contexts = [];
    this.pages = [];
    this.closedContexts = [];
    this.closeCount = 0;
    this.handlers = new Map();
    this.nextNewPageDeferred = null;
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  async newContext() {
    if (this.newContextError) {
      throw this.newContextError;
    }
    const context = new FakeContext(this, this.pageOptions);
    this.contexts.push(context);
    return context;
  }

  async close() {
    this.closeCount += 1;
    this.handlers.get("disconnected")?.();
  }

  disconnectUnexpectedly() {
    this.handlers.get("disconnected")?.();
  }
}

class FakeBrowserProvider {
  constructor(results) {
    this.results = Array.isArray(results) ? results : [results];
    this.launchCount = 0;
  }

  async launchFirstAvailable() {
    this.launchCount += 1;
    const index = Math.min(this.launchCount - 1, this.results.length - 1);
    const result = this.results[index];
    return typeof result === "function" ? result() : result;
  }
}

function createAvailableResult(fakeBrowser) {
  let normalCloseRequested = false;
  const lifecycle = {
    status: BROWSER_PROVIDER_STATUS.AVAILABLE,
  };
  fakeBrowser.on("disconnected", () => {
    if (!normalCloseRequested) {
      lifecycle.status = BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY;
    }
  });
  return {
    ok: true,
    browser: "msedge",
    browserChannel: "msedge",
    browserInstance: fakeBrowser,
    status: BROWSER_PROVIDER_STATUS.AVAILABLE,
    launchOutcome: "available",
    getStatus: () => lifecycle.status,
    close: async () => {
      normalCloseRequested = true;
      await fakeBrowser.close();
      lifecycle.status = BROWSER_PROVIDER_STATUS.AVAILABLE;
      return { ok: true };
    },
  };
}

function createUnavailableResult(status) {
  return {
    ok: false,
    browser: null,
    browserChannel: null,
    status,
    launchOutcome: status === BROWSER_PROVIDER_STATUS.NOT_FOUND
      ? "browser_unavailable"
      : "browser_launch_failed",
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushEventLoop() {
  await new Promise((resolve) => setImmediate(resolve));
}

async function withUnhandledRejectionTrap(action) {
  const unhandledRejections = [];
  const handler = (reason) => {
    unhandledRejections.push(reason);
  };
  process.on("unhandledRejection", handler);
  try {
    const result = await action(unhandledRejections);
    await flushMicrotasks();
    await flushEventLoop();
    assert.equal(unhandledRejections.length, 0);
    return result;
  } finally {
    process.off("unhandledRejection", handler);
  }
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function makeRenderer({
  browser,
  provider,
  renderConcurrency = 1,
  renderTimeoutMs = 250,
  renderSettleMinMs = 0,
  renderSettleIntervalMs = 5,
  renderSettleStableSamples = 2,
  renderSettleMaxMs = 20,
  extractLinks = () => [],
  getDocumentBaseUrl = (_html, url) => url,
  now,
  sleep,
} = {}) {
  return new DynamicRenderer({
    enabled: true,
    browserProvider: provider || new FakeBrowserProvider(createAvailableResult(browser || new FakeBrowser())),
    renderConcurrency,
    renderTimeoutMs,
    renderSettleMinMs,
    renderSettleIntervalMs,
    renderSettleStableSamples,
    renderSettleMaxMs,
    extractLinks,
    getDocumentBaseUrl,
    now,
    sleep,
  });
}

async function testStopBeforeFirstLaunch() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({ browser, provider });

  await renderer.requestStop();
  const result = await renderer.renderPage(SOURCE_URL);
  await renderer.close();

  assert.equal(provider.launchCount, 0);
  assert.equal(browser.contexts.length, 0);
  assert.equal(browser.pages.length, 0);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
}

async function testStopDuringPendingLaunch() {
  const lateBrowser = new FakeBrowser();
  const deferredLaunch = createDeferred();
  const provider = new FakeBrowserProvider(() => deferredLaunch.promise);
  const renderer = makeRenderer({ provider });

  const job = renderer.renderPage(SOURCE_URL);
  await flushMicrotasks();
  assert.equal(provider.launchCount, 1);

  await renderer.requestStop();
  deferredLaunch.resolve(createAvailableResult(lateBrowser));
  const result = await job;
  await renderer.close();

  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
  assert.equal(lateBrowser.contexts.length, 0);
  assert.equal(lateBrowser.pages.length, 0);
  assert.equal(lateBrowser.closeCount, 1);
  assert.equal(provider.launchCount, 1);
}

async function testTimeoutDuringPendingLaunchDisposesLateBrowser() {
  await withUnhandledRejectionTrap(async () => {
    const lateBrowser = new FakeBrowser();
    const laterBrowser = new FakeBrowser();
    const deferredLaunch = createDeferred();
    const provider = new FakeBrowserProvider([
      () => deferredLaunch.promise,
      createAvailableResult(laterBrowser),
    ]);
    const renderer = makeRenderer({
      provider,
      renderTimeoutMs: 20,
      renderSettleMaxMs: 0,
    });

    const job = renderer.renderPage(SOURCE_URL);
    await flushMicrotasks();
    assert.equal(provider.launchCount, 1);

    const result = await job;
    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
    assert.equal(result.links.length, 0);
    assert.equal(lateBrowser.contexts.length, 0);
    assert.equal(lateBrowser.pages.length, 0);
    assert.equal(renderer.browserResult, null);

    deferredLaunch.resolve(createAvailableResult(lateBrowser));
    await flushMicrotasks();
    await flushEventLoop();

    assert.equal(lateBrowser.closeCount, 1);
    assert.equal(renderer.browserResult, null);
    assert.equal(provider.launchCount, 1);

    const laterResult = await renderer.renderPage(`${SOURCE_URL}/after-timeout`);
    await renderer.close();

    assert.equal(laterResult.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);
    assert.equal(provider.launchCount, 2);
    assert.equal(laterBrowser.contexts.length, 1);
    assert.equal(laterBrowser.pages.length, 1);
  });
}

async function testConcurrentLaunchTimeoutDoesNotDisposeBrowserForValidWaiter() {
  const browser = new FakeBrowser();
  const deferredLaunch = createDeferred();
  const provider = new FakeBrowserProvider(() => deferredLaunch.promise);
  const renderer = makeRenderer({
    provider,
    renderConcurrency: 2,
    renderSettleMaxMs: 0,
  });

  const shortDeadline = {
    expired: () => false,
    remainingMs: () => 20,
  };
  const longDeadline = {
    expired: () => false,
    remainingMs: () => 1000,
  };

  const timedOutJob = renderer.withPage(() => {
    throw new Error("Timed-out waiter must not create a page.");
  }, { deadline: shortDeadline });
  const validJob = renderer.withPage(() => "valid", { deadline: longDeadline });
  await flushMicrotasks();
  assert.equal(provider.launchCount, 1);

  const timedOutResult = await timedOutJob;
  deferredLaunch.resolve(createAvailableResult(browser));
  const validResult = await validJob;
  await renderer.close();

  assert.equal(timedOutResult.ok, false);
  assert.equal(timedOutResult.status, DYNAMIC_RENDERER_STATUS.RENDER_TIMEOUT);
  assert.equal(validResult.ok, true);
  assert.equal(validResult.value, "valid");
  assert.equal(browser.closeCount, 1);
  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.pages.length, 1);
  assert.equal(provider.launchCount, 1);
}

async function testStopWhileQueuedInLimiter() {
  const gotoDeferred = createDeferred();
  const browser = new FakeBrowser({
    pageOptions: {
      gotoImpl: () => gotoDeferred.promise,
    },
  });
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({
    browser,
    provider,
    renderConcurrency: 1,
    renderTimeoutMs: 1000,
  });

  const activeJob = renderer.renderPage(`${SOURCE_URL}/active`);
  await waitFor(() => browser.pages[0]?.gotoCount === 1, "active render navigation");
  const queuedJob = renderer.renderPage(`${SOURCE_URL}/queued`);
  await flushMicrotasks();
  assert.equal(browser.contexts.length, 1);

  await renderer.requestStop();
  const [activeResult, queuedResult] = await Promise.all([activeJob, queuedJob]);
  await renderer.close();

  assert.equal(activeResult.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
  assert.equal(queuedResult.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.pages.length, 1);
  assert.equal(browser.closedContexts.length, 1);
  assert.equal(provider.launchCount, 1);
}

async function testQueuedJobDeadlineExpiresBeforeBrowserOrContextWork() {
  const activeDeferred = createDeferred();
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({
    browser,
    provider,
    renderConcurrency: 1,
    renderTimeoutMs: 25,
    renderSettleMaxMs: 0,
  });

  const activeJob = renderer.withPage(() => activeDeferred.promise);
  await waitFor(() => browser.pages.length === 1, "active limiter job page");

  const queuedJob = renderer.renderPage(`${SOURCE_URL}/queued-timeout`);
  await new Promise((resolve) => setTimeout(resolve, 35));
  activeDeferred.resolve("done");

  const [activeResult, queuedResult] = await Promise.all([activeJob, queuedJob]);
  await renderer.close();

  assert.equal(activeResult.ok, true);
  assert.equal(queuedResult.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
  assert.equal(queuedResult.links.length, 0);
  assert.equal(provider.launchCount, 1);
  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.pages.length, 1);
  assert.equal(renderer.renderLimiter.active, 0);
  assert.equal(renderer.renderLimiter.queue.length, 0);
}

async function testStopDuringSettle() {
  const sleepDeferred = createDeferred();
  let sleepCalls = 0;
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({
    browser,
    provider,
    renderTimeoutMs: 1000,
    renderSettleMinMs: 1000,
    renderSettleIntervalMs: 1000,
    renderSettleMaxMs: 5000,
    sleep: () => {
      sleepCalls += 1;
      return sleepDeferred.promise;
    },
  });

  const job = renderer.renderPage(SOURCE_URL);
  await waitFor(() => sleepCalls === 1, "settle sleep");
  await renderer.requestStop();
  const result = await job;
  await renderer.close();

  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
  assert.equal(browser.pages[0].contentCount, 0);
  assert.equal(browser.closedContexts.length, 1);
}

async function testStopDuringContent() {
  const contentDeferred = createDeferred();
  const browser = new FakeBrowser({
    pageOptions: {
      contentImpl: () => contentDeferred.promise,
    },
  });
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({
    browser,
    provider,
    renderTimeoutMs: 1000,
    renderSettleMaxMs: 0,
  });

  const job = renderer.renderPage(SOURCE_URL);
  await waitFor(() => browser.pages[0]?.contentCount === 1, "content read");
  await renderer.requestStop();
  const result = await job;
  await renderer.close();

  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
  assert.equal(result.links.length, 0);
  assert.equal(browser.closedContexts.length, 1);
}

async function testStopBeforeRenderedIngestion() {
  const server = await createDynamicScanFixtureServer().start();
  const startUrl = new URL(dynamicScanFixtures["csr-basic"].path, server.origin).toString();
  try {
    const checker = new LinkChecker(startUrl, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      maxPages: 4,
      maxDepth: 0,
      dynamicRender: true,
      renderMaxPages: 1,
      checkExternal: false,
    });
    checker.dynamicRenderer = {
      renderPage: async () => {
        checker.stop();
        return {
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.RENDERED,
          requestedUrl: startUrl,
          renderFinalUrl: startUrl,
          documentBaseUrl: startUrl,
          elapsedMs: 1,
          settled: true,
          links: [{
            value: "/after-stop-rendered-link",
            tag: "a",
            attribute: "href",
            sourceType: "rendered_dom",
          }],
          linkCount: 1,
        };
      },
      requestStop: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
      close: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
    };

    const report = await checker.run();
    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(checker.stopped, true);
    assert.equal(checker.inventory.has(checker.getCanonicalKey(new URL("/after-stop-rendered-link", server.origin).toString())), false);
  } finally {
    await server.close();
  }
}

async function testRenderTimeoutResultsAreNotIngested() {
  const server = await createDynamicScanFixtureServer().start();
  const startUrl = new URL(dynamicScanFixtures["csr-basic"].path, server.origin).toString();
  const timeoutTarget = new URL("/timeout-rendered-link", server.origin).toString();
  try {
    const checker = new LinkChecker(startUrl, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      maxPages: 4,
      maxDepth: 0,
      dynamicRender: true,
      renderMaxPages: 1,
      checkExternal: false,
    });
    checker.dynamicRenderer = {
      renderPage: async (url) => ({
        attempted: true,
        outcome: DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT,
        requestedUrl: url,
        renderFinalUrl: url,
        documentBaseUrl: url,
        elapsedMs: 10,
        settled: false,
        links: [{
          value: "/timeout-rendered-link",
          tag: "a",
          attribute: "href",
          sourceType: "rendered_dom",
        }],
        linkCount: 1,
      }),
      requestStop: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
      close: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
    };

    const report = await checker.run();
    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(checker.inventory.has(checker.getCanonicalKey(timeoutTarget)), false);
    assert.equal(report.checked.some((entry) => entry.url === timeoutTarget), false);
  } finally {
    await server.close();
  }
}

async function testNavigationTimeoutAndRenderTimeoutAreDistinct() {
  const navigationTimeoutError = new Error("Timeout 25ms exceeded");
  navigationTimeoutError.name = "TimeoutError";
  const navigationBrowser = new FakeBrowser({
    pageOptions: {
      gotoImpl: async () => {
        throw navigationTimeoutError;
      },
    },
  });
  const navigationRenderer = makeRenderer({
    browser: navigationBrowser,
    renderTimeoutMs: 500,
  });
  const navigationResult = await navigationRenderer.renderPage(SOURCE_URL);
  await navigationRenderer.close();
  assert.equal(navigationResult.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_TIMEOUT);

  const lateGoto = createDeferred();
  const renderTimeoutBrowser = new FakeBrowser({
    pageOptions: {
      gotoImpl: () => lateGoto.promise,
    },
  });
  const renderTimeoutRenderer = makeRenderer({
    browser: renderTimeoutBrowser,
    renderTimeoutMs: 20,
  });
  const renderTimeoutResult = await renderTimeoutRenderer.renderPage(SOURCE_URL);
  await renderTimeoutRenderer.close();

  assert.equal(renderTimeoutResult.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
  assert.equal(renderTimeoutResult.failureStage, "navigation");
  assert.equal(renderTimeoutBrowser.pages[0].contentCount, 0);
  assert.equal(renderTimeoutBrowser.closedContexts.length, 1);

  lateGoto.resolve({ status: () => 200 });
  await flushMicrotasks();
  assert.equal(renderTimeoutBrowser.pages[0].contentCount, 0);
}

async function testLateNavigationRejectionAfterRenderTimeoutIsConsumed() {
  await withUnhandledRejectionTrap(async () => {
    const lateGoto = createDeferred();
    const browser = new FakeBrowser({
      pageOptions: {
        gotoImpl: () => lateGoto.promise,
      },
    });
    const renderer = makeRenderer({
      browser,
      renderTimeoutMs: 20,
    });

    const result = await renderer.renderPage(SOURCE_URL);
    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
    assert.equal(result.failureStage, "navigation");
    assert.equal(result.links.length, 0);
    assert.equal(browser.pages[0].contentCount, 0);

    lateGoto.reject(new Error("late navigation rejection"));
    await flushMicrotasks();
    await flushEventLoop();
    await renderer.close();

    assert.equal(browser.pages[0].contentCount, 0);
    assert.equal(browser.closedContexts.length, 1);
  });
}

async function testSettleMaxRemainsUnsettledNotTimeout() {
  const signatures = ["one", "two", "three", "four"];
  const browser = new FakeBrowser({
    pageOptions: {
      evaluateImpl: () => signatures.shift() || `next-${Date.now()}`,
    },
  });
  const renderer = makeRenderer({
    browser,
    renderTimeoutMs: 1000,
    renderSettleMinMs: 100,
    renderSettleIntervalMs: 10,
    renderSettleStableSamples: 10,
    renderSettleMaxMs: 30,
    extractLinks: () => [{
      value: "/unsettled-link",
      tag: "a",
      attribute: "href",
      sourceType: "html_attribute",
    }],
  });

  const result = await renderer.renderPage(SOURCE_URL);
  await renderer.close();
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);
  assert.equal(result.links.length, 1);
}

async function testBrowserUnavailableAndLaunchFailed() {
  for (const status of [BROWSER_PROVIDER_STATUS.NOT_FOUND, BROWSER_PROVIDER_STATUS.LAUNCH_FAILED]) {
    const provider = new FakeBrowserProvider(createUnavailableResult(status));
    const renderer = makeRenderer({ provider });
    const result = await renderer.renderPage(SOURCE_URL);
    await renderer.close();

    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
    assert.equal(result.rendererStatus, status);
    assert.equal(provider.launchCount, 1);
  }
}

async function testUnexpectedDisconnectDoesNotRelaunch() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({ browser, provider });

  const first = await renderer.renderPage(SOURCE_URL);
  assert.equal(first.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);

  browser.disconnectUnexpectedly();
  const second = await renderer.renderPage(`${SOURCE_URL}/after-disconnect`);
  await renderer.close();

  assert.equal(second.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(second.rendererStatus, BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY);
  assert.equal(provider.launchCount, 1);
}

async function testDisconnectDuringNavigationMapsDeterministically() {
  const browser = new FakeBrowser({
    pageOptions: {
      gotoImpl: async () => {
        browser.disconnectUnexpectedly();
        throw new Error("Target page, context or browser has been closed");
      },
    },
  });
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({ browser, provider, renderTimeoutMs: 500 });

  const result = await renderer.renderPage(SOURCE_URL);
  await renderer.close();

  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE);
  assert.equal(result.rendererStatus, BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY);
  assert.equal(provider.launchCount, 1);
}

async function testContextPageContentAndExtractionFailuresDoNotLeakLinks() {
  const contextError = new Error("newContext failed");
  const contextBrowser = new FakeBrowser({ newContextError: contextError });
  const contextRenderer = makeRenderer({ browser: contextBrowser });
  const contextResult = await contextRenderer.renderPage(SOURCE_URL);
  await contextRenderer.close();
  assert.equal(contextResult.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(contextResult.failureStage, "setup");
  assert.equal(contextBrowser.pages.length, 0);

  const pageError = new Error("newPage failed");
  const pageBrowser = new FakeBrowser();
  pageBrowser.nextNewPageError = pageError;
  const pageRenderer = makeRenderer({ browser: pageBrowser });
  const pageResult = await pageRenderer.renderPage(SOURCE_URL);
  await pageRenderer.close();
  assert.equal(pageResult.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(pageResult.failureStage, "setup");
  assert.equal(pageBrowser.closedContexts.length, 1);

  const contentBrowser = new FakeBrowser({
    pageOptions: {
      contentImpl: async () => {
        throw new Error("content failed");
      },
    },
  });
  const contentRenderer = makeRenderer({ browser: contentBrowser, renderSettleMaxMs: 0 });
  const contentResult = await contentRenderer.renderPage(SOURCE_URL);
  await contentRenderer.close();
  assert.equal(contentResult.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(contentResult.failureStage, "content");
  assert.equal(contentResult.links.length, 0);

  const extractionBrowser = new FakeBrowser();
  const extractionRenderer = makeRenderer({
    browser: extractionBrowser,
    renderSettleMaxMs: 0,
    extractLinks: () => {
      throw new Error("extract failed");
    },
  });
  const extractionResult = await extractionRenderer.renderPage(SOURCE_URL);
  await extractionRenderer.close();
  assert.equal(extractionResult.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(extractionResult.failureStage, "extraction");
  assert.equal(extractionResult.links.length, 0);
}

async function testPendingNewPageStopReturnsRenderResultAndCleansContext() {
  await withUnhandledRejectionTrap(async () => {
    const newPageDeferred = createDeferred();
    const latePage = new FakePage(null);
    const browser = new FakeBrowser();
    browser.nextNewPageDeferred = newPageDeferred;
    const provider = new FakeBrowserProvider(createAvailableResult(browser));
    const renderer = makeRenderer({
      browser,
      provider,
      renderTimeoutMs: 1000,
      renderSettleMaxMs: 0,
    });

    const job = renderer.renderPage(SOURCE_URL);
    await waitFor(() => browser.contexts.length === 1, "context before pending newPage stop");
    await renderer.requestStop();
    const result = await job;

    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.STOPPED);
    assert.equal(result.links.length, 0);
    assert.equal(browser.pages.length, 0);
    assert.equal(browser.closedContexts.length, 1);

    newPageDeferred.resolve(latePage);
    await flushMicrotasks();
    await flushEventLoop();
    await renderer.close();

    assert.equal(latePage.closeCount, 1);
    assert.equal(browser.pages.length, 1);
    assert.equal(provider.launchCount, 1);
  });
}

async function testPendingNewPageTimeoutReturnsRenderResultAndCleansContext() {
  await withUnhandledRejectionTrap(async () => {
    const newPageDeferred = createDeferred();
    const latePage = new FakePage(null);
    const browser = new FakeBrowser();
    browser.nextNewPageDeferred = newPageDeferred;
    const provider = new FakeBrowserProvider(createAvailableResult(browser));
    const renderer = makeRenderer({
      browser,
      provider,
      renderTimeoutMs: 20,
      renderSettleMaxMs: 0,
    });

    const resultPromise = renderer.renderPage(SOURCE_URL);
    await waitFor(() => browser.contexts.length === 1, "context before pending newPage timeout");
    const result = await resultPromise;

    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
    assert.equal(result.failureStage, "setup");
    assert.equal(result.links.length, 0);
    assert.equal(browser.pages.length, 0);
    assert.equal(browser.closedContexts.length, 1);

    newPageDeferred.resolve(latePage);
    await flushMicrotasks();
    await flushEventLoop();
    await renderer.close();

    assert.equal(latePage.closeCount, 1);
    assert.equal(browser.pages.length, 1);
    assert.equal(provider.launchCount, 1);
  });
}

async function testExtractionCrossingDeadlineReturnsTimeoutWithoutLinks() {
  let currentTime = 0;
  let extractionCalled = false;
  const browser = new FakeBrowser();
  const renderer = makeRenderer({
    browser,
    renderTimeoutMs: 10,
    renderSettleMaxMs: 0,
    now: () => currentTime,
    extractLinks: () => {
      extractionCalled = true;
      currentTime = 11;
      return [{
        value: "/late-extraction-link",
        tag: "a",
        attribute: "href",
        sourceType: "html_attribute",
      }];
    },
  });

  const result = await renderer.renderPage(SOURCE_URL);
  await renderer.close();

  assert.equal(extractionCalled, true);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
  assert.equal(result.failureStage, "extraction");
  assert.equal(result.links.length, 0);
  assert.equal(result.linkCount, 0);
  assert.equal(browser.closedContexts.length, 1);
}

async function testJobLocalFailureAllowsLaterRender() {
  const failingPage = {
    gotoImpl: async () => {
      throw new Error("controlled navigation failure");
    },
  };
  const successPage = {};
  const browser = new FakeBrowser();
  const originalNewContext = browser.newContext.bind(browser);
  let contextIndex = 0;
  browser.newContext = async () => {
    browser.pageOptions = contextIndex === 0 ? failingPage : successPage;
    contextIndex += 1;
    return originalNewContext();
  };
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = makeRenderer({ browser, provider, renderSettleMaxMs: 0 });

  const first = await renderer.renderPage(`${SOURCE_URL}/failing`);
  const second = await renderer.renderPage(`${SOURCE_URL}/success`);
  await renderer.close();

  assert.equal(first.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(second.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);
  assert.equal(provider.launchCount, 1);
  assert.equal(browser.contexts.length, 2);
}

async function testStaticScanContinuesAfterJobLocalRenderFailure() {
  const server = createServer((request, response) => {
    if (request.url === "/page-a") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><a href=\"/page-b\">page b</a>");
      return;
    }
    if (request.url === "/page-b") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><p>page b</p>");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const renderOutcomes = [
    DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
    DYNAMIC_RENDER_OUTCOME.RENDERED,
  ];
  try {
    const checker = new LinkChecker(`${origin}/page-a`, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      maxPages: 2,
      maxDepth: 1,
      concurrency: 1,
      dynamicRender: true,
      checkExternal: false,
    });
    checker.dynamicRenderer = {
      renderPage: async (url) => {
        const outcome = renderOutcomes.shift();
        return {
          attempted: true,
          outcome,
          requestedUrl: url,
          renderFinalUrl: url,
          documentBaseUrl: url,
          elapsedMs: 1,
          settled: outcome === DYNAMIC_RENDER_OUTCOME.RENDERED,
          links: [],
          linkCount: 0,
        };
      },
      requestStop: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
      close: async () => ({ ok: true, status: DYNAMIC_RENDERER_STATUS.STOPPED }),
    };

    const report = await checker.run();
    assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(checker.dynamicRenderResults.length, 2);
    assert.equal(checker.dynamicRenderResults[0].outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
    assert.equal(checker.dynamicRenderResults[1].outcome, DYNAMIC_RENDER_OUTCOME.RENDERED);
    assert.equal(report.checked.some((entry) => entry.url === `${origin}/page-a` && entry.ok === true), true);
    assert.equal(report.checked.some((entry) => entry.url === `${origin}/page-b` && entry.ok === true), true);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function testSubresourceBlocksDoNotForceFatalOutcome() {
  const browser = new FakeBrowser();
  const renderer = makeRenderer({
    browser,
    renderSettleMaxMs: 0,
    extractLinks: () => [],
  });
  const result = await renderer.renderPage(SOURCE_URL);
  await renderer.close();

  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);
}

async function testRealRenderTimeoutFixtureIfBrowserAvailable() {
  const server = await createDynamicScanFixtureServer().start();
  try {
    const startUrl = new URL(dynamicScanFixtures["render-timeout"].path, server.origin).toString();
    const checker = new LinkChecker(startUrl, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      maxPages: 1,
      maxDepth: 0,
      dynamicRender: true,
      renderTimeoutMs: 750,
      renderSettleMinMs: 100,
      renderSettleIntervalMs: 50,
      renderSettleStableSamples: 10,
      renderSettleMaxMs: 2000,
      checkExternal: false,
    });
    const report = await checker.run();
    assert.equal(report.schemaVersion, "1.3.0");
    const result = checker.dynamicRenderResults[0];
    if (result?.outcome === DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE) {
      return false;
    }
    assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT);
    assert.equal(report.checked.some((entry) => entry.url === startUrl && entry.ok === true), true);
    return true;
  } finally {
    await server.close();
  }
}

const tests = [
  testStopBeforeFirstLaunch,
  testStopDuringPendingLaunch,
  testTimeoutDuringPendingLaunchDisposesLateBrowser,
  testConcurrentLaunchTimeoutDoesNotDisposeBrowserForValidWaiter,
  testStopWhileQueuedInLimiter,
  testQueuedJobDeadlineExpiresBeforeBrowserOrContextWork,
  testStopDuringSettle,
  testStopDuringContent,
  testStopBeforeRenderedIngestion,
  testRenderTimeoutResultsAreNotIngested,
  testNavigationTimeoutAndRenderTimeoutAreDistinct,
  testLateNavigationRejectionAfterRenderTimeoutIsConsumed,
  testSettleMaxRemainsUnsettledNotTimeout,
  testBrowserUnavailableAndLaunchFailed,
  testUnexpectedDisconnectDoesNotRelaunch,
  testDisconnectDuringNavigationMapsDeterministically,
  testContextPageContentAndExtractionFailuresDoNotLeakLinks,
  testPendingNewPageStopReturnsRenderResultAndCleansContext,
  testPendingNewPageTimeoutReturnsRenderResultAndCleansContext,
  testExtractionCrossingDeadlineReturnsTimeoutWithoutLinks,
  testJobLocalFailureAllowsLaterRender,
  testStaticScanContinuesAfterJobLocalRenderFailure,
  testSubresourceBlocksDoNotForceFatalOutcome,
];

for (const test of tests) {
  await test();
}

const realBrowserEvidence = await testRealRenderTimeoutFixtureIfBrowserAvailable();
const realBrowserState = realBrowserEvidence ? "LOCAL_FIXTURE_PASS" : "ENV_BLOCKED";

assert.equal(DEFAULT_RENDER_OPTIONS.renderTimeoutMs, 15000);
console.log(`P1-05 stop/timeout/failure tests passed (${tests.length}); real timeout fixture: ${realBrowserState}.`);
