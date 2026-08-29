#!/usr/bin/env node

import http from "node:http";
import { LinkChecker, BROWSER_USER_AGENT } from "./link-checker.mjs";

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

function assertConfirmedMissing(item, label) {
  assert(item.confirmation?.candidate === true, `${label} should be a confirmation candidate.`);
  assert(item.confirmation?.checked === true, `${label} should be checked by formal confirmation.`);
  assert(item.confirmation?.outcome === "confirmed_missing", `${label} should be confirmed_missing.`);
  assert(item.interpretation?.category === "action_required", `${label} should remain action_required.`);
}

function assertNotCandidate(item, label) {
  assert(item.confirmation?.candidate === false, `${label} should not be a confirmation candidate.`);
  assert(item.confirmation?.checked === false, `${label} should not be checked by formal confirmation.`);
  assert(item.confirmation?.reason === "not_candidate", `${label} should keep not_candidate reason.`);
}

async function runChecker(server, overrides = {}) {
  const checker = new LinkChecker(server.origin, {
    allowLocalhost: true,
    maxPages: 1,
    maxDepth: 0,
    concurrency: 8,
    perHostConcurrency: 8,
    requestDelayMs: 0,
    requestDelayMinMs: 0,
    requestDelayMaxMs: 0,
    retryCount: 0,
    timeoutMs: 80,
    confirm404: true,
    confirmationConcurrency: 4,
    confirmationPerHostConcurrency: 4,
    confirmationDelayMinMs: 0,
    confirmationDelayMaxMs: 0,
    confirmationMaxUrls: 20,
    confirmationMaxPerHost: 20,
    ...overrides,
  });
  return await checker.run();
}

