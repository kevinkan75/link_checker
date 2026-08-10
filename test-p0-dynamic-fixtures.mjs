#!/usr/bin/env node

import vm from "node:vm";
import {
  LinkChecker,
  canonicalizeUrl,
} from "./link-checker.mjs";
import {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
  getDynamicScanExpectedUrls,
  readDynamicScanFixture,
} from "./fixtures/dynamic-scan/fixtures.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractInlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function extractStaticAnchors(html, pageUrl) {
  return [...html.matchAll(/<a\b[^>]*\shref=["']([^"']+)["'][^>]*>/gi)].map((match) => ({
    rawHref: match[1],
    resolvedUrl: new URL(match[1], pageUrl).toString(),
  }));
}

function extractElementIds(html) {
  const ids = new Map();
  for (const match of html.matchAll(/<([a-zA-Z][\w:-]*)\b[^>]*\sid=["']([^"']+)["'][^>]*>/g)) {
    ids.set(match[2], new TestElement(match[1]));
  }
  return ids;
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  set href(value) {
    this.setAttribute("href", value);
  }

  get href() {
    return this.getAttribute("href");
  }
}

function collectAnchors(root, output = []) {
  if (root.tagName === "a") {
    output.push(root);
  }
  for (const child of root.children) {
    collectAnchors(child, output);
  }
  return output;
}

function firstBaseHref(document) {
  return document.head.children
    .find((child) => child.tagName === "base" && child.getAttribute("href"))
    ?.getAttribute("href") || null;
}

function simulateRuntimeDom(html, pageUrl) {
  let currentUrl = pageUrl;
  const timers = [];
  const elementsById = extractElementIds(html);
  const document = {
    head: new TestElement("head"),
    body: new TestElement("body"),
    createElement: (tagName) => new TestElement(tagName),
    getElementById: (id) => elementsById.get(id) || null,
    addEventListener: (eventName, callback) => {
      if (eventName === "DOMContentLoaded") {
        callback();
      }
    },
  };

  for (const element of elementsById.values()) {
    document.body.appendChild(element);
  }

  for (const staticAnchor of extractStaticAnchors(html, pageUrl)) {
    const anchor = new TestElement("a");
    anchor.setAttribute("href", staticAnchor.rawHref);
    document.body.appendChild(anchor);
  }

  const context = {
    document,
    history: {
      pushState: (_state, _title, url) => {
        currentUrl = new URL(url, currentUrl).toString();
      },
    },
    location: {
      get href() {
        return currentUrl;
      },
      set href(value) {
        currentUrl = new URL(value, currentUrl).toString();
      },
    },
    setTimeout: (callback, delayMs) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
  };

  for (const script of extractInlineScripts(html)) {
    vm.runInNewContext(script, context, { timeout: 1000 });
  }

  timers.sort((left, right) => left.delayMs - right.delayMs);
  for (const timer of timers) {
    timer.callback();
  }

  const baseHref = firstBaseHref(document);
  const baseUrl = baseHref ? new URL(baseHref, currentUrl).toString() : currentUrl;
  const runtimeAnchors = collectAnchors(document.body).map((anchor) => ({
    rawHref: anchor.getAttribute("href"),
    resolvedUrl: new URL(anchor.getAttribute("href"), baseUrl).toString(),
  }));

  return {
    anchors: runtimeAnchors,
    baseUrl,
    currentUrl,
    timerDelays: timers.map((timer) => timer.delayMs),
  };
}

function canonicalSet(urls) {
  return new Set(urls.map((url) => canonicalizeUrl(url)));
}

async function httpGetText(url) {
  const response = await fetch(url);
  assert(response.ok, `Expected fixture fetch to succeed: ${url}`);
  return response.text();
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxPages: 1,
    maxDepth: 0,
    concurrency: 2,
    perHostConcurrency: 2,
    preferGet: true,
    ...options,
  });
}

const broadSiteLinkRules = {
  fields: {
    externalUrl: ["href", "url", "linkUrl"],
    youtubeId: [],
    routePath: ["href", "path", "routePath"],
  },
  routeMappings: [],
};

const staticDiscoveryModes = [
  { name: "spaLinks:auto", options: { spaLinks: "auto" } },
  { name: "spaLinks:strict", options: { spaLinks: "strict" } },
  { name: "spaLinks:auto+site-rules", options: { spaLinks: "auto", siteLinkRules: broadSiteLinkRules } },
];

