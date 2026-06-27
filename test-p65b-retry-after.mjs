#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
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
  await withServer((request, response) => {
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("forbidden");
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      robotsTxt: false,
    });

    await Promise.all([
      checker.checkUrl(`${origin}/a`, { requireBody: false }),
      checker.checkUrl(`${origin}/b`, { requireBody: false }),
      checker.checkUrl(`${origin}/c`, { requireBody: false }),
    ]);
    const report = checker.buildReport();
    const hostDiagnostics = report.summary.hostDiagnostics.hosts.find((item) => item.host === new URL(origin).host);

    assert(hostDiagnostics.accessDenied === 3, "Access denied count should be aggregated per host.");
    assert(hostDiagnostics.blockRate === 1, "Block rate should be 1 for all blocked responses.");
    assert(hostDiagnostics.warnings.includes("high_block_rate"), "High block-rate warning should be emitted.");
  });
}

async function main() {
  await assertRetryAfterCooldownIsCappedAndPerHost();
  await assertHighBlockRateDiagnostics();
  console.log("ok p65b retry after");
}

main().catch((error) => {
  console.error(`test-p65b-retry-after: ${error.message}`);
  process.exitCode = 1;
});