async function assertRedirectConfirmationMatrix() {
  const requestLog = [];
  const targetGetCounts = new Map();
  let server;

  server = await createServer((request, response) => {
    requestLog.push({ method: request.method, url: request.url, userAgent: request.headers["user-agent"] || null });

    if (request.url === "/robots.txt") {
      write(response, 200, "User-agent: *\nAllow: /\n");
      return;
    }

    if (request.url === "/") {
      write(response, 200, `<!doctype html>
        <a href="/direct-404">direct 404</a>
        <a href="/direct-410">direct 410</a>
        <a href="/temp-redirect-404">temp redirect 404</a>
        <a href="/perm-redirect-410">perm redirect 410</a>
        <a href="/preserve-redirect-404">preserve redirect 404</a>
        <a href="/recovered">recovered</a>
        <a href="/timeout-confirm">timeout confirmation</a>
        <a href="/protected-confirm">protected confirmation</a>
        <a href="/client-redirect-confirm">client redirect confirmation</a>
        <a href="/redirect-500">redirect 500</a>
        <a href="/redirect-403">redirect 403</a>
        <a href="/redirect-loop-a">redirect loop</a>
        <a href="/too-many-a">too many redirects</a>
        <a href="/protected-initial">protected initial</a>
        <a href="/network-error">network error</a>
        <a href="/direct-timeout">direct timeout</a>
        <a href="/redirect-ok">redirect ok</a>`, { "content-type": "text/html" });
      return;
    }

    if (request.url === "/direct-404") {
      write(response, 404, "direct missing");
      return;
    }
    if (request.url === "/direct-410") {
      write(response, 410, "direct gone");
      return;
    }

    if (request.url === "/temp-redirect-404") {
      redirect(response, 302, "/temp-redirect-404-target");
      return;
    }
    if (request.url === "/temp-redirect-404-target") {
      write(response, 404, "redirect missing");
      return;
    }

    if (request.url === "/perm-redirect-410") {
      redirect(response, 301, "/perm-redirect-410-target");
      return;
    }
    if (request.url === "/perm-redirect-410-target") {
      write(response, 410, "redirect gone");
      return;
    }

    if (request.url === "/preserve-redirect-404") {
      redirect(response, 308, "/preserve-redirect-404-target");
      return;
    }
    if (request.url === "/preserve-redirect-404-target") {
      write(response, 404, "preserve redirect missing");
      return;
    }

    if (request.url === "/recovered") {
      redirect(response, 302, "/recovered-target");
      return;
    }
    if (request.url === "/recovered-target") {
      if (request.method === "GET") {
        const count = (targetGetCounts.get(request.url) || 0) + 1;
        targetGetCounts.set(request.url, count);
        write(response, count >= 3 ? 200 : 404, count >= 3 ? "recovered" : "initial missing");
        return;
      }
      write(response, 404, "initial missing");
      return;
    }

    if (request.url === "/timeout-confirm") {
      redirect(response, 302, "/timeout-confirm-target");
      return;
    }
    if (request.url === "/timeout-confirm-target") {
      if (request.method === "GET") {
        const count = (targetGetCounts.get(request.url) || 0) + 1;
        targetGetCounts.set(request.url, count);
        if (count >= 3) {
          setTimeout(() => write(response, 200, "late"), 250);
          return;
        }
        write(response, 404, "initial missing");
        return;
      }
      write(response, 404, "initial missing");
      return;
    }

    if (request.url === "/protected-confirm") {
      redirect(response, 302, "/protected-confirm-target");
      return;
    }
    if (request.url === "/protected-confirm-target") {
      if (request.method === "GET") {
        const count = (targetGetCounts.get(request.url) || 0) + 1;
        targetGetCounts.set(request.url, count);
        if (count >= 3) {
          write(response, 404, "<!doctype html><title>Just a moment...</title>Cloudflare is checking your browser before accessing the site.", { "content-type": "text/html" });
          return;
        }
        write(response, 404, "initial missing");
        return;
      }
      write(response, 404, "initial missing");
      return;
    }

    if (request.url === "/client-redirect-confirm") {
      redirect(response, 302, "/client-redirect-confirm-target");
      return;
    }
    if (request.url === "/client-redirect-confirm-target") {
      write(response, 404, "<!doctype html><script>window.location='/ok';</script>", { "content-type": "text/html" });
      return;
    }

    if (request.url === "/redirect-500") {
      redirect(response, 302, "/server-error");
      return;
    }
    if (request.url === "/server-error") {
      write(response, 500, "server error");
      return;
    }

    if (request.url === "/redirect-403") {
      redirect(response, 302, "/forbidden");
      return;
    }
    if (request.url === "/forbidden") {
      write(response, 403, "forbidden");
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

    if (request.url === "/protected-initial") {
      write(response, 403, "<!doctype html><title>Just a moment...</title>Cloudflare is checking your browser before accessing the site.", { "content-type": "text/html" });
      return;
    }

    if (request.url === "/network-error") {
      request.socket.destroy();
      return;
    }

    if (request.url === "/direct-timeout") {
      setTimeout(() => write(response, 200, "late"), 250);
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

    write(response, 404, "fallback missing");
  });

  try {
    const report = await runChecker(server, { maxRedirects: 2 });

    assertConfirmedMissing(findByPath(report, "/direct-404"), "direct 404");
    assertConfirmedMissing(findByPath(report, "/direct-410"), "direct 410");

    const tempRedirect = findByPath(report, "/temp-redirect-404");
    assert(tempRedirect.issueType === "redirect_to_error", "302 -> 404 should preserve redirect_to_error issueType.");
    assert(tempRedirect.redirected === true, "302 -> 404 should preserve redirected=true.");
    assert(tempRedirect.finalUrl.endsWith("/temp-redirect-404-target"), "302 -> 404 should preserve finalUrl.");
    assert(tempRedirect.redirectIssues.includes("redirect_to_error"), "302 -> 404 should preserve redirect_to_error evidence.");
    assertConfirmedMissing(tempRedirect, "302 -> 404");

    assertConfirmedMissing(findByPath(report, "/perm-redirect-410"), "301 -> 410");
    assertConfirmedMissing(findByPath(report, "/preserve-redirect-404"), "308 -> 404");

    const recovered = findByPath(report, "/recovered");
    assert(recovered.issueType === "redirect_to_error", "Recovered redirect should preserve original redirect_to_error issueType.");
    assert(recovered.confirmation?.outcome === "recovered", "Recovered redirect should record recovered confirmation.");
    assert(recovered.interpretation?.category === "needs_review", "Recovered redirect should need review, not action_required.");

    const timeout = findByPath(report, "/timeout-confirm");
    assert(timeout.confirmation?.outcome === "needs_review", "Timeout confirmation should be needs_review.");
    assert(timeout.confirmation?.reason === "timeout", "Timeout confirmation should preserve timeout reason.");
    assert(timeout.interpretation?.category === "needs_review", "Timeout confirmation should need review.");

    const protectedConfirmation = findByPath(report, "/protected-confirm");
    assert(protectedConfirmation.confirmation?.outcome === "needs_review", "Protection confirmation should be needs_review.");
    assert(protectedConfirmation.confirmation?.reason === "blocked_bot" || protectedConfirmation.confirmation?.reason === "blocked_waf", "Protection confirmation should preserve protection reason.");
    assert(protectedConfirmation.interpretation?.category === "needs_review", "Protection confirmation should need review.");

    const clientRedirect = findByPath(report, "/client-redirect-confirm");
    assert(clientRedirect.confirmation?.outcome === "confirmed_missing", "Client redirect evidence should not change confirmation outcome.");
    assert(clientRedirect.confirmation?.clientRedirectEvidence?.detected === true, "Redirect-to-404 confirmation should retain client redirect evidence.");
    assert(clientRedirect.confirmation.clientRedirectEvidence.targetChecked === true, "Same-origin client redirect target should be checked.");

    assertNotCandidate(findByPath(report, "/redirect-500"), "redirect -> 500");
    assertNotCandidate(findByPath(report, "/redirect-403"), "redirect -> 403");
    assertNotCandidate(findByPath(report, "/redirect-loop-a"), "redirect loop");
    assertNotCandidate(findByPath(report, "/too-many-a"), "too many redirects");
    assertNotCandidate(findByPath(report, "/protected-initial"), "protected initial");
    assertNotCandidate(findByPath(report, "/network-error"), "network error");
    assertNotCandidate(findByPath(report, "/direct-timeout"), "direct timeout");
    assertNotCandidate(findByPath(report, "/redirect-ok"), "successful redirect");

    const replay = requestLog.filter((item) => item.url === "/temp-redirect-404");
    assert(replay.some((item) => item.method === "HEAD"), "Initial validation should check the original redirect URL.");
    assert(replay.some((item) => item.method === "GET" && item.userAgent === BROWSER_USER_AGENT), "Confirmation should replay the original redirect URL with browser-compatible GET.");
  } finally {
    await server.close();
  }
}

async function assertConfirm404Disabled() {
  let server;
  server = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      write(response, 200, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/") {
      write(response, 200, '<!doctype html><a href="/redirect-missing">redirect missing</a>', { "content-type": "text/html" });
      return;
    }
    if (request.url === "/redirect-missing") {
      redirect(response, 302, "/missing");
      return;
    }
    if (request.url === "/missing") {
      write(response, 404, "missing");
      return;
    }
    write(response, 404, "fallback");
  });

  try {
    const report = await runChecker(server, { confirm404: false });
    const item = findByPath(report, "/redirect-missing");
    assert(item.issueType === "redirect_to_error", "Disabled confirmation should preserve original redirect_to_error.");
    assert(item.confirmation?.enabled === false, "confirm404=false should disable confirmation.");
    assert(item.confirmation?.candidate === false, "confirm404=false should not queue candidates.");
    assert(item.confirmation?.reason === "disabled", "confirm404=false should preserve disabled reason.");
  } finally {
    await server.close();
  }
}

