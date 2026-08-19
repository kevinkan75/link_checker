#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LinkChecker } from "./link-checker.mjs";

const XML_FIELDS = [
  "status",
  "reason",
  "attempted",
  "candidateLimit",
  "candidatesTried",
  "accepted",
  "acceptedUrl",
  "sitemapType",
  "urlsDiscovered",
  "urlsSeeded",
].sort();

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function requestCount(requestCounts, pathname) {
  return [...requestCounts.entries()]
    .filter(([requestUrl]) => new URL(requestUrl, "http://localhost").pathname === pathname)
    .reduce((total, [, count]) => total + count, 0);
}

async function startServer(handler) {
  const requestCounts = new Map();
  const server = createServer((request, response) => {
    requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    requestCounts,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function withServer(handler, task) {
  const fixture = await startServer(handler);
  try {
    return await task(fixture.origin, fixture.requestCounts);
  } finally {
    await fixture.close();
  }
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    confirm404: false,
    preferGet: true,
    requestDelayMs: 0,
    concurrency: 1,
    perHostConcurrency: 1,
    maxDepth: 2,
    maxPages: 10,
    ...options,
  });
}

function html(body) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

function writeHtml(response, body, status = 200) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html(body));
}

function writeXml(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/xml; charset=utf-8" });
  response.end(body);
}

function writeNotFound(response) {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("missing");
}

function writeRedirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function urlset(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url><loc>${url.replaceAll("&", "&amp;")}</loc></url>`).join("\n")}
</urlset>`;
}

function sitemapindex(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <sitemap><loc>${url.replaceAll("&", "&amp;")}</loc></sitemap>`).join("\n")}
</sitemapindex>`;
}

function writeUsefulHtmlFallback(request, response) {
  if (new URL(request.url, "http://localhost").pathname === "/siteinformation/sitemap") {
    writeHtml(response, '<a href="/from-html-fallback">Fallback page</a>');
    return true;
  }
  return false;
}

function assertNoProbePollution(report, sitemapUrl) {
  assert(!report.checked.some((item) => item.url === sitemapUrl), "Auto XML probe must not enter checked results.");
  assert(!report.broken.some((item) => item.url === sitemapUrl), "Auto XML probe must not enter broken results.");
}

async function assertNormalFrontierSuppressesXml() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, '<a href="/normal-page">Normal</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/`).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assertEqual(requestCount(requestCounts, "/sitemap.xml"), 0, "Normal frontier must suppress XML probing.");
    assert(report.checked.some((item) => item.url === `${origin}/normal-page`), "Normal page should be crawled.");
    assertEqual(xml.status, "not_needed", "XML status should be not_needed.");
    assertEqual(xml.reason, "normal_frontier_present", "XML reason should identify the normal frontier.");
    assertEqual(xml.attempted, false, "XML fallback should not be attempted.");
    assertEqual(xml.candidatesTried, 0, "No XML candidates should be tried.");
    assertEqual(fallback.status, "not_needed", "HTML fallback should be not_needed.");
    assertEqual(fallback.reason, "normal_frontier_present", "HTML fallback should identify the normal frontier.");
  });
}

