#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, redactSensitiveQueryValue } from "../link-checker.mjs";

const ASSET_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".css", ".csv", ".doc", ".docx", ".eot", ".gif",
  ".gz", ".ico", ".jpeg", ".jpg", ".js", ".json", ".map", ".mov", ".mp3",
  ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".rar", ".rss", ".svg", ".tar",
  ".ttf", ".txt", ".wav", ".webm", ".webp", ".woff", ".woff2", ".xls",
  ".xlsx", ".xml", ".zip",
]);

const PAGE_LIKE_EXTENSIONS = new Set([".html", ".htm", ".asp", ".aspx", ".php"]);
const ELIGIBLE_CAUSE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const NON_SWITCH_CAUSE_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENOTFOUND",
]);
const TLS_CAUSE_CODES = new Set([
  "ERR_SSL_DH_KEY_TOO_SMALL",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
]);
const CAUSE_CODE_BUCKETS = [
  "ETIMEDOUT",
  "ECONNRESET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENOTFOUND",
  "missing_or_unknown",
  "other",
];
const ISSUE_TYPE_BUCKETS = ["timeout", "network_error", "other"];
const POSITIVE_TARGETS = [
  ["ETIMEDOUT_OR_TIMEOUT", 8],
  ["ECONNRESET", 7],
  ["UND_ERR_CONNECT_TIMEOUT", 7],
  ["UND_ERR_HEADERS_TIMEOUT", 5],
  ["UND_ERR_SOCKET", 5],
  ["OTHER_ELIGIBLE", 3],
];
const NEGATIVE_TARGETS = [
  ["EAI_AGAIN", 2],
  ["ECONNREFUSED", 2],
  ["ENOTFOUND_OR_OTHER", 1],
];
const POSITIVE_TARGET_TOTAL = 35;
const NEGATIVE_TARGET_TOTAL = 5;
const MAX_SAMPLE_SIZE = 50;

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function makeEmptyCountMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function getPathExtension(pathname = "") {
  const lastSegment = pathname.split("/").pop() || "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) {
    return "";
  }
  return lastSegment.slice(dot).toLowerCase();
}

function isPageLikeUrl(urlValue) {
  const parsed = safeUrl(urlValue);
  if (!parsed) {
    return false;
  }

  const extension = getPathExtension(parsed.pathname);
  if (!extension) {
    return true;
  }
  if (PAGE_LIKE_EXTENSIONS.has(extension)) {
    return true;
  }
  return !ASSET_EXTENSIONS.has(extension);
}

function sameOrigin(urlValue, origin) {
  const parsed = safeUrl(urlValue);
  return Boolean(parsed && parsed.origin === origin);
}

function isHeadTransportFailure(result) {
  return result?.method === "HEAD"
    && result.status == null
    && (
      result.classification === "network_error"
      || result.issueType === "timeout"
      || result.issueType === "network_error"
    );
}

function getCauseCode(result) {
  return result?.cause?.code || null;
}

function getCauseBucket(result) {
  const code = getCauseCode(result);
  if (!code) {
    return "missing_or_unknown";
  }
  return CAUSE_CODE_BUCKETS.includes(code) ? code : "other";
}

function getIssueTypeBucket(result) {
  if (result?.issueType === "timeout") {
    return "timeout";
  }
  if (result?.issueType === "network_error") {
    return "network_error";
  }
  return "other";
}

function isTlsFailure(result) {
  const code = getCauseCode(result);
  const text = [
    result?.error,
    result?.diagnosis,
    result?.cause?.message,
  ].filter(Boolean).join(" ");
  return TLS_CAUSE_CODES.has(code)
    || /\b(?:tls|ssl|certificate|issuer cert|self[- ]signed|dh key)\b/i.test(text);
}

function isPositiveTrigger(result) {
  const code = getCauseCode(result);
  return result?.issueType === "timeout" || ELIGIBLE_CAUSE_CODES.has(code);
}

function isNegativeTrigger(result) {
  return NON_SWITCH_CAUSE_CODES.has(getCauseCode(result)) || isTlsFailure(result);
}

