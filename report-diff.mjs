#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DIFF_SCHEMA_VERSION = "diff.p6.draft.1";
const GENERATOR_VERSION = "0.1.0";
const URL_COMPARISON_FIELDS = [
  "ok",
  "status",
  "issueType",
  "classification",
  "finalUrl",
  "redirected",
  "redirectCount",
  "redirectType",
  "redirectIssues",
  "confirmationOutcome",
  "confirmationNeedsReview",
  "transientFailure"
];
const EXTERNAL_COMPARISON_FIELDS = [
  "ok",
  "status",
  "issueType",
  "finalUrl",
  "externalRisk.riskLevel",
  "externalRisk.governanceStatus",
  "externalRisk.riskReasons",
  "externalRisk.matchedRules",
  "externalRisk.needsReview"
];
const RISK_ORDER = new Map([
  ["info", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3]
]);
const GOVERNANCE_ORDER = new Map([
  ["allowed", 0],
  ["unknown", 1],
  ["watchlisted", 2],
  ["needs_review", 3],
  ["blocked", 4]
]);
const DIAGNOSTICS_PATHS = [
  "summary.scanQuality",
  "summary.spaDetection",
  "summary.checkedByKind"
];

function printHelp() {
  console.log(`Usage:
  node report-diff.mjs <old-report.json> <new-report.json> --output <diff.json>

Options:
  --output, -o <path>  Write diff JSON to the given path.
  --help, -h          Show this help text.

P6.6 reads and normalizes both reports, emits URL, external, and diagnostics
diff changes. Fixture regression coverage is available in test-report-diff.mjs.`);
}

