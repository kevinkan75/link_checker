#!/usr/bin/env node

import http from "node:http";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
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

function findByPath(report, path) {
  const item = report.checked.find((candidate) => {
    try {
      return new URL(candidate.url).pathname === path;
    } catch {
      return false;
    }
  });
  assert(item, `Expected checked result for ${path}.`);
  return item;
}

function findExternal(report, origin) {
  const item = report.checked.find((candidate) => candidate.url.startsWith(origin));
  assert(item, "Expected checked external result.");
  return item;
}

async function main() {
  let externalServer;
  let mainServer;

  externalServer = await createServer((_request, response) => {
    response.writeHead(403, { "content-type": "text/plain" });
    response.end("Forbidden");
  });

  mainServer = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <a href="/missing">missing</a>
        <a href="/denied">denied</a>
        <a href="/rate-limited">rate limited</a>
        <a href="/redirect-ok">redirect ok</a>
        <a href="/redirect-missing">redirect missing</a>
        <a href="${externalServer.origin}/external-denied">external denied</a>`);
      return;
    }

    if (request.url === "/ok") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>OK</title>");
      return;
    }

    if (request.url === "/missing") {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("missing");
      return;
    }

    if (request.url === "/denied") {
      response.writeHead(403, { "content-type": "text/plain" });
      response.end("denied");
      return;
    }

    if (request.url === "/rate-limited") {
      response.writeHead(429, { "content-type": "text/plain" });
      response.end("rate limited");
      return;
    }

    if (request.url === "/redirect-ok") {
      response.writeHead(302, { location: "/ok" });
      response.end();
      return;
    }

    if (request.url === "/redirect-missing") {
      response.writeHead(302, { location: "/missing" });
      response.end();
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  try {
    const checker = new LinkChecker(mainServer.origin, {
      allowLocalhost: true,
      checkExternal: true,
      maxPages: 1,
      maxDepth: 0,
      concurrency: 4,
      perHostConcurrency: 2,
      requestDelayMs: 0,
      retryCount: 0,
      confirm404: true,
    });
    const report = await checker.run();

    assert(report.summary.interpretationByCategory, "summary.interpretationByCategory should be present.");
    const confirmedDirect = findByPath(report, "/missing");
    assert(confirmedDirect.interpretation.category === "action_required", "Confirmed 404 should require action.");
    assert(confirmedDirect.interpretation.label === "已確認失效", "Confirmed 404 should use evidence-based TA wording.");
    assert(confirmedDirect.interpretation.severity === "high", "Confirmed 404 should retain high severity.");
    assert(confirmedDirect.interpretation.needsManualReview === false, "Confirmed 404 should not ask for another manual confirmation.");
    assert(confirmedDirect.interpretation.action === "建議修正、更新或移除此連結。", "Confirmed 404 should recommend direct maintenance action.");
    assert(findByPath(report, "/denied").interpretation.category === "needs_review", "Same-origin 403 should need review.");
    assert(findByPath(report, "/rate-limited").interpretation.category === "needs_review", "Same-origin 429 should need review.");
    assert(findByPath(report, "/redirect-ok").interpretation.category === "redirect_ok", "Successful redirect should be redirect_ok.");
    const confirmedRedirect = findByPath(report, "/redirect-missing");
    assert(confirmedRedirect.interpretation.category === "action_required", "Confirmed redirect to error should require action.");
    assert(confirmedRedirect.interpretation.label === "已確認失效", "Confirmed redirect to 404 should use evidence-based TA wording.");
    assert(findExternal(report, externalServer.origin).interpretation.category === "external_limited", "External 403 should be external_limited.");

    const missingBroken = report.broken.find((item) => new URL(item.url).pathname === "/missing");
    assert(missingBroken?.interpretation?.category === "action_required", "broken[] should preserve interpretation.");
    assert(report.summary.interpretationByCategory.action_required >= 2, "summary should count action_required results.");
    assert(report.summary.interpretationByCategory.needs_review >= 2, "summary should count needs_review results.");
    assert(report.summary.interpretationByCategory.external_limited >= 1, "summary should count external_limited results.");
    assert(report.summary.interpretationByCategory.redirect_ok >= 1, "summary should count redirect_ok results.");

    const unconfirmedChecker = new LinkChecker(mainServer.origin, {
      allowLocalhost: true,
      checkExternal: false,
      maxPages: 1,
      maxDepth: 0,
      concurrency: 4,
      perHostConcurrency: 2,
      requestDelayMs: 0,
      retryCount: 0,
      confirm404: false,
    });
    const unconfirmedReport = await unconfirmedChecker.run();
    const unconfirmedDirect = findByPath(unconfirmedReport, "/missing");
    assert(unconfirmedDirect.interpretation.category === "likely_problem", "Unconfirmed direct 404 should be likely_problem.");
    assert(unconfirmedDirect.interpretation.label === "請人工確認", "Unconfirmed direct 404 should ask for human confirmation.");
    assert(unconfirmedDirect.interpretation.severity === "medium", "Unconfirmed direct 404 should use medium severity.");
    assert(unconfirmedDirect.interpretation.needsManualReview === true, "Unconfirmed direct 404 should require manual review.");
    assert(unconfirmedDirect.interpretation.action === "請先用一般瀏覽器確認此連結是否可正常開啟；若確實失效，再修正、更新或移除此連結。", "Unconfirmed direct 404 should use TA-oriented review guidance.");

    const unconfirmedRedirect = findByPath(unconfirmedReport, "/redirect-missing");
    assert(unconfirmedRedirect.interpretation.category === "likely_problem", "Unconfirmed redirect to 404 should be likely_problem.");
    assert(unconfirmedRedirect.interpretation.label === "請人工確認", "Unconfirmed redirect to 404 should ask for human confirmation.");
    assert(unconfirmedRedirect.interpretation.needsManualReview === true, "Unconfirmed redirect to 404 should require manual review.");
  } finally {
    if (mainServer) {
      await mainServer.close();
    }
    if (externalServer) {
      await externalServer.close();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
