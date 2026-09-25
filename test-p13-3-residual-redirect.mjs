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
    "content-type": "text/plain",
    ...headers,
  });
  response.end(body);
}

function redirect(response, status, location) {
  response.writeHead(status, { location });
  response.end();
}

function findByPath(report, path) {
  const item = report.checked.find((candidate) => new URL(candidate.url).pathname === path);
  assert(item, `Expected checked result for ${path}.`);
  return item;
}

function isInBroken(report, item) {
  return report.broken.some((candidate) => candidate.url === item.url);
}

function assertRedirectWithoutLocation(report, item) {
  assert(item.ok === false, `${item.status} without Location should set ok=false.`);
  assert(item.issueType === "redirect_without_location", `${item.status} without Location should use redirect_without_location issueType.`);
  assert(item.classification === "redirect_error", `${item.status} without Location should use redirect_error classification.`);
  assert(item.redirectIssues.includes("redirect_without_location"), `${item.status} should record redirect_without_location.`);
  assert(item.redirectLabels.includes("redirect_without_location"), `${item.status} should label redirect_without_location.`);
  assert(item.interpretation?.category !== "ok", `${item.status} without Location must not be interpreted as ok.`);
  assert(isInBroken(report, item), `${item.status} without Location should appear in broken[].`);
}

async function main() {
  const server = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      write(response, 200, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/") {
      write(response, 200, `<!doctype html>
        <a href="/redirect-no-location-301">301 no location</a>
        <a href="/redirect-no-location-302">302 no location</a>
        <a href="/redirect-ok">redirect ok</a>
        <a href="/redirect-loop-a">redirect loop</a>
        <a href="/too-many-a">too many redirects</a>`, { "content-type": "text/html" });
      return;
    }
    if (request.url === "/redirect-no-location-301") {
      write(response, 301);
      return;
    }
    if (request.url === "/redirect-no-location-302") {
      write(response, 302);
      return;
    }
    if (request.url === "/redirect-ok") {
      redirect(response, 302, "/ok");
      return;
    }
    if (request.url === "/ok") {
      write(response, 200, "ok");
      return;
    }
    if (request.url === "/redirect-loop-a") {
      redirect(response, 302, "/redirect-loop-b");
      return;
    }
    if (request.url === "/redirect-loop-b") {
      redirect(response, 302, "/redirect-loop-a");
      return;
    }
    if (request.url === "/too-many-a") {
      redirect(response, 302, "/too-many-b");
      return;
    }
    if (request.url === "/too-many-b") {
      redirect(response, 302, "/too-many-c");
      return;
    }
    if (request.url === "/too-many-c") {
      redirect(response, 302, "/too-many-d");
      return;
    }
    write(response, 404, "missing");
  });

  try {
    const checker = new LinkChecker(server.origin, {
      allowLocalhost: true,
      maxPages: 1,
      maxDepth: 0,
      concurrency: 5,
      perHostConcurrency: 5,
      requestDelayMs: 0,
      requestDelayMinMs: 0,
      requestDelayMaxMs: 0,
      retryCount: 0,
      timeoutMs: 500,
      maxRedirects: 2,
      confirm404: false,
    });
    const report = await checker.run();
    assertRedirectWithoutLocation(report, findByPath(report, "/redirect-no-location-301"));
    assertRedirectWithoutLocation(report, findByPath(report, "/redirect-no-location-302"));

    const validRedirect = findByPath(report, "/redirect-ok");
    assert(validRedirect.ok === true, "Valid 302 redirect should remain ok.");
    assert(validRedirect.redirected === true, "Valid 302 redirect should retain redirected=true.");
    assert(validRedirect.interpretation?.category === "redirect_ok", "Valid 302 redirect should remain redirect_ok.");

    const redirectLoop = findByPath(report, "/redirect-loop-a");
    assert(redirectLoop.ok === false, "Redirect loop should remain not ok.");
    assert(redirectLoop.issueType === "redirect_loop", "Redirect loop issueType should remain unchanged.");
    assert(redirectLoop.classification === "redirect_error", "Redirect loop classification should remain unchanged.");
    assert(redirectLoop.interpretation?.category === "action_required", "Redirect loop interpretation should remain action_required.");

    const tooManyRedirects = findByPath(report, "/too-many-a");
    assert(tooManyRedirects.ok === false, "Too many redirects should remain not ok.");
    assert(tooManyRedirects.issueType === "too_many_redirects", "Too many redirects issueType should remain unchanged.");
    assert(tooManyRedirects.classification === "redirect_error", "Too many redirects classification should remain unchanged.");
    assert(tooManyRedirects.interpretation?.category === "action_required", "Too many redirects interpretation should remain action_required.");

    console.log("ok p13-3 residual redirect hardening");
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