function getPositiveStratum(result) {
  const code = getCauseCode(result);
  if (code === "ETIMEDOUT" || (!code && result?.issueType === "timeout")) {
    return "ETIMEDOUT_OR_TIMEOUT";
  }
  if (ELIGIBLE_CAUSE_CODES.has(code)) {
    return code;
  }
  return "OTHER_ELIGIBLE";
}

function getNegativeStratum(result) {
  const code = getCauseCode(result);
  if (code === "EAI_AGAIN" || code === "ECONNREFUSED") {
    return code;
  }
  return "ENOTFOUND_OR_OTHER";
}

function displayUrl(url, options = DEFAULTS) {
  return redactSensitiveQueryValue(url, {
    ...options,
    redactSensitiveQuery: true,
  });
}

function toCandidate(result, { startOrigin, reportOptions, sampleType, stratum }) {
  return {
    sampleType,
    stratum,
    url: result.url,
    displayUrl: displayUrl(result.url, reportOptions),
    hash: sha256(result.url),
    baseline: {
      method: result.method || null,
      status: result.status ?? null,
      classification: result.classification || null,
      issueType: result.issueType || null,
      causeCode: getCauseCode(result),
      elapsedMs: result.elapsedMs ?? null,
      finalUrl: result.finalUrl || null,
      redirected: result.redirected === true,
    },
    checks: {
      sameOrigin: sameOrigin(result.url, startOrigin),
      pageLike: isPageLikeUrl(result.url),
      head: result.method === "HEAD",
      statusNull: result.status == null,
    },
  };
}

function uniqueByUrl(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    if (seen.has(item.url)) {
      continue;
    }
    seen.add(item.url);
    output.push(item);
  }
  return output;
}

function sortByHash(items) {
  return [...items].sort((left, right) => {
    const hashCompare = left.hash.localeCompare(right.hash);
    if (hashCompare !== 0) {
      return hashCompare;
    }
    return left.url.localeCompare(right.url);
  });
}

function groupByStratum(items) {
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.stratum)) {
      grouped.set(item.stratum, []);
    }
    grouped.get(item.stratum).push(item);
  }
  for (const [key, values] of grouped.entries()) {
    grouped.set(key, sortByHash(values));
  }
  return grouped;
}

function pickStratified(items, targets, totalTarget, excludedUrls = new Set()) {
  const grouped = groupByStratum(items.filter((item) => !excludedUrls.has(item.url)));
  const selected = [];
  const selectedUrls = new Set(excludedUrls);

  for (const [stratum, target] of targets) {
    const candidates = grouped.get(stratum) || [];
    for (const item of candidates.slice(0, target)) {
      if (selectedUrls.has(item.url)) {
        continue;
      }
      selected.push(item);
      selectedUrls.add(item.url);
    }
  }

  if (selected.length < totalTarget) {
    const remaining = sortByHash(items.filter((item) => !selectedUrls.has(item.url)));
    for (const item of remaining) {
      if (selected.length >= totalTarget) {
        break;
      }
      selected.push(item);
      selectedUrls.add(item.url);
    }
  }

  return selected;
}

function validateSamples(samples) {
  const sampleIds = new Set();
  const urls = new Set();
  const errors = [];
  for (const item of samples) {
    if (sampleIds.has(item.sampleId)) {
      errors.push(`duplicate sampleId ${item.sampleId}`);
    }
    sampleIds.add(item.sampleId);
    if (urls.has(item.url)) {
      errors.push(`duplicate URL ${item.url}`);
    }
    urls.add(item.url);
    if (!item.checks.sameOrigin || !item.checks.pageLike || !item.checks.head || !item.checks.statusNull) {
      errors.push(`invalid filter checks for ${item.sampleId}`);
    }
    if (item.sampleType === "positive" && !isPositiveSample(item)) {
      errors.push(`positive sample is not eligible ${item.sampleId}`);
    }
    if (item.sampleType === "negative_control" && !isNegativeSample(item)) {
      errors.push(`negative control would switch GET ${item.sampleId}`);
    }
  }
  if (samples.length > MAX_SAMPLE_SIZE) {
    errors.push(`sample size exceeds ${MAX_SAMPLE_SIZE}`);
  }
  return errors;
}

