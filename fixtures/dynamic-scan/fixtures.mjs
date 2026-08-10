import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const fixtureDir = fileURLToPath(new URL(".", import.meta.url));

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

const fixtureDefinitions = [
  {
    id: "static-html",
    file: "static-html.html",
    path: "/fixtures/static-html",
    expectedPaths: [
      "/static-html/visible-link",
      "/static-html/secondary-link?case=static",
    ],
  },
  {
    id: "csr-basic",
    file: "csr-basic.html",
    path: "/fixtures/csr-basic",
    expectedPaths: [
      "/csr-basic-same-origin",
    ],
    expectedExternalUrls: [
      "https://dynamic.example/csr-basic-external",
    ],
  },
  {
    id: "csr-delayed",
    file: "csr-delayed.html",
    path: "/fixtures/csr-delayed",
    expectedPaths: [
      "/csr-delayed-target",
    ],
    delayMs: 250,
  },
  {
    id: "duplicate-link",
    file: "duplicate-link.html",
    path: "/fixtures/duplicate-link",
    expectedPaths: [
      "/duplicate-link/shared-target",
    ],
    duplicateCanonicalPath: "/duplicate-link/shared-target",
  },
  {
    id: "runtime-base-url",
    file: "runtime-base-url.html",
    path: "/fixtures/runtime-base-url",
    expectedPaths: [
      "/runtime-history/runtime-base/relative-target",
    ],
    runtimeHistoryPath: "/runtime-history/current-page",
    runtimeBasePath: "/runtime-history/runtime-base/",
  },
  {
    id: "render-timeout",
    file: "render-timeout.html",
    path: "/fixtures/render-timeout",
    expectedAction: "Repeated DOM mutation keeps the rendered DOM unsettled.",
    observation: "runtime DOM data-render-timeout-tick increments every 50ms",
    expectedLaterPolicyResult: "render timeout or unsettled diagnostic without hanging the scan",
    mutationIntervalMs: 50,
  },
  {
    id: "security-private-url",
    file: "security-private-url.html",
    path: "/fixtures/security-private-url",
    expectedAction: "Runtime DOM emits protected-address-class URLs without contacting real sensitive targets.",
    observation: "runtime anchors with data-address-class values",
    expectedLaterPolicyResult: "Browser policy blocks protected targets before network egress",
    protectedAddressClasses: ["loopback", "localhost", "private", "link-local", "metadata"],
  },
  {
    id: "side-effect-method",
    file: "side-effect-method.html",
    path: "/fixtures/side-effect-method",
    expectedAction: "Page initialization attempts POST and PUT requests.",
    observation: "/observe/unsafe-method records method/path/body length",
    expectedLaterPolicyResult: "unsafe methods are blocked and not received by the endpoint",
    expectedUnsafeMethods: ["POST", "PUT"],
  },
  {
    id: "popup-download",
    file: "popup-download.html",
    path: "/fixtures/popup-download",
    expectedAction: "Page initialization attempts popup and download flows.",
    observation: "/observe/popup and /observe/download record local requests",
    expectedLaterPolicyResult: "popup is closed/blocked and download is cancelled",
  },
  {
    id: "render-cross-origin-navigation",
    file: "render-cross-origin-navigation.html",
    path: "/fixtures/render-cross-origin-navigation",
    expectedAction: "Page initialization attempts main-frame navigation to a second controlled origin.",
    observation: "secondary server records /observe/cross-origin-target",
    expectedLaterPolicyResult: "main-frame navigation outside crawl origin is blocked",
  },
  {
    id: "challenge-rendered",
    file: "challenge-rendered.html",
    path: "/fixtures/challenge-rendered",
    expectedAction: "Runtime DOM renders synthetic challenge-like content.",
    observation: "body contains known local challenge signals and decoy links",
    expectedLaterPolicyResult: "challenge diagnostics only; challenge links are not ingested",
    challengeSignals: ["just a moment...", "/cdn-cgi/challenge-platform", "captcha"],
  },
  {
    id: "websocket-egress",
    file: "websocket-egress.html",
    path: "/fixtures/websocket-egress",
    expectedAction: "Page initialization attempts WebSocket connection to a controlled local endpoint.",
    observation: "local upgrade handler records handshake attempts",
    expectedLaterPolicyResult: "WebSocket route is blocked before connection establishment",
  },
  {
    id: "browser-request-burst",
    file: "browser-request-burst.html",
    path: "/fixtures/browser-request-burst",
    expectedAction: "Page initialization creates a known burst of subresource and fetch requests.",
    observation: "/observe/burst/* records request kind, id, and resource type",
    expectedLaterPolicyResult: "OQ-6 telemetry can measure starts, in-flight behavior, and resource type",
    expectedBurstRequests: {
      image: 4,
      fetch: 3,
      script: 1,
      stylesheet: 1,
    },
  },
];

