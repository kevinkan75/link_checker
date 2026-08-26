#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(rootDir, "fixtures", "reports");
const schemaPath = path.join(rootDir, "schemas", "diff.schema.json");
const cliPath = path.join(rootDir, "report-diff.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoExtraProperties(value, allowed, label) {
  for (const key of Object.keys(value || {})) {
    assert(allowed.has(key), `${label} has unexpected property: ${key}`);
  }
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function runReportDiff(oldReport, newReport, outputPath) {
  try {
    return await execFileAsync(
      process.execPath,
      [cliPath, oldReport, newReport, "--output", outputPath],
      { cwd: rootDir }
    );
  }
  catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const stdout = error.stdout ? `\n${error.stdout}` : "";
    throw new Error(`report-diff CLI failed.${stdout}${stderr}`);
  }
}

function assertRootShape(diff, schema) {
  assertNoExtraProperties(diff, new Set(Object.keys(schema.properties)), "diff root");
  for (const key of schema.required) {
    assert(Object.hasOwn(diff, key), `Missing required root field: ${key}`);
  }

  assert(diff.schemaVersion === "diff.p6.draft.1", "Unexpected schemaVersion.");
  assert(diff.generator?.name === "report-diff.mjs", "Unexpected generator.name.");
  assert(typeof diff.generatedAt === "string", "generatedAt must be a string.");
  assert(diff.oldReport && typeof diff.oldReport.path === "string", "oldReport.path is required.");
  assert(diff.newReport && typeof diff.newReport.path === "string", "newReport.path is required.");
  assert(Array.isArray(diff.urlChanges), "urlChanges must be an array.");
  assert(Array.isArray(diff.externalChanges), "externalChanges must be an array.");
  assert(Array.isArray(diff.diagnosticsChanges), "diagnosticsChanges must be an array.");
  assert(Array.isArray(diff.warnings), "warnings must be an array.");
}

function assertSummarySkeleton(diff, schema) {
  const requiredSummary = schema.properties.summary.required;
  assertNoExtraProperties(diff.summary, new Set(Object.keys(schema.properties.summary.properties)), "summary");
  for (const key of requiredSummary) {
    assert(Object.hasOwn(diff.summary, key), `Missing required summary field: ${key}`);
    assert(Number.isInteger(diff.summary[key]) && diff.summary[key] >= 0, `Summary field must be non-negative integer: ${key}`);
  }
}

function assertWarnings(diff, schema) {
  const allowedCodes = new Set(schema.$defs.warning.properties.code.enum);
  const allowedWarningProps = new Set(Object.keys(schema.$defs.warning.properties));
  for (const warning of diff.warnings) {
    assertNoExtraProperties(warning, allowedWarningProps, "warning");
    assert(allowedCodes.has(warning.code), `Unexpected warning code: ${warning.code}`);
    assert(typeof warning.message === "string" && warning.message.length > 0, "Warning message is required.");
  }

  const legacyReports = new Set(
    diff.warnings
      .filter((warning) => warning.code === "legacy_report")
      .map((warning) => warning.report)
  );
  assert(legacyReports.has("old"), "Expected legacy_report warning for old report.");
  assert(legacyReports.has("new"), "Expected legacy_report warning for new report.");
}

function assertSortedBy(items, label, selector) {
  const values = items.map(selector);
  const sorted = [...values].sort();
  assert(JSON.stringify(values) === JSON.stringify(sorted), `${label} must be sorted deterministically.`);
}

function assertChangeTypes(changeTypes, schema, label) {
  const allowed = new Set(schema.$defs.changeTypeList.items.enum);
  assert(Array.isArray(changeTypes) && changeTypes.length > 0, `${label}.changeTypes must be a non-empty array.`);
  assert(new Set(changeTypes).size === changeTypes.length, `${label}.changeTypes must be unique.`);
  for (const type of changeTypes) {
    assert(allowed.has(type), `${label}.changeTypes has unexpected type: ${type}`);
  }
}

function assertFieldChanges(fieldChanges, label) {
  assert(Array.isArray(fieldChanges), `${label}.fieldChanges must be an array.`);
  for (const fieldChange of fieldChanges) {
    assertNoExtraProperties(fieldChange, new Set(["path", "oldValue", "newValue"]), `${label}.fieldChange`);
    assert(typeof fieldChange.path === "string" && fieldChange.path.length > 0, `${label}.fieldChange.path is required.`);
  }
}

