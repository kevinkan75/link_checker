#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import {
  LinkChecker,
  REPORT_SCHEMA_VERSION,
} from "./link-checker.mjs";
import {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
  getDynamicScanExpectedUrls,
} from "./fixtures/dynamic-scan/fixtures.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected, null, 2)}\nactual: ${JSON.stringify(actual, null, 2)}`);
  }
}

function pathWithSearch(url) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function makeChecker(startUrl, events, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxPages: 10,
    maxDepth: 1,
    concurrency: 2,
    perHostConcurrency: 2,
    preferGet: true,
    checkExternal: false,
    spaLinks: "strict",
    reporter: {
      start: () => {},
      stop: () => {},
      pageStarted: (url, depth) => events.pageStarted.push({ path: pathWithSearch(url), depth }),
      pageQueued: (url, depth) => events.pageQueued.push({ path: pathWithSearch(url), depth }),
      pageLinksFound: () => {},
      externalSkipped: (url, sourcePageUrl) => events.externalSkipped.push({
        path: pathWithSearch(url),
        sourcePagePath: pathWithSearch(sourcePageUrl),
      }),
      requestQueued: () => {},
      requestFinished: () => {},
    },
    ...options,
  });
}

async function runFixture(server, fixtureId, options = {}) {
  const events = {
    pageStarted: [],
    pageQueued: [],
    externalSkipped: [],
  };
  const startUrl = new URL(dynamicScanFixtures[fixtureId].path, server.origin).toString();
  const checker = makeChecker(startUrl, events, options);
  const report = await checker.run();
  return { checker, report, events, startUrl };
}