async function assertExplicitSitemapPrecedence() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p12-2a-explicit-"));
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        writeHtml(response, "<p>empty frontier</p>");
        return;
      }
      writeHtml(response, "<p>ok</p>");
    }, async (origin, requestCounts) => {
      const sitemapFile = path.join(tempDir, "explicit.xml");
      await writeFile(sitemapFile, urlset([`${origin}/explicit-seed`]), "utf8");
      const checker = makeChecker(`${origin}/`, {
        sitemap: sitemapFile,
        stateFile: path.join(tempDir, "state.json"),
        incrementalStateWrite: false,
      });
      const report = await checker.run();
      const xml = report.summary.discoveryFallback.xmlSitemap;
      assertEqual(requestCount(requestCounts, "/sitemap.xml"), 0, "Explicit sitemap must suppress the conventional probe.");
      assert(report.checked.some((item) => item.url === `${origin}/explicit-seed`), "Explicit sitemap seed should be crawled.");
      assertEqual(report.options.sitemap, sitemapFile, "Report must preserve the explicit sitemap option.");
      assertEqual(checker.effectiveSitemap?.provenance, "explicit", "Effective sitemap provenance must remain explicit.");
      assertEqual(xml.status, "not_needed", "XML fallback should be not_needed for explicit sitemap input.");
      assertEqual(xml.reason, "explicit_sitemap", "XML fallback should report explicit_sitemap.");
      assertEqual(xml.attempted, false, "Conventional XML fallback must not be attempted.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertValidAutoUrlsetAccepted() {
  await withServer((request, response) => {
    const origin = `http://${request.headers.host}`;
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeXml(response, urlset([`${origin}/auto-a`, `${origin}/auto-b`]));
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/`).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assertEqual(requestCount(requestCounts, "/sitemap.xml"), 1, "Auto sitemap should be requested exactly once.");
    assert(report.summary.pagesCrawled > 1, "Auto sitemap should add crawl pages.");
    assertEqual(xml.status, "accepted", "Valid auto sitemap should be accepted.");
    assertEqual(xml.reason, "empty_initial_frontier", "Accepted fallback should record its trigger.");
    assertEqual(xml.attempted, true, "Accepted fallback should be attempted.");
    assertEqual(xml.candidateLimit, 1, "Auto XML candidate limit should remain one.");
    assertEqual(xml.candidatesTried, 1, "Exactly one XML candidate should be tried.");
    assertEqual(xml.accepted, true, "Auto XML diagnostic should mark acceptance.");
    assertEqual(xml.sitemapType, "urlset", "Auto XML type should be urlset.");
    assert(xml.urlsDiscovered > 0, "Auto sitemap should report discovered URLs.");
    assert(xml.urlsSeeded > 0, "Auto sitemap should report applied seeds.");
    assertEqual(fallback.status, "not_needed", "HTML fallback should not run after XML acceptance.");
    assertEqual(fallback.reason, "xml_sitemap_accepted", "HTML fallback should explain XML acceptance.");
    assertEqual(fallback.attempted, false, "HTML fallback should remain unattempted.");
    assertEqual(report.options.sitemap, null, "Auto discovery must not populate options.sitemap.");
  });
}

async function assertAuto404ContinuesHtmlFallback() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeNotFound(response);
      return;
    }
    if (writeUsefulHtmlFallback(request, response)) {
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/`).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assertEqual(requestCount(requestCounts, "/sitemap.xml"), 1, "Missing XML candidate should be requested once.");
    assertEqual(xml.status, "not_found", "Missing XML sitemap should be not_found.");
    assertEqual(xml.reason, "fetch_failed", "Missing XML sitemap should report fetch_failed.");
    assertEqual(xml.attempted, true, "Missing XML candidate should be attempted.");
    assertEqual(xml.candidatesTried, 1, "Missing XML candidate should count as tried.");
    assertEqual(xml.accepted, false, "Missing XML candidate must not be accepted.");
    assertNoProbePollution(report, `${origin}/sitemap.xml`);
    assertEqual(fallback.status, "accepted", "HTML fallback should continue after XML 404.");
    assert(report.checked.some((item) => item.url === `${origin}/from-html-fallback`), "HTML fallback page should be crawled.");
  });
}

async function assertUnsupportedXmlContinuesHtmlFallback() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeXml(response, "<?xml version=\"1.0\"?><unsupported><loc>/ignored</loc></unsupported>");
      return;
    }
    if (writeUsefulHtmlFallback(request, response)) {
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const report = await makeChecker(`${origin}/`).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    assertEqual(xml.status, "not_found", "Unsupported XML should be not_found.");
    assertEqual(xml.reason, "unsupported_sitemap", "Unsupported XML should report unsupported_sitemap.");
    assertEqual(xml.urlsSeeded, 0, "Unsupported XML must produce no seeds.");
    assertEqual(report.runStatus.status, "complete", "Unsupported XML must not crash the scan.");
    assertEqual(report.summary.discoveryFallback.htmlSitemap.status, "accepted", "HTML fallback should remain available.");
    assertNoProbePollution(report, `${origin}/sitemap.xml`);
  });
}

