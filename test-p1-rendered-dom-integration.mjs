#!/usr/bin/env node

import assert from "node:assert/strict";
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
  readDynamicScanFixture,
} from "./fixtures/dynamic-scan/fixtures.mjs";

function pathWithSearch(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function createEvents() {
  return {
    pageQueued: [],
  };
}

function makeChecker(startUrl, options = {}) {
  const { events = null, ...checkerOptions } = options;
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
      pageQueued: (url, depth) => {
        events?.pageQueued.push({ path: pathWithSearch(url), depth });
      },
      pageLinksFound: () => {},
      externalSkipped: () => {},
      requestQueued: () => {},
      requestFinished: () => {},
    },
    ...checkerOptions,
  });
}

async function runFixture(server, fixtureId, options = {}) {
  const events = createEvents();
  const startUrl = new URL(dynamicScanFixtures[fixtureId].path, server.origin).toString();
  const checker = makeChecker(startUrl, { ...options, events });
  const report = await checker.run();
  return { checker, report, startUrl, events };
}

function inventoryItem(checker, url) {
  return checker.inventory.get(checker.getCanonicalKey(url)) || null;
}

function sourceTypes(item) {
  return [...new Set((item?.sources || []).map((source) => source.sourceType))].sort();
}

function renderResult(checker) {
  return checker.dynamicRenderResults[0] || null;
}

class CountingRenderer {
  constructor(result) {
    this.result = result || {
      attempted: true,
      outcome: DYNAMIC_RENDER_OUTCOME.RENDERED,
      links: [],
      linkCount: 0,
    };
    this.renderAttempts = 0;
    this.contextsCreated = 0;
    this.pagesCreated = 0;
    this.closeCount = 0;
  }

  async renderPage() {
    this.renderAttempts += 1;
    return this.result;
  }

  async close() {
    this.closeCount += 1;
  }

  async requestStop() {
    return { ok: true };
  }
}

class FakePage {
  constructor({ url, gotoError }) {
    this.currentUrl = url;
    this.gotoError = gotoError;
    this.contentCalls = 0;
  }

  async goto() {
    if (this.gotoError) {
      throw this.gotoError;
    }
    return { status: () => 200 };
  }

  url() {
    return this.currentUrl;
  }

  async content() {
    this.contentCalls += 1;
    return "<!doctype html><a href=\"/should-not-be-read\">should not be read</a>";
  }
}

class FakeContext {
  constructor(page) {
    this.page = page;
    this.closed = false;
    this.closeCount = 0;
    this.newPageCount = 0;
  }

  async newPage() {
    this.newPageCount += 1;
    return this.page;
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeCount += 1;
  }
}

class FakeBrowser {
  constructor(context) {
    this.context = context;
    this.newContextCount = 0;
  }

  async newContext() {
    this.newContextCount += 1;
    return this.context;
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
      close: async () => ({ ok: true }),
    };
  }
}

function createNavigationError(name, message) {
  const error = new Error(message);
  error.name = name;
  return error;
}

async function renderWithFakeNavigationError(error) {
  const page = new FakePage({
    url: "http://127.0.0.1/render-navigation-source",
    gotoError: error,
  });
  const context = new FakeContext(page);
  const browser = new FakeBrowser(context);
  const provider = new FakeBrowserProvider(browser);
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: provider,
    renderTimeoutMs: 25,
    renderSettleMinMs: 0,
    renderSettleIntervalMs: 1,
    renderSettleMaxMs: 1,
  });
  const result = await renderer.renderPage(page.currentUrl);
  await renderer.close();
  return { result, page, context, browser, provider };
}

function assertReportSchemaUnchanged(report) {
  assert.equal(report.schemaVersion, REPORT_SCHEMA_VERSION);
  assert.equal(REPORT_SCHEMA_VERSION, "1.3.0");
  assert.equal(report.checked.some((item) => Object.hasOwn(item, "discovery")), false);
  assert.equal(Object.hasOwn(report.summary, "dynamicRender"), false);
  assert.equal(report.checked.some((item) => Object.hasOwn(item, "renderEvidence")), false);
}

