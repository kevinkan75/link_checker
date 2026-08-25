#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function getFreePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

async function startTargetServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>ok</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

async function startGuiServer() {
  const port = await getFreePort();
  const child = spawn(process.execPath, [
    "gui-server.mjs",
    "--port",
    String(port),
    "--no-idle-shutdown",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdout = "";
  let stderr = "";
  const readyText = `Link Checker GUI is running at http://127.0.0.1:${port}`;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`GUI server did not start.\n${stdout}${stderr}`));
    }, 5000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes(readyText)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`GUI server exited before ready with ${code}.\n${stdout}${stderr}`));
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill();
      await once(child, "exit");
    },
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function postWithHostOverride(port, path, { host, tokenHeader, token, body }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      path,
      method: "POST",
      headers: {
        "host": host,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
        [tokenHeader]: token,
      },
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

async function waitForReport(baseUrl, jobId) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/jobs/${jobId}/report`);
    if (response.status === 200) {
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for GUI scan report.");
}

let gui;
let target;
try {
  target = await startTargetServer();
  gui = await startGuiServer();

  const sessionResponse = await fetch(`${gui.baseUrl}/api/session`);
  assert(sessionResponse.status === 200, "Session endpoint should be readable from localhost.");
  const session = await readJson(sessionResponse);
  const tokenHeader = session.sessionHeader;
  const token = session.sessionToken;
  assert(tokenHeader === "X-Link-Checker-Session", "Session endpoint should name the token header.");
  assert(typeof token === "string" && token.length > 20, "Session endpoint should return a session token.");

  const noTokenJob = await fetch(`${gui.baseUrl}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: target.origin, allowLocalhost: true, maxPages: 1 }),
  });
  assert(noTokenJob.status === 403, "Job creation without a token should be rejected.");

  const crossSiteJob = await fetch(`${gui.baseUrl}/api/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [tokenHeader]: token,
      "origin": "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ url: target.origin, allowLocalhost: true, maxPages: 1 }),
  });
  assert(crossSiteJob.status === 403, "Cross-site job creation should be rejected.");

  const badHostJobStatus = await postWithHostOverride(gui.port, "/api/jobs", {
    host: "attacker.example",
    tokenHeader,
    token,
    body: { url: target.origin, allowLocalhost: true, maxPages: 1 },
  });
  assert(badHostJobStatus === 403, "Unexpected Host job creation should be rejected.");

  const beforeQueue = await readJson(await fetch(`${gui.baseUrl}/api/queue`));
  const plainTextQueue = await fetch(`${gui.baseUrl}/api/queue/items`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      [tokenHeader]: token,
      "origin": gui.baseUrl,
    },
    body: JSON.stringify({ urls: target.origin, allowLocalhost: true, maxPages: 1 }),
  });
  assert(plainTextQueue.status === 415, "Text/plain JSON mutation should be rejected.");
  const afterQueue = await readJson(await fetch(`${gui.baseUrl}/api/queue`));
  assert(afterQueue.totals.total === beforeQueue.totals.total, "Rejected text/plain mutation must not alter the queue.");

  const validJob = await fetch(`${gui.baseUrl}/api/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [tokenHeader]: token,
      "origin": gui.baseUrl,
    },
    body: JSON.stringify({ url: target.origin, allowLocalhost: true, maxPages: 1, maxDepth: 0, timeoutMs: 1000 }),
  });
  assert(validJob.status === 201, "Same-origin token job creation should succeed.");
  const validJobData = await readJson(validJob);
  const report = await waitForReport(gui.baseUrl, validJobData.id);
  assert(report.runStatus?.status === "complete", "Valid token job should complete.");

  const stopWithoutToken = await fetch(`${gui.baseUrl}/api/jobs/${validJobData.id}/stop`, { method: "POST" });
  assert(stopWithoutToken.status === 403, "Job stop without a token should be rejected.");

  const validQueue = await fetch(`${gui.baseUrl}/api/queue/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [tokenHeader]: token,
      "origin": gui.baseUrl,
    },
    body: JSON.stringify({ urls: target.origin, allowLocalhost: true, maxPages: 1 }),
  });
  assert(validQueue.status === 201, "Same-origin token queue mutation should succeed.");
  const validQueueData = await readJson(validQueue);
  const queueItemId = validQueueData.items?.[0]?.id;
  assert(queueItemId, "Valid queue mutation should return a queue item id.");

  const removeWithoutToken = await fetch(`${gui.baseUrl}/api/queue/items/${queueItemId}/remove`, { method: "POST" });
  assert(removeWithoutToken.status === 403, "Queue item removal without a token should be rejected.");

  const heartbeat = await fetch(`${gui.baseUrl}/api/session/heartbeat`, { method: "POST" });
  assert(heartbeat.status === 403, "Heartbeat without a token should be rejected.");

  const shutdownWithoutToken = await fetch(`${gui.baseUrl}/api/shutdown`, { method: "POST" });
  assert(shutdownWithoutToken.status === 403, "Shutdown without a token should be rejected.");

  const shutdown = await fetch(`${gui.baseUrl}/api/shutdown`, {
    method: "POST",
    headers: {
      [tokenHeader]: token,
      "origin": gui.baseUrl,
    },
  });
  assert(shutdown.status === 200, "Shutdown with a token should succeed.");
  await once(gui.child, "exit");
  gui = null;

  console.log("ok gui local session guard");
} finally {
  if (gui) {
    await gui.stop();
  }
  if (target) {
    await target.close();
  }
}
