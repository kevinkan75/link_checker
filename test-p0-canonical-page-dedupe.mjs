#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withServer(handler, task) {
  const requestCounts = new Map();
  const server = createServer((request, response) => {
    requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    return await task(`http://127.0.0.1:${port}`, requestCounts);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function writeHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><body>${body}</body></html>`);
}

async function assertCanonicalPageAliasesShareOneCrawlSlot() {
  await withServer((request, response) => {
    if (request.url === "/") {
      writeHtml(response, [
        '<a href="/alias?b=2&a=1">alias one</a>',
        '<a href="/alias?a=1&b=2">alias two</a>',
        '<a href="/unique">unique</a>',
      ].join(""));
      return;
    }

    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const aliasOne = `${origin}/alias?b=2&a=1`;
    const aliasTwo = `${origin}/alias?a=1&b=2`;
    const unique = `${origin}/unique`;
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      confirm404: false,
      preferGet: true,
      requestDelayMs: 0,
      concurrency: 1,
      perHostConcurrency: 1,
      maxDepth: 1,
      maxPages: 3,
      canonicalStrategy: "moderate",
    });

    const report = await checker.run();
    const aliasCanonical = checker.getCanonicalKey(aliasOne);
    assert(aliasCanonical === checker.getCanonicalKey(aliasTwo), "Fixture aliases must share one canonical key.");

    const crawledAliasUrls = [...checker.crawledPages].filter((url) => new URL(url).pathname === "/alias");
    assert(crawledAliasUrls.length === 1, "Canonical-equivalent aliases should be crawled only once.");
    assert(checker.crawledPageKeys.size === 3, "Canonical page-key count should include start, one alias, and unique.");
    assert(report.summary.pagesCrawled === 3, "pagesCrawled should report canonical page count.");
    assert(checker.crawledPages.has(unique), "Unique page should still fit within maxPages.");
    assert(report.checked.some((item) => item.url === unique), "Unique page should be checked.");

    const aliasInventory = checker.inventory.get(aliasCanonical);
    assert(aliasInventory, "Alias inventory entry should exist.");
    assert(aliasInventory.resolvedUrls.length === 2, "Alias inventory should preserve both raw resolved URLs.");
    assert(report.checked.filter((item) => item.canonicalUrl === aliasCanonical).length === 1, "Checked results should remain canonical-deduped.");
  });
}

async function main() {
  await assertCanonicalPageAliasesShareOneCrawlSlot();
  console.log("ok p0 canonical page dedupe");
}

main().catch((error) => {
  console.error(`test-p0-canonical-page-dedupe: ${error.message}`);
  process.exitCode = 1;
});
