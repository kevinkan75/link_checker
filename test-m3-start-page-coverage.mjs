#!/usr/bin/env node

import { LinkChecker, deriveCoverageStatus } from "./link-checker.mjs";

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

function networkError(code, message = `${code} failure`) {
  const error = new TypeError(message);
  error.cause = {
    name: "Error",
    message,
    code,
  };
  return error;
}

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
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
    maxDepth: 1,
    maxPages: 10,
    preferGet: true,
    ...options,
  });
}

async function runWithHandler(origin, handler, options = {}) {
  return withFetchHandler(handler, async () => makeChecker(origin, options).run());
}

function assertNoStartPageFetchFailure(report, message) {
  assertExcludes(report.summary.coverage.reasons, "start_page_fetch_failed", message);
  assertExcludes(report.summary.coverage.discovery.reasons, "start_page_fetch_failed", message);
  assertExcludes(report.summary.scanQuality.warnings, "start_page_fetch_failed", message);
}

async function assertNormalStartPageCoverageComplete() {
  const origin = "http://127.0.0.1:13061";
  const report = await runWithHandler(origin, (url) => {
    if (url.pathname === "/") {
      return htmlResponse('<a href="/child">Child</a>');
    }
    return htmlResponse("<p>child</p>");
  });

  assert(report.runStatus.status === "complete", "Normal scan execution should complete.");
  assert(report.summary.coverage.status === "complete", "Normal start page should keep coverage complete.");
  assert(report.summary.coverage.discovery.status === "complete", "Normal start page should keep discovery complete.");
  assert(report.summary.coverage.discovery.incomplete === false, "Normal start page should not mark discovery incomplete.");
  assert(report.summary.scanQuality.status === "ok", "Normal start page should keep scan quality ok.");
  assertNoStartPageFetchFailure(report, "Normal start page should not report start_page_fetch_failed.");
}

async function assertStartPageNetworkFailureMarksDiscoveryIncomplete() {
  const origin = "http://127.0.0.1:13062";
  const report = await runWithHandler(origin, () => {
    throw networkError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate");
  });

  assert(report.runStatus.status === "complete", "Start-page fetch failure should not change execution status.");
  assert(report.summary.coverage.status === "incomplete", "Start-page fetch failure should make overall coverage incomplete.");
  assert(report.summary.coverage.discovery.status === "incomplete", "Start-page fetch failure should make discovery incomplete.");
  assert(report.summary.coverage.discovery.incomplete === true, "Start-page fetch failure should set discovery incomplete.");
  assertIncludes(report.summary.coverage.reasons, "start_page_fetch_failed", "Coverage should include start_page_fetch_failed.");
  assertIncludes(report.summary.coverage.discovery.reasons, "start_page_fetch_failed", "Discovery should include start_page_fetch_failed.");
  assert(report.summary.coverage.validation.incomplete === false, "Start-page fetch failure should not mark validation incomplete.");
  assert(report.summary.scanQuality.status !== "ok", "Start-page fetch failure should raise scan quality.");
  assertIncludes(report.summary.scanQuality.warnings, "start_page_fetch_failed", "Scan quality should include start_page_fetch_failed.");
}

async function assertStartPageTimeoutMarksDiscoveryIncomplete() {
  const origin = "http://127.0.0.1:13063";
  const report = await runWithHandler(origin, () => {
    throw abortError();
  });

  assert(report.runStatus.status === "complete", "Start-page timeout should not change execution status.");
  assert(report.summary.coverage.status === "incomplete", "Start-page timeout should make coverage incomplete.");
  assertIncludes(report.summary.coverage.discovery.reasons, "start_page_fetch_failed", "Timeout should report start_page_fetch_failed.");
  assert(report.summary.scanQuality.status !== "ok", "Start-page timeout should raise scan quality.");
}

async function assertRobotsFailureDoesNotMarkStartPageFetchFailed() {
  const origin = "http://127.0.0.1:13064";
  const report = await runWithHandler(origin, (url) => {
    if (url.pathname === "/robots.txt") {
      throw networkError("ENOTFOUND");
    }
    if (url.pathname === "/") {
      return htmlResponse('<a href="/child">Child</a>');
    }
    return htmlResponse("<p>child</p>");
  }, { robotsTxt: true });

  assert(report.runStatus.status === "complete", "Robots-only failure should not stop scan execution.");
  assert(report.summary.robotsTxt.status === "fetch_error", "Fixture should exercise robots fetch failure.");
  assert(report.summary.coverage.status === "complete", "Robots-only failure should not make coverage incomplete.");
  assert(report.summary.coverage.discovery.incomplete === false, "Robots-only failure should not make discovery incomplete.");
  assertNoStartPageFetchFailure(report, "Robots-only failure should not report start_page_fetch_failed.");
}

function assertExistingMaxPagesReasonStillWorks() {
  const coverage = deriveCoverageStatus({
    runStatus: {
      status: "complete",
      pendingPages: 0,
      pendingValidations: 0,
      activeValidationTasks: 0,
    },
    summary: {
      pagesCrawled: 3,
      discoveryFallback: {
        xmlSitemap: {
          reason: null,
          urlsDiscovered: 0,
          urlsSeeded: 0,
        },
        htmlSitemap: {
          reason: "max_pages",
        },
      },
    },
    options: { maxPages: 3 },
  });

  assertIncludes(coverage.reasons, "max_pages_reached", "M3 should preserve max_pages_reached coverage reason.");
  assertExcludes(coverage.reasons, "start_page_fetch_failed", "max_pages_reached should not imply start_page_fetch_failed.");
}

async function main() {
  await assertNormalStartPageCoverageComplete();
  await assertStartPageNetworkFailureMarksDiscoveryIncomplete();
  await assertStartPageTimeoutMarksDiscoveryIncomplete();
  await assertRobotsFailureDoesNotMarkStartPageFetchFailed();
  assertExistingMaxPagesReasonStillWorks();
  console.log("ok m3 start page coverage");
}

main().catch((error) => {
  console.error(`test-m3-start-page-coverage: ${error.message}`);
  process.exitCode = 1;
});