const dynamicScanFixtures = Object.fromEntries(
  fixtureDefinitions.map((fixture) => [fixture.id, fixture]),
);

async function readDynamicScanFixture(id) {
  const fixture = dynamicScanFixtures[id];
  if (!fixture) {
    throw new Error(`Unknown dynamic scan fixture: ${id}`);
  }
  return readFile(join(fixtureDir, fixture.file), "utf8");
}

function getDynamicScanExpectedUrls(origin, id) {
  const fixture = dynamicScanFixtures[id];
  if (!fixture) {
    throw new Error(`Unknown dynamic scan fixture: ${id}`);
  }
  return [
    ...(fixture.expectedPaths || []).map((path) => new URL(path, origin).toString()),
    ...(fixture.expectedExternalUrls || []),
  ];
}

function createEmptyObservationState() {
  return {
    requests: [],
    unsafeMethods: [],
    popupRequests: [],
    downloadRequests: [],
    crossOriginNavigations: [],
    websocketHandshakes: [],
    burstRequests: [],
    securityRequests: [],
  };
}

function snapshotState(state) {
  return JSON.parse(JSON.stringify(state));
}

function resetState(state) {
  const fresh = createEmptyObservationState();
  for (const key of Object.keys(state)) {
    delete state[key];
  }
  Object.assign(state, fresh);
}

function recordRequest(state, request, requestUrl, serverRole) {
  state.requests.push({
    serverRole,
    method: request.method,
    path: requestUrl.pathname,
    search: requestUrl.search,
    host: request.headers.host || null,
    recordedAt: new Date().toISOString(),
  });
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function sendJson(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendText(response, text, status = 200, headers = {}) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  response.end(text);
}

function renderFixtureHtml(html, origins) {
  return html
    .replaceAll("__PRIMARY_ORIGIN__", origins.primaryOrigin)
    .replaceAll("__SECOND_ORIGIN__", origins.secondaryOrigin)
    .replaceAll("__WS_ORIGIN__", origins.primaryOrigin.replace(/^http:/, "ws:"));
}

async function serveFixture(response, fixture, origins) {
  const filePath = join(fixtureDir, fixture.file);
  const html = await readFile(filePath, "utf8");
  response.writeHead(200, {
    "content-type": contentTypes.get(extname(filePath)) || "application/octet-stream",
  });
  response.end(renderFixtureHtml(html, origins));
}

function createGifPixel() {
  return Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
}

async function handleObservationRequest(request, response, requestUrl, state, serverRole) {
  if (requestUrl.pathname === "/observe/state") {
    sendJson(response, snapshotState(state));
    return true;
  }

  if (requestUrl.pathname === "/observe/reset") {
    resetState(state);
    sendJson(response, { ok: true });
    return true;
  }

  if (requestUrl.pathname === "/observe/unsafe-method") {
    const body = await readRequestBody(request);
    state.unsafeMethods.push({
      method: request.method,
      path: requestUrl.pathname,
      fixture: requestUrl.searchParams.get("fixture"),
      operation: requestUrl.searchParams.get("operation"),
      bodyBytes: body.length,
    });
    sendJson(response, { ok: true, recorded: true });
    return true;
  }

  if (requestUrl.pathname === "/observe/popup") {
    state.popupRequests.push({
      method: request.method,
      fixture: requestUrl.searchParams.get("fixture"),
      opener: requestUrl.searchParams.get("opener"),
    });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Controlled popup</title><p>Controlled popup fixture.</p>");
    return true;
  }

  if (requestUrl.pathname === "/observe/download") {
    state.downloadRequests.push({
      method: request.method,
      fixture: requestUrl.searchParams.get("fixture"),
      filename: requestUrl.searchParams.get("filename"),
    });
    sendText(response, "", 200, {
      "content-disposition": "attachment; filename=\"dynamic-scan-empty-download.txt\"",
      "cache-control": "no-store",
    });
    return true;
  }

  if (requestUrl.pathname === "/observe/security/loopback") {
    state.securityRequests.push({
      method: request.method,
      fixture: requestUrl.searchParams.get("fixture"),
      addressClass: "loopback",
    });
    sendJson(response, { ok: true, addressClass: "loopback" });
    return true;
  }

  if (requestUrl.pathname === "/observe/cross-origin-target") {
    state.crossOriginNavigations.push({
      method: request.method,
      fixture: requestUrl.searchParams.get("fixture"),
      serverRole,
      origin: request.headers.host || null,
    });
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Controlled alternate origin</title><p>Cross-origin target reached.</p>");
    return true;
  }

  if (requestUrl.pathname.startsWith("/observe/burst/")) {
    const kind = requestUrl.pathname.includes("/fetch/") ? "fetch" : "subresource";
    const resourceType = requestUrl.searchParams.get("type") || "unknown";
    state.burstRequests.push({
      method: request.method,
      kind,
      resourceType,
      id: requestUrl.searchParams.get("id"),
      fixture: requestUrl.searchParams.get("fixture"),
    });

    if (resourceType === "image") {
      response.writeHead(200, { "content-type": "image/gif", "cache-control": "no-store" });
      response.end(createGifPixel());
      return true;
    }
    if (resourceType === "script") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
      response.end("window.__dynamicScanBurstScriptLoaded = true;\n");
      return true;
    }
    if (resourceType === "stylesheet") {
      response.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" });
      response.end("body { --dynamic-scan-burst-style: 1; }\n");
      return true;
    }
    sendJson(response, { ok: true, kind, resourceType });
    return true;
  }

  return false;
}