function assertExpectedRuntimeUrls(origin, fixtureId, rendered) {
  const expected = canonicalSet(getDynamicScanExpectedUrls(origin, fixtureId));
  const actual = canonicalSet(rendered.anchors.map((anchor) => anchor.resolvedUrl));
  for (const expectedUrl of expected) {
    assert(actual.has(expectedUrl), `Expected runtime DOM URL for ${fixtureId}: ${expectedUrl}`);
  }
}

async function scanFixtureStatically(origin, fixtureId, options = {}) {
  const fixture = dynamicScanFixtures[fixtureId];
  const startUrl = new URL(fixture.path, origin).toString();
  const checker = makeChecker(startUrl, {
    checkExternal: false,
    ...options,
  });
  const report = await checker.run();
  return { checker, report, startUrl };
}

function getInventoryObservation(checker, targetUrl) {
  const canonicalUrl = checker.getCanonicalKey(targetUrl);
  const item = checker.inventory.get(canonicalUrl) || null;
  const inventorySources = item?.sources || [];
  const directSources = checker.sources.get(canonicalUrl) || [];
  const sources = [...inventorySources, ...directSources];
  const sourceTypes = [...new Set(sources.map((source) => source.sourceType).filter(Boolean))].sort();
  return {
    canonicalUrl,
    discovered: Boolean(item),
    sourceTypes,
    sourceCount: sources.length,
  };
}

async function assertTargetsNotStaticallyDiscovered(origin, fixtureId, targetUrls) {
  for (const mode of staticDiscoveryModes) {
    const { checker, report } = await scanFixtureStatically(origin, fixtureId, mode.options);
    for (const targetUrl of targetUrls) {
      const observation = getInventoryObservation(checker, targetUrl);
      const checked = report.checked.some((item) => checker.getResultCanonicalKey(item) === observation.canonicalUrl);
      const external = report.externalLinks.some((item) => (item.canonicalUrl || item.url) === observation.canonicalUrl);
      assert(
        !observation.discovered && !checked && !external,
        `${fixtureId} ${mode.name} should not statically discover ${targetUrl}; observed sourceTypes=${observation.sourceTypes.join(",") || "none"}.`,
      );
    }
  }
}

async function assertTargetOnlyHtmlAttribute(origin, fixtureId, targetUrl) {
  for (const mode of staticDiscoveryModes) {
    const { checker } = await scanFixtureStatically(origin, fixtureId, mode.options);
    const observation = getInventoryObservation(checker, targetUrl);
    assert(observation.discovered, `${fixtureId} ${mode.name} should statically discover ${targetUrl}.`);
    assert(
      observation.sourceTypes.length === 1 && observation.sourceTypes[0] === "html_attribute",
      `${fixtureId} ${mode.name} should discover ${targetUrl} only via html_attribute; observed sourceTypes=${observation.sourceTypes.join(",") || "none"}.`,
    );
  }
}

async function assertStaticHtmlFixture(origin) {
  const fixture = dynamicScanFixtures["static-html"];
  const startUrl = new URL(fixture.path, origin).toString();
  const rawHtml = await httpGetText(startUrl);

  for (const expectedUrl of getDynamicScanExpectedUrls(origin, "static-html")) {
    const expectedPath = new URL(expectedUrl).pathname;
    assert(rawHtml.includes(`href="${expectedPath}`), `Static fixture should include ${expectedPath} in initial HTML.`);
  }

  const report = await makeChecker(startUrl).run();
  const checked = canonicalSet(report.checked.map((item) => item.canonicalUrl || item.url));
  for (const expectedUrl of getDynamicScanExpectedUrls(origin, "static-html")) {
    assert(checked.has(canonicalizeUrl(expectedUrl)), `Static scanner should discover ${expectedUrl}.`);
  }
}

async function assertCsrBasicFixture(origin) {
  const fixture = dynamicScanFixtures["csr-basic"];
  const startUrl = new URL(fixture.path, origin).toString();
  const rawHtml = await httpGetText(startUrl);
  const [sameOriginUrl, externalUrl] = getDynamicScanExpectedUrls(origin, "csr-basic");

  assert(!rawHtml.includes(sameOriginUrl), "CSR basic raw HTML must not contain the resolved same-origin target URL.");
  assert(!rawHtml.includes(new URL(sameOriginUrl).pathname), "CSR basic raw HTML must not contain the same-origin target path.");
  assert(!rawHtml.includes(externalUrl), "CSR basic raw HTML must not contain the external target URL.");

  const rendered = simulateRuntimeDom(rawHtml, startUrl);
  assertExpectedRuntimeUrls(origin, "csr-basic", rendered);

  await assertTargetsNotStaticallyDiscovered(origin, "csr-basic", [sameOriginUrl, externalUrl]);
}