function projectInventory(checker) {
  return [...checker.inventory.values()]
    .map((item) => ({
      path: pathWithSearch(item.representativeUrl),
      isExternal: item.isExternal,
      shouldCheck: item.shouldCheck,
      shouldCrawl: item.shouldCrawl,
      needsStatusCheck: item.needsStatusCheck,
      needsBodyFetch: item.needsBodyFetch,
      statusValidationScheduled: item.statusValidationScheduled,
      bodyValidationScheduled: item.bodyValidationScheduled,
      checked: item.checked,
      bodyFetched: item.bodyFetched,
      sourceTypes: [...new Set(item.sources.map((source) => source.sourceType))].sort(),
      sourceCount: item.sources.length,
      sources: item.sources
        .map((source) => ({
          pagePath: pathWithSearch(source.page),
          tag: source.tag,
          attribute: source.attribute,
          text: source.text.startsWith("http://127.0.0.1:")
            ? new URL(source.text).pathname + new URL(source.text).search
            : source.text,
          sourceType: source.sourceType,
          rawValue: source.rawValue.startsWith("http://127.0.0.1:")
            ? new URL(source.rawValue).pathname + new URL(source.rawValue).search
            : source.rawValue,
          resolvedPath: pathWithSearch(source.resolvedUrl),
        }))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function projectReport(checker, report, events) {
  return {
    schemaVersion: report.schemaVersion,
    hasSecurityPolicy: Boolean(report.securityPolicy),
    hasPhase3DiscoverySchema: report.checked.some((item) => Object.prototype.hasOwnProperty.call(item, "discovery")),
    checkedHasFullSources: report.checked.some((item) => Object.prototype.hasOwnProperty.call(item, "sources")),
    inventorySummary: report.summary.inventorySummary,
    skippedExternal: report.summary.skippedExternal,
    canonicalPaths: projectInventory(checker).map((item) => item.path),
    checkedPaths: report.checked.map((item) => pathWithSearch(item.url)).sort(),
    broken: report.broken.map((item) => ({
      path: pathWithSearch(item.url),
      sourceCount: item.sourceCount,
      sourceTypes: item.sources.map((source) => source.sourceType).sort(),
    })),
    externalLinks: report.externalLinks.map((item) => ({
      path: pathWithSearch(item.url),
      checked: item.checked,
      sourceCount: item.sourceCount,
      sourceTypes: item.sources.map((source) => source.sourceType).sort(),
      sourceFields: item.sources.map((source) => ({
        pagePath: pathWithSearch(source.page),
        tag: source.tag,
        attribute: source.attribute,
        textPath: source.text.startsWith("http://127.0.0.1:")
          ? new URL(source.text).pathname + new URL(source.text).search
          : source.text,
      })),
    })),
    inventory: projectInventory(checker),
    pageStarted: events.pageStarted,
    pageQueued: events.pageQueued,
    externalSkipped: events.externalSkipped,
    remainingPageQueue: checker.pageQueue.map((item) => ({ path: pathWithSearch(item.url), depth: item.depth })),
    validationQueueLength: checker.validationQueue.length,
  };
}

function assertReportCompatibility(projection, fixtureId) {
  assert(projection.schemaVersion === "1.3.0", `${fixtureId} should keep report schema 1.3.0.`);
  assert(projection.hasSecurityPolicy, `${fixtureId} should keep root securityPolicy.`);
  assert(!projection.hasPhase3DiscoverySchema, `${fixtureId} should not add checked[].discovery.`);
  assert(!projection.checkedHasFullSources, `${fixtureId} should not add checked[].sources.`);
}

function assertInventoryFlags(item, expected, label) {
  assertDeepEqual({
    isExternal: item.isExternal,
    shouldCheck: item.shouldCheck,
    shouldCrawl: item.shouldCrawl,
    needsStatusCheck: item.needsStatusCheck,
    needsBodyFetch: item.needsBodyFetch,
    statusValidationScheduled: item.statusValidationScheduled,
    bodyValidationScheduled: item.bodyValidationScheduled,
    checked: item.checked,
    bodyFetched: item.bodyFetched,
    sourceTypes: item.sourceTypes,
    sourceCount: item.sourceCount,
  }, expected, `${label} inventory flags/provenance changed.`);
}

async function assertProcessPageUsesSharedIngestion() {
  const source = await readFile(new URL("./link-checker.mjs", import.meta.url), "utf8");
  const processPageStart = source.indexOf("  async processPage(");
  const ingestionStart = source.indexOf("  ingestDiscoveredLinks(", processPageStart);
  assert(processPageStart >= 0 && ingestionStart > processPageStart, "Expected processPage and ingestDiscoveredLinks methods.");
  const processPageBody = source.slice(processPageStart, ingestionStart);
  assert(processPageBody.includes("this.ingestDiscoveredLinks(links,"), "processPage should call shared ingestion.");
  assert(!processPageBody.includes("this.addInventoryItem("), "processPage should not directly add inventory items.");
  assert(!processPageBody.includes("this.enqueueValidation("), "processPage should not directly enqueue validation.");
  assert(!processPageBody.includes("this.enqueuePage("), "processPage should not directly enqueue crawl pages.");
}

async function assertStaticHtmlProjection(server) {
  const { checker, report, events } = await runFixture(server, "static-html");
  const projection = projectReport(checker, report, events);
  assertReportCompatibility(projection, "static-html");
  assertDeepEqual(projection.inventorySummary, {
    urlsDiscovered: 2,
    uniqueCanonicalUrls: 2,
    duplicateUrlReferences: 0,
    sourcesMerged: 0,
    validationSkippedByInventory: 0,
    statusCacheHits: 0,
    bodyCacheHits: 0,
    inventoryMergeRatio: 0,
  }, "static-html inventory summary changed.");
  assertDeepEqual(projection.canonicalPaths, [
    "/static-html/secondary-link?case=static",
    "/static-html/visible-link",
  ], "static-html canonical URL set changed.");
  assertDeepEqual(projection.checkedPaths, [
    "/fixtures/static-html",
    "/static-html/secondary-link?case=static",
    "/static-html/visible-link",
  ], "static-html validation scheduling changed.");
  assertDeepEqual(projection.pageQueued, [
    { path: "/static-html/visible-link", depth: 1 },
    { path: "/static-html/secondary-link?case=static", depth: 1 },
  ], "static-html crawl queue changed.");
  assertDeepEqual(projection.pageStarted, [
    { path: "/fixtures/static-html", depth: 0 },
    { path: "/static-html/visible-link", depth: 1 },
    { path: "/static-html/secondary-link?case=static", depth: 1 },
  ], "static-html crawl depth changed.");
  for (const item of projection.inventory) {
    assertInventoryFlags(item, {
      isExternal: false,
      shouldCheck: true,
      shouldCrawl: true,
      needsStatusCheck: true,
      needsBodyFetch: true,
      statusValidationScheduled: true,
      bodyValidationScheduled: true,
      checked: true,
      bodyFetched: true,
      sourceTypes: ["html_attribute"],
      sourceCount: 1,
    }, `static-html ${item.path}`);
    assert(item.sources[0].pagePath === "/fixtures/static-html", "static-html source page changed.");
    assert(item.sources[0].tag === "a" && item.sources[0].attribute === "href", "static-html source tag/attribute changed.");
  }
}

async function assertDuplicateProjection(server) {
  const { checker, report, events } = await runFixture(server, "duplicate-link");
  const projection = projectReport(checker, report, events);
  assertReportCompatibility(projection, "duplicate-link");
  assertDeepEqual(projection.inventorySummary, {
    urlsDiscovered: 1,
    uniqueCanonicalUrls: 1,
    duplicateUrlReferences: 0,
    sourcesMerged: 0,
    validationSkippedByInventory: 0,
    statusCacheHits: 0,
    bodyCacheHits: 0,
    inventoryMergeRatio: 0,
  }, "duplicate-link inventory summary changed.");
  assertDeepEqual(projection.canonicalPaths, ["/duplicate-link/shared-target"], "duplicate-link canonical URL set changed.");
  assertDeepEqual(projection.checkedPaths, [
    "/duplicate-link/shared-target",
    "/fixtures/duplicate-link",
  ], "duplicate-link validation scheduling changed.");
  assertDeepEqual(projection.pageQueued, [
    { path: "/duplicate-link/shared-target", depth: 1 },
  ], "duplicate-link crawl queue changed.");
  assertInventoryFlags(projection.inventory[0], {
    isExternal: false,
    shouldCheck: true,
    shouldCrawl: true,
    needsStatusCheck: true,
    needsBodyFetch: true,
    statusValidationScheduled: true,
    bodyValidationScheduled: true,
    checked: true,
    bodyFetched: true,
    sourceTypes: ["html_attribute"],
    sourceCount: 1,
  }, "duplicate-link shared target");
}

async function assertRuntimeOnlyStaticAbsence(server) {
  for (const fixtureId of ["csr-basic", "csr-delayed"]) {
    const { checker, report, events } = await runFixture(server, fixtureId, { maxPages: 1, maxDepth: 0 });
    const projection = projectReport(checker, report, events);
    assertReportCompatibility(projection, fixtureId);
    assertDeepEqual(projection.inventorySummary, {
      urlsDiscovered: 0,
      uniqueCanonicalUrls: 0,
      duplicateUrlReferences: 0,
      sourcesMerged: 0,
      validationSkippedByInventory: 0,
      statusCacheHits: 0,
      bodyCacheHits: 0,
      inventoryMergeRatio: 0,
    }, `${fixtureId} static inventory summary changed.`);
    assertDeepEqual(projection.canonicalPaths, [], `${fixtureId} should remain statically undiscovered.`);
    for (const expectedUrl of getDynamicScanExpectedUrls(server.origin, fixtureId)) {
      const canonicalUrl = checker.getCanonicalKey(expectedUrl);
      assert(!checker.inventory.has(canonicalUrl), `${fixtureId} runtime target became statically discoverable: ${expectedUrl}`);
    }
  }
}

async function assertRuntimeBaseProjection(server) {
  const { checker, report, events } = await runFixture(server, "runtime-base-url");
  const projection = projectReport(checker, report, events);
  assertReportCompatibility(projection, "runtime-base-url");
  assertDeepEqual(projection.inventorySummary, {
    urlsDiscovered: 2,
    uniqueCanonicalUrls: 2,
    duplicateUrlReferences: 0,
    sourcesMerged: 0,
    validationSkippedByInventory: 0,
    statusCacheHits: 0,
    bodyCacheHits: 0,
    inventoryMergeRatio: 0,
  }, "runtime-base-url inventory summary changed.");
  assertDeepEqual(projection.canonicalPaths, [
    "/runtime-base/",
    "/runtime-history/current-page",
  ], "runtime-base-url static canonical URL set changed.");
  assert(!projection.canonicalPaths.includes("/runtime-base/relative-target"), "runtime-base-url final runtime target became statically discoverable.");
  assertDeepEqual(projection.pageQueued, [
    { path: "/runtime-history/current-page", depth: 1 },
    { path: "/runtime-base/", depth: 1 },
  ], "runtime-base-url crawl queue changed.");
  for (const item of projection.inventory) {
    assertInventoryFlags(item, {
      isExternal: false,
      shouldCheck: true,
      shouldCrawl: true,
      needsStatusCheck: true,
      needsBodyFetch: true,
      statusValidationScheduled: true,
      bodyValidationScheduled: true,
      checked: true,
      bodyFetched: true,
      sourceTypes: ["spa_payload"],
      sourceCount: 1,
    }, `runtime-base-url ${item.path}`);
    assert(item.sources[0].tag === "payload" && item.sources[0].attribute === "payload:path", "runtime-base-url payload provenance changed.");
  }
}

async function assertExternalProjection(server) {
  const { checker, report, events } = await runFixture(server, "render-cross-origin-navigation", {
    maxPages: 1,
    maxDepth: 0,
    spaLinks: "strict",
  });
  const projection = projectReport(checker, report, events);
  assertReportCompatibility(projection, "render-cross-origin-navigation");
  assertDeepEqual(projection.inventorySummary, {
    urlsDiscovered: 2,
    uniqueCanonicalUrls: 1,
    duplicateUrlReferences: 1,
    sourcesMerged: 1,
    validationSkippedByInventory: 0,
    statusCacheHits: 0,
    bodyCacheHits: 0,
    inventoryMergeRatio: 0.5,
  }, "cross-origin external inventory summary changed.");
  assert(projection.skippedExternal === 2, "cross-origin skippedExternal count changed.");
  assertDeepEqual(projection.checkedPaths, [
    "/fixtures/render-cross-origin-navigation",
  ], "cross-origin external URL should not be validated when checkExternal is false.");
  assertDeepEqual(projection.canonicalPaths, [
    "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
  ], "cross-origin external canonical URL set changed.");
  assertDeepEqual(projection.externalLinks.map((item) => ({
    path: item.path,
    checked: item.checked,
    sourceCount: item.sourceCount,
    sourceTypes: item.sourceTypes,
    sourceFields: item.sourceFields,
  })), [
    {
      path: "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
      checked: false,
      sourceCount: 2,
      sourceTypes: ["script_literal", "script_literal"],
      sourceFields: [
        {
          pagePath: "/fixtures/render-cross-origin-navigation",
          tag: "script",
          attribute: "location.assign",
          textPath: "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
        },
        {
          pagePath: "/fixtures/render-cross-origin-navigation",
          tag: "payload",
          attribute: "payload:url",
          textPath: "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
        },
      ],
    },
  ], "cross-origin external provenance changed.");
  assertDeepEqual(projection.externalSkipped, [
    {
      path: "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
      sourcePagePath: "/fixtures/render-cross-origin-navigation",
    },
    {
      path: "/observe/cross-origin-target?fixture=render-cross-origin-navigation",
      sourcePagePath: "/fixtures/render-cross-origin-navigation",
    },
  ], "cross-origin external skip reporting changed.");
  assertDeepEqual(server.getState().requests.map((request) => ({
    serverRole: request.serverRole,
    method: request.method,
    path: request.path,
  })), [
    {
      serverRole: "primary",
      method: "GET",
      path: "/fixtures/render-cross-origin-navigation",
    },
  ], "cross-origin fixture should not contact the secondary origin during static ingestion.");
}

await assertProcessPageUsesSharedIngestion();
assert(REPORT_SCHEMA_VERSION === "1.3.0", "REPORT_SCHEMA_VERSION should remain 1.3.0.");

const fixtureFactory = createDynamicScanFixtureServer();
const server = await fixtureFactory.start();
try {
  await assertStaticHtmlProjection(server);
  await assertDuplicateProjection(server);
  await assertRuntimeOnlyStaticAbsence(server);
  await assertRuntimeBaseProjection(server);
  server.resetState();
  await assertExternalProjection(server);
} finally {
  await server.close();
}

console.log("ok p0 ingestion refactor");