function assertNoBrowserAvailable(checker) {
  const result = renderResult(checker);
  return result && result.outcome === DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE;
}

async function assertStaticControl(server) {
  const { checker, report } = await runFixture(server, "csr-basic", {
    dynamicRender: false,
  });
  assertReportSchemaUnchanged(report);
  assert.equal(checker.dynamicRenderer, null);
  assert.equal(checker.dynamicRenderAttemptedPages, 0);
  assert.equal(checker.dynamicRenderResults.length, 0);
  assert.equal(inventoryItem(checker, new URL("/csr-basic-same-origin", server.origin).toString()), null);
  assert.equal(inventoryItem(checker, "https://dynamic.example/csr-basic-external"), null);
}

async function assertCsrBasic(server) {
  const { checker, report } = await runFixture(server, "csr-basic", {
    dynamicRender: true,
  });
  assertReportSchemaUnchanged(report);
  if (assertNoBrowserAvailable(checker)) {
    return false;
  }
  const result = renderResult(checker);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED);
  const internalUrl = new URL("/csr-basic-same-origin", server.origin).toString();
  const externalUrl = "https://dynamic.example/csr-basic-external";
  const internalItem = inventoryItem(checker, internalUrl);
  const externalItem = inventoryItem(checker, externalUrl);
  assert.ok(internalItem, "csr-basic internal runtime target should be inventoried.");
  assert.ok(externalItem, "csr-basic external runtime target should be inventoried.");
  assert.deepEqual(sourceTypes(internalItem), ["rendered_dom"]);
  assert.deepEqual(sourceTypes(externalItem), ["rendered_dom"]);
  assert.equal(externalItem.shouldCheck, false);
  assert.equal(report.checked.some((item) => item.url === internalUrl && item.ok === true && item.classification === "ok"), true);
  assert.equal(report.checked.some((item) => item.url === externalUrl), false);
  assert.equal(server.getState().requests.some((request) => request.host?.includes("dynamic.example")), false);
  return true;
}

async function assertCsrDelayed(server) {
  const { checker } = await runFixture(server, "csr-delayed", {
    dynamicRender: true,
    renderSettleMinMs: 350,
    renderSettleMaxMs: 1200,
  });
  const targetUrl = new URL("/csr-delayed-target", server.origin).toString();
  const item = inventoryItem(checker, targetUrl);
  assert.ok(item, "csr-delayed target should be discovered after bounded settle.");
  assert.deepEqual(sourceTypes(item), ["rendered_dom"]);
  const result = renderResult(checker);
  assert.equal(result.settled, true);
  assert(result.settle.elapsedMs >= 250, "settle should wait long enough for delayed DOM mutation.");
}

async function assertDuplicateLink(server) {
  const { checker, report, events } = await runFixture(server, "duplicate-link", {
    dynamicRender: true,
    maxDepth: 1,
  });
  assertReportSchemaUnchanged(report);
  const targetUrl = new URL("/duplicate-link/shared-target", server.origin).toString();
  const item = inventoryItem(checker, targetUrl);
  assert.ok(item, "duplicate target should exist.");
  assert.deepEqual(sourceTypes(item), ["html_attribute", "rendered_dom"]);
  assert.equal(checker.inventory.size, 1);
  assert.equal(report.checked.filter((entry) => entry.url === targetUrl).length, 1);
  assert.equal(item.sources.length, 2);
  assert.equal(checker.inventoryMetrics.validationSkippedByInventory, 2);
  assert.deepEqual(events.pageQueued.filter((entry) => entry.path === "/duplicate-link/shared-target"), [
    { path: "/duplicate-link/shared-target", depth: 1 },
  ]);
}