function assertMatchKey(key, label) {
  assertNoExtraProperties(key, new Set(["value", "source"]), `${label}.key`);
  assert(typeof key?.value === "string" && key.value.length > 0, `${label}.key.value is required.`);
  assert(key.source === "canonicalUrl" || key.source === "url", `${label}.key.source is invalid.`);
}

function assertUrlSnapshot(snapshot, label) {
  if (!snapshot) {
    return;
  }
  assert(typeof snapshot.url === "string" && snapshot.url.length > 0, `${label}.url is required.`);
  assert(typeof snapshot.ok === "boolean", `${label}.ok is required.`);
}

function assertExternalSnapshot(snapshot, label) {
  if (!snapshot) {
    return;
  }
  assert(typeof snapshot.url === "string" && snapshot.url.length > 0, `${label}.url is required.`);
}

function assertChangeItems(diff, schema) {
  assertSortedBy(diff.urlChanges, "urlChanges", (change) => change.key.value);
  assertSortedBy(diff.externalChanges, "externalChanges", (change) => change.key.value);
  assertSortedBy(diff.diagnosticsChanges, "diagnosticsChanges", (change) => change.path);

  for (const [index, change] of diff.urlChanges.entries()) {
    const label = `urlChanges[${index}]`;
    assertNoExtraProperties(change, new Set(["key", "changeTypes", "old", "new", "fieldChanges"]), label);
    assertMatchKey(change.key, label);
    assertChangeTypes(change.changeTypes, schema, label);
    assertFieldChanges(change.fieldChanges, label);
    assertUrlSnapshot(change.old, `${label}.old`);
    assertUrlSnapshot(change.new, `${label}.new`);
  }

  for (const [index, change] of diff.externalChanges.entries()) {
    const label = `externalChanges[${index}]`;
    assertNoExtraProperties(change, new Set(["key", "changeTypes", "old", "new", "fieldChanges"]), label);
    assertMatchKey(change.key, label);
    assertChangeTypes(change.changeTypes, schema, label);
    assertFieldChanges(change.fieldChanges, label);
    assertExternalSnapshot(change.old, `${label}.old`);
    assertExternalSnapshot(change.new, `${label}.new`);
  }

  for (const [index, change] of diff.diagnosticsChanges.entries()) {
    const label = `diagnosticsChanges[${index}]`;
    assertNoExtraProperties(change, new Set(["path", "changeTypes", "fieldChanges"]), label);
    assert(
      ["summary.scanQuality", "summary.spaDetection", "summary.checkedByKind", "summary.hostDiagnostics"].includes(change.path),
      `${label}.path is invalid.`,
    );
    assertChangeTypes(change.changeTypes, schema, label);
    assertFieldChanges(change.fieldChanges, label);
  }
}

function countChanges(changes, type) {
  return changes.filter((change) => change.changeTypes.includes(type)).length;
}

function assertSummaryCounts(diff) {
  assert(diff.summary.urlsAdded === countChanges(diff.urlChanges, "added"), "summary.urlsAdded mismatch.");
  assert(diff.summary.urlsRemoved === countChanges(diff.urlChanges, "removed"), "summary.urlsRemoved mismatch.");
  assert(diff.summary.urlsChanged === countChanges(diff.urlChanges, "changed"), "summary.urlsChanged mismatch.");
  assert(diff.summary.newIssues === countChanges(diff.urlChanges, "newIssue"), "summary.newIssues mismatch.");
  assert(diff.summary.resolvedIssues === countChanges(diff.urlChanges, "resolvedIssue"), "summary.resolvedIssues mismatch.");
  assert(diff.summary.persistentIssues === countChanges(diff.urlChanges, "persistentIssue"), "summary.persistentIssues mismatch.");
  assert(diff.summary.confidenceIncreased === countChanges(diff.urlChanges, "confidenceIncreased"), "summary.confidenceIncreased mismatch.");
  assert(diff.summary.confidenceDecreased === countChanges(diff.urlChanges, "confidenceDecreased"), "summary.confidenceDecreased mismatch.");
  assert(diff.summary.externalRiskIncreased === countChanges(diff.externalChanges, "riskIncreased"), "summary.externalRiskIncreased mismatch.");
  assert(diff.summary.externalRiskDecreased === countChanges(diff.externalChanges, "riskDecreased"), "summary.externalRiskDecreased mismatch.");
  assert(diff.summary.diagnosticsChanged === diff.diagnosticsChanges.length, "summary.diagnosticsChanged mismatch.");
}

