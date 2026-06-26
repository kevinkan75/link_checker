#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { LinkChecker } from "./link-checker.mjs";

const execFileAsync = promisify(execFile);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function makeChecker(origin, options = {}) {
  return new LinkChecker(`${origin}/`, {
    allowLocalhost: true,
    retryCount: 0,
    confirm404: false,
    maxPages: 1,
    maxDepth: 0,
    ...options,
  });
}

async function assertRobotsRecorded() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end([
        "User-agent: *",
        "Disallow: /private",
        "Allow: /public",
        "Crawl-delay: 7",
        "Sitemap: https://example.test/sitemap.xml",
        "",
      ].join("\n"));
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>ok</title>");
  }, async (origin) => {
    const report = await makeChecker(origin).run();
    const robots = report.summary.robotsTxt;

    assert(robots.status === "ok", "robots.txt should be recorded as ok.");
    assert(robots.httpStatus === 200, "robots httpStatus should be recorded.");
    assert(robots.disallowRules === 1, "Disallow rule count should be recorded.");
    assert(robots.allowRules === 1, "Allow rule count should be recorded.");
    assert(robots.crawlDelaySeconds === 7, "Crawl-delay should be parsed.");
    assert(robots.pathEnforcement === false, "P6.5b-3 should not enforce robots paths.");
    assert(report.scanPolicy.robotsTxt.status === "robots_compliant", "Expected compliant record-only policy.");
    assert(report.scanPolicy.robotsTxt.mode === "record_only", "robots policy should be record-only.");
    assert(report.compliance.authorizedScanDeclared === false, "Authorization should not be implied.");
    assert(report.compliance.scope === "same_origin", "Default compliance scope should be same_origin.");
  });
}

async function assertFullDisallowWithoutDeclaration() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nDisallow: /\n");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>ok</title>");
  }, async (origin) => {
    const report = await makeChecker(origin).run();

    assert(report.summary.robotsTxt.fullDisallow === true, "Full disallow should be detected.");
    assert(
      report.scanPolicy.robotsTxt.status === "robots_disallow_override_without_declaration",
      "Full disallow without declaration should be explicit.",
    );
    assert(report.compliance.robotsTxtEnforced === false, "P6.5b-3 should not claim robots enforcement.");
  });
}

async function assertRobotsDisabled() {
  let robotsRequested = false;
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      robotsRequested = true;
    }
    response.writeHead(200, { "content-type": request.url === "/robots.txt" ? "text/plain" : "text/html" });
    response.end(request.url === "/robots.txt" ? "User-agent: *\nDisallow: /\n" : "<!doctype html><title>ok</title>");
  }, async (origin) => {
    const report = await makeChecker(origin, {
      robotsTxt: false,
      authorizedScan: true,
      authorizationNote: "internal ticket LC-123",
    }).run();

    assert(robotsRequested === false, "robots.txt should not be requested when disabled.");
    assert(report.summary.robotsTxt.status === "disabled", "Disabled robots status should be recorded.");
    assert(report.scanPolicy.robotsTxt.status === "robots_disabled", "Disabled scan policy should be recorded.");
    assert(report.compliance.authorizedScanDeclared === true, "Authorization declaration should be recorded.");
    assert(report.compliance.authorizationNote === "internal ticket LC-123", "Authorization note should be recorded.");
  });
}

async function assertCliComplianceOptions() {
  await withServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>ok</title>");
  }, async (origin) => {
    const { stdout } = await execFileAsync(process.execPath, [
      "link-checker.mjs",
      `${origin}/`,
      "--allow-localhost",
      "--max-pages",
      "1",
      "--max-depth",
      "1",
      "--no-robots",
      "--authorized-scan",
      "--authorization-note",
      "cli declaration",
      "--json",
    ]);
    const report = JSON.parse(stdout);

    assert(report.options.robotsTxt === false, "CLI --no-robots should be reflected in report options.");
    assert(report.options.authorizedScan === true, "CLI --authorized-scan should be reflected in report options.");
    assert(report.options.authorizationNote === "cli declaration", "CLI authorization note should be reflected.");
    assert(report.compliance.authorizedScanDeclared === true, "CLI compliance declaration should be recorded.");
  });
}

async function main() {
  await assertRobotsRecorded();
  await assertFullDisallowWithoutDeclaration();
  await assertRobotsDisabled();
  await assertCliComplianceOptions();
  console.log("ok p65b robots compliance");
}

main().catch((error) => {
  console.error(`test-p65b-robots-compliance: ${error.message}`);
  process.exitCode = 1;
});