function parseArgs(argv) {
  const positionals = [];
  let outputPath = null;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    if (arg === "--output" || arg === "-o") {
      const value = argv[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${arg} requires a file path.`);
      }
      outputPath = value;
      index++;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length !== 2) {
    throw new Error("Expected exactly two report paths: <old-report.json> <new-report.json>.");
  }

  if (!outputPath) {
    throw new Error("Missing required --output <diff.json> option.");
  }

  return {
    help: false,
    oldReportPath: positionals[0],
    newReportPath: positionals[1],
    outputPath
  };
}

async function readReport(filePath, label) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  }
  catch (error) {
    throw new Error(`${label} is not readable: ${filePath}`);
  }

  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  }
  catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function addWarning(warnings, code, report, message, key) {
  const warning = { code, message };
  if (report) {
    warning.report = report;
  }
  if (key) {
    warning.key = key;
  }
  warnings.push(warning);
}

function optionalString(value) {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value) {
  return typeof value === "boolean" ? value : undefined;
}

function optionalStatus(value) {
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function optionalNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

function cleanArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

function setDefined(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function getMatchKey(item) {
  if (typeof item?.canonicalUrl === "string" && item.canonicalUrl.length > 0) {
    return { value: item.canonicalUrl, source: "canonicalUrl" };
  }

  if (typeof item?.url === "string" && item.url.length > 0) {
    return { value: item.url, source: "url" };
  }

  return null;
}

function addByKey(map, item, warnings, reportLabel, collectionName) {
  const key = getMatchKey(item);
  if (!key) {
    addWarning(
      warnings,
      "unsupported_schema",
      reportLabel,
      `${collectionName} entry was skipped because it has neither canonicalUrl nor url.`
    );
    return;
  }

  if (map.has(key.value)) {
    addWarning(
      warnings,
      "duplicate_key",
      reportLabel,
      `Duplicate ${collectionName} key ignored; first entry was kept.`,
      key.value
    );
    return;
  }

  map.set(key.value, { key, snapshot: item });
}

function projectUrl(item, fallbackOk) {
  const snapshot = {};

  setDefined(snapshot, "url", optionalString(item?.url));
  setDefined(snapshot, "canonicalUrl", optionalString(item?.canonicalUrl));
  setDefined(snapshot, "ok", optionalBoolean(item?.ok) ?? fallbackOk);
  setDefined(snapshot, "status", optionalStatus(item?.status));
  setDefined(snapshot, "issueType", item?.issueType === null ? null : optionalString(item?.issueType));
  setDefined(snapshot, "classification", item?.classification === null ? null : optionalString(item?.classification));
  setDefined(snapshot, "finalUrl", item?.finalUrl === null ? null : optionalString(item?.finalUrl));
  setDefined(snapshot, "redirected", optionalBoolean(item?.redirected));
  setDefined(snapshot, "redirectCount", optionalNonNegativeInteger(item?.redirectCount));
  setDefined(snapshot, "redirectType", item?.redirectType === null ? null : optionalString(item?.redirectType));
  setDefined(snapshot, "redirectIssues", cleanArray(item?.redirectIssues));
  setDefined(
    snapshot,
    "confirmationOutcome",
    item?.confirmation?.outcome === null ? null : optionalString(item?.confirmation?.outcome)
  );
  setDefined(
    snapshot,
    "confirmationNeedsReview",
    optionalBoolean(item?.needsReview) ?? (item?.confirmation?.outcome === "needs_review" ? true : undefined)
  );
  setDefined(snapshot, "transientFailure", optionalBoolean(item?.transientFailure));

  return snapshot;
}

function projectExternal(item) {
  const snapshot = {};
  const risk = item?.externalRisk;
  const externalRisk = {};

  setDefined(snapshot, "url", optionalString(item?.url));
  setDefined(snapshot, "canonicalUrl", optionalString(item?.canonicalUrl));
  setDefined(snapshot, "hostname", optionalString(item?.hostname));
  setDefined(snapshot, "registrableDomain", optionalString(item?.registrableDomain));
  setDefined(snapshot, "ok", optionalBoolean(item?.ok));
  setDefined(snapshot, "status", optionalStatus(item?.status));
  setDefined(snapshot, "issueType", item?.issueType === null ? null : optionalString(item?.issueType));
  setDefined(snapshot, "finalUrl", item?.finalUrl === null ? null : optionalString(item?.finalUrl));

  setDefined(externalRisk, "riskLevel", risk?.riskLevel === null ? null : optionalString(risk?.riskLevel));
  setDefined(
    externalRisk,
    "governanceStatus",
    risk?.governanceStatus === null ? null : optionalString(risk?.governanceStatus)
  );
  setDefined(externalRisk, "riskReasons", cleanArray(risk?.riskReasons));
  setDefined(externalRisk, "matchedRules", cleanArray(risk?.matchedRules));
  setDefined(externalRisk, "needsReview", optionalBoolean(risk?.needsReview));

  if (Object.keys(externalRisk).length > 0) {
    snapshot.externalRisk = externalRisk;
  }

  return snapshot;
}

function buildReportRef(report, reportPath) {
  const ref = {
    path: path.normalize(reportPath)
  };

  setDefined(ref, "startedAt", optionalString(report?.startedAt));
  setDefined(ref, "startUrl", optionalString(report?.startUrl));
  setDefined(ref, "schemaVersion", optionalString(report?.schemaVersion));

  if (report?.summary && typeof report.summary === "object" && !Array.isArray(report.summary)) {
    ref.summary = report.summary;
  }

  return ref;
}

function normalizeReport(report, reportPath, reportLabel) {
  const warnings = [];
  const urlsByKey = new Map();
  const externalByKey = new Map();

  if (!report?.schemaVersion) {
    addWarning(warnings, "legacy_report", reportLabel, "Report has no schemaVersion; treating it as legacy.");
  }

  if (Array.isArray(report?.checked)) {
    for (const item of report.checked) {
      addByKey(urlsByKey, projectUrl(item), warnings, reportLabel, "checked");
    }
  }
  else {
    addWarning(warnings, "missing_checked", reportLabel, "Report has no checked[] array.");

    if (Array.isArray(report?.broken)) {
      addWarning(warnings, "fallback_to_broken", reportLabel, "Using broken[] as the URL result fallback.");
      for (const item of report.broken) {
        addByKey(urlsByKey, projectUrl(item, false), warnings, reportLabel, "broken");
      }
    }
  }

  if (Array.isArray(report?.externalLinks)) {
    for (const item of report.externalLinks) {
      addByKey(externalByKey, projectExternal(item), warnings, reportLabel, "externalLinks");
    }
  }
  else {
    addWarning(warnings, "missing_external_links", reportLabel, "Report has no externalLinks[] array.");
  }

  return {
    ref: buildReportRef(report, reportPath),
    urlsByKey,
    externalByKey,
    diagnostics: {
      "summary.scanQuality": report?.summary?.scanQuality ?? null,
      "summary.spaDetection": report?.summary?.spaDetection ?? null,
      "summary.checkedByKind": report?.summary?.checkedByKind ?? null
    },
    warnings
  };
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function getPathValue(source, dottedPath) {
  return dottedPath.split(".").reduce((value, part) => value?.[part], source);
}

function valuesEqual(oldValue, newValue) {
  return stableValue(oldValue) === stableValue(newValue);
}

function buildFieldChanges(oldSnapshot, newSnapshot, fields) {
  const changes = [];
  for (const field of fields) {
    const oldValue = getPathValue(oldSnapshot, field);
    const newValue = getPathValue(newSnapshot, field);
    if (valuesEqual(oldValue, newValue)) {
      continue;
    }

    const change = { path: field };
    if (oldValue !== undefined) {
      change.oldValue = oldValue;
    }
    if (newValue !== undefined) {
      change.newValue = newValue;
    }
    changes.push(change);
  }

  return changes;
}

function addChangeType(changeTypes, type) {
  if (!changeTypes.includes(type)) {
    changeTypes.push(type);
  }
}

function isIssue(snapshot) {
  return snapshot?.ok !== true;
}

function confidenceIncreased(oldSnapshot, newSnapshot) {
  if (oldSnapshot?.confirmationOutcome === "needs_review" && newSnapshot?.confirmationOutcome === "confirmed_missing") {
    return true;
  }

  return oldSnapshot?.confirmationNeedsReview === true &&
    newSnapshot?.confirmationNeedsReview === false &&
    isIssue(newSnapshot);
}

function confidenceDecreased(oldSnapshot, newSnapshot) {
  if (oldSnapshot?.confirmationOutcome === "confirmed_missing" && newSnapshot?.confirmationOutcome === "needs_review") {
    return true;
  }

  return oldSnapshot?.confirmationNeedsReview === false && newSnapshot?.confirmationNeedsReview === true;
}

function diffUrls(oldUrlsByKey, newUrlsByKey) {
  const changes = [];
  const keys = Array.from(new Set([...oldUrlsByKey.keys(), ...newUrlsByKey.keys()])).sort();

  for (const key of keys) {
    const oldEntry = oldUrlsByKey.get(key);
    const newEntry = newUrlsByKey.get(key);
    const oldSnapshot = oldEntry?.snapshot;
    const newSnapshot = newEntry?.snapshot;
    const changeTypes = [];
    const fieldChanges = buildFieldChanges(oldSnapshot, newSnapshot, URL_COMPARISON_FIELDS);

    if (!oldEntry) {
      addChangeType(changeTypes, "added");
      if (isIssue(newSnapshot)) {
        addChangeType(changeTypes, "newIssue");
      }
    }
    else if (!newEntry) {
      addChangeType(changeTypes, "removed");
      if (isIssue(oldSnapshot)) {
        addChangeType(changeTypes, "resolvedIssue");
      }
    }
    else {
      if (fieldChanges.length > 0) {
        addChangeType(changeTypes, "changed");
      }

      if (!isIssue(oldSnapshot) && isIssue(newSnapshot)) {
        addChangeType(changeTypes, "newIssue");
      }
      else if (isIssue(oldSnapshot) && !isIssue(newSnapshot)) {
        addChangeType(changeTypes, "resolvedIssue");
      }
      else if (isIssue(oldSnapshot) && isIssue(newSnapshot)) {
        addChangeType(changeTypes, "persistentIssue");
      }

      if (confidenceIncreased(oldSnapshot, newSnapshot)) {
        addChangeType(changeTypes, "confidenceIncreased");
      }
      if (confidenceDecreased(oldSnapshot, newSnapshot)) {
        addChangeType(changeTypes, "confidenceDecreased");
      }
    }

    if (changeTypes.length === 0) {
      continue;
    }

    const change = {
      key: newEntry?.key ?? oldEntry.key,
      changeTypes,
      fieldChanges
    };

    if (oldSnapshot) {
      change.old = oldSnapshot;
    }
    if (newSnapshot) {
      change.new = newSnapshot;
    }

    changes.push(change);
  }

  return changes;
}

function riskRank(snapshot) {
  const riskLevel = snapshot?.externalRisk?.riskLevel;
  if (RISK_ORDER.has(riskLevel)) {
    return RISK_ORDER.get(riskLevel);
  }

  const governanceStatus = snapshot?.externalRisk?.governanceStatus;
  if (GOVERNANCE_ORDER.has(governanceStatus)) {
    return GOVERNANCE_ORDER.get(governanceStatus);
  }

  return null;
}

function riskIncreased(oldSnapshot, newSnapshot) {
  const oldRank = riskRank(oldSnapshot);
  const newRank = riskRank(newSnapshot);
  return oldRank !== null && newRank !== null && newRank > oldRank;
}

function riskDecreased(oldSnapshot, newSnapshot) {
  const oldRank = riskRank(oldSnapshot);
  const newRank = riskRank(newSnapshot);
  return oldRank !== null && newRank !== null && newRank < oldRank;
}

function diffExternal(oldExternalByKey, newExternalByKey) {
  const changes = [];
  const keys = Array.from(new Set([...oldExternalByKey.keys(), ...newExternalByKey.keys()])).sort();

  for (const key of keys) {
    const oldEntry = oldExternalByKey.get(key);
    const newEntry = newExternalByKey.get(key);
    const oldSnapshot = oldEntry?.snapshot;
    const newSnapshot = newEntry?.snapshot;
    const changeTypes = [];
    const fieldChanges = buildFieldChanges(oldSnapshot, newSnapshot, EXTERNAL_COMPARISON_FIELDS);

    if (!oldEntry) {
      addChangeType(changeTypes, "added");
    }
    else if (!newEntry) {
      addChangeType(changeTypes, "removed");
    }
    else {
      if (fieldChanges.length > 0) {
        addChangeType(changeTypes, "changed");
      }
      if (riskIncreased(oldSnapshot, newSnapshot)) {
        addChangeType(changeTypes, "riskIncreased");
      }
      if (riskDecreased(oldSnapshot, newSnapshot)) {
        addChangeType(changeTypes, "riskDecreased");
      }
    }

    if (changeTypes.length === 0) {
      continue;
    }

    const change = {
      key: newEntry?.key ?? oldEntry.key,
      changeTypes,
      fieldChanges
    };

    if (oldSnapshot) {
      change.old = oldSnapshot;
    }
    if (newSnapshot) {
      change.new = newSnapshot;
    }

    changes.push(change);
  }

  return changes;
}

function diffDiagnostics(oldDiagnostics, newDiagnostics) {
  const changes = [];

  for (const pathName of DIAGNOSTICS_PATHS) {
    const oldValue = oldDiagnostics[pathName];
    const newValue = newDiagnostics[pathName];

    if (valuesEqual(oldValue, newValue)) {
      continue;
    }

    const fieldChange = { path: pathName };
    if (oldValue !== undefined) {
      fieldChange.oldValue = oldValue;
    }
    if (newValue !== undefined) {
      fieldChange.newValue = newValue;
    }

    changes.push({
      path: pathName,
      changeTypes: ["changed"],
      fieldChanges: [fieldChange]
    });
  }

  return changes;
}

function buildSummary(urlChanges, externalChanges, diagnosticsChanges) {
  const summary = {
    urlsAdded: 0,
    urlsRemoved: 0,
    urlsChanged: 0,
    newIssues: 0,
    resolvedIssues: 0,
    persistentIssues: 0,
    externalRiskIncreased: 0,
    externalRiskDecreased: 0,
    confidenceIncreased: 0,
    confidenceDecreased: 0,
    diagnosticsChanged: 0
  };

  for (const change of urlChanges) {
    if (change.changeTypes.includes("added")) {
      summary.urlsAdded++;
    }
    if (change.changeTypes.includes("removed")) {
      summary.urlsRemoved++;
    }
    if (change.changeTypes.includes("changed")) {
      summary.urlsChanged++;
    }
    if (change.changeTypes.includes("newIssue")) {
      summary.newIssues++;
    }
    if (change.changeTypes.includes("resolvedIssue")) {
      summary.resolvedIssues++;
    }
    if (change.changeTypes.includes("persistentIssue")) {
      summary.persistentIssues++;
    }
    if (change.changeTypes.includes("confidenceIncreased")) {
      summary.confidenceIncreased++;
    }
    if (change.changeTypes.includes("confidenceDecreased")) {
      summary.confidenceDecreased++;
    }
  }

  for (const change of externalChanges) {
    if (change.changeTypes.includes("riskIncreased")) {
      summary.externalRiskIncreased++;
    }
    if (change.changeTypes.includes("riskDecreased")) {
      summary.externalRiskDecreased++;
    }
  }

  summary.diagnosticsChanged = diagnosticsChanges.length;

  return summary;
}

function buildEmptyDiff(oldReport, newReport) {
  const urlChanges = diffUrls(oldReport.urlsByKey, newReport.urlsByKey);
  const externalChanges = diffExternal(oldReport.externalByKey, newReport.externalByKey);
  const diagnosticsChanges = diffDiagnostics(oldReport.diagnostics, newReport.diagnostics);

  return {
    schemaVersion: DIFF_SCHEMA_VERSION,
    generator: {
      name: "report-diff.mjs",
      version: GENERATOR_VERSION
    },
    generatedAt: new Date().toISOString(),
    oldReport: oldReport.ref,
    newReport: newReport.ref,
    summary: buildSummary(urlChanges, externalChanges, diagnosticsChanges),
    urlChanges,
    externalChanges,
    diagnosticsChanges,
    warnings: [...oldReport.warnings, ...newReport.warnings]
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const oldRawReport = await readReport(options.oldReportPath, "Old report");
  const newRawReport = await readReport(options.newReportPath, "New report");
  const oldReport = normalizeReport(oldRawReport, options.oldReportPath, "old");
  const newReport = normalizeReport(newRawReport, options.newReportPath, "new");

  const diff = buildEmptyDiff(oldReport, newReport);
  const json = `${JSON.stringify(diff, null, 2)}\n`;

  await writeFile(options.outputPath, json, "utf8");

  console.log("Report diff written.");
  console.log(`Output: ${options.outputPath}`);
  console.log(`Normalized URL records: old ${oldReport.urlsByKey.size}, new ${newReport.urlsByKey.size}`);
  console.log(`Normalized external records: old ${oldReport.externalByKey.size}, new ${newReport.externalByKey.size}`);
  console.log(`Warnings: ${diff.warnings.length}`);
  console.log(`URL changes: ${diff.urlChanges.length}, external changes: ${diff.externalChanges.length}, diagnostics changes: ${diff.diagnosticsChanges.length}`);
}

main().catch((error) => {
  console.error(`report-diff: ${error.message}`);
  console.error("Run with --help for usage.");
  process.exitCode = 1;
});
