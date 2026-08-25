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

async function withDelayedServer(task) {
  let requestCount = 0;
  let requestStartedResolve;
  const requestStarted = new Promise((resolve) => {
    requestStartedResolve = resolve;
  });

  const server = createServer((_request, response) => {
    requestCount += 1;
    requestStartedResolve();
    const timer = setTimeout(() => {
      if (!response.destroyed && !response.writableEnded) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>late response</title>");
      }
    }, 4000);
    response.on("close", () => clearTimeout(timer));
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    return await task({
      origin: `http://127.0.0.1:${port}`,
      requestStarted,
      getRequestCount: () => requestCount,
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

await withDelayedServer(async ({ origin, requestStarted, getRequestCount }) => {
  const timeoutMs = 5000;
  const checker = new LinkChecker(`${origin}/`, {
    allowLocalhost: true,
    robotsTxt: false,
    timeoutMs,
    retryCount: 2,
    maxPages: 1,
    maxDepth: 0,
    concurrency: 1,
    perHostConcurrency: 1,
    requestDelayMs: 0,
    confirm404: false,
  });

  const runPromise = checker.run();
  await requestStarted;

  await new Promise((resolve) => setTimeout(resolve, 100));
  const stoppedAt = performance.now();
  checker.stop();
  checker.stop();

  const report = await runPromise;
  const stopElapsedMs = performance.now() - stoppedAt;

  assert(stopElapsedMs < 1000, `Stopped scan should settle promptly, got ${Math.round(stopElapsedMs)}ms.`);
  assert(stopElapsedMs < timeoutMs / 2, "Stopped scan should not wait for the configured timeout.");
  assert(report.runStatus.status === "partial", "Stopped scan should produce a partial report.");
  assert(report.runStatus.stoppedByUser === true, "Stopped scan should be marked as stopped by user.");
  assert(report.runStatus.stopReason === "stopped_by_user", "Stop reason should remain stopped_by_user.");
  assert(report.runStatus.failureReason === undefined, "User stop must not become a failed scan.");
  assert(report.checked.length === 0, "Cancelled in-flight request should not be written as a checked result.");
  assert(report.broken.length === 0, "Cancelled in-flight request should not become a broken link.");
  assert(getRequestCount() === 1, "Cancelled in-flight request should not be retried.");
  assert(checker.activeRequestControllers.size === 0, "Request abort controllers should be cleaned up.");
  assert(checker.fetchLimiter.active === 0, "No active fetch limiter slot should remain after stop.");
});

console.log("ok gui request cancellation");