async function assertValidSitemapWithZeroUsableSeeds() {
  let otherOrigin;
  const other = await startServer((request, response) => writeHtml(response, "<p>cross origin</p>"));
  otherOrigin = other.origin;
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        writeHtml(response, "<p>empty frontier</p>");
        return;
      }
      if (request.url === "/sitemap.xml") {
        writeXml(response, urlset([`${otherOrigin}/cross-origin-seed`]));
        return;
      }
      if (writeUsefulHtmlFallback(request, response)) {
        return;
      }
      writeHtml(response, "<p>ok</p>");
    }, async (origin) => {
      const checker = makeChecker(`${origin}/`);
      const report = await checker.run();
      const xml = report.summary.discoveryFallback.xmlSitemap;
      const crossUrl = `${otherOrigin}/cross-origin-seed`;
      const crossKey = checker.getCanonicalKey(crossUrl);
      assertEqual(xml.status, "not_found", "Zero-seed sitemap should be not_found.");
      assertEqual(xml.reason, "no_usable_seed", "Zero-seed sitemap should report no_usable_seed.");
      assertEqual(xml.sitemapType, "urlset", "Parser should identify the valid urlset.");
      assertEqual(xml.urlsDiscovered, 1, "Diagnostic should retain the parsed entry count.");
      assertEqual(xml.urlsSeeded, 0, "Cross-origin entry must not seed.");
      assertEqual(requestCount(other.requestCounts, "/cross-origin-seed"), 0, "Cross-origin sitemap entry must not be requested.");
      assert(!report.checked.some((item) => item.url === crossUrl), "Cross-origin sitemap entry must not be checked.");
      assert(!checker.queuedPages.has(crossUrl), "Rejected sitemap entry must not be queued.");
      assert(!checker.inventory.has(crossKey), "Rejected sitemap entry must not enter inventory.");
      assert(!checker.sources.has(crossKey), "Rejected sitemap entry must not gain a source record.");
      assertEqual(checker.effectiveSitemap, null, "Rejected auto sitemap must not become effective state.");
      assertEqual(checker.sitemapEntries.length, 0, "Rejected auto sitemap entries must not be committed.");
      assertEqual(report.summary.discoveryFallback.htmlSitemap.status, "accepted", "HTML fallback should continue.");
    });
  } finally {
    await other.close();
  }
}

async function assertMaxDepthPreserved() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    writeHtml(response, '<a href="/budget-bypass">No</a>');
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/`, { maxDepth: 0 }).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assertEqual(requestCount(requestCounts, "/sitemap.xml"), 0, "maxDepth=0 must suppress XML probing.");
    assertEqual(xml.status, "skipped", "XML fallback should be skipped at maxDepth=0.");
    assertEqual(xml.reason, "max_depth", "XML fallback should report max_depth.");
    assertEqual(xml.attempted, false, "Depth-skipped XML fallback must not be attempted.");
    assertEqual(xml.candidatesTried, 0, "Depth-skipped XML fallback must try no candidates.");
    assertEqual(report.summary.pagesCrawled, 1, "Depth budget must not be bypassed.");
    assertEqual(fallback.status, "skipped", "HTML fallback should preserve its max-depth behavior.");
    assertEqual(fallback.reason, "max_depth", "HTML fallback should report max_depth.");
  });
}

async function assertMaxPagesPreserved() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    writeHtml(response, '<a href="/budget-bypass">No</a>');
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/`, { maxPages: 1 }).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assertEqual(requestCount(requestCounts, "/sitemap.xml"), 0, "Exhausted maxPages must suppress XML probing.");
    assertEqual(xml.status, "skipped", "XML fallback should be skipped when page budget is exhausted.");
    assertEqual(xml.reason, "max_pages", "XML fallback should report max_pages.");
    assertEqual(xml.attempted, false, "Page-skipped XML fallback must not be attempted.");
    assertEqual(xml.candidatesTried, 0, "Page-skipped XML fallback must try no candidates.");
    assertEqual(report.summary.pagesCrawled, 1, "Page budget must not be bypassed.");
    assertEqual(fallback.status, "skipped", "HTML fallback should preserve its max-pages behavior.");
    assertEqual(fallback.reason, "max_pages", "HTML fallback should report max_pages.");
  });
}

async function assertPartialPageBudgetPreserved() {
  await withServer((request, response) => {
    const origin = `http://${request.headers.host}`;
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeXml(response, urlset([`${origin}/one`, `${origin}/two`, `${origin}/three`]));
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const checker = makeChecker(`${origin}/`, { maxPages: 2 });
    const report = await checker.run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    assertEqual(xml.status, "accepted", "One available slot should accept one sitemap seed.");
    assertEqual(xml.urlsDiscovered, 3, "All parsed entries should be reported.");
    assertEqual(xml.urlsSeeded, 1, "Diagnostic must report the one applied seed.");
    assertEqual(checker.sitemapSeed.seeded, 1, "Seed summary should preserve maxPages.");
    assertEqual(checker.sitemapSeed.ignoredByReason.max_pages, 2, "Remaining entries should be rejected by maxPages.");
    assert(report.summary.pagesCrawled <= 2, "Crawl must remain within maxPages.");
  });
}

