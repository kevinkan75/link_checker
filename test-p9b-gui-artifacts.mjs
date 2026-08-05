#!/usr/bin/env node

import {
  buildCompletePayload,
  buildLogSummary,
  buildUrlPatternSummary,
  makeNdjson,
} from "./gui-server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseNdjson(text) {
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const report = {
  schemaVersion: "1.2.0",
  generator: {
    name: "link-checker.mjs",
    version: "0.1.0",
  },
  startUrl: "https://example.com/",
  options: {
    maxPages: 10,
    maxDepth: 2,
  },
  runStatus: {
    status: "complete",
  },
  summary: {
    pagesCrawled: 1,
    urlsChecked: 2,
    brokenLinks: 1,
    externalLinks: 1,
  },
  checked: [
    { url: "https://example.com/", ok: true, status: 200 },
    { url: "https://example.com/missing", ok: false, status: 404 },
  ],
  broken: [
    { url: "https://example.com/missing", ok: false, status: 404 },
  ],
  externalLinks: [
    { url: "https://www.youtube.com/watch?v=abc123", hostname: "www.youtube.com" },
  ],
};

const job = {
  id: "p9b-test-job",
  state: "finished",
  startUrl: report.startUrl,
  options: report.options,
  report,
  error: null,
  logDir: "logs/p9b-test-job",
  logRelativePath: "logs/p9b-test-job",
  logError: null,
  createdAt: "2026-07-18T00:00:00.000Z",
};

job.artifactSummary = buildLogSummary(job);
job.artifactManifest = {
  generatedFiles: [
    { path: "checked.ndjson", kind: "ndjson" },
    { path: "broken.ndjson", kind: "ndjson" },
    { path: "external-links.ndjson", kind: "ndjson" },
  ],
};

const payload = buildCompletePayload(job);
assert(!Object.hasOwn(payload, "report"), "Complete payload must not include full report.");
assert(payload.summary?.brokenLinks === 1, "Complete payload should include lightweight summary.");
assert(payload.reportUrl === "/api/jobs/p9b-test-job/report", "Complete payload should include reportUrl.");
assert(payload.reportFiles?.checkedNdjson === "checked.ndjson", "Summary reportFiles must include checked.ndjson.");
assert(payload.reportFiles?.brokenNdjson === "broken.ndjson", "Summary reportFiles must include broken.ndjson.");
assert(payload.reportFiles?.externalLinksNdjson === "external-links.ndjson", "Summary reportFiles must include external-links.ndjson.");

const checkedRows = parseNdjson(makeNdjson(report.checked));
const brokenRows = parseNdjson(makeNdjson(report.broken));
const externalRows = parseNdjson(makeNdjson(report.externalLinks));
assert(checkedRows.length === report.checked.length, "checked.ndjson row count should match checked[].");
assert(brokenRows.length === report.broken.length, "broken.ndjson row count should match broken[].");
assert(externalRows.length === report.externalLinks.length, "external-links.ndjson row count should match externalLinks[].");
assert(makeNdjson([]) === "", "Empty NDJSON sidecar should be an empty file.");

function makeCheckerWithInventory(urls) {
  return {
    inventory: new Map(urls.map((url) => [
      url,
      {
        canonicalUrl: url,
        representativeUrl: url,
      },
    ])),
  };
}

const repeatedUrls = Array.from({ length: 80 }, (_, index) => `https://archives.cisanet.org.tw/verification_pass.php?id=${index + 1}`);
const mixedUrls = Array.from({ length: 20 }, (_, index) => `https://archives.cisanet.org.tw/download.php?id=${index + 1}`);
const patternSummary = buildUrlPatternSummary(
  makeCheckerWithInventory([...repeatedUrls, ...mixedUrls]),
  "https://archives.cisanet.org.tw/verification_pass.php?id=85",
);
assert(patternSummary.warning === true, "Repeated path pattern should trigger GUI warning.");
assert(patternSummary.dominantPattern?.pattern === "/verification_pass.php", "Dominant pattern should ignore query values.");
assert(patternSummary.dominantPattern.count === 80, "Dominant pattern count should match repeated URLs.");

const smallPatternSummary = buildUrlPatternSummary(
  makeCheckerWithInventory(repeatedUrls.slice(0, 20)),
  "https://archives.cisanet.org.tw/verification_pass.php?id=85",
);
assert(smallPatternSummary.warning === false, "Small repeated set should not trigger GUI warning.");

console.log("ok p9b gui artifacts");