function createServerHandler({ state, origins, serverRole }) {
  return async (request, response) => {
    const fallbackOrigin = origins.primaryOrigin || "http://127.0.0.1";
    const requestUrl = new URL(request.url || "/", fallbackOrigin);
    recordRequest(state, request, requestUrl, serverRole);

    try {
      if (requestUrl.pathname === "/robots.txt") {
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        response.end("User-agent: *\nAllow: /\n");
        return;
      }

      if (await handleObservationRequest(request, response, requestUrl, state, serverRole)) {
        return;
      }

      if (requestUrl.pathname === "/eligibility/failing-page") {
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Controlled 404</title><p>Controlled failing page.</p>");
        return;
      }

      if (requestUrl.pathname === "/eligibility/non-html") {
        sendText(response, "controlled non-html response");
        return;
      }

      if (requestUrl.pathname === "/eligibility/bodyless-html") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("");
        return;
      }

      const fixture = fixtureDefinitions.find((candidate) => candidate.path === requestUrl.pathname);
      if (fixture) {
        await serveFixture(response, fixture, origins);
        return;
      }

      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Fixture Target</title></head>
<body><p>Target ${requestUrl.pathname}</p></body>
</html>`);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(`fixture server error: ${error.message}`);
    }
  };
}

function handleWebSocketUpgrade(request, socket, _head, state) {
  const requestUrl = new URL(request.url || "/", "ws://127.0.0.1");
  if (requestUrl.pathname !== "/observe/websocket") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  state.websocketHandshakes.push({
    fixture: requestUrl.searchParams.get("fixture"),
    protocol: request.headers["sec-websocket-protocol"] || null,
    host: request.headers.host || null,
  });
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
  setTimeout(() => socket.end(), 25);
}

function createDynamicScanFixtureServer() {
  const state = createEmptyObservationState();
  const origins = {
    primaryOrigin: null,
    secondaryOrigin: null,
  };
  const server = createServer(createServerHandler({ state, origins, serverRole: "primary" }));
  const secondaryServer = createServer(createServerHandler({ state, origins, serverRole: "secondary" }));
  const upgradedSockets = new Set();

  server.on("upgrade", (request, socket, head) => {
    upgradedSockets.add(socket);
    socket.on("close", () => upgradedSockets.delete(socket));
    handleWebSocketUpgrade(request, socket, head, state);
  });

  return {
    async start() {
      secondaryServer.listen(0, "127.0.0.1");
      await once(secondaryServer, "listening");
      const secondaryAddress = secondaryServer.address();
      origins.secondaryOrigin = `http://127.0.0.1:${secondaryAddress.port}`;

      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      origins.primaryOrigin = `http://127.0.0.1:${address.port}`;

      return {
        origin: origins.primaryOrigin,
        secondaryOrigin: origins.secondaryOrigin,
        getState: () => snapshotState(state),
        resetState: () => resetState(state),
        close: async () => {
          for (const socket of upgradedSockets) {
            socket.destroy();
          }
          await Promise.all([
            new Promise((resolve, reject) => {
              server.close((error) => error ? reject(error) : resolve());
            }),
            new Promise((resolve, reject) => {
              secondaryServer.close((error) => error ? reject(error) : resolve());
            }),
          ]);
        },
      };
    },
  };
}

export {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
  getDynamicScanExpectedUrls,
  readDynamicScanFixture,
};