function assertP67Output(diff, schema) {
  assert(Array.isArray(diff.diagnosticsChanges), "diagnosticsChanges must be an array.");
  assertChangeItems(diff, schema);
  assertSummaryCounts(diff);
}

function findChangeByKey(changes, canonicalUrl) {
  return changes.find((change) => change.key?.value === canonicalUrl);
}

async function runInlineReportDiff(tempDir, name, oldReport, newReport) {
  const oldReportPath = path.join(tempDir, `${name}.old.json`);
  const newReportPath = path.join(tempDir, `${name}.new.json`);
  const outputPath = path.join(tempDir, `${name}.diff.json`);
  await writeJson(oldReportPath, oldReport);
  await writeJson(newReportPath, newReport);
  await runReportDiff(oldReportPath, newReportPath, outputPath);
  return readJson(outputPath);
}

function assertNoAddedRemoved(diff, label) {
  assert(diff.summary.urlsAdded === 0, `${label}: should not report added URLs.`);
  assert(diff.summary.urlsRemoved === 0, `${label}: should not report removed URLs.`);
  assert(countChanges(diff.urlChanges, "added") === 0, `${label}: urlChanges should not include added.`);
  assert(countChanges(diff.urlChanges, "removed") === 0, `${label}: urlChanges should not include removed.`);
}

async function assertAliasMatchCases(tempDir) {
  const baseReport = {
    schemaVersion: "1.3.0",
    summary: {},
    externalLinks: [],
  };
  const legacyUrl = "https://example.test/a?utm=1";
  const canonicalUrl = "https://example.test/a";

  const legacyToCanonical = await runInlineReportDiff(
    tempDir,
    "legacy-to-canonical",
    {
      ...baseReport,
      checked: [{ url: legacyUrl, ok: true, status: 200 }],
    },
    {
      ...baseReport,
      checked: [{ url: legacyUrl, canonicalUrl, ok: true, status: 200 }],
    },
  );
  assertNoAddedRemoved(legacyToCanonical, "legacy-to-canonical");
  assert(legacyToCanonical.urlChanges.length === 0, "legacy-to-canonical should have no URL changes.");

  const sameCanonical = await runInlineReportDiff(
    tempDir,
    "same-canonical",
    {
      ...baseReport,
      checked: [{ url: legacyUrl, canonicalUrl, ok: true, status: 200 }],
    },
    {
      ...baseReport,
      checked: [{ url: legacyUrl, canonicalUrl, ok: false, status: 404, issueType: "not_found" }],
    },
  );
  assertNoAddedRemoved(sameCanonical, "same-canonical");
  assert(sameCanonical.summary.urlsChanged === 1, "same-canonical should keep existing changed behavior.");
  assert(sameCanonical.summary.newIssues === 1, "same-canonical should keep existing newIssue behavior.");

  const realDifferentUrl = await runInlineReportDiff(
    tempDir,
    "real-different-url",
    {
      ...baseReport,
      checked: [{ url: "https://example.test/a", ok: true, status: 200 }],
    },
    {
      ...baseReport,
      checked: [{ url: "https://example.test/b", canonicalUrl: "https://example.test/b-canonical", ok: true, status: 200 }],
    },
  );
  assert(realDifferentUrl.summary.urlsAdded === 1, "real-different-url should still report an added URL.");
  assert(realDifferentUrl.summary.urlsRemoved === 1, "real-different-url should still report a removed URL.");

  const ambiguousAlias = await runInlineReportDiff(
    tempDir,
    "ambiguous-alias",
    {
      ...baseReport,
      checked: [{ url: legacyUrl, canonicalUrl, ok: true, status: 200 }],
    },
    {
      ...baseReport,
      checked: [
        { url: legacyUrl, ok: true, status: 200 },
        { url: canonicalUrl, canonicalUrl: "https://example.test/new-canonical", ok: true, status: 200 },
      ],
    },
  );
  assert(ambiguousAlias.summary.urlsAdded === 2, "ambiguous-alias should not guess between multiple alias candidates.");
  assert(ambiguousAlias.summary.urlsRemoved === 1, "ambiguous-alias should leave the unmatched old URL removed.");
}

