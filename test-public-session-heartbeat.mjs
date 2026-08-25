#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";

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
    baseUrl: `http://127.0.0.1:${port}`,
    child,
    getOutput: () => `${stdout}${stderr}`,
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

function assertHeartbeatContract(fileName, source) {
  assert(source.includes("fetch(\"/api/session\", { cache: \"no-store\" })"), `${fileName} should load the local session token.`);
  assert(source.includes("X-Link-Checker-Session"), `${fileName} should name the session header.`);
  assert(source.includes("[sessionHeaderName]: token"), `${fileName} should send the session token on heartbeat.`);
  assert(source.includes("loadSessionToken().catch(() => \"\")"), `${fileName} should handle session loading failures.`);
  assert(source.includes("setInterval(send, 30000)"), `${fileName} should preserve the heartbeat cadence.`);
  assert(source.includes("window.addEventListener(\"pagehide\", send)"), `${fileName} should preserve pagehide heartbeat.`);
  assert(!/console\.(?:log|info|warn|error)\([^)]*session/i.test(source), `${fileName} should not log session details.`);
}

const analyzerJs = readFileSync("public/analyzer.js", "utf8");
const reportAnalyzerJs = readFileSync("public/report-analyzer.js", "utf8");

assertHeartbeatContract("public/analyzer.js", analyzerJs);
assertHeartbeatContract("public/report-analyzer.js", reportAnalyzerJs);

let gui;
try {
  gui = await startGuiServer();

  for (const path of ["/analyzer.html", "/report-analyzer.html"]) {
    const response = await fetch(`${gui.baseUrl}${path}`);
    assert(response.status === 200, `${path} should remain available.`);
    const body = await response.text();
    assert(!body.includes("X-Link-Checker-Session"), `${path} should not expose the session header.`);
  }

  const sessionResponse = await fetch(`${gui.baseUrl}/api/session`);
  assert(sessionResponse.status === 200, "Session endpoint should be readable from localhost.");
  const session = await readJson(sessionResponse);
  const tokenHeader = session.sessionHeader;
  const token = session.sessionToken;
  assert(tokenHeader === "X-Link-Checker-Session", "Session endpoint should return the expected header name.");
  assert(typeof token === "string" && token.length > 20, "Session endpoint should return a session token.");

  const noTokenHeartbeat = await fetch(`${gui.baseUrl}/api/session/heartbeat`, { method: "POST" });
  assert(noTokenHeartbeat.status === 403, "Heartbeat without a token should be rejected.");

  const tokenHeartbeat = await fetch(`${gui.baseUrl}/api/session/heartbeat`, {
    method: "POST",
    headers: {
      [tokenHeader]: token,
      "origin": gui.baseUrl,
    },
  });
  assert(tokenHeartbeat.status === 200, "Heartbeat with the session token should succeed.");
  const heartbeatBody = await readJson(tokenHeartbeat);
  assert(heartbeatBody.ok === true, "Successful heartbeat should return ok.");

  const output = gui.getOutput();
  assert(!output.includes(token), "GUI server output should not include the session token.");
  assert(!analyzerJs.includes(token), "Analyzer script should not contain the runtime session token.");
  assert(!reportAnalyzerJs.includes(token), "Report Analyzer script should not contain the runtime session token.");

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

  console.log("ok public session heartbeat");
} finally {
  if (gui) {
    await gui.stop();
  }
}
