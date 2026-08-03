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

async function main() {
  let externalServer;
  let mainServer;

  externalServer = await createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>External form endpoint</title>");
  });

  mainServer = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("User-agent: *\nAllow: /\n");
      return;
    }

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
      maxPages: 1,
      maxDepth: 0,
      requestDelayMs: 0,
      retryCount: 0,
    });
    const report = await checker.run();
    const externalForm = report.externalLinks.find((item) => item.type === "form");

    assert(externalForm, "Expected external form to appear in externalLinks.");
    assert(externalForm.categories.includes("form"), "External form should include form category.");
    assert(externalForm.externalRisk?.riskLevel === "medium", "External form should be medium risk.");
    assert(externalForm.externalRisk?.riskReasons.includes("form"), "External form should cite form as risk reason.");
    assert(externalForm.externalRisk?.needsReview === true, "External form should require review.");
    assert(externalForm.externalRisk?.governanceStatus === "needs_review", "External form should use needs_review governance status.");
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
