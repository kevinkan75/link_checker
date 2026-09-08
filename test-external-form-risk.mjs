#!/usr/bin/env node

import http from "node:http";
import { makeBrokenCsv } from "./gui-server.mjs";
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

function getInventoryItem(checker, url) {
  return checker.inventory.get(checker.getCanonicalKey(url));
}

async function assertFormOnlyAndMixedSourceSemantics() {
  const requests = [];
  const server = await createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html>
        <form action="/submit"></form>
        <form method="post" action="/login"></form>
        <form method="get" action="/search"></form>
        <form action="/default-search"></form>
        <form action="/account"></form>
        <a href="/account">Account</a>
        <form action="/target"></form>
        <area href="/target">`);
      return;
    }

    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Navigation target</title>");
  });

  try {
    const checker = new LinkChecker(server.origin, {
      allowLocalhost: true,
      checkExternal: false,
      confirm404: false,
      concurrency: 2,
      maxPages: 3,
      maxDepth: 1,
      requestDelayMs: 0,
      retryCount: 0,
      robotsTxt: false,
    });
    const report = await checker.run();
    const formOnlyPaths = ["/submit", "/login", "/search", "/default-search"];

    for (const path of formOnlyPaths) {
      const url = `${server.origin}${path}`;
      const inventoryItem = getInventoryItem(checker, url);
      assert(inventoryItem, `Expected ${path} form action in the canonical inventory.`);
      assert(inventoryItem.sources.some((source) => source.tag === "form" && source.attribute === "action"), `Expected ${path} form source evidence.`);
      assert(inventoryItem.shouldCheck === false, `Form-only ${path} must not demand status validation.`);
      assert(inventoryItem.shouldCrawl === false, `Form-only ${path} must not demand page crawl.`);
      assert(inventoryItem.needsStatusCheck === false, `Form-only ${path} must not need a status check.`);
      assert(inventoryItem.needsBodyFetch === false, `Form-only ${path} must not need a body fetch.`);
      assert(!requests.some((item) => item.url === path), `Form-only ${path} must not be requested.`);
      assert(!report.checked.some((item) => item.url === url), `Form-only ${path} must not enter checked results.`);
      assert(!report.broken.some((item) => item.url === url), `Form-only ${path} must not enter broken results.`);
    }

    const accountUrl = `${server.origin}/account`;
    const accountItem = getInventoryItem(checker, accountUrl);
    assert(accountItem, "Expected mixed form and anchor URL in the canonical inventory.");
    assert(accountItem.sources.some((source) => source.tag === "form"), "Mixed URL should retain its form source.");
    assert(accountItem.sources.some((source) => source.tag === "a"), "Mixed URL should retain its anchor source.");
    assert(accountItem.shouldCheck === true, "Anchor source must preserve normal validation intent.");
    assert(accountItem.shouldCrawl === true, "Anchor source must preserve normal crawl intent.");
    assert(accountItem.needsStatusCheck === true, "Anchor source must preserve status-check demand.");
    assert(accountItem.needsBodyFetch === true, "Anchor source must preserve body-fetch demand.");
    assert(report.checked.some((item) => item.url === accountUrl && item.ok), "Mixed form and anchor URL should be checked normally.");
    assert(checker.crawledPageKeys.has(checker.getPageKey(accountUrl)), "Mixed form and anchor URL should be crawled normally.");

    const areaUrl = `${server.origin}/target`;
    const areaItem = getInventoryItem(checker, areaUrl);
    assert(areaItem?.sources.some((source) => source.tag === "form"), "Mixed form and area URL should retain its form source.");
    assert(areaItem?.sources.some((source) => source.tag === "area"), "Mixed form and area URL should retain its area source.");
    assert(areaItem?.shouldCheck === true, "Area source must preserve normal validation intent.");
    assert(areaItem?.shouldCrawl === true, "Area source must preserve normal crawl intent.");
    assert(checker.crawledPageKeys.has(checker.getPageKey(areaUrl)), "Mixed form and area URL should be crawled normally.");

    assert(!requests.some((item) => item.method === "POST"), "Form actions must never create POST requests.");
    assert(!requests.some((item) => item.url.startsWith("/search?")), "GET forms must not create synthetic query requests.");
    const brokenCsv = makeBrokenCsv(report.broken, report.options);
    for (const path of formOnlyPaths) {
      assert(!brokenCsv.includes(path), `broken.csv must not contain form-only ${path}.`);
    }
  } finally {
    await server.close();
  }
}

async function assertExternalFormEvidenceWithoutValidation() {
  const externalRequests = [];
  let externalServer;
  let mainServer;

  externalServer = await createServer((request, response) => {
    externalRequests.push({ method: request.method, url: request.url });
    response.writeHead(405, { "content-type": "text/html" });
    response.end("<!doctype html><title>Method not allowed</title>");
  });

  mainServer = await createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html>
      <form action="${externalServer.origin}/submit" method="post">
        <button>Send</button>
      </form>`);
  });

  try {
    const checker = new LinkChecker(mainServer.origin, {
      allowLocalhost: true,
      checkExternal: true,
      confirm404: false,
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 0,
      retryCount: 0,
      robotsTxt: false,
    });
    const report = await checker.run();
    const externalUrl = `${externalServer.origin}/submit`;
    const externalForm = report.externalLinks.find((item) => item.url === externalUrl);
    const inventoryItem = getInventoryItem(checker, externalUrl);

    assert(externalForm, "Expected external form to appear in externalLinks.");
    assert(externalForm.type === "form", "External form should retain form type.");
    assert(externalForm.categories.includes("form"), "External form should include form category.");
    assert(externalForm.sources.some((source) => source.tag === "form" && source.attribute === "action"), "External form should retain source evidence.");
    assert(externalForm.externalRisk?.riskLevel === "medium", "External form should be medium risk.");
    assert(externalForm.externalRisk?.riskReasons.includes("form"), "External form should cite form as risk reason.");
    assert(externalForm.externalRisk?.needsReview === true, "External form should require review.");
    assert(externalForm.externalRisk?.governanceStatus === "needs_review", "External form should use needs_review governance status.");
    assert(externalForm.checked === false && externalForm.status === null && externalForm.method === null, "External form should remain unvalidated source evidence.");
    assert(inventoryItem?.shouldCheck === false && inventoryItem?.shouldCrawl === false, "External form-only inventory intent should skip validation and crawl.");
    assert(inventoryItem?.needsStatusCheck === false && inventoryItem?.needsBodyFetch === false, "External form-only inventory should demand no request work.");
    assert(externalRequests.length === 0, "External form endpoint must not receive HEAD, GET, or POST requests.");
    assert(!report.broken.some((item) => item.url === externalUrl), "External form-only URL must not enter broken results.");
  } finally {
    if (mainServer) {
      await mainServer.close();
    }
    if (externalServer) {
      await externalServer.close();
    }
  }
}

async function main() {
  await assertFormOnlyAndMixedSourceSemantics();
  await assertExternalFormEvidenceWithoutValidation();
  console.log("ok external form risk and source semantics");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