async function assertAutoRootRedirectOutsideOrigin() {
  let startOrigin;
  const outside = await startServer((request, response) => {
    if (request.url === "/outside-sitemap.xml") {
      writeXml(response, urlset([`${startOrigin}/rejected-root-seed`]));
      return;
    }
    writeNotFound(response);
  });
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        writeHtml(response, "<p>empty frontier</p>");
        return;
      }
      if (request.url === "/sitemap.xml") {
        writeRedirect(response, `${outside.origin}/outside-sitemap.xml`);
        return;
      }
      if (writeUsefulHtmlFallback(request, response)) {
        return;
      }
      writeHtml(response, "<p>ok</p>");
    }, async (origin) => {
      startOrigin = origin;
      const checker = makeChecker(`${origin}/`);
      const report = await checker.run();
      const xml = report.summary.discoveryFallback.xmlSitemap;
      assertEqual(requestCount(outside.requestCounts, "/outside-sitemap.xml"), 1, "Redirect target should be fetched before final-origin validation.");
      assertEqual(xml.status, "not_found", "Outside-origin redirect should reject the auto sitemap.");
      assertEqual(xml.reason, "fetch_failed", "Outside-origin redirect should report fetch_failed.");
      assert(!report.checked.some((item) => item.url === `${origin}/rejected-root-seed`), "Rejected redirect body must not seed a page.");
      assertEqual(checker.sitemapEntries.length, 0, "Rejected root body must not be committed.");
      assertEqual(report.summary.discoveryFallback.htmlSitemap.status, "accepted", "HTML fallback should continue after root redirect rejection.");
    });
  } finally {
    await outside.close();
  }
}

async function assertSitemapIndexChildRedirectRegression() {
  let startOrigin;
  const outside = await startServer((request, response) => {
    if (request.url === "/outside-child.xml") {
      writeXml(response, urlset([`${startOrigin}/distinctive-rejected-child-page`]));
      return;
    }
    writeNotFound(response);
  });
  try {
    await withServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.url === "/") {
        writeHtml(response, "<p>empty frontier</p>");
        return;
      }
      if (request.url === "/sitemap.xml") {
        writeXml(response, sitemapindex([`${origin}/good-child.xml`, `${origin}/redirect-child.xml`]));
        return;
      }
      if (request.url === "/good-child.xml") {
        writeXml(response, urlset([`${origin}/valid-sibling-page`]));
        return;
      }
      if (request.url === "/redirect-child.xml") {
        writeRedirect(response, `${outside.origin}/outside-child.xml`);
        return;
      }
      writeHtml(response, "<p>ok</p>");
    }, async (origin) => {
      startOrigin = origin;
      const checker = makeChecker(`${origin}/`);
      const report = await checker.run();
      const xml = report.summary.discoveryFallback.xmlSitemap;
      const rejectedUrl = `${origin}/distinctive-rejected-child-page`;
      assertEqual(requestCount(outside.requestCounts, "/outside-child.xml"), 1, "Redirected child response should be fetched for final-origin validation.");
      assertEqual(xml.status, "accepted", "Compliant sibling should allow sitemapindex acceptance.");
      assertEqual(xml.sitemapType, "sitemapindex", "Root sitemap type should remain sitemapindex.");
      assertEqual(xml.urlsDiscovered, 1, "Rejected child body must not add entries.");
      assertEqual(xml.urlsSeeded, 1, "Only compliant sibling entry should seed.");
      assert(report.checked.some((item) => item.url === `${origin}/valid-sibling-page`), "Compliant sibling page should be crawled.");
      assert(!report.checked.some((item) => item.url === rejectedUrl), "Rejected child body must not be crawled.");
      assert(!checker.queuedPages.has(rejectedUrl), "Rejected child body must not be queued.");
      assert(checker.sitemap.warnings.some((warning) => warning.code === "sitemap_child_redirect_outside_crawl_origin"), "Rejected child should remain isolated as a sitemap warning.");
    });
  } finally {
    await outside.close();
  }
}