function isPositiveSample(sample) {
  return sample.stratum === "ETIMEDOUT_OR_TIMEOUT"
    || ELIGIBLE_CAUSE_CODES.has(sample.baseline.causeCode);
}

function isNegativeSample(sample) {
  return !isPositiveSample(sample);
}

function analyzeReport(report, { baselineReport = null } = {}) {
  const checked = Array.isArray(report.checked) ? report.checked : [];
  const startUrl = report.startUrl || "";
  const startOrigin = safeUrl(startUrl)?.origin;
  if (!startOrigin) {
    throw new Error("Baseline report has no valid startUrl origin.");
  }

  const reportOptions = report.options || DEFAULTS;
  const byCauseCode = makeEmptyCountMap(CAUSE_CODE_BUCKETS);
  const byIssueType = makeEmptyCountMap(ISSUE_TYPE_BUCKETS);
  const candidates = [];
  const positiveCandidates = [];
  const negativeCandidates = [];

  let headTransportFailure = 0;
  let sameOriginCount = 0;
  let sameOriginPageLike = 0;

  for (const result of checked) {
    if (!isHeadTransportFailure(result)) {
      continue;
    }
    headTransportFailure += 1;
    increment(byCauseCode, getCauseBucket(result));
    increment(byIssueType, getIssueTypeBucket(result));

    if (!sameOrigin(result.url, startOrigin)) {
      continue;
    }
    sameOriginCount += 1;
    if (!isPageLikeUrl(result.url)) {
      continue;
    }
    sameOriginPageLike += 1;

    const common = { startOrigin, reportOptions };
    if (isPositiveTrigger(result)) {
      positiveCandidates.push(toCandidate(result, {
        ...common,
        sampleType: "positive",
        stratum: getPositiveStratum(result),
      }));
    } else if (isNegativeTrigger(result)) {
      negativeCandidates.push(toCandidate(result, {
        ...common,
        sampleType: "negative_control",
        stratum: getNegativeStratum(result),
      }));
    }
    candidates.push(result);
  }

  const uniquePositive = uniqueByUrl(positiveCandidates);
  const uniqueNegative = uniqueByUrl(negativeCandidates);
  const positiveSample = pickStratified(uniquePositive, POSITIVE_TARGETS, POSITIVE_TARGET_TOTAL);
  const negativeSample = pickStratified(
    uniqueNegative,
    NEGATIVE_TARGETS,
    NEGATIVE_TARGET_TOTAL,
    new Set(positiveSample.map((item) => item.url)),
  );
  const samples = [...positiveSample, ...negativeSample]
    .slice(0, MAX_SAMPLE_SIZE)
    .map((item, index) => ({
      sampleId: `P13-1-${String(index + 1).padStart(3, "0")}`,
      sampleType: item.sampleType,
      stratum: item.stratum,
      url: item.url,
      displayUrl: item.displayUrl,
      baseline: item.baseline,
      checks: item.checks,
      selectionHash: item.hash,
    }));

  const validationErrors = validateSamples(samples);
  const stats = {
    baselineReport,
    startUrl,
    startOrigin,
    runStatus: report.runStatus?.status || null,
    urlsChecked: report.summary?.urlsChecked ?? checked.length,
    filters: {
      method: "HEAD",
      statusNull: true,
      sameOrigin: true,
      pageLike: true,
    },
    counts: {
      headTransportFailure,
      sameOrigin: sameOriginCount,
      sameOriginPageLike,
    },
    byCauseCode,
    byIssueType,
    positiveCandidates: uniquePositive.length,
    negativeControlCandidates: uniqueNegative.length,
    sampling: {
      method: "sha256(url) ascending within each stratum, then deterministic hash fill for redistributed quota",
      positiveTarget: POSITIVE_TARGET_TOTAL,
      negativeTarget: NEGATIVE_TARGET_TOTAL,
      maxSampleSize: MAX_SAMPLE_SIZE,
      positiveTargets: Object.fromEntries(POSITIVE_TARGETS),
      negativeTargets: Object.fromEntries(NEGATIVE_TARGETS),
    },
    finalSample: summarizeSamples(samples),
    validation: {
      passed: validationErrors.length === 0,
      errors: validationErrors,
    },
  };

  return {
    stats,
    sample: {
      baselineReport,
      startUrl,
      startOrigin,
      generatedAt: report.runStatus?.completedAt || report.completedAt || null,
      sampling: stats.sampling,
      sampleSize: samples.length,
      positiveSamples: samples.filter((item) => item.sampleType === "positive").length,
      negativeControlSamples: samples.filter((item) => item.sampleType === "negative_control").length,
      byStratum: countBy(samples, (item) => item.stratum),
      samples,
    },
    candidates,
  };
}

