#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LinkChecker } from "./link-checker.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(rootDir, "link-checker.mjs");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hashLabel(value) {
  return `sha256:${createHash("sha256").update(String(value || "")).digest("hex")}`;
}

async function createServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function assertDisabledRulesTrace(report) {
  assert(report.rulesTrace?.schemaVersion === "rules-trace.p9c2", "rulesTrace schemaVersion should be present.");
  for (const key of ["domainCategoryRules", "externalRiskRules", "siteLinkRules"]) {
    const entry = report.rulesTrace[key];
    assert(entry, `${key} trace should be present.`);
    assert(entry.enabled === false, `${key} should be disabled by default.`);
    assert(entry.ruleCount === 0, `${key} disabled trace should have ruleCount 0.`);
    assert(Array.isArray(entry.warnings), `${key} warnings should be an array.`);
  }
}

async function assertLocalFileRulesTrace() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p9c2-"));
  const server = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>P9c2</title>");
  });

  try {
    const rulesText = `${JSON.stringify({
      schemaVersion: "domain-rules.test",
      rules: [
        { category: "government", domains: ["gov.tw", "example.gov.tw"] },
      ],
    }, null, 2)}\n`;
    const rulesPath = path.join(tempDir, "domain-rules.json");
    const reportPath = path.join(tempDir, "report.json");
    await writeFile(rulesPath, rulesText, "utf8");

    await execFileAsync(process.execPath, [
      cliPath,
      server.origin,
      "--allow-localhost",
      "--max-pages", "1",
      "--max-depth", "1",
      "--domain-rules", rulesPath,
      "--output", reportPath,
    ], { cwd: rootDir });

    const report = await readJson(reportPath);
    const trace = report.rulesTrace?.domainCategoryRules;
    assert(trace?.enabled === true, "domainCategoryRules trace should be enabled.");
    assert(trace.sourceType === "file", "domainCategoryRules sourceType should be file.");
    assert(trace.source === rulesPath, "domainCategoryRules source should match the rules path.");
    assert(trace.rulesVersion === "domain-rules.test", "domainCategoryRules rulesVersion should be recorded.");
    assert(trace.fingerprint === hashLabel(rulesText), "domainCategoryRules fingerprint should match rules text.");
    assert(trace.byteSize === Buffer.byteLength(rulesText, "utf8"), "domainCategoryRules byteSize should match rules text.");
    assert(trace.ruleCount === 1, "domainCategoryRules ruleCount should count normalized rules.");
    assert(trace.redirectCount === 0, "domainCategoryRules local file redirectCount should be 0.");
    assert(Array.isArray(trace.warnings) && trace.warnings.length === 0, "domainCategoryRules local file warnings should be empty.");
    assert(report.rulesTrace.externalRiskRules.enabled === false, "externalRiskRules should remain disabled.");
    assert(report.rulesTrace.siteLinkRules.enabled === false, "siteLinkRules should remain disabled.");
  } finally {
    await server.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertRulesUrlSecurityBlock() {
  const server = await createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{ category: "local", domains: ["example.test"] }]));
  });

  try {
    let failed = false;
    try {
      await execFileAsync(process.execPath, [
        cliPath,
        "https://example.com/",
        "--domain-rules", `${server.origin}/rules.json`,
      ], { cwd: rootDir });
    } catch (error) {
      failed = true;
      const stderr = String(error.stderr || "");
      assert(stderr.includes("blocked by security policy"), "rules URL localhost should be blocked by security policy.");
    }
    assert(failed, "rules URL localhost should fail without --allow-localhost.");
  } finally {
    await server.close();
  }
}

async function main() {
  const report = new LinkChecker("https://example.com/").buildReport();
  assertDisabledRulesTrace(report);
  await assertLocalFileRulesTrace();
  await assertRulesUrlSecurityBlock();
  console.log("ok p9c2 rules trace");
}

main().catch((error) => {
  console.error(`test-p9c2-rules-trace: ${error.message}`);
  process.exitCode = 1;
});