async function assertCsrDelayedFixture(origin) {
  const fixture = dynamicScanFixtures["csr-delayed"];
  const startUrl = new URL(fixture.path, origin).toString();
  const rawHtml = await readDynamicScanFixture("csr-delayed");
  const [expectedUrl] = getDynamicScanExpectedUrls(origin, "csr-delayed");

  assert(!rawHtml.includes(new URL(expectedUrl).pathname), "CSR delayed raw HTML must not contain the target path.");
  const rendered = simulateRuntimeDom(rawHtml, startUrl);
  assert(rendered.timerDelays.length === 1, "CSR delayed fixture should use one deterministic timer.");
  assert(rendered.timerDelays[0] === fixture.delayMs, "CSR delayed fixture timer should match the fixture contract.");
  assertExpectedRuntimeUrls(origin, "csr-delayed", rendered);
  await assertTargetsNotStaticallyDiscovered(origin, "csr-delayed", [expectedUrl]);
}

async function assertDuplicateLinkFixture(origin) {
  const fixture = dynamicScanFixtures["duplicate-link"];
  const startUrl = new URL(fixture.path, origin).toString();
  const rawHtml = await httpGetText(startUrl);
  const [expectedUrl] = getDynamicScanExpectedUrls(origin, "duplicate-link");

  assert(rawHtml.includes(`href="${fixture.duplicateCanonicalPath}"`), "Duplicate fixture should include the shared target in static HTML.");
  const rendered = simulateRuntimeDom(rawHtml, startUrl);
  const duplicateCount = rendered.anchors
    .map((anchor) => canonicalizeUrl(anchor.resolvedUrl))
    .filter((url) => url === canonicalizeUrl(expectedUrl)).length;
  assert(duplicateCount === 2, "Duplicate fixture should expose the same canonical URL statically and at runtime.");

  const report = await makeChecker(startUrl).run();
  const checked = canonicalSet(report.checked.map((item) => item.canonicalUrl || item.url));
  assert(checked.has(canonicalizeUrl(expectedUrl)), "Static side of duplicate fixture should remain discoverable.");
  await assertTargetOnlyHtmlAttribute(origin, "duplicate-link", expectedUrl);
}

async function assertRuntimeBaseUrlFixture(origin) {
  const fixture = dynamicScanFixtures["runtime-base-url"];
  const startUrl = new URL(fixture.path, origin).toString();
  const rawHtml = await httpGetText(startUrl);
  const [expectedUrl] = getDynamicScanExpectedUrls(origin, "runtime-base-url");

  assert(!rawHtml.includes(new URL(expectedUrl).pathname), "Runtime base fixture raw HTML must not contain the resolved target path.");
  const rendered = simulateRuntimeDom(rawHtml, startUrl);
  assert(rendered.currentUrl === new URL(fixture.runtimeHistoryPath, origin).toString(), "Runtime base fixture should update history state.");
  assert(rendered.baseUrl === new URL(fixture.runtimeBasePath, origin).toString(), "Runtime base fixture should create an explicit runtime base URL.");
  assertExpectedRuntimeUrls(origin, "runtime-base-url", rendered);
  assert(rendered.anchors.some((anchor) => anchor.resolvedUrl === expectedUrl), `Runtime base expected resolved URL should be ${expectedUrl}.`);
  await assertTargetsNotStaticallyDiscovered(origin, "runtime-base-url", [expectedUrl]);
}

async function main() {
  const fixtureServer = createDynamicScanFixtureServer();
  const server = await fixtureServer.start();
  let closed = false;

  try {
    await assertStaticHtmlFixture(server.origin);
    await assertCsrBasicFixture(server.origin);
    await assertCsrDelayedFixture(server.origin);
    await assertDuplicateLinkFixture(server.origin);
    await assertRuntimeBaseUrlFixture(server.origin);
  } finally {
    await server.close();
    closed = true;
  }

  assert(closed, "Dynamic scan fixture server should shut down cleanly.");
  console.log("ok p0 dynamic fixtures");
}

main().catch((error) => {
  console.error(`test-p0-dynamic-fixtures: ${error.message}`);
  process.exitCode = 1;
});