async function assertSharedConfirmationLimits() {
  let server;
  server = await createServer((request, response) => {
    if (request.url === "/robots.txt") {
      write(response, 200, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/") {
      write(response, 200, '<!doctype html><a href="/direct-404">direct</a><a href="/redirect-404">redirect</a>', { "content-type": "text/html" });
      return;
    }
    if (request.url === "/direct-404") {
      write(response, 404, "direct missing");
      return;
    }
    if (request.url === "/redirect-404") {
      redirect(response, 302, "/redirect-404-target");
      return;
    }
    if (request.url === "/redirect-404-target") {
      write(response, 404, "redirect missing");
      return;
    }
    write(response, 404, "fallback");
  });

  try {
    const report = await runChecker(server, { confirmationMaxUrls: 1, confirmationMaxPerHost: 10 });
    const direct = findByPath(report, "/direct-404");
    const redirected = findByPath(report, "/redirect-404");
    assert(direct.confirmation?.candidate === true, "Direct missing should consume the shared confirmation queue.");
    assert(direct.confirmation?.checked === true, "Direct missing should be checked within the shared limit.");
    assert(redirected.confirmation?.candidate === true, "Redirect missing should still be recognized as a candidate at the shared limit.");
    assert(redirected.confirmation?.checked === false, "Redirect missing should not bypass the shared confirmation limit.");
    assert(redirected.confirmation?.reason === "global_limit", "Redirect missing should use existing global_limit reason.");
  } finally {
    await server.close();
  }
}

async function main() {
  await assertRedirectConfirmationMatrix();
  await assertConfirm404Disabled();
  await assertSharedConfirmationLimits();
  console.log("ok p13-2 redirect confirmation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
