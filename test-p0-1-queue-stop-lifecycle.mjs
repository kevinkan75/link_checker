#!/usr/bin/env node

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";

const STALL_MS = 800;
const POLL_INTERVAL_MS = 20;
const POLL_TIMEOUT_MS = 5000;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function startFixtureServer() {
  let slowRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === "/slow") {
      slowRequests += 1;
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.flushHeaders();
      response.write("<!doctype html><html><body>");
      setTimeout(() => {
        response.end("<p>slow</p></body></html>");
      }, STALL_MS);
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><body>fast</body></html>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  return {
    origin: `http://127.0.0.1:${port}`,
    get slowRequests() {
      return slowRequests;
    },
    close: async () => {
      server.close();
      server.closeAllConnections?.();
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
    cwd: process.cwd(),
    env: {
      ...process.env,
      LINK_CHECKER_GUI_WRAPPER: "",
      NODE_OPTIONS: "",
    },
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
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      const exited = once(child, "exit");
      child.kill();
      await exited;
    },
  };
}

async function readJson(response) {
  return response.json().catch(() => ({}));
}

async function getSession(gui) {
  const response = await fetch(`${gui.baseUrl}/api/session`);
  const data = await readJson(response);
  assert(response.status === 200, "Session endpoint should be available from localhost.");
  assert(data.sessionHeader === "X-Link-Checker-Session", "Session endpoint should name its token header.");
  assert(typeof data.sessionToken === "string" && data.sessionToken.length > 20, "Session token should be present.");
  return {
    header: data.sessionHeader,
    token: data.sessionToken,
  };
}

async function getQueue(gui) {
  const response = await fetch(`${gui.baseUrl}/api/queue`);
  assert(response.status === 200, "Queue endpoint should return HTTP 200.");
  return readJson(response);
}

async function post(gui, session, path, body) {
  const headers = {
    [session.header]: session.token,
    origin: gui.baseUrl,
  };
  const options = {
    method: "POST",
    headers,
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${gui.baseUrl}${path}`, options);
  return {
    status: response.status,
    data: await readJson(response),
  };
}

async function waitFor(readState, predicate, label) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let state;
  while (Date.now() < deadline) {
    state = await readState();
    if (predicate(state)) {
      return state;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label}. Last state: ${JSON.stringify(state)}`);
}

function queueInput(urls) {
  return {
    urls,
    allowLocalhost: true,
    blockPrivateIp: false,
    maxPages: 1,
    maxDepth: 0,
    requestDelayMs: 0,
    retryCount: 0,
    robotsTxt: false,
    timeoutMs: 5000,
  };
}

async function reproduceIdleStopImpact() {
  const gui = await startGuiServer();
  try {
    const session = await getSession(gui);
    const initial = await getQueue(gui);
    assert(initial.running === false, "Fresh queue should not be running.");
    assert(initial.stopRequested === false, "Fresh queue should not have a stop request.");
    assert(initial.activeSites === 0, "Fresh queue should not have active sites.");

    const stopResponse = await post(gui, session, "/api/queue/stop");
    assert(stopResponse.status === 200, "Idle queue stop should return HTTP 200.");
    const afterStop = await getQueue(gui);
    assert(afterStop.running === false, "Idle queue should remain non-running after stop.");
    assert(afterStop.stopRequested === true, "Idle queue stop should reproduce the stale stop flag.");
    assert(afterStop.activeSites === 0, "Idle queue stop should have no active sites.");

    const restart = await post(gui, session, "/api/restart-system-ca");
    assert(restart.status === 409, "Stale idle stop state should block System CA restart.");

    const shutdown = await post(gui, session, "/api/shutdown");
    assert(shutdown.status === 409, "Stale idle stop state should block manual shutdown.");
    assert(
      shutdown.data.error === "Cannot shut down while a scan or queue is still running.",
      "Manual shutdown should report the queue-running conflict.",
    );

    return {
      afterStop: {
        running: afterStop.running,
        stopRequested: afterStop.stopRequested,
        activeSites: afterStop.activeSites,
      },
      manualShutdownStatus: shutdown.status,
      systemCaRestartStatus: restart.status,
    };
  } finally {
    await gui.stop();
  }
}