function summarizeSamples(samples) {
  return {
    size: samples.length,
    positive: samples.filter((item) => item.sampleType === "positive").length,
    negativeControl: samples.filter((item) => item.sampleType === "negative_control").length,
    byStratum: countBy(samples, (item) => item.stratum),
  };
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    increment(counts, selector(item) || "unknown");
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(sample) {
  const headers = [
    "sample_id",
    "sample_type",
    "stratum",
    "url",
    "baseline_method",
    "baseline_status",
    "baseline_classification",
    "baseline_issue_type",
    "baseline_cause_code",
    "baseline_elapsed_ms",
    "baseline_final_url",
    "baseline_redirected",
  ];
  const rows = sample.samples.map((item) => [
    item.sampleId,
    item.sampleType,
    item.stratum,
    item.displayUrl || item.url,
    item.baseline.method,
    item.baseline.status,
    item.baseline.classification,
    item.baseline.issueType,
    item.baseline.causeCode,
    item.baseline.elapsedMs,
    item.baseline.finalUrl,
    item.baseline.redirected,
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

async function writeOutputs({ stats, sample }, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const statsPath = path.join(outputDir, "p13-1-tycg-candidate-stats.json");
  const sampleJsonPath = path.join(outputDir, "p13-1-tycg-targeted-sample.json");
  const sampleCsvPath = path.join(outputDir, "p13-1-tycg-targeted-sample.csv");
  await writeFile(statsPath, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  await writeFile(sampleJsonPath, `${JSON.stringify(sample, null, 2)}\n`, "utf8");
  await writeFile(sampleCsvPath, toCsv(sample), "utf8");
  return { statsPath, sampleJsonPath, sampleCsvPath };
}

async function main() {
  const reportPath = process.argv[2];
  const outputDir = process.argv[3] || process.cwd();
  if (!reportPath) {
    throw new Error("Usage: node scripts/extract-p13-1-targeted-sample.mjs <report.json> [output-dir]");
  }
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const result = analyzeReport(report, { baselineReport: path.resolve(reportPath) });
  if (!result.stats.validation.passed) {
    throw new Error(`Sample validation failed: ${result.stats.validation.errors.join("; ")}`);
  }
  const outputs = await writeOutputs(result, outputDir);
  console.log(JSON.stringify({
    baselineReport: result.stats.baselineReport,
    runStatus: result.stats.runStatus,
    urlsChecked: result.stats.urlsChecked,
    counts: result.stats.counts,
    byCauseCode: result.stats.byCauseCode,
    byIssueType: result.stats.byIssueType,
    positiveCandidates: result.stats.positiveCandidates,
    negativeControlCandidates: result.stats.negativeControlCandidates,
    finalSample: result.stats.finalSample,
    outputs,
  }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(`extract-p13-1-targeted-sample: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  analyzeReport,
  isHeadTransportFailure,
  isPageLikeUrl,
  isPositiveTrigger,
  isNegativeTrigger,
  pickStratified,
  toCsv,
};
