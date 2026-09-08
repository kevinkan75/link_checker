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

async function assertResourceHintsAreNotValidated() {
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
}

async function assertCloudflareEmailProtectionSourceRecognition() {
  const origin = "http://127.0.0.1:13103";
  const emailPath = "/cdn-cgi/l/email-protection";
  const requestCounts = new Map();
  let checker;
  const report = await withFetchHandler((url) => {
    requestCounts.set(url.pathname, (requestCounts.get(url.pathname) || 0) + 1);
    if (url.pathname === "/") {
      return htmlResponse(`<body>
        <a href="${emailPath}#087c7a696166616e67">relative protected email</a>
        <a href="${origin}${emailPath}#1a7e7f6a7a75686e">absolute protected email</a>
        <a href="//127.0.0.1:13103${emailPath}#3b5f5e4b4b54494f">scheme-relative protected email</a>
        <a href="${emailPath}#2b4f4e5b5b44595f">another protected email</a>
        <a href="${emailPath}" class="contact __cf_email__ muted" data-cfemail="3c585d4f57595c5f52">attribute protected email</a>
        <a href="/cdn-cgi/trace">Cloudflare trace endpoint</a>
        <a href="/cdn-cgi/image/sample.png">Cloudflare image endpoint</a>
      </body>`);
    }
    if (url.pathname === "/cdn-cgi/trace" || url.pathname === "/cdn-cgi/image/sample.png") {
      return htmlResponse("<body>ordinary endpoint</body>");
    }
    return htmlResponse("<body>not found</body>", 404);
  }, async () => {
    checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      robotsTxt: false,
      retryCount: 0,
      confirm404: true,
      requestDelayMs: 0,
      confirmationDelayMinMs: 0,
      confirmationDelayMaxMs: 0,
      concurrency: 1,
      perHostConcurrency: 1,
      maxDepth: 0,
      maxPages: 1,
      preferGet: true,
      checkExternal: true,
    });
    return checker.run();
  });

  const emailUrl = `${origin}${emailPath}`;
  assert(requestCounts.get(emailPath) === undefined, "Valid Cloudflare Email Protection links should not be requested.");
  assert(!findChecked(report, emailPath), "Valid Cloudflare Email Protection links should not enter checked results.");
  assert(!findBroken(report, emailPath), "Valid Cloudflare Email Protection links should not become broken results.");
  assert(!checker.inventory.has(checker.getCanonicalKey(emailUrl)), "Valid Cloudflare Email Protection links should not enter inventory.");
  assert(findChecked(report, "/"), "The source HTML page should still be crawled and validated.");
  assert(findChecked(report, "/cdn-cgi/trace"), "Other /cdn-cgi endpoints should retain normal validation.");
  assert(findChecked(report, "/cdn-cgi/image/sample.png"), "Cloudflare image endpoints should retain normal validation.");
  assert(report.summary.brokenLinks === 0, "Recognized Email Protection links should not affect broken counts.");
}

async function assertWeakCloudflareEmailProtectionEvidenceIsNotSkipped() {
  const origin = "http://127.0.0.1:13103";
  const emailPath = "/cdn-cgi/l/email-protection";
  for (const [href, label] of [
    [emailPath, "bare path"],
    [`${emailPath}#xyz`, "invalid fragment"],
  ]) {
    let emailRequests = 0;
    const report = await withFetchHandler((url) => {
      if (url.pathname === "/") {
        return htmlResponse(`<body><a href="${href}">${label}</a></body>`);
      }
      if (url.pathname === emailPath) {
        emailRequests += 1;
      }
      return htmlResponse("<body>ordinary missing page</body>", 404);
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
      });
      return checker.run();
    });

    assert(emailRequests > 0, `${label} should retain normal HTTP validation.`);
    assert(findChecked(report, emailPath), `${label} should remain in checked results.`);
    assert(findBroken(report, emailPath), `${label} should retain ordinary broken handling without response evidence.`);
  }
}

async function main() {
  await assertResourceHintsAreNotValidated();
  await assertCloudflareEmailProtectionSourceRecognition();
  await assertWeakCloudflareEmailProtectionEvidenceIsNotSkipped();

  console.log("ok resource hint and special link validation");
}

main().catch((error) => {
  console.error(`test-resource-hint-validation: ${error.message}`);
  process.exitCode = 1;
});