async function assertRuntimeBase(server) {
  const staticRun = await runFixture(server, "runtime-base-url", {
    dynamicRender: false,
  });
  const { checker } = await runFixture(server, "runtime-base-url", {
    dynamicRender: true,
  });
  const relativeBase = "runtime-base/";
  const relativeTarget = "relative-target";
  const requestedUrl = new URL(dynamicScanFixtures["runtime-base-url"].path, server.origin).toString();
  const runtimeUrl = new URL(dynamicScanFixtures["runtime-base-url"].runtimeHistoryPath, server.origin).toString();
  const runtimeBaseUrl = new URL(relativeBase, runtimeUrl).toString();
  const originalRequestBaseUrl = new URL(relativeBase, requestedUrl).toString();
  const targetUrl = new URL(relativeTarget, runtimeBaseUrl).toString();
  const wrongTargetUrl = new URL(relativeTarget, originalRequestBaseUrl).toString();

  assert.notEqual(targetUrl, wrongTargetUrl, "Runtime-base fixture must fail if original request URL is used instead of page.url().");
  assert.equal(inventoryItem(staticRun.checker, targetUrl), null, "Runtime-base target must remain absent from static discovery.");

  const item = inventoryItem(checker, targetUrl);
  const result = renderResult(checker);
  assert.ok(item, "runtime-base-url final target should be inventoried.");
  assert.deepEqual(sourceTypes(item), ["rendered_dom"]);
  assert.equal(pathWithSearch(result.requestedUrl), "/fixtures/runtime-base-url");
  assert.equal(pathWithSearch(result.renderFinalUrl), "/runtime-history/current-page");
  assert.equal(result.documentBaseUrl, runtimeBaseUrl);
  assert.equal(pathWithSearch(item.representativeUrl), "/runtime-history/runtime-base/relative-target");
  assert.equal(inventoryItem(checker, wrongTargetUrl), null, "Original-request-based target must not be discovered.");
  return {
    requestedUrl,
    runtimeUrl,
    relativeBase,
    relativeTarget,
    runtimeBaseUrl,
    targetUrl,
    wrongTargetUrl,
    actualTargetUrl: item.representativeUrl,
  };
}

async function assertChallengeGuard(server) {
  const rawHtml = await readDynamicScanFixture("challenge-rendered");
  assert.equal(rawHtml.includes("Just a moment..."), false);
  assert.equal(rawHtml.toLowerCase().includes("captcha"), false);
  assert.equal(rawHtml.includes("/cdn-cgi/challenge-platform"), false);
  assert.equal(rawHtml.includes("/challenge-rendered/decoy-link"), false);

  const staticRun = await runFixture(server, "challenge-rendered", {
    dynamicRender: false,
  });
  const decoyUrl = new URL("/challenge-rendered/decoy-link", server.origin).toString();
  assert.equal(inventoryItem(staticRun.checker, decoyUrl), null);

  const snapshot = await captureChallengeRuntimeDom(server);
  assert.equal(snapshot.challengeSignalPresent, true);
  assert.equal(snapshot.decoyAnchorPresent, true);
  assert.equal(snapshot.decoyResolvedPath, "/challenge-rendered/decoy-link");

  const dynamicRun = await runFixture(server, "challenge-rendered", {
    dynamicRender: true,
    maxDepth: 1,
  });
  const result = renderResult(dynamicRun.checker);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.CHALLENGE_DETECTED);
  assert.equal(result.challenge.detected, true);
  assert.equal(inventoryItem(dynamicRun.checker, decoyUrl), null);
  assert.equal(dynamicRun.report.checked.some((entry) => entry.url === decoyUrl), false);
  assert.equal(dynamicRun.events.pageQueued.some((entry) => entry.path === "/challenge-rendered/decoy-link"), false);
  assert.equal(dynamicRun.checker.pageQueue.some((entry) => pathWithSearch(entry.url) === "/challenge-rendered/decoy-link"), false);
}

