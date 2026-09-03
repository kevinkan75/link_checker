#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const LINK_CHECKER = fileURLToPath(new URL("./link-checker.mjs", import.meta.url));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(value, expected, message) {
  assert(String(value).includes(expected), `${message} (expected ${JSON.stringify(expected)} in ${JSON.stringify(value)})`);
}

function writeHtml(response, body) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><body>${body}</body></html>`);
}

async function startServer() {
  const requestCounts = new Map();
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    requestCounts.set(pathname, (requestCounts.get(pathname) || 0) + 1);
    if (pathname === "/") {
      writeHtml(response, '<a href="/child">Child</a>');
      return;
    }
    if (pathname === "/child") {
      writeHtml(response, '<a href="/grandchild">Grandchild</a>');
      return;
    }
    if (pathname === "/grandchild") {
      writeHtml(response, "<p>Grandchild</p>");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("missing");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    requestCounts,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [LINK_CHECKER, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function runCliAsync(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [LINK_CHECKER, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (status, signal) => {
      resolve({
        status,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

function parseJsonRun(result) {
  assert(
    result.status === 0,
    `CLI should exit 0. status=${result.status} signal=${result.signal} stdout=${result.stdout} stderr=${result.stderr}`,
  );
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`CLI stdout should be JSON: ${error.message}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
}

async function assertMaxDepthZeroParsesAndOnlyCrawlsStartPage() {
  const fixture = await startServer();
  try {
    const report = parseJsonRun(await runCliAsync([
      fixture.origin,
      "--max-depth", "0",
      "--max-pages", "5",
      "--allow-localhost",
      "--no-robots",
      "--no-confirm-404",
      "--no-keep-alive",
      "--request-delay-ms", "0",
      "--retry-count", "0",
      "--json",
    ]));

    assert(report.options.maxDepth === 0, "CLI should parse --max-depth 0 as numeric zero.");
    assert(report.summary.pagesCrawled === 1, "maxDepth=0 should crawl only the start page.");
    assert(report.checked.some((item) => item.url === `${fixture.origin}/child`), "Depth-0 scan may still validate links discovered on the start page.");
    assert(!report.checked.some((item) => item.url === `${fixture.origin}/grandchild`), "Depth-0 scan must not crawl child pages and discover deeper links.");
    assert((fixture.requestCounts.get("/grandchild") || 0) === 0, "Depth-0 scan must not request grandchild URLs.");
  } finally {
    await fixture.close();
  }
}

async function assertMaxDepthOneStillCrawlsOneLevel() {
  const fixture = await startServer();
  try {
    const report = parseJsonRun(await runCliAsync([
      fixture.origin,
      "--max-depth", "1",
      "--max-pages", "5",
      "--allow-localhost",
      "--no-robots",
      "--no-confirm-404",
      "--no-keep-alive",
      "--request-delay-ms", "0",
      "--retry-count", "0",
      "--json",
    ]));

    assert(report.options.maxDepth === 1, "CLI should keep parsing --max-depth 1.");
    assert(report.summary.pagesCrawled === 2, "maxDepth=1 should still crawl the first discovered page level.");
    assert(report.checked.some((item) => item.url === `${fixture.origin}/grandchild`), "maxDepth=1 should discover links from the child page.");
  } finally {
    await fixture.close();
  }
}

function assertInvalidMaxDepthRejects() {
  const result = runCli(["https://example.test/", "--max-depth", "-1"]);
  assert(result.status === 1, "--max-depth -1 should be rejected.");
  assertIncludes(result.stderr, "--max-depth must be a non-negative integer", "--max-depth error should describe the non-negative constraint.");
}

function assertMaxPagesZeroStillRejects() {
  const result = runCli(["https://example.test/", "--max-pages", "0"]);
  assert(result.status === 1, "--max-pages 0 should remain rejected.");
  assertIncludes(result.stderr, "--max-pages must be a positive integer", "--max-pages error should keep the positive constraint.");
}

async function main() {
  await assertMaxDepthZeroParsesAndOnlyCrawlsStartPage();
  await assertMaxDepthOneStillCrawlsOneLevel();
  assertInvalidMaxDepthRejects();
  assertMaxPagesZeroStillRejects();
  console.log("ok m4 max depth cli");
}

main().catch((error) => {
  console.error(`test-m4-max-depth-cli: ${error.message}`);
  process.exitCode = 1;
});
