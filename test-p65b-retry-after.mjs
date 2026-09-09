#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { runInNewContext } from "node:vm";
import { LinkChecker } from "./link-checker.mjs";

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

async function assertRetryAfterCooldownIsCappedAndPerHost() {
  const slowTimes = [];
  let fastCompletedAt = null;
  let slowCompletedAt = null;

  await withServer((request, response) => {
    slowTimes.push(performance.now());
    if (slowTimes.length === 1) {
      response.writeHead(429, {
        "content-type": "text/plain",
        "retry-after": "2",
      });
      response.end("rate limited");
      return;
    }
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("slow ok");
  }, async (slowOrigin) => {
    await withServer((request, response) => {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("fast ok");
    }, async (fastOrigin) => {
      const checker = new LinkChecker(`${slowOrigin}/`, {
        allowLocalhost: true,
        retryCount: 1,
        retryAfterMaxMs: 120,
        requestDelayMs: 0,
        confirm404: false,
        robotsTxt: false,
      });

      const slowPromise = checker
        .checkUrl(`${slowOrigin}/limited`, { requireBody: false })
        .then((result) => {
          slowCompletedAt = performance.now();
          return result;
        });
      const fastResult = await checker.checkUrl(`${fastOrigin}/ok`, { requireBody: false });
      fastCompletedAt = performance.now();
      const slowResult = await slowPromise;
      const report = checker.buildReport();
      const slowHost = new URL(slowOrigin).host;
      const diagnostics = report.summary.hostDiagnostics;
      const slowDiagnostics = diagnostics.hosts.find((item) => item.host === slowHost);

      assert(fastResult.ok === true, "Other host should complete successfully during cooldown.");
      assert(slowResult.ok === true && slowResult.attempts === 2, "Rate-limited host should retry once.");
      assert(fastCompletedAt < slowCompletedAt, "Other host should not wait for slow host cooldown.");
      assert(slowTimes.length === 2, "Slow host should receive initial request and one retry.");
      const retryGap = slowTimes[1] - slowTimes[0];
      assert(retryGap >= 90, `Retry gap should respect capped Retry-After wait, got ${retryGap}.`);
      assert(retryGap < 800, `Retry gap should not use raw 2s Retry-After wait, got ${retryGap}.`);
      assert(diagnostics.warnings.includes("rate_limited_host"), "Host diagnostics should warn on Retry-After/rate limit.");
      assert(slowDiagnostics.retryAfterCooldowns >= 1, "Host diagnostics should count Retry-After cooldowns.");
      assert(slowDiagnostics.retryAfterCooldownMs <= 150, "Cooldown should be capped near retryAfterMaxMs.");
      assert(slowDiagnostics.maxRetryAfterWaitMs === 2000, "Raw Retry-After wait should be preserved.");
    });
  });
}

async function assertHighBlockRateDiagnostics() {
  const checker = new LinkChecker("https://example.test/");
  const blocked = {
    url: "https://example.test/blocked",
    finalUrl: "https://example.test/blocked",
    ok: false,
    status: 403,
    classification: "protected",
    issueType: "access_denied",
    suspectedWaf: true,
    suspectedBot: true,
  };
  const normal = (path) => ({
    url: `https://example.test/${path}`,
    finalUrl: `https://example.test/${path}`,
    ok: true,
    status: 200,
  });

  const overlappingSignals = checker.buildHostDiagnostics([blocked]).hosts[0];
  assert(overlappingSignals.accessDenied === 1, "Access denied counter should be preserved.");
  assert(overlappingSignals.protected === 1, "Protected counter should be preserved.");
  assert(overlappingSignals.suspectedWaf === 1, "Suspected WAF counter should be preserved.");
  assert(overlappingSignals.suspectedBot === 1, "Suspected bot counter should be preserved.");
  assert(overlappingSignals.blockRate === 1, "One URL with overlapping signals should have block rate 1.");

  const oneOfThree = checker.buildHostDiagnostics([blocked, normal("ok-a"), normal("ok-b")]).hosts[0];
  assert(oneOfThree.blockRate === 0.3333, "One blocked URL out of three should have block rate 0.3333.");
  assert(!oneOfThree.warnings.includes("high_block_rate"), "One blocked URL out of three should not trigger high block rate.");

  const rateLimited = {
    url: "https://example.test/rate-limited",
    finalUrl: "https://example.test/rate-limited",
    ok: false,
    status: 429,
  };
  const twoOfFour = checker.buildHostDiagnostics([blocked, rateLimited, normal("ok-c"), normal("ok-d")]).hosts[0];
  assert(twoOfFour.accessDenied === 1, "Access denied count should remain independently available.");
  assert(twoOfFour.rateLimited === 1, "Rate limited count should remain independently available.");
  assert(twoOfFour.blockRate === 0.5, "Two blocked URLs out of four should have block rate 0.5.");
  assert(twoOfFour.warnings.includes("high_block_rate"), "Block rate 0.5 across four URLs should trigger high block rate.");
}

function assertElapsedTimeFormatting() {
  const appSource = readFileSync(new URL("./public/app.js", import.meta.url), "utf8");
  const formatterSource = appSource.match(/function formatElapsedTime\(seconds\) \{[\s\S]*?^\}/m)?.[0];
  assert(formatterSource, "Elapsed time formatter should exist in public/app.js.");
  const formatElapsedTime = runInNewContext(`(${formatterSource})`);
  const examples = new Map([
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [65, "1:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3665, "1:01:05"],
    [7387, "2:03:07"],
  ]);
  for (const [seconds, expected] of examples) {
    assert(formatElapsedTime(seconds) === expected, `${seconds} seconds should display as ${expected}.`);
  }
}

async function main() {
  await assertRetryAfterCooldownIsCappedAndPerHost();
  await assertHighBlockRateDiagnostics();
  assertElapsedTimeFormatting();
  console.log("ok p65b retry after");
}

main().catch((error) => {
  console.error(`test-p65b-retry-after: ${error.message}`);
  process.exitCode = 1;
});
