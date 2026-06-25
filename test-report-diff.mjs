#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
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
  for (const key of requiredSummary) {
    assert(Object.hasOwn(diff.summary, key), `Missing required summary field: ${key}`);
    assert(Number.isInteger(diff.summary[key]) && diff.summary[key] >= 0, `Summary field must be non-negative integer: ${key}`);
  }
}

function assertWarnings(diff, schema) {
  const allowedCodes = new Set(schema.$defs.warning.properties.code.enum);
  for (const warning of diff.warnings) {
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

function assertP65Scope(diff) {
  assert(diff.diagnosticsChanges.length === 0, "P6.5 should not emit diagnosticsChanges yet.");
}

function findChangeByKey(changes, canonicalUrl) {
  return changes.find((change) => change.key?.value === canonicalUrl);
}

function assertSignal(diff, fixture, signal) {
  const urlSignals = new Set(["newIssue", "resolvedIssue", "confidenceIncreased", "confidenceDecreased"]);
  const externalSignals = new Set(["riskIncreased", "riskDecreased"]);

  if (!urlSignals.has(signal) && !externalSignals.has(signal)) {
    return false;
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
      assertP65Scope(diff);

      assert(diff.oldReport.path.endsWith(path.normalize(fixture.oldReport)), `${fixture.name}: oldReport path mismatch.`);
      assert(diff.newReport.path.endsWith(path.normalize(fixture.newReport)), `${fixture.name}: newReport path mismatch.`);

      for (const signal of fixture.expectedSignals || []) {
        if (!assertSignal(diff, fixture, signal)) {
          pendingSignals.push(`${fixture.name}:${signal}`);
        }
      }

      console.log(`ok ${fixture.name}`);
    }

    if (pendingSignals.length > 0) {
      console.log(`pending signal assertions for later P6 steps: ${pendingSignals.join(", ")}`);
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
