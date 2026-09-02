#!/usr/bin/env node

import {
  buildCompletePayload,
  buildLogSummary,
  buildUrlPatternSummary,
  getJobArtifactPlan,
} from "./gui-server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function artifactPaths(job) {
  return getJobArtifactPlan(job).map((artifact) => artifact.path);
}

const report = {
  schemaVersion: "1.2.0",
  generator: { name: "link-checker.mjs", version: "0.1.0" },
  startUrl: "https://example.com/",
  options: { maxPages: 10, maxDepth: 2 },
  runStatus: { status: "complete" },
  summary: { pagesCrawled: 1, urlsChecked: 2, brokenLinks: 1, externalLinks: 1 },
  checked: [
    { url: "https://example.com/", ok: true, status: 200 },
    { url: "https://example.com/missing", ok: false, status: 404 },
  ],
  broken: [{ url: "https://example.com/missing", ok: false, status: 404 }],
  externalLinks: [{ url: "https://www.youtube.com/watch?v=abc123", hostname: "www.youtube.com" }],
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

assert(
  JSON.stringify(artifactPaths(job)) === JSON.stringify(["broken.csv", "report.json"]),
  "Complete scans must generate exactly broken.csv and report.json.",
);

const partialJob = {
  ...job,
  state: "stopped",
  report: { ...report, runStatus: { status: "partial" } },
};
assert(
  JSON.stringify(artifactPaths(partialJob)) === JSON.stringify(["report.json", "events.log"]),
  "Partial scans must generate exactly report.json and events.log.",
);

const failedJob = {
  ...job,
  state: "failed",
  report: { ...report, runStatus: { status: "failed" } },
  error: "Network failure",
};
assert(
  JSON.stringify(artifactPaths(failedJob)) === JSON.stringify(["report.json", "events.log"]),
  "Failed scans must generate exactly report.json and events.log.",
);

job.artifactSummary = buildLogSummary(job, getJobArtifactPlan(job));
const payload = buildCompletePayload(job);
assert(!Object.hasOwn(payload, "report"), "Complete payload must not include full report.");
assert(payload.summary?.brokenLinks === 1, "Complete payload should include lightweight summary.");
assert(payload.reportUrl === "/api/jobs/p9b-test-job/report", "Complete payload should include reportUrl.");
assert(payload.reportFiles?.brokenCsv === "broken.csv", "Complete summary should list broken.csv.");
assert(payload.reportFiles?.report === "report.json", "Complete summary should list report.json.");
assert(!payload.reportFiles?.brokenNdjson, "Complete summary must not list broken.ndjson.");
assert(!payload.reportFiles?.manifest, "Complete summary must not list a per-scan manifest.");

function makeCheckerWithInventory(urls) {
  return {
    inventory: new Map(urls.map((url) => [url, { canonicalUrl: url, representativeUrl: url }])),
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
