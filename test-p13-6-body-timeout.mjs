#!/usr/bin/env node

import { spawn } from "node:child_process";
import http from "node:http";
import { performance } from "node:perf_hooks";
import { LinkChecker } from "./link-checker.mjs";

const TIMEOUT_MS = 80;
const STALL_MS = 300;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function endAfter(response, body, delayMs = STALL_MS) {
  setTimeout(() => {
    if (!response.destroyed && !response.writableEnded) {
      response.end(body);
    }
  }, delayMs);
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

function createChecker(origin) {
  return new LinkChecker(origin, {
    allowLocalhost: true,
    robotsTxt: false,
    preferGet: true,
    retryCount: 0,
    timeoutMs: TIMEOUT_MS,
    requestDelayMs: 0,
    requestDelayMinMs: 0,
    requestDelayMaxMs: 0,
    maxPages: 1,
    maxDepth: 0,
    confirm404: false,
  });
}

async function measure(action) {
  const started = performance.now();
  const result = await action();
  return {
    result,
    elapsedMs: Math.round(performance.now() - started),
  };
}

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["link-checker.mjs", ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function main() {
  assert(STALL_MS >= TIMEOUT_MS * 3, "Fixture stall must be at least three times the configured timeout.");

  const server = await createServer((request, response) => {
    if (request.url === "/body-stall-required") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.flushHeaders();
      response.write("<html><body>");
      endAfter(response, '<a href="/late">late</a></body></html>');
      return;
    }
    if (request.url === "/body-stall-404") {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.flushHeaders();
      response.write("<html><body>not found");
      endAfter(response, "</body></html>");
      return;
    }
    if (request.url === "/body-fast") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><body>ok</body></html>");
      return;
    }
    if (request.url === "/header-stall") {
      setTimeout(() => {
        if (!response.destroyed && !response.writableEnded) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("late");
        }
      }, STALL_MS);
      return;
    }
    if (request.url === "/rules-stall") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.flushHeaders();
      response.write('{"rules":[');
      endAfter(response, '{"category":"fixture","domains":["example.com"],"source":"p13-6"}]}');
      return;
    }
    if (request.url === "/body-stall-stop") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.flushHeaders();
      response.write("<html><body>");
      endAfter(response, "late</body></html>");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("missing");
  });

  try {
    const checker = createChecker(server.origin);

    const caseA = await measure(() => checker.checkUrl(`${server.origin}/body-stall-required`, { requireBody: true }));
    const caseAPass = caseA.elapsedMs >= STALL_MS * 0.8
      && caseA.elapsedMs > TIMEOUT_MS * 2
      && caseA.result.status === 200
      && caseA.result.issueType !== "timeout";
    assert(caseAPass, "Required HTML body stall did not reproduce the timeout lifecycle gap.");

    const caseB = await measure(() => checker.checkUrl(`${server.origin}/body-stall-404`, { requireBody: false }));
    const caseBPass = caseB.result.status === 404 && caseB.elapsedMs > TIMEOUT_MS * 2;
    assert(caseBPass, "404 diagnostic body stall did not reproduce the timeout lifecycle gap.");

    const caseC = await measure(() => checker.checkUrl(`${server.origin}/body-fast`, { requireBody: true }));
    const caseCPass = caseC.result.status === 200
      && caseC.result.ok === true
      && caseC.result.issueType !== "timeout"
      && caseC.elapsedMs < STALL_MS / 2;
    assert(caseCPass, "Fast body control should complete well before the stalled fixtures.");

    const caseD = await measure(() => checker.checkUrl(`${server.origin}/header-stall`, { requireBody: true }));
    const caseDPass = caseD.result.status === null
      && caseD.result.issueType === "timeout"
      && caseD.result.classification === "network_error"
      && caseD.elapsedMs >= TIMEOUT_MS * 0.5
      && caseD.elapsedMs < STALL_MS;
    assert(caseDPass, "Pre-header stall should retain the existing timeout behavior.");

    const caseE = await measure(() => runCli([
      `${server.origin}/body-fast`,
      "--domain-rules", `${server.origin}/rules-stall`,
      "--timeout", String(TIMEOUT_MS),
      "--retry-count", "0",
      "--max-pages", "1",
      "--max-depth", "0",
      "--request-delay-ms", "0",
      "--allow-localhost",
      "--no-robots",
      "--no-confirm-404",
    ]));
    const caseEPass = caseE.result.code === 0
      && caseE.result.signal === null
      && caseE.elapsedMs > TIMEOUT_MS * 2;
    assert(caseEPass, `Rules URL body stall did not reproduce cleanly: ${caseE.result.stderr.trim()}`);

    const stopChecker = createChecker(server.origin);
    const stopPromise = measure(() => stopChecker.checkUrl(`${server.origin}/body-stall-stop`, { requireBody: true }));
    setTimeout(() => stopChecker.stop(), Math.floor(TIMEOUT_MS / 2));
    const caseF = await stopPromise;
    const caseFPass = caseF.result.cancelledByStop === true && caseF.elapsedMs < STALL_MS;
    assert(caseFPass, "User stop should abort an active response body read.");

    const summary = {
      timeoutMs: TIMEOUT_MS,
      stallMs: STALL_MS,
      caseA: {
        pass: caseAPass,
        status: caseA.result.status,
        ok: caseA.result.ok,
        issueType: caseA.result.issueType,
        classification: caseA.result.classification,
        elapsedMs: caseA.elapsedMs,
        resultElapsedMs: caseA.result.elapsedMs,
        bodyBytesRead: caseA.result.bodyBytesRead,
        bodyTruncated: caseA.result.bodyTruncated,
      },
      caseB: {
        pass: caseBPass,
        status: caseB.result.status,
        ok: caseB.result.ok,
        issueType: caseB.result.issueType,
        classification: caseB.result.classification,
        elapsedMs: caseB.elapsedMs,
        resultElapsedMs: caseB.result.elapsedMs,
        diagnosticBody: caseB.result.diagnosticBody,
        bodyBytesRead: caseB.result.bodyBytesRead,
        bodyTruncated: caseB.result.bodyTruncated,
      },
      caseC: {
        pass: caseCPass,
        status: caseC.result.status,
        ok: caseC.result.ok,
        issueType: caseC.result.issueType,
        classification: caseC.result.classification,
        elapsedMs: caseC.elapsedMs,
      },
      caseD: {
        pass: caseDPass,
        status: caseD.result.status,
        ok: caseD.result.ok,
        issueType: caseD.result.issueType,
        classification: caseD.result.classification,
        elapsedMs: caseD.elapsedMs,
      },
      caseE: {
        pass: caseEPass,
        exitCode: caseE.result.code,
        elapsedMs: caseE.elapsedMs,
      },
      caseF: {
        pass: caseFPass,
        cancelledByStop: caseF.result.cancelledByStop,
        stopReason: caseF.result.stopReason,
        elapsedMs: caseF.elapsedMs,
      },
    };

    console.log(JSON.stringify(summary, null, 2));
    console.log("ok p13-6 response body timeout lifecycle reproduction");
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
