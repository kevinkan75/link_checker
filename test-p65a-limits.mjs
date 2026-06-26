#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
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

function assertSourceTruncation() {
  const checker = new LinkChecker("https://example.test/", {
    maxSourcesPerUrl: 2,
  });
  const target = "https://example.test/missing";
  for (let index = 0; index < 5; index += 1) {
    checker.addSource(target, {
      page: `https://example.test/page-${index}`,
      tag: "a",
      attribute: "href",
      text: `missing-${index}`,
      sourceType: "html_attribute",
    });
  }
  checker.setResultForUrl(target, {
    url: target,
    canonicalUrl: target,
    checkedAt: "2026-01-01T00:00:00.000Z",
    ok: false,
    status: 404,
    method: "GET",
    finalUrl: target,
    contentType: "text/html",
    contentLength: 0,
    cacheHeaders: {},
    redirected: false,
    redirectCount: 0,
    redirectChain: [],
    redirectType: "none",
    redirectIssues: [],
    redirectLabels: [],
    classification: "http_error",
    issueType: "not_found",
    error: null,
  });

  const report = checker.buildReport();
  const broken = report.broken.find((item) => item.url === target);
  assert(broken, "Expected broken item for source truncation.");
  assert(broken.sourceCount === 5, "sourceCount should preserve the full source count.");
  assert(broken.sources.length === 2, "sources should be truncated to maxSourcesPerUrl.");
  assert(broken.sourcesTruncated === true, "sourcesTruncated should be true when output sources are capped.");
}

async function assertBodyLimits() {
  const largeHtml = `<html><body>${"x".repeat(2048)}<a href="/late">late</a></body></html>`;
  const largeBinary = Buffer.alloc(2048, 1);
  const report = await withServer((request, response) => {
    if (request.url === "/file.bin") {
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": largeBinary.length,
      });
      response.end(largeBinary);
      return;
    }

    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(largeHtml),
    });
    response.end(largeHtml);
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      maxPages: 1,
      retryCount: 0,
      confirm404: false,
      allowLocalhost: true,
      preferGet: true,
      concurrency: 2,
      perHostConcurrency: 2,
      requestDelayMs: 0,
      maxHtmlBytes: 256,
      maxBodyPreviewBytes: 128,
      maxDownloadProbeBytes: 64,
    });
    checker.addSource(`${origin}/file.bin`, {
      page: `${origin}/`,
      tag: "a",
      attribute: "href",
      text: "file",
      sourceType: "html_attribute",
    });
    await checker.checkUrl(`${origin}/file.bin`, { requireBody: false });
    return checker.run();
  });

  const page = report.checked.find((item) => item.url.endsWith("/"));
  assert(page, "Expected checked page result.");
  assert(page.bodyBytesRead === 256, "HTML bodyBytesRead should equal maxHtmlBytes.");
  assert(page.bodyTruncated === true, "HTML body should be marked truncated.");

  const download = report.checked.find((item) => item.url.endsWith("/file.bin"));
  assert(download, "Expected checked download result.");
  assert(download.bodyBytesRead === 0, "Download probe should not drain oversized body.");
  assert(download.bodyTruncated === true, "Oversized download probe should be marked truncated.");
}

async function main() {
  assertSourceTruncation();
  await assertBodyLimits();
  console.log("ok p65a limits");
}

main().catch((error) => {
  console.error(`test-p65a-limits: ${error.message}`);
  process.exitCode = 1;
});
