#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  REPORT_SCHEMA_VERSION,
  TOOL_VERSION,
  LinkChecker,
  buildOutputManifest,
} from "./link-checker.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(rootDir, "schemas", "report.schema.json");
const diffCliPath = path.join(rootDir, "report-diff.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath) {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

function assertReportRoot(report, schema) {
  for (const key of schema.required) {
    assert(Object.hasOwn(report, key), `Missing report root field: ${key}`);
  }
  assert(report.schemaVersion === REPORT_SCHEMA_VERSION, "Unexpected report schemaVersion.");
  assert(report.generator?.name === "link-checker.mjs", "Unexpected report generator.name.");
  assert(report.generator?.version === TOOL_VERSION, "Unexpected report generator.version.");
  assert(Array.isArray(report.checked), "checked must be an array.");
  assert(Array.isArray(report.broken), "broken must be an array.");
  assert(Array.isArray(report.externalLinks), "externalLinks must be an array.");
}

function assertManifest(manifest) {
  assert(manifest.toolVersion === TOOL_VERSION, "Unexpected manifest toolVersion.");
  assert(manifest.schemaVersions?.report === REPORT_SCHEMA_VERSION, "Unexpected manifest report schema version.");
  assert(manifest.runtimeVersion?.node === process.version, "Unexpected manifest runtime node version.");
  assert(manifest.optionsProfile === "normal", "Unexpected manifest optionsProfile.");
  assert(manifest.connection?.keepAlive === true, "Manifest should record effective keepAlive setting.");
  assert(Number.isInteger(manifest.connection?.maxSockets), "Manifest should record effective maxSockets.");
  assert(Array.isArray(manifest.generatedFiles), "generatedFiles must be an array.");
  assert(manifest.generatedFiles.some((file) => (
    file.path === "report.json"
    && file.kind === "report"
    && file.schemaVersion === REPORT_SCHEMA_VERSION
  )), "Manifest must include report.json with report schema version.");
}

async function assertDiffReadsVersionedReport(reportPath, tempDir) {
  const outputPath = path.join(tempDir, "diff.json");
  await execFileAsync(
    process.execPath,
    [diffCliPath, reportPath, reportPath, "--output", outputPath],
    { cwd: rootDir },
  );
  const diff = await readJson(outputPath);
  assert(!diff.warnings.some((warning) => warning.code === "legacy_report"), "Versioned reports must not emit legacy_report warnings.");
}

async function main() {
  const schema = await readJson(schemaPath);
  const checker = new LinkChecker("https://example.com/");
  const report = checker.buildReport();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p65a-"));

  try {
    assertReportRoot(report, schema);

    const manifest = buildOutputManifest({
      generatedAt: "2026-01-01T00:00:00.000Z",
      startUrl: report.startUrl,
      options: report.options,
      generatedFiles: [
        { path: "report.json", kind: "report", schemaVersion: report.schemaVersion },
      ],
    });
    assertManifest(manifest);

    const reportPath = path.join(tempDir, "report.json");
    const manifestPath = path.join(tempDir, "manifest.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    assertManifest(await readJson(manifestPath));
    await assertDiffReadsVersionedReport(reportPath, tempDir);
    console.log("ok p65a output contract");
  }
  finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`test-p65a-output-contract: ${error.message}`);
  process.exitCode = 1;
});