async function assertUnsettledExtraction(server) {
  const { checker } = await runFixture(server, "render-timeout", {
    dynamicRender: true,
    renderSettleMinMs: 100,
    renderSettleIntervalMs: 50,
    renderSettleStableSamples: 3,
    renderSettleMaxMs: 300,
  });
  const result = renderResult(checker);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED);
  assert.equal(result.settled, false);
  assert.equal(Array.isArray(result.links), true);
}

async function assertHtmlSizeGuard(server) {
  const { checker } = await runFixture(server, "static-html", {
    dynamicRender: true,
    maxRenderedHtmlBytes: 32,
  });
  const result = renderResult(checker);
  assert.equal(result.outcome, DYNAMIC_RENDER_OUTCOME.RENDER_HTML_TOO_LARGE);
  assert.equal(result.links.length, 0);
}

async function captureChallengeRuntimeDom(server) {
  const renderer = new DynamicRenderer({
    enabled: true,
    renderTimeoutMs: 5000,
    renderSettleMinMs: 100,
    renderSettleIntervalMs: 50,
    renderSettleStableSamples: 2,
    renderSettleMaxMs: 1000,
  });
  try {
    const startUrl = new URL(dynamicScanFixtures["challenge-rendered"].path, server.origin).toString();
    const result = await renderer.withPage(async ({ page }) => {
      await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 5000 });
      await page.waitForFunction(() => {
        const text = document.body.textContent || "";
        const decoy = document.querySelector("a[href='/challenge-rendered/decoy-link']");
        return text.includes("Just a moment...")
          && text.toLowerCase().includes("captcha")
          && Boolean(decoy);
      }, null, { timeout: 1000 });
      return page.evaluate(() => {
        const text = document.body.textContent || "";
        const decoy = document.querySelector("a[href='/challenge-rendered/decoy-link']");
        return {
          challengeSignalPresent: text.includes("Just a moment...")
            && text.toLowerCase().includes("captcha")
            && Boolean(document.querySelector("[data-challenge-platform]")),
          decoyAnchorPresent: Boolean(decoy),
          decoyResolvedPath: decoy ? new URL(decoy.getAttribute("href"), document.URL).pathname : null,
        };
      });
    });
    assert.equal(result.ok, true, "Challenge runtime DOM snapshot requires a supported local Browser.");
    return result.value;
  } finally {
    await renderer.close();
  }
}

async function assertRenderEligibilityGates(server) {
  const cases = [
    {
      label: "failed static HTTP",
      path: "/eligibility/failing-page",
      assertStaticCondition: async (startUrl) => {
        const response = await fetch(startUrl);
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("content-type")?.startsWith("text/html"), true);
      },
    },
    {
      label: "non-HTML",
      path: "/eligibility/non-html",
      assertStaticCondition: async (startUrl) => {
        const response = await fetch(startUrl);
        assert.equal(response.ok, true);
        assert.equal(response.headers.get("content-type")?.startsWith("text/plain"), true);
      },
    },
    {
      label: "bodyless",
      path: "/eligibility/bodyless-html",
      assertStaticCondition: async (startUrl) => {
        const response = await fetch(startUrl);
        const body = await response.text();
        assert.equal(response.ok, true);
        assert.equal(response.headers.get("content-type")?.startsWith("text/html"), true);
        assert.equal(body, "");
      },
    },
  ];

  for (const testCase of cases) {
    const startUrl = new URL(testCase.path, server.origin).toString();
    await testCase.assertStaticCondition(startUrl);
    const checker = makeChecker(startUrl, {
      dynamicRender: true,
      maxPages: 1,
    });
    const renderer = new CountingRenderer();
    checker.dynamicRenderer = renderer;
    await checker.run();
    assert.equal(checker.dynamicRenderAttemptedPages, 0, `${testCase.label} should not attempt render.`);
    assert.equal(renderer.renderAttempts, 0, `${testCase.label} should not call DynamicRenderer.renderPage().`);
    assert.equal(renderer.contextsCreated, 0, `${testCase.label} should not create BrowserContext.`);
    assert.equal(renderer.pagesCreated, 0, `${testCase.label} should not create Page.`);
  }
}

