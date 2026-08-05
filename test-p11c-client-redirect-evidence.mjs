#!/usr/bin/env node

import http from "node:http";
import { LinkChecker, REPORT_SCHEMA_VERSION } from "./link-checker.mjs";

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

async function main() {
  let externalServer;
  let server;
  let externalRequests = 0;

  externalServer = await createServer((_request, response) => {
    externalRequests += 1;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>External target</title>");
  });

  server = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <a href="/missing-with-client-redirect">missing with client redirect</a>
        <a href="/missing-with-external-client-redirect">missing with external client redirect</a>
        <a href="/plain-missing">plain missing</a>`);
      return;
    }

    if (request.url === "/missing-with-client-redirect") {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>Moved</title>
        <script>window.location.replace("/replacement");</script>`);
      return;
    }

    if (request.url === "/missing-with-external-client-redirect") {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <title>External moved</title>
        <script>window.location.href = "${externalServer.origin}/external-target";</script>`);
      return;
    }

    if (request.url === "/plain-missing") {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Missing</title><p>Not found.</p>");
      return;
    }

    if (request.url === "/replacement") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Replacement</title>");
      return;
    }

    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });

  try {
    const checker = new LinkChecker(server.origin, {
      allowLocalhost: true,
      maxPages: 1,
      maxDepth: 0,
      concurrency: 4,
      perHostConcurrency: 2,
      requestDelayMs: 0,
      retryCount: 0,
      confirm404: true,
      confirmationDelayMinMs: 0,
      confirmationDelayMaxMs: 0,
      confirmationConcurrency: 2,
      confirmationPerHostConcurrency: 2,
    });
    const report = await checker.run();

    assert(report.schemaVersion === REPORT_SCHEMA_VERSION, "Report should use the current schema version.");
    assert(report.schemaVersion === "1.3.0", "Client redirect evidence should start at report schema 1.3.0.");

    const redirected = findByPath(report, "/missing-with-client-redirect");
    assert(redirected.confirmation?.outcome === "confirmed_missing", "Client redirect evidence must not change confirmation outcome.");
    const evidence = redirected.confirmation.clientRedirectEvidence;
    assert(evidence.detected === true, "Expected client redirect evidence to be detected.");
    assert(evidence.source === "script_literal", "Expected script literal redirect source.");
    assert(evidence.attribute === "location.replace", "Expected location.replace evidence.");
    assert(evidence.targetUrl === `${server.origin}/replacement`, "Expected resolved same-origin target URL.");
    assert(evidence.targetChecked === true, "Same-origin redirect target should be checked.");
    assert(evidence.targetStatus === 200, "Expected reachable target status.");
    assert(evidence.targetOk === true, "Expected reachable target ok evidence.");
    assert(evidence.targetFinalUrl === `${server.origin}/replacement`, "Expected target final URL.");
    assert(evidence.reason === "target_reachable", "Expected target_reachable evidence reason.");

    const plain = findByPath(report, "/plain-missing");
    assert(plain.confirmation?.outcome === "confirmed_missing", "Plain 404 should still be confirmed missing.");
    assert(plain.confirmation.clientRedirectEvidence.detected === false, "Plain 404 should explicitly report no client redirect.");
    assert(plain.confirmation.clientRedirectEvidence.reason === "no_client_redirect", "Plain 404 should use no_client_redirect reason.");

    const externalRedirect = findByPath(report, "/missing-with-external-client-redirect");
    const externalEvidence = externalRedirect.confirmation.clientRedirectEvidence;
    assert(externalEvidence.detected === true, "Expected external client redirect evidence.");
    assert(externalEvidence.targetUrl === `${externalServer.origin}/external-target`, "Expected external target URL to be recorded.");
    assert(externalEvidence.targetChecked === false, "External target should not be checked in the first phase.");
    assert(externalEvidence.reason === "target_not_checked_external", "Expected external target skip reason.");
    assert(externalRequests === 0, "External target server should not receive validation requests.");

    console.log("ok p11c client redirect evidence");
  } finally {
    if (server) {
      await server.close();
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
