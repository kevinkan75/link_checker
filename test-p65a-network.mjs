#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { deflateSync, gzipSync } from "node:zlib";
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
  }
  finally {
    server.close();
    await once(server, "close");
  }
}

async function assertHeadersAndCompression() {
  const requests = [];
  await withServer((request, response) => {
    requests.push({
      url: request.url,
      accept: request.headers.accept,
      acceptEncoding: request.headers["accept-encoding"],
      connection: request.headers.connection,
    });

    if (request.url === "/asset.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([1, 2, 3]));
      return;
    }

    if (request.url === "/gzip") {
      const body = gzipSync("<html><body><a href=\"/late\">late</a></body></html>");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "gzip",
      });
      response.end(body);
      return;
    }

    if (request.url === "/deflate") {
      const body = deflateSync("<html><body><a href=\"/late\">late</a></body></html>");
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-encoding": "deflate",
      });
      response.end(body);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body>ok</body></html>");
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      retryCount: 0,
      confirm404: false,
      allowLocalhost: true,
      preferGet: true,
      requestDelayMs: 0,
    });

    const page = await checker.checkUrl(`${origin}/`, { requireBody: true });
    const asset = await checker.checkUrl(`${origin}/asset.png`, { requireBody: false });
    const gzip = await checker.checkUrl(`${origin}/gzip`, { requireBody: true });
    const deflate = await checker.checkUrl(`${origin}/deflate`, { requireBody: true });

    assert(page.ok, "Expected page request to succeed.");
    assert(asset.ok, "Expected asset request to succeed.");
    assert(gzip.body.includes("/late"), "Expected gzip-compressed HTML to be decoded.");
    assert(deflate.body.includes("/late"), "Expected deflate-compressed HTML to be decoded.");
  });

  const pageRequest = requests.find((item) => item.url === "/");
  const assetRequest = requests.find((item) => item.url === "/asset.png");
  assert(pageRequest.accept.includes("text/html"), "Page-like requests should use document Accept.");
  assert(assetRequest.accept === "*/*", "Asset/media/document probes should use generic Accept.");
  assert(pageRequest.acceptEncoding === "gzip, deflate", "Requests should advertise gzip/deflate support.");
  assert(assetRequest.acceptEncoding === "gzip, deflate", "Asset probes should advertise gzip/deflate support.");
}

async function assertNoKeepAliveHeader() {
  const requests = [];
  await withServer((request, response) => {
    requests.push({
      url: request.url,
      connection: request.headers.connection,
    });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<html><body>ok</body></html>");
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      keepAlive: false,
      retryCount: 0,
      confirm404: false,
      allowLocalhost: true,
      preferGet: true,
      requestDelayMs: 0,
    });
    const result = await checker.checkUrl(`${origin}/`, { requireBody: false });
    const report = checker.buildReport();
    assert(result.ok, "Expected no-keep-alive request to succeed.");
    assert(report.options.keepAlive === false, "Report options should record disabled keepAlive.");
  });

  assert(requests[0].connection === "close", "--no-keep-alive should send Connection: close.");
}

async function assertPerHostConcurrencyLimit() {
  let active = 0;
  let maxActive = 0;

  await withServer((request, response) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body>ok</body></html>");
      active -= 1;
    }, 50);
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      concurrency: 8,
      perHostConcurrency: 2,
      retryCount: 0,
      confirm404: false,
      allowLocalhost: true,
      preferGet: true,
      requestDelayMs: 0,
    });

    await Promise.all(Array.from({ length: 6 }, (_, index) => (
      checker.checkUrl(`${origin}/slow-${index}`, { requireBody: false })
    )));
  });

  assert(maxActive <= 2, `Expected per-host concurrency <= 2, got ${maxActive}.`);
}

async function assertOrdinaryAnchor405Fallback() {
  const requests = [];
  await withServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
        <a href="/head-fallback-ok">Fallback succeeds</a>
        <a href="/head-fallback-405">Fallback remains 405</a>`);
      return;
    }
    if (request.url === "/head-fallback-ok" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Fallback succeeded</title>");
      return;
    }
    response.writeHead(405, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Method not allowed</title>");
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      confirm404: false,
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 0,
      retryCount: 0,
      robotsTxt: false,
    });
    const report = await checker.run();
    const recoveredUrl = `${origin}/head-fallback-ok`;
    const failedUrl = `${origin}/head-fallback-405`;
    const recovered = report.checked.find((item) => item.url === recoveredUrl);
    const failed = report.checked.find((item) => item.url === failedUrl);
    const recoveredMethods = requests.filter((item) => item.url === "/head-fallback-ok").map((item) => item.method);
    const failedMethods = requests.filter((item) => item.url === "/head-fallback-405").map((item) => item.method);

    assert(JSON.stringify(recoveredMethods) === JSON.stringify(["HEAD", "GET"]), "Ordinary anchor should retain HEAD-to-GET fallback after HEAD 405.");
    assert(recovered?.ok === true && recovered.status === 200 && recovered.method === "GET", "Ordinary anchor should recover when fallback GET returns 200.");
    assert(JSON.stringify(failedMethods) === JSON.stringify(["HEAD", "GET"]), "Ordinary anchor should still attempt GET when HEAD and GET both return 405.");
    assert(failed?.ok === false && failed.status === 405 && failed.method === "GET", "Ordinary anchor GET 405 should retain general HTTP error semantics.");
    assert(failed?.classification === "http_error" && failed.issueType === "http_error", "Ordinary anchor GET 405 classification must remain unchanged.");
    assert(failed?.interpretation?.category === "likely_problem", "Ordinary anchor GET 405 interpretation must remain unchanged.");
    assert(report.broken.length === 1 && report.broken[0].url === failedUrl, "Only the ordinary anchor whose GET remains 405 should be broken.");
  });
}

async function main() {
  await assertHeadersAndCompression();
  await assertNoKeepAliveHeader();
  await assertPerHostConcurrencyLimit();
  await assertOrdinaryAnchor405Fallback();
  console.log("ok p65a network");
}

main().catch((error) => {
  console.error(`test-p65a-network: ${error.message}`);
  process.exitCode = 1;
});
