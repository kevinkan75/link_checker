#!/usr/bin/env node

import {
  analyzeReport,
  isHeadTransportFailure,
  isNegativeTrigger,
  isPageLikeUrl,
  isPositiveTrigger,
} from "./scripts/extract-p13-1-targeted-sample.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function result(url, overrides = {}) {
  return {
    url,
    method: "HEAD",
    status: null,
    classification: "network_error",
    issueType: "network_error",
    cause: { code: "ECONNRESET" },
    elapsedMs: 100,
    finalUrl: null,
    redirected: false,
    ...overrides,
  };
}

function buildSyntheticReport() {
  const origin = "https://example.test";
  const checked = [
    result(`${origin}/zh-tw/a`, { issueType: "timeout", cause: null }),
    result(`${origin}/zh-tw/a`, { issueType: "timeout", cause: null }),
    result(`${origin}/zh-tw/b`, { cause: { code: "ECONNRESET" } }),
    result(`${origin}/zh-tw/c`, { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
    result(`${origin}/zh-tw/d`, { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }),
    result(`${origin}/zh-tw/e`, { cause: { code: "UND_ERR_SOCKET" } }),
    result(`${origin}/zh-tw/f`, { cause: { code: "ETIMEDOUT" } }),
    result(`${origin}/zh-tw/g`, { cause: { code: "EAI_AGAIN" } }),
    result(`${origin}/zh-tw/h`, { cause: { code: "ECONNREFUSED" } }),
    result(`${origin}/zh-tw/i`, { cause: { code: "ENOTFOUND" } }),
    result(`${origin}/zh-tw/j`, { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }),
    result(`${origin}/zh-tw/file.pdf`, { issueType: "timeout", cause: null }),
    result("https://example.com/zh-tw/external", { issueType: "timeout", cause: null }),
    result(`${origin}/zh-tw/ok`, { status: 200, classification: "ok", issueType: "ok", cause: null }),
    result(`${origin}/zh-tw/get`, { method: "GET", issueType: "timeout", cause: null }),
  ];

  for (let index = 0; index < 40; index += 1) {
    checked.push(result(`${origin}/zh-tw/fill-${index}`, {
      cause: { code: index % 2 === 0 ? "ECONNRESET" : "UND_ERR_SOCKET" },
    }));
  }

  return {
    startUrl: `${origin}/zh-tw`,
    runStatus: { status: "complete" },
    summary: { urlsChecked: checked.length },
    options: {},
    checked,
  };
}

async function assertFilteringAndClassification() {
  assert(isPageLikeUrl("https://example.test/zh-tw"), "Route URL should be page-like.");
  assert(isPageLikeUrl("https://example.test/index.html"), "HTML URL should be page-like.");
  assert(!isPageLikeUrl("https://example.test/file.pdf"), "PDF should not be page-like.");
  assert(isHeadTransportFailure(result("https://example.test/zh-tw/a")), "HEAD network error should be a transport failure.");
  assert(!isHeadTransportFailure(result("https://example.test/zh-tw/a", { status: 500 })), "HTTP status should not be transport failure.");
  assert(isPositiveTrigger(result("https://example.test/zh-tw/a", { issueType: "timeout", cause: null })), "Missing cause timeout should be positive.");
  assert(isNegativeTrigger(result("https://example.test/zh-tw/a", { cause: { code: "EAI_AGAIN" } })), "EAI_AGAIN should be negative control.");
}

async function assertDeterministicSampling() {
  const report = buildSyntheticReport();
  const first = analyzeReport(report, { baselineReport: "synthetic-report.json" });
  const second = analyzeReport(report, { baselineReport: "synthetic-report.json" });

  assert(JSON.stringify(first.sample.samples) === JSON.stringify(second.sample.samples), "Sampling must be deterministic.");
  assert(first.stats.counts.headTransportFailure === 53, "All HEAD status-null network failures should be counted.");
  assert(first.stats.counts.sameOrigin === 52, "External transport failure should be excluded from same-origin count.");
  assert(first.stats.counts.sameOriginPageLike === 51, "PDF transport failure should be excluded from page-like count.");
  assert(first.stats.byCauseCode.missing_or_unknown === 4, "Missing cause.code should be counted.");
  assert(first.stats.positiveCandidates === 46, "Duplicate positive URL should be deduplicated.");
  assert(first.stats.negativeControlCandidates === 4, "Negative controls should include method-independent/TLS failures.");
  assert(first.sample.sampleSize === 39, "Sample should include all 35 positive target slots plus available negatives.");
  assert(first.sample.positiveSamples === 35, "Positive sample should fill redistributed quota.");
  assert(first.sample.negativeControlSamples === 4, "Available negative controls should be retained without inventing samples.");
  assert(first.stats.validation.passed === true, "Generated synthetic sample should validate.");

  const urls = first.sample.samples.map((item) => item.url);
  assert(new Set(urls).size === urls.length, "Sample URLs should be unique.");
  assert(first.sample.samples.some((item) => item.stratum === "ETIMEDOUT_OR_TIMEOUT"), "Missing-cause timeout stratum should be represented.");
  assert(first.sample.samples.some((item) => item.stratum === "ECONNRESET"), "Quota redistribution should include ECONNRESET fill.");
  assert(first.sample.samples.some((item) => item.stratum === "ENOTFOUND_OR_OTHER"), "Negative other stratum should be represented.");
}

async function main() {
  await assertFilteringAndClassification();
  await assertDeterministicSampling();
  console.log("ok p13-1 sample extraction");
}

main().catch((error) => {
  console.error(`test-p13-1-sample-extraction: ${error.message}`);
  process.exitCode = 1;
});