async function assertNavigationFailureAndTimeout(server) {
  const failure = await renderWithFakeNavigationError(
    createNavigationError("Error", "controlled local navigation failed"),
  );
  assert.equal(failure.result.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(failure.result.links.length, 0);
  assert.equal(failure.context.closeCount, 1);
  assert.equal(failure.provider.launchCount, 1);
  assert.equal(failure.browser.newContextCount, 1);

  const timeout = await renderWithFakeNavigationError(
    createNavigationError("TimeoutError", "Timeout 25ms exceeded"),
  );
  assert.equal(timeout.result.outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_TIMEOUT);
  assert.equal(timeout.result.links.length, 0);
  assert.equal(timeout.context.closeCount, 1);
  assert.equal(timeout.provider.launchCount, 1);
  assert.equal(timeout.browser.newContextCount, 1);

  const navigationFailureResult = {
    attempted: true,
    outcome: DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
    requestedUrl: new URL(dynamicScanFixtures["csr-basic"].path, server.origin).toString(),
    renderFinalUrl: new URL(dynamicScanFixtures["csr-basic"].path, server.origin).toString(),
    documentBaseUrl: null,
    links: [],
    linkCount: 0,
  };
  const startUrl = new URL(dynamicScanFixtures["csr-basic"].path, server.origin).toString();
  const checker = makeChecker(startUrl, {
    dynamicRender: true,
  });
  checker.dynamicRenderer = new CountingRenderer(navigationFailureResult);
  const report = await checker.run();
  assert.equal(checker.dynamicRenderResults[0].outcome, DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
  assert.equal(inventoryItem(checker, new URL("/csr-basic-same-origin", server.origin).toString()), null);
  assert.equal(report.checked.some((entry) => entry.url === startUrl && entry.ok === true), true);
}

async function assertRenderedCrawlQueueDepth(server) {
  const { checker, events } = await runFixture(server, "csr-basic", {
    dynamicRender: true,
    maxDepth: 1,
  });
  const internalUrl = new URL("/csr-basic-same-origin", server.origin).toString();
  const externalUrl = "https://dynamic.example/csr-basic-external";
  assert.ok(inventoryItem(checker, internalUrl));
  assert.ok(inventoryItem(checker, externalUrl));
  assert.deepEqual(events.pageQueued.filter((entry) => entry.path === "/csr-basic-same-origin"), [
    { path: "/csr-basic-same-origin", depth: 1 },
  ]);
  assert.equal(events.pageQueued.some((entry) => entry.path === "/csr-basic-same-origin" && entry.depth !== 1), false);
  assert.equal(events.pageQueued.some((entry) => entry.path.includes("dynamic.example")), false);
}

const fixtureFactory = createDynamicScanFixtureServer();
const server = await fixtureFactory.start();
try {
  await assertStaticControl(server);
  await assertRenderEligibilityGates(server);
  await assertNavigationFailureAndTimeout(server);
  const browserAvailable = await assertCsrBasic(server);
  if (!browserAvailable) {
    console.log("p1 rendered dom integration ENV_BLOCKED: supported local Browser unavailable.");
  } else {
    await assertCsrDelayed(server);
    await assertDuplicateLink(server);
    await assertRuntimeBase(server);
    await assertChallengeGuard(server);
    await assertRenderedCrawlQueueDepth(server);
    await assertUnsettledExtraction(server);
    await assertHtmlSizeGuard(server);
    console.log("ok p1 rendered dom integration");
  }
} finally {
  await server.close();
}
