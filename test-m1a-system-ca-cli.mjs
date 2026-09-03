#!/usr/bin/env node

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isSystemCaEnabled,
  restartWithSystemCa,
  shouldRestartWithSystemCa,
} from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRestartDecision() {
  assert(
    shouldRestartWithSystemCa({ systemCa: false }, false) === false,
    "CLI should not restart when --system-ca is absent.",
  );
  assert(
    shouldRestartWithSystemCa({ systemCa: true }, false) === true,
    "CLI should restart when --system-ca is present and process system CA is not enabled.",
  );
  assert(
    shouldRestartWithSystemCa({ systemCa: true }, true) === false,
    "CLI should not restart again when process system CA is already enabled.",
  );

  const originalNodeOptions = process.env.NODE_OPTIONS;
  try {
    process.env.NODE_OPTIONS = originalNodeOptions
      ? `${originalNodeOptions} --use-system-ca`
      : "--use-system-ca";
    assert(isSystemCaEnabled() === true, "NODE_OPTIONS=--use-system-ca should count as process system CA mode.");
    assert(
      shouldRestartWithSystemCa({ systemCa: true }) === false,
      "CLI should not restart when NODE_OPTIONS already enables process system CA mode.",
    );
  } finally {
    if (originalNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }
  }
}

async function assertRestartUsesProcessLevelSystemCaAndReturnsChildExitCode() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-m1a-"));
  const childScript = path.join(tempDir, "system-ca-child.mjs");
  const expectedExitCode = 7;

  try {
    await writeFile(childScript, `
if (!process.execArgv.includes("--use-system-ca")) {
  process.exit(6);
}
process.exit(Number.parseInt(process.argv[2], 10));
`, "utf8");

    const exitCode = await restartWithSystemCa([String(expectedExitCode)], {
      entrypoint: childScript,
    });

    assert(
      exitCode === expectedExitCode,
      "Parent CLI should return the child process exit code from the system CA restart.",
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  assertRestartDecision();
  await assertRestartUsesProcessLevelSystemCaAndReturnsChildExitCode();
  console.log("ok m1a system ca cli");
}

main().catch((error) => {
  console.error(`test-m1a-system-ca-cli: ${error.message}`);
  process.exitCode = 1;
});
