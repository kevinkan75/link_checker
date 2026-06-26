#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LinkChecker, REPORT_SCHEMA_VERSION } from "./link-checker.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(fileURLToPath(import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertCompleteReport() {
  const checker = new LinkChecker("https://example.test/", {
    retryCount: 0,
    confirm404: false,
  });
  const report = checker.buildReport();

  assert(report.runStatus?.status === "complete", "Default report should be complete.");
  assert(report.runStatus.stoppedByUser === false, "Complete report should not be stopped by user.");
  assert(typeof report.completedAt === "string", "Report should include completedAt.");
  assert(report.startedAt === report.runStatus.startedAt, "Root startedAt should match runStatus.");
  assert(report.completedAt === report.runStatus.completedAt, "Root completedAt should match runStatus.");
}

function assertPartialReport() {
  const checker = new LinkChecker("https://example.test/", {
    retryCount: 0,
    confirm404: false,
  });
  checker.stop();
  const report = checker.buildReport();

  assert(report.runStatus.status === "partial", "Stopped report should be partial.");
  assert(report.runStatus.stoppedByUser === true, "User stop should be marked.");
  assert(report.runStatus.stopReason === "stopped_by_user", "Stop reason should be recorded.");
  assert(Number.isInteger(report.runStatus.pendingPages), "Partial report should include pending page count.");
}

function assertFailedReport() {
  const checker = new LinkChecker("https://example.test/", {
    retryCount: 0,
    confirm404: false,
  });
  checker.validationError = new Error("validation exploded");
  checker.stopped = true;
  const report = checker.buildReport();

  assert(report.runStatus.status === "failed", "Validation error report should be failed.");
  assert(report.runStatus.stoppedByUser === false, "Failed report should not imply user stop.");
  assert(report.runStatus.failureReason === "validation exploded", "Failure reason should be recorded.");
}

function makeDiffReport(runStatus) {
  const timestamp = "2026-06-26T00:00:00.000Z";
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generator: {
      name: "link-checker.mjs",
      version: "test",
    },
    startedAt: timestamp,
    completedAt: timestamp,
    runStatus,
    startUrl: "https://example.test/",
    summary: {},
    checked: [],
    broken: [],
    externalLinks: [],
  };
}

async function assertDiffWarnsOnPartialReport() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-run-status-"));
  try {
    const oldPath = path.join(tempDir, "old.json");
    const newPath = path.join(tempDir, "new.json");
    const outputPath = path.join(tempDir, "diff.json");
    const completeRun = {
      status: "complete",
      startedAt: "2026-06-26T00:00:00.000Z",
      completedAt: "2026-06-26T00:00:01.000Z",
      stoppedByUser: false,
      pendingPages: 0,
      pendingValidations: 0,
      activeValidationTasks: 0,
    };
    const partialRun = {
      ...completeRun,
      status: "partial",
      stoppedByUser: true,
      stopReason: "stopped_by_user",
      pendingPages: 2,
    };

    await writeFile(oldPath, `${JSON.stringify(makeDiffReport(completeRun), null, 2)}\n`, "utf8");
    await writeFile(newPath, `${JSON.stringify(makeDiffReport(partialRun), null, 2)}\n`, "utf8");
    await execFileAsync(process.execPath, ["report-diff.mjs", oldPath, newPath, "--output", outputPath], {
      cwd: rootDir,
    });
    const diff = JSON.parse(await readFile(outputPath, "utf8"));
    const partialWarning = diff.warnings.find((warning) => warning.code === "partial_report");

    assert(partialWarning?.report === "new", "Diff should warn on new partial report.");
    assert(diff.newReport.runStatus.status === "partial", "Diff report ref should preserve runStatus.");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  assertCompleteReport();
  assertPartialReport();
  assertFailedReport();
  await assertDiffWarnsOnPartialReport();
  console.log("ok p65b run status");
}

main().catch((error) => {
  console.error(`test-p65b-run-status: ${error.message}`);
  process.exitCode = 1;
});