async function assertAcceptedRedirectUrlRedaction() {
  await withServer((request, response) => {
    const origin = `http://${request.headers.host}`;
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeRedirect(response, "/real-sitemap.xml?token=secret-value&view=full");
      return;
    }
    if (request.url === "/real-sitemap.xml?token=secret-value&view=full") {
      writeXml(response, urlset([`${origin}/redirect-seed`]));
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const report = await makeChecker(`${origin}/`, { redactSensitiveQuery: false }).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    assertEqual(xml.status, "accepted", "Same-origin redirected sitemap should be accepted.");
    assert(xml.acceptedUrl.startsWith(`${origin}/real-sitemap.xml?`), "acceptedUrl should use the effective final URL.");
    assert(xml.acceptedUrl.includes("token=REDACTED"), "Sensitive token value should use existing redaction semantics.");
    assert(!xml.acceptedUrl.includes("secret-value"), "acceptedUrl must not expose the sensitive value.");
    assert(xml.acceptedUrl.includes("view=full"), "Non-sensitive query material should remain visible.");
  });
}

async function assertAutoDoesNotEnableIncremental() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p12-2a-incremental-"));
  try {
    const stateFile = path.join(tempDir, "state.json");
    await withServer((request, response) => {
      const origin = `http://${request.headers.host}`;
      if (request.url === "/") {
        writeHtml(response, "<p>empty frontier</p>");
        return;
      }
      if (request.url === "/sitemap.xml") {
        writeXml(response, urlset([`${origin}/auto-seed`]));
        return;
      }
      writeHtml(response, "<p>ok</p>");
    }, async (origin) => {
      const report = await makeChecker(`${origin}/`, { stateFile }).run();
      assertEqual(report.options.sitemap, null, "Auto sitemap must not populate options.sitemap.");
      assertEqual(report.options.incremental, false, "Auto sitemap must not enable incremental mode.");
      assertEqual(report.summary.incremental.enabled, false, "Incremental summary must remain disabled.");
      assertEqual(report.summary.discoveryFallback.xmlSitemap.status, "accepted", "XML diagnostics must exist without incremental mode.");
      let stateExists = true;
      try {
        await access(stateFile);
      } catch (error) {
        if (error.code === "ENOENT") {
          stateExists = false;
        } else {
          throw error;
        }
      }
      assertEqual(stateExists, false, "Auto sitemap must not write incremental state.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertReportContract() {
  await withServer((request, response) => {
    const origin = `http://${request.headers.host}`;
    if (request.url === "/") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/sitemap.xml") {
      writeXml(response, urlset([`${origin}/contract-seed`]));
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const report = await makeChecker(`${origin}/`).run();
    const xml = report.summary.discoveryFallback.xmlSitemap;
    assertEqual(report.schemaVersion, "1.3.0", "P12-2A must not change the report schema version.");
    assertEqual(JSON.stringify(Object.keys(xml).sort()), JSON.stringify(XML_FIELDS), "XML fallback diagnostic must retain the locked field shape.");
  });
}

async function main() {
  const cases = [
    ["normal frontier suppression", assertNormalFrontierSuppressesXml],
    ["explicit sitemap precedence", assertExplicitSitemapPrecedence],
    ["valid auto urlset", assertValidAutoUrlsetAccepted],
    ["404 HTML continuation", assertAuto404ContinuesHtmlFallback],
    ["unsupported XML", assertUnsupportedXmlContinuesHtmlFallback],
    ["zero usable seeds", assertValidSitemapWithZeroUsableSeeds],
    ["max depth", assertMaxDepthPreserved],
    ["max pages", assertMaxPagesPreserved],
    ["partial page budget", assertPartialPageBudgetPreserved],
    ["root redirect boundary", assertAutoRootRedirectOutsideOrigin],
    ["child redirect regression", assertSitemapIndexChildRedirectRegression],
    ["accepted URL redaction", assertAcceptedRedirectUrlRedaction],
    ["incremental isolation", assertAutoDoesNotEnableIncremental],
    ["report contract", assertReportContract],
  ];

  for (const [name, test] of cases) {
    try {
      await test();
    } catch (error) {
      throw new Error(`${name}: ${error.message}`);
    }
  }
  console.log(`ok p12-2a xml sitemap fallback (${cases.length} cases)`);
}

main().catch((error) => {
  console.error(`test-p12-2a-xml-sitemap-fallback: ${error.message}`);
  process.exitCode = 1;
});
