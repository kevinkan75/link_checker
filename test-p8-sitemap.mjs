#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxDepth: 0,
    ...options,
  });
}

async function assertSitemapUrlsetFileSummary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-urlset-"));
  try {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>ok</p>");
    }, async (origin) => {
      const sitemapFile = path.join(tempDir, "sitemap.xml");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(sitemapFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/alpha?token=secret-value</loc>
    <lastmod>2026-07-15</lastmod>
  </url>
  <url>
    <loc>${origin}/beta</loc>
  </url>
</urlset>
`, "utf8");

      const report = await makeChecker(origin, {
        sitemap: sitemapFile,
        stateFile,
      }).run();
      const sitemap = report.summary.incremental.sitemap;

      assert(report.options.incremental === true, "--sitemap should enable incremental summary.");
      assert(report.options.sitemap === sitemapFile, "Report options should record the sitemap source.");
      assert(sitemap.enabled === true, "Sitemap summary should be enabled.");
      assert(sitemap.status === "ok", "Sitemap file should load successfully.");
      assert(sitemap.sourceType === "file", "Sitemap file should be marked as file source.");
      assert(sitemap.type === "urlset", "Sitemap summary should classify urlset.");
      assert(sitemap.urlCount === 2, "Sitemap summary should count urlset URLs.");
      assert(sitemap.lastmodCount === 1, "Sitemap summary should count lastmod values.");
      assert(sitemap.sampleUrls[0].url.includes("token=REDACTED"), "Sitemap sample URLs should redact sensitive query values.");
      assert(!JSON.stringify(sitemap).includes("secret-value"), "Sitemap summary must not expose sensitive query values.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertSitemapIndexFileSummary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-index-"));
  try {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>ok</p>");
    }, async (origin) => {
      const childFile = path.join(tempDir, "child.xml");
      const indexFile = path.join(tempDir, "index.xml");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(childFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/from-index</loc>
    <lastmod>2026-07-16</lastmod>
  </url>
</urlset>
`, "utf8");
      await writeFile(indexFile, `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>${pathToFileURL(childFile).href}</loc>
    <lastmod>2026-07-16</lastmod>
  </sitemap>
</sitemapindex>
`, "utf8");

      const report = await makeChecker(origin, {
        sitemap: indexFile,
        stateFile,
      }).run();
      const sitemap = report.summary.incremental.sitemap;

      assert(sitemap.status === "ok", "Sitemap index should load successfully.");
      assert(sitemap.type === "sitemapindex", "Sitemap summary should classify sitemap index.");
      assert(sitemap.indexChildCount === 1, "Sitemap index should count child sitemap entries.");
      assert(sitemap.fetchedChildCount === 1, "Sitemap index should read same-file child sitemap.");
      assert(sitemap.urlCount === 1, "Sitemap index should collect child urlset URLs.");
      assert(sitemap.lastmodCount === 1, "Sitemap index should preserve child lastmod counts.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertSitemapMaxUrlsTruncatesSummary() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-limit-"));
  try {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>ok</p>");
    }, async (origin) => {
      const sitemapFile = path.join(tempDir, "sitemap.xml");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(sitemapFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/one</loc></url>
  <url><loc>${origin}/two</loc></url>
</urlset>
`, "utf8");

      const report = await makeChecker(origin, {
        sitemap: sitemapFile,
        sitemapMaxUrls: 1,
        stateFile,
      }).run();
      const sitemap = report.summary.incremental.sitemap;

      assert(sitemap.status === "ok", "Limited sitemap should load successfully.");
      assert(sitemap.urlCount === 1, "Sitemap summary should respect sitemapMaxUrls.");
      assert(sitemap.maxUrls === 1, "Sitemap summary should expose maxUrls.");
      assert(sitemap.truncated === true, "Sitemap summary should mark truncation.");
      assert(sitemap.warnings.some((warning) => warning.code === "sitemap_urls_truncated"), "Sitemap summary should include truncation warning.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertRemoteSitemapSeedsConservativelyInP8d3() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-remote-"));
  try {
    const requestCounts = new Map();
    await withServer((request, response) => {
      requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
      if (request.url.startsWith("/sitemap.xml")) {
        const origin = `http://${request.headers.host}`;
        response.writeHead(200, { "content-type": "application/xml" });
        response.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/sitemap-only</loc>
    <lastmod>2026-07-16</lastmod>
  </url>
  <url>
    <loc>${origin}/sitemap-broken</loc>
    <lastmod>2026-07-16</lastmod>
  </url>
</urlset>
`);
        return;
      }
      if (request.url === "/sitemap-only") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<a href="/from-sitemap-seed">from seed</a>');
        return;
      }
      if (request.url === "/sitemap-broken") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("missing");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<p>ok</p>");
    }, async (origin) => {
      const stateFile = path.join(tempDir, "state.json");
      const sitemapSource = `${origin}/sitemap.xml?token=secret-value`;
      const report = await makeChecker(origin, {
        sitemap: sitemapSource,
        stateFile,
        maxDepth: 1,
      }).run();
      const sitemap = report.summary.incremental.sitemap;
      const seed = sitemap.seed;
      const sitemapOnly = report.checked.find((item) => item.url.endsWith("/sitemap-only"));
      const sitemapBroken = report.broken.find((item) => item.url.endsWith("/sitemap-broken"));
      const fromSeed = report.checked.find((item) => item.url.endsWith("/from-sitemap-seed"));

      assert(sitemap.status === "ok", "Remote sitemap should load successfully.");
      assert(sitemap.sourceType === "url", "Remote sitemap should be marked as URL source.");
      assert(report.options.sitemap.includes("token=REDACTED"), "Report options should redact sensitive sitemap source query values.");
      assert(!JSON.stringify(report).includes("secret-value"), "Report output must not expose sensitive sitemap source query values.");
      assert(sitemap.type === "urlset", "Remote sitemap should classify urlset.");
      assert(sitemap.urlCount === 2, "Remote sitemap should count sitemap-only URLs.");
      assert(requestCounts.get("/sitemap.xml?token=secret-value") === 1, "Remote sitemap should be fetched once.");
      assert(requestCounts.get("/sitemap-only") === 1, "P8d-3 should crawl same-origin page-like sitemap-only URLs.");
      assert(requestCounts.get("/sitemap-broken") >= 1, "P8d-3 should validate sitemap seeded pages through current crawl.");
      assert(seed.enabled === true, "Sitemap seed summary should be enabled.");
      assert(seed.attempted === 2, "Sitemap seed summary should count attempted sitemap URLs.");
      assert(seed.seeded === 2, "Sitemap seed summary should count seeded URLs.");
      assert(seed.ignored === 0, "Sitemap seed summary should not ignore the valid sitemap URL.");
      assert(sitemapOnly, "Seeded sitemap URL should appear in checked results after page crawl.");
      assert(sitemapBroken?.sourceCount === 1, "Broken seeded sitemap URL should have a current sitemap source.");
      assert(sitemapBroken?.sources?.[0]?.sourceType === "sitemap", "Broken seeded sitemap URL source should be marked as sitemap.");
      assert(fromSeed, "Seeded sitemap page should still discover and validate current HTML links.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertSitemapSeedRespectsDepthAndPageFilters() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-seed-limits-"));
  try {
    const requestCounts = new Map();
    await withServer((request, response) => {
      requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
      response.writeHead(200, { "content-type": request.url.endsWith(".png") ? "image/png" : "text/html" });
      response.end("<p>ok</p>");
    }, async (origin) => {
      const sitemapFile = path.join(tempDir, "sitemap.xml");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(sitemapFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/allowed-page</loc></url>
  <url><loc>${origin}/asset.png</loc></url>
</urlset>
`, "utf8");

      const noDepthReport = await makeChecker(origin, {
        sitemap: sitemapFile,
        stateFile,
        maxDepth: 0,
      }).run();
      assert(noDepthReport.summary.incremental.sitemap.seed.seeded === 0, "Sitemap seed should respect maxDepth 0.");
      assert(noDepthReport.summary.incremental.sitemap.seed.ignoredByReason.max_depth === 2, "Sitemap seed should record max_depth ignores.");
      assert(requestCounts.get("/allowed-page") === undefined, "maxDepth 0 should prevent sitemap seed crawl.");

      const stateFileSecond = path.join(tempDir, "state-second.json");
      const filteredReport = await makeChecker(origin, {
        sitemap: sitemapFile,
        stateFile: stateFileSecond,
        maxDepth: 1,
      }).run();
      const seed = filteredReport.summary.incremental.sitemap.seed;
      assert(seed.seeded === 1, "Sitemap seed should include same-origin page-like URL.");
      assert(seed.ignoredByReason.non_page_like === 1, "Sitemap seed should ignore non-page-like URLs.");
      assert(requestCounts.get("/allowed-page") === 1, "Allowed sitemap page should be crawled.");
      assert(requestCounts.get("/asset.png") === undefined, "Non-page-like sitemap URL should not be crawled.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertSitemapLastmodSignalsAffectPriority() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-sitemap-priority-"));
  try {
    const requestOrder = [];
    await withServer((request, response) => {
      if (request.url !== "/" && request.method !== "GET") {
        requestOrder.push(request.url);
      }
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <a href="/known">known</a>
          <a href="/changed">changed</a>
        `);
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const sitemapFile = path.join(tempDir, "sitemap.xml");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(sitemapFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/known</loc><lastmod>2026-07-15</lastmod></url>
  <url><loc>${origin}/changed</loc><lastmod>2026-07-15</lastmod></url>
</urlset>
`, "utf8");

      await makeChecker(origin, {
        sitemap: sitemapFile,
        stateFile,
        concurrency: 1,
        perHostConcurrency: 1,
      }).run();

      requestOrder.length = 0;
      await writeFile(sitemapFile, `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${origin}/known</loc><lastmod>2026-07-15</lastmod></url>
  <url><loc>${origin}/changed</loc><lastmod>2026-07-16</lastmod></url>
</urlset>
`, "utf8");

      const report = await makeChecker(origin, {
        sitemap: sitemapFile,
        stateFile,
        concurrency: 1,
        perHostConcurrency: 1,
      }).run();
      const sitemapPriority = report.summary.incremental.sitemap.priority;

      assert(report.summary.incremental.stateRead === true, "Second sitemap priority run should read state.");
      assert(sitemapPriority.matchedCurrentUrls === 2, "Sitemap priority should only count current inventory matches.");
      assert(sitemapPriority.changed === 1, "Sitemap priority should count newer lastmod URL.");
      assert(sitemapPriority.known === 1, "Sitemap priority should count unchanged lastmod URL.");
      assert(sitemapPriority.boosted === 1, "Newer sitemap lastmod should boost priority.");
      assert(sitemapPriority.deferred === 1, "Unchanged sitemap lastmod should defer priority.");
      assert(sitemapPriority.byClassification.sitemap_changed === 20, "Summary should expose sitemap_changed boost.");
      assert(sitemapPriority.byClassification.sitemap_known === -10, "Summary should expose sitemap_known deferral.");
      assert(requestOrder[0] === "/changed", "Newer sitemap lastmod URL should be checked before unchanged sitemap URL.");
      assert(requestOrder[1] === "/known", "Unchanged sitemap lastmod URL should be checked after changed sitemap URL.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await assertSitemapUrlsetFileSummary();
await assertSitemapIndexFileSummary();
await assertSitemapMaxUrlsTruncatesSummary();
await assertRemoteSitemapSeedsConservativelyInP8d3();
await assertSitemapSeedRespectsDepthAndPageFilters();
await assertSitemapLastmodSignalsAffectPriority();

console.log("ok p8 sitemap");
