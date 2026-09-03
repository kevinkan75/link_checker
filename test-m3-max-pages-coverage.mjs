#!/usr/bin/env node

import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(list, value, message) {
  assert(Array.isArray(list) && list.includes(value), message);
}

function assertExcludes(list, value, message) {
  assert(!Array.isArray(list) || !list.includes(value), message);
}

function html(body) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

function htmlResponse(body, status = 200) {
  return new Response(html(body), {
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

function makeChecker(origin, options = {}) {
  return new LinkChecker(`${origin}/`, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    confirm404: false,
    requestDelayMs: 0,
    concurrency: 1,
    perHostConcurrency: 1,
    maxDepth: 5,
    maxPages: 2,
    preferGet: true,
    checkExternal: false,
    ...options,
  });
}

async function runWithHandler(origin, handler, options = {}) {
  return withFetchHandler(handler, async () => makeChecker(origin, options).run());
}

async function assertMaxPagesDiscoveryBudgetEvidence() {
  const origin = "http://127.0.0.1:13101";
  const report = await runWithHandler(origin, (url) => {
    if (url.pathname === "/") {
      return htmlResponse('<a href="/b">B</a>');
    }
    if (url.pathname === "/b") {
      return htmlResponse('<a href="/c">C</a>');
    }
    if (url.pathname === "/c") {
      return htmlResponse("<p>C</p>");
    }
    return htmlResponse("<p>not found</p>", 404);
  });

  assert(report.runStatus.status === "complete", "Page budget discovery truncation should not fail execution.");
  assert(report.summary.pagesCrawled === 2, "Fixture should crawl exactly A and B.");
  assert(report.summary.coverage.status === "incomplete", "Page budget truncation should make overall coverage incomplete.");
  assert(report.summary.coverage.discovery.status === "incomplete", "Page budget truncation should make discovery incomplete.");
  assertIncludes(report.summary.coverage.reasons, "max_pages_reached", "Coverage should include max_pages_reached.");
  assertIncludes(report.summary.coverage.discovery.reasons, "max_pages_reached", "Discovery should include max_pages_reached.");
  assert(report.summary.coverage.validation.status === "complete", "Discovery truncation should not mark validation incomplete.");
  assert(report.summary.coverage.details.pendingPages === 0, "Fixture should reproduce evidence loss through an empty final queue.");
  assert(report.summary.coverage.details.pageBudgetStopEvidence === true, "Budget-skipped crawl candidate should leave explicit evidence.");
}

async function assertNoFalsePositiveWhenBudgetExactlyFilled() {
  const origin = "http://127.0.0.1:13102";
  const report = await runWithHandler(origin, (url) => {
    if (url.pathname === "/") {
      return htmlResponse('<a href="/b">B</a>');
    }
    if (url.pathname === "/b") {
      return htmlResponse([
        '<a href="/b">Self</a>',
        '<a href="https://external.example/path">External</a>',
        '<script src="/app.js"></script>',
      ].join(""));
    }
    if (url.pathname === "/app.js") {
      return new Response("console.log('asset');", {
        status: 200,
        headers: { "content-type": "text/javascript; charset=utf-8" },
      });
    }
    return htmlResponse("<p>not found</p>", 404);
  }, { maxPages: 2 });

  assert(report.runStatus.status === "complete", "Control scan should complete.");
  assert(report.summary.pagesCrawled === 2, "Control should exactly fill the page budget.");
  assert(report.summary.coverage.status === "complete", "Exact page budget without skipped crawlable work should keep coverage complete.");
  assert(report.summary.coverage.discovery.status === "complete", "Exact page budget should not imply incomplete discovery.");
  assertExcludes(report.summary.coverage.reasons, "max_pages_reached", "Control should not report max_pages_reached.");
  assertExcludes(report.summary.coverage.discovery.reasons, "max_pages_reached", "Control discovery should not report max_pages_reached.");
  assert(report.summary.coverage.details.pageBudgetStopEvidence === false, "Control should not record page budget stop evidence.");
}

async function main() {
  await assertMaxPagesDiscoveryBudgetEvidence();
  await assertNoFalsePositiveWhenBudgetExactlyFilled();
  console.log("ok m3 max pages coverage");
}

main().catch((error) => {
  console.error(`test-m3-max-pages-coverage: ${error.message}`);
  process.exitCode = 1;
});