function assertSignal(diff, fixture, signal) {
  const urlSignals = new Set(["newIssue", "resolvedIssue", "confidenceIncreased", "confidenceDecreased"]);
  const externalSignals = new Set(["riskIncreased", "riskDecreased"]);
  const diagnosticsSignals = new Set(["diagnosticsChanged"]);

  if (!urlSignals.has(signal) && !externalSignals.has(signal) && !diagnosticsSignals.has(signal)) {
    return false;
  }

  if (diagnosticsSignals.has(signal)) {
    const change = diff.diagnosticsChanges.find((item) => item.path === fixture.diagnosticsPath);
    assert(change, `${fixture.name}: expected diagnosticsChange for ${fixture.diagnosticsPath}.`);
    assert(diff.summary.diagnosticsChanged > 0, `${fixture.name}: summary.diagnosticsChanged should increase.`);
    return true;
  }

  const changes = urlSignals.has(signal) ? diff.urlChanges : diff.externalChanges;
  const change = findChangeByKey(changes, fixture.canonicalUrl);
  assert(change, `${fixture.name}: expected change for ${fixture.canonicalUrl}.`);
  assert(change.changeTypes.includes(signal), `${fixture.name}: expected signal ${signal}.`);

  if (signal === "newIssue") {
    assert(diff.summary.newIssues > 0, `${fixture.name}: summary.newIssues should increase.`);
  }
  if (signal === "resolvedIssue") {
    assert(diff.summary.resolvedIssues > 0, `${fixture.name}: summary.resolvedIssues should increase.`);
  }
  if (signal === "confidenceIncreased") {
    assert(diff.summary.confidenceIncreased > 0, `${fixture.name}: summary.confidenceIncreased should increase.`);
  }
  if (signal === "confidenceDecreased") {
    assert(diff.summary.confidenceDecreased > 0, `${fixture.name}: summary.confidenceDecreased should increase.`);
  }
  if (signal === "riskIncreased") {
    assert(diff.summary.externalRiskIncreased > 0, `${fixture.name}: summary.externalRiskIncreased should increase.`);
  }
  if (signal === "riskDecreased") {
    assert(diff.summary.externalRiskDecreased > 0, `${fixture.name}: summary.externalRiskDecreased should increase.`);
  }

  return true;
}

async function main() {
  const index = await readJson(path.join(fixturesDir, "index.json"));
  const schema = await readJson(schemaPath);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-report-diff-"));
  const pendingSignals = [];

  try {
    assert(Array.isArray(index.cases) && index.cases.length > 0, "Fixture index must contain cases.");

    for (const fixture of index.cases) {
      const oldReport = path.join(fixturesDir, fixture.oldReport);
      const newReport = path.join(fixturesDir, fixture.newReport);
      const outputPath = path.join(tempDir, `${fixture.name}.diff.json`);

      await runReportDiff(oldReport, newReport, outputPath);
      const diff = await readJson(outputPath);

      assertRootShape(diff, schema);
      assertSummarySkeleton(diff, schema);
      assertWarnings(diff, schema);
      assertP67Output(diff, schema);

      assert(diff.oldReport.path.endsWith(path.normalize(fixture.oldReport)), `${fixture.name}: oldReport path mismatch.`);
      assert(diff.newReport.path.endsWith(path.normalize(fixture.newReport)), `${fixture.name}: newReport path mismatch.`);

      for (const signal of fixture.expectedSignals || []) {
        if (!assertSignal(diff, fixture, signal)) {
          pendingSignals.push(`${fixture.name}:${signal}`);
        }
      }

      console.log(`ok ${fixture.name}`);
    }

    await assertAliasMatchCases(tempDir);
    console.log("ok report-diff alias matching");

    if (pendingSignals.length > 0) {
      throw new Error(`Unexpected pending signal assertions: ${pendingSignals.join(", ")}`);
    }
  }
  finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`test-report-diff: ${error.message}`);
  process.exitCode = 1;
});