async function reproduceRunningStop(fixture) {
  const gui = await startGuiServer();
  try {
    const session = await getSession(gui);
    const add = await post(gui, session, "/api/queue/items", queueInput([
      `${fixture.origin}/slow`,
      `${fixture.origin}/queued`,
    ]));
    assert(add.status === 201, "Two queue items should be accepted.");
    assert(add.data.items?.length === 2, "Queue creation should return two items.");
    const [firstId, secondId] = add.data.items.map((item) => item.id);

    const start = await post(gui, session, "/api/queue/start", { maxConcurrentSites: 1 });
    assert(start.status === 200, "Queue start should return HTTP 200.");

    const running = await waitFor(
      async () => ({ queue: await getQueue(gui), slowRequests: fixture.slowRequests }),
      ({ queue, slowRequests }) => (
        queue.running === true
        && queue.items.find((item) => item.id === firstId)?.state === "running"
        && queue.items.find((item) => item.id === secondId)?.state === "queued"
        && slowRequests > 0
      ),
      "one running item, one queued item, and the slow fixture request",
    );
    assert(running.queue.activeSites === 1, "Exactly one queue item should be active.");

    const stop = await post(gui, session, "/api/queue/stop");
    assert(stop.status === 200, "Running queue stop should return HTTP 200.");

    const settled = await waitFor(
      () => getQueue(gui),
      (queue) => queue.running === false && queue.activeSites === 0,
      "queue stop settlement",
    );
    const first = settled.items.find((item) => item.id === firstId);
    const second = settled.items.find((item) => item.id === secondId);
    assert(first?.state !== "running", "Active item should no longer be running after settlement.");
    assert(second?.state === "stopped", "Pending item should settle as stopped without starting.");
    assert(second.startedAt === null, "Pending item should never have started.");
    assert(settled.stopRequested === true, "Running queue settlement should reproduce the stale stop flag.");

    return {
      afterSettlement: {
        running: settled.running,
        stopRequested: settled.stopRequested,
        activeSites: settled.activeSites,
      },
      firstItemState: first?.state,
      secondItemState: second?.state,
    };
  } finally {
    await gui.stop();
  }
}

async function verifyQueueRestartControl(fixture) {
  const gui = await startGuiServer();
  try {
    const session = await getSession(gui);
    const idleStop = await post(gui, session, "/api/queue/stop");
    assert(idleStop.status === 200 && idleStop.data.stopRequested === true, "Control should begin with stale idle stop state.");

    const add = await post(gui, session, "/api/queue/items", queueInput(`${fixture.origin}/fast`));
    assert(add.status === 201, "Restart control item should be accepted.");
    const itemId = add.data.items?.[0]?.id;
    assert(itemId, "Restart control should receive a queue item id.");

    const start = await post(gui, session, "/api/queue/start", { maxConcurrentSites: 1 });
    assert(start.status === 200, "Queue should accept a new start after stale stop state.");
    assert(start.data.running === true, "Restarted queue should report running.");
    assert(start.data.stopRequested === false, "Queue start should clear the stale stop flag.");

    const settled = await waitFor(
      () => getQueue(gui),
      (queue) => queue.running === false && queue.activeSites === 0,
      "restart control completion",
    );
    const item = settled.items.find((candidate) => candidate.id === itemId);
    assert(item?.state === "finished", "Restart control item should finish normally.");
    assert(settled.stopRequested === false, "Normal queue completion should retain a clear stop flag.");

    return {
      startStopRequested: start.data.stopRequested,
      finalItemState: item.state,
      finalStopRequested: settled.stopRequested,
    };
  } finally {
    await gui.stop();
  }
}

let fixture;
try {
  fixture = await startFixtureServer();
  const idle = await reproduceIdleStopImpact();
  const running = await reproduceRunningStop(fixture);
  const restartControl = await verifyQueueRestartControl(fixture);

  console.log(JSON.stringify({
    stallMs: STALL_MS,
    caseA: idle.afterStop,
    caseB: running.afterSettlement,
    caseC: {
      firstItemState: running.firstItemState,
      secondItemState: running.secondItemState,
    },
    caseD: {
      manualShutdownStatus: idle.manualShutdownStatus,
    },
    caseE: {
      systemCaRestartStatus: idle.systemCaRestartStatus,
    },
    caseF: restartControl,
  }, null, 2));
  console.log("ok p0-1 queue stop lifecycle reproduction");
} finally {
  if (fixture) {
    await fixture.close();
  }
}
