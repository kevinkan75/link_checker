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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function write(response, status, body = "", headers = {}) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    ...headers,
  });
  response.end(body);
}

function redirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function writeProtection(response) {
  write(
    response,
    403,
    "<!doctype html><title>Attention Required! | Cloudflare</title>Just a moment... /cdn-cgi/challenge-platform",
    {
      "content-type": "text/html; charset=utf-8",
      server: "cloudflare",
      "cf-ray": "p13-4-test-ray",
    },
  );
}

function findByUrl(report, url) {
  const item = report.checked.find((candidate) => candidate.url === url);
  assert(item, `Expected checked result for ${url}.`);
  return item;
}

function hasProtectionEvidence(result) {
  return result.suspectedWaf === true
    || result.suspectedBot === true
    || result.protection?.suspectedWaf === true
    || result.protection?.suspectedBot === true
    || Boolean(result.blockedReason)
    || Boolean(result.protection?.blockedReason);
}

function checkerOptions(overrides = {}) {
  return {
    allowLocalhost: true,
    maxPages: 1,
    maxDepth: 0,
    concurrency: 6,
    perHostConcurrency: 6,
    requestDelayMs: 0,
    requestDelayMinMs: 0,
    requestDelayMaxMs: 0,
    retryCount: 0,
    confirm404: true,
    confirmationConcurrency: 2,
    confirmationPerHostConcurrency: 2,
    confirmationDelayMinMs: 0,
    confirmationDelayMaxMs: 0,
    confirmationMaxUrls: 10,
    confirmationMaxPerHost: 10,
    ...overrides,
  };
}

async function assertSameOriginMatrix(server) {
  const checker = new LinkChecker(server.origin, checkerOptions());
  const report = await checker.run();

  const protectedRedirect = findByUrl(report, `${server.origin}/redirect-protected`);
  assert(protectedRedirect.issueType === "redirect_to_error", "Case 1 should preserve redirect_to_error issueType.");
  assert(protectedRedirect.classification === "redirect_error", "Case 1 should preserve redirect_error classification.");
  assert(hasProtectionEvidence(protectedRedirect), "Case 1 should preserve meaningful protection evidence.");
  assert(
    protectedRedirect.interpretation?.category === "needs_review",
    `Case 1 redirect + protection expected needs_review; got ${protectedRedirect.interpretation?.category}.`,
  );

  const plain403 = findByUrl(report, `${server.origin}/redirect-403`);
  assert(plain403.issueType === "redirect_to_error", "Case 3 should preserve redirect_to_error issueType.");
  assert(!hasProtectionEvidence(plain403), "Case 3 should not gain protection evidence.");
  assert(plain403.interpretation?.category === "action_required", "Case 3 generic redirect -> 403 should remain action_required.");

  const plain500 = findByUrl(report, `${server.origin}/redirect-500`);
  assert(plain500.issueType === "redirect_to_error", "Case 4 should preserve redirect_to_error issueType.");
  assert(!hasProtectionEvidence(plain500), "Case 4 should not gain protection evidence.");
  assert(plain500.interpretation?.category === "action_required", "Case 4 generic redirect -> 500 should remain action_required.");

  const confirmedMissing = findByUrl(report, `${server.origin}/redirect-404`);
  assert(confirmedMissing.issueType === "redirect_to_error", "Case 5 should preserve redirect_to_error issueType.");
  assert(confirmedMissing.confirmation?.candidate === true, "Case 5 should be a formal confirmation candidate.");
  assert(confirmedMissing.confirmation?.checked === true, "Case 5 should complete formal confirmation.");
  assert(confirmedMissing.confirmation?.outcome === "confirmed_missing", "Case 5 should remain confirmed_missing.");
  assert(confirmedMissing.interpretation?.category === "action_required", "Case 5 confirmed_missing should remain action_required.");

  const directProtection = findByUrl(report, `${server.origin}/direct-protected`);
  assert(directProtection.issueType === "protected", "Case 6 direct protection should retain protected issueType.");
  assert(hasProtectionEvidence(directProtection), "Case 6 should retain meaningful protection evidence.");
  assert(directProtection.interpretation?.category === "needs_review", "Case 6 direct protection should remain needs_review.");
}

async function assertExternalProtection(startOrigin, externalServer) {
  const checker = new LinkChecker(startOrigin, checkerOptions({
    confirm404: false,
    preferGet: true,
    robotsTxt: false,
  }));
  const url = `${externalServer.origin}/redirect-protected`;
  await checker.checkUrl(url, { requireBody: false });
  const result = findByUrl(checker.buildReport(), url);

  assert(result.issueType === "redirect_to_error", "Case 2 should preserve redirect_to_error issueType.");
  assert(result.classification === "redirect_error", "Case 2 should preserve redirect_error classification.");
  assert(hasProtectionEvidence(result), "Case 2 should preserve meaningful protection evidence.");
  assert(result.interpretation?.category === "external_limited", "Case 2 external redirect + protection should be external_limited.");
}

async function main() {
  let mainServer;
  let externalServer;

  mainServer = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      write(response, 200, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/") {
      write(response, 200, `<!doctype html>
        <a href="/redirect-protected">redirect protected</a>
        <a href="/redirect-403">redirect 403</a>
        <a href="/redirect-500">redirect 500</a>
        <a href="/redirect-404">redirect 404</a>
        <a href="/direct-protected">direct protected</a>`, { "content-type": "text/html; charset=utf-8" });
      return;
    }
    if (request.url === "/redirect-protected") {
      redirect(response, "/protected");
      return;
    }
    if (request.url === "/protected" || request.url === "/direct-protected") {
      writeProtection(response);
      return;
    }
    if (request.url === "/redirect-403") {
      redirect(response, "/plain-403");
      return;
    }
    if (request.url === "/plain-403") {
      write(response, 403, "forbidden");
      return;
    }
    if (request.url === "/redirect-500") {
      redirect(response, "/plain-500");
      return;
    }
    if (request.url === "/plain-500") {
      write(response, 500, "server error");
      return;
    }
    if (request.url === "/redirect-404") {
      redirect(response, "/missing");
      return;
    }
    if (request.url === "/missing") {
      write(response, 404, "missing");
      return;
    }
    write(response, 404, "fallback missing");
  });

  externalServer = await createServer((request, response) => {
    if (request.url === "/redirect-protected") {
      redirect(response, "/protected");
      return;
    }
    if (request.url === "/protected") {
      writeProtection(response);
      return;
    }
    write(response, 404, "fallback missing");
  });

  try {
    await assertSameOriginMatrix(mainServer);
    await assertExternalProtection(mainServer.origin, externalServer);
    console.log("ok p13-4 protection-aware interpretation");
  } finally {
    await Promise.all([mainServer.close(), externalServer.close()]);
  }
}

main().catch((error) => {
  console.error(`test-p13-4-protection-interpretation: ${error.message}`);
  process.exitCode = 1;
});
