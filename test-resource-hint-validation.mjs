#!/usr/bin/env node

import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function htmlResponse(body, status = 200) {
  return new Response(`<!doctype html><html>${body}</html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function withFetchHandler(handler, task) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handler(new URL(String(url)), options);
  try {
    return await task();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function findChecked(report, path) {
  return report.checked.find((item) => new URL(item.url).pathname === path);
}

function findBroken(report, path) {
  return report.broken.find((item) => new URL(item.url).pathname === path);
}

async function main() {
  const origin = "http://127.0.0.1:13103";
  const report = await withFetchHandler((url) => {
    if (url.pathname === "/") {
      return htmlResponse(`
        <head>
          <link rel="preconnect" href="${origin}/preconnect-origin">
          <link rel="dns-prefetch" href="//127.0.0.1:13103/dns-origin">
          <link rel="stylesheet" href="${origin}/style.css">
        </head>
        <body>Resource hint regression</body>
      `);
    }
    if (url.pathname === "/preconnect-origin" || url.pathname === "/dns-origin") {
      return htmlResponse("<body>origin root not found</body>", 404);
    }
    if (url.pathname === "/style.css") {
      return new Response("body { color: #123456; }", {
        status: 200,
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    return htmlResponse("<body>not found</body>", 404);
  }, async () => {
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      confirm404: false,
      requestDelayMs: 0,
      concurrency: 1,
      perHostConcurrency: 1,
      maxDepth: 0,
      maxPages: 1,
      preferGet: true,
      checkExternal: true,
    });
    return checker.run();
  });

  assert(report.runStatus.status === "complete", "Fixture scan should complete.");

  assert(!findChecked(report, "/preconnect-origin"), "preconnect hints should not be availability validation targets.");
  assert(!findBroken(report, "/preconnect-origin"), "preconnect hints should not become broken results.");
  assert(!findChecked(report, "/dns-origin"), "dns-prefetch hints should not be availability validation targets.");
  assert(!findBroken(report, "/dns-origin"), "dns-prefetch hints should not become broken results.");

  const stylesheet = findChecked(report, "/style.css");
  assert(stylesheet, "stylesheet links should still be validated.");
  assert(stylesheet.ok === true && stylesheet.status === 200, "stylesheet 200 response should remain ok.");
  assert(report.summary.brokenLinks === 0, "Resource hints should not create broken-link false positives.");

  console.log("ok resource hint validation");
}

main().catch((error) => {
  console.error(`test-resource-hint-validation: ${error.message}`);
  process.exitCode = 1;
});
