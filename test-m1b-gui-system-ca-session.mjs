#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

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
    response.end("<!doctype html><title>M1b</title>");
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

async function startGuiServer({ systemCa = false } = {}) {
  const port = await getFreePort();
  const args = [
    ...(systemCa ? ["--use-system-ca"] : []),
    "gui-server.mjs",
    "--port",
    String(port),
    "--no-idle-shutdown",
  ];
  const child = spawn(process.execPath, args, {
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
    stop: async (session = null) => {
      if (child.exitCode !== null) {
        return;
      }
      if (session) {
        await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
          method: "POST",
          headers: {
            [session.sessionHeader]: session.sessionToken,
            "origin": `http://127.0.0.1:${port}`,
          },
        }).catch(() => {});
      } else {
        child.kill();
      }
      await once(child, "exit");
    },
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function getSession(baseUrl) {
  const response = await fetch(`${baseUrl}/api/session`);
  const session = await readJson(response);
  assert(response.status === 200, "Session endpoint should be available.");
  assert(session.sessionHeader === "X-Link-Checker-Session", "Session should expose the local session header name.");
  assert(typeof session.sessionToken === "string" && session.sessionToken.length > 20, "Session should expose a token.");
  return session;
}

async function createJobAndReadReport(baseUrl, session, targetOrigin, options = {}) {
  const response = await fetch(`${baseUrl}/api/jobs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [session.sessionHeader]: session.sessionToken,
      "origin": baseUrl,
    },
    body: JSON.stringify({
      url: targetOrigin,
      allowLocalhost: true,
      robotsTxt: false,
      maxPages: 1,
      maxDepth: 0,
      retryCount: 0,
      confirm404: false,
      ...options,
    }),
  });
  const job = await readJson(response);
  assert(response.status === 201, `Job creation should succeed: ${job.error || response.status}`);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const reportResponse = await fetch(`${baseUrl}/api/jobs/${job.id}/report`);
    if (reportResponse.status === 200) {
      return readJson(reportResponse);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for GUI report.");
}

async function assertDefaultSessionIgnoresLegacySystemCaPayload(target) {
  let gui;
  let session;
  try {
    gui = await startGuiServer();
    session = await getSession(gui.baseUrl);
    assert(session.systemCaEnabled === false, "Default GUI session should report system CA disabled.");

    const reportA = await createJobAndReadReport(gui.baseUrl, session, target.origin, { systemCa: true });
    assert(reportA.options?.systemCa === false, "Legacy per-job systemCa=true payload should not enable default GUI session system CA.");

    const afterA = await getSession(gui.baseUrl);
    assert(afterA.systemCaEnabled === false, "Per-job systemCa=true payload must not mutate process system CA state.");

    const reportB = await createJobAndReadReport(gui.baseUrl, session, target.origin, { systemCa: false });
    assert(reportB.options?.systemCa === false, "Default GUI session jobs should keep options.systemCa false.");
  } finally {
    if (gui) {
      await gui.stop(session);
    }
  }
}

async function assertSystemCaSessionTruth(target) {
  let gui;
  let session;
  try {
    gui = await startGuiServer({ systemCa: true });
    session = await getSession(gui.baseUrl);
    assert(session.systemCaEnabled === true, "System CA GUI session should report system CA enabled.");

    const report = await createJobAndReadReport(gui.baseUrl, session, target.origin, { systemCa: false });
    assert(report.options?.systemCa === true, "System CA GUI session jobs should reflect the process-level system CA truth.");
  } finally {
    if (gui) {
      await gui.stop(session);
    }
  }
}

async function assertFrontendSessionTruth() {
  const html = await readFile("public/index.html", "utf8");
  const app = await readFile("public/app.js", "utf8");

  assert(html.includes('id="system-ca-status"'), "Main GUI should render a read-only system CA status.");
  assert(!html.includes('id="system-ca"'), "Main GUI should not keep an interactive system CA checkbox.");
  assert(app.includes("updateSystemCaStatus(data.systemCaEnabled === true)"), "Frontend should derive system CA display from server session truth.");
  assert(!app.includes("systemCaInput.checked"), "Frontend should not read a scan-level system CA checkbox.");
  assert(!app.includes("systemCa:"), "Frontend scan payload should not send a per-job systemCa option.");
}

async function main() {
  const target = await startTargetServer();
  try {
    await assertDefaultSessionIgnoresLegacySystemCaPayload(target);
    await assertSystemCaSessionTruth(target);
    await assertFrontendSessionTruth();
    console.log("ok m1b gui system ca session");
  } finally {
    await target.close();
  }
}

main().catch((error) => {
  console.error(`test-m1b-gui-system-ca-session: ${error.message}`);
  process.exitCode = 1;
});
