#!/usr/bin/env node

import net from "node:net";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import vm from "node:vm";
import {
  LinkChecker,
  canonicalizeUrl,
} from "./link-checker.mjs";
import {
  createDynamicScanFixtureServer,
  dynamicScanFixtures,
} from "./fixtures/dynamic-scan/fixtures.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function httpGetText(url, options = {}) {
  const response = await fetch(url, options);
  assert(response.ok, `Expected local fixture request to succeed: ${url}`);
  return response.text();
}

async function httpGetJson(url, options = {}) {
  const response = await fetch(url, options);
  assert(response.ok, `Expected local fixture JSON request to succeed: ${url}`);
  return response.json();
}

function fixtureUrl(origin, fixtureId) {
  const fixture = dynamicScanFixtures[fixtureId];
  assert(fixture, `Expected fixture metadata for ${fixtureId}.`);
  return new URL(fixture.path, origin).toString();
}

function assertLocalUrl(url, message) {
  const parsed = new URL(url);
  assert(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    `${message}: expected local URL, got ${url}`,
  );
}

function assertAllRecordedRequestsLocal(state) {
  for (const request of state.requests) {
    const host = String(request.host || "");
    assert(
      host.startsWith("127.0.0.1:") || host.startsWith("localhost:"),
      `Expected recorded request host to be local, got ${host}`,
    );
  }
}

class TestElement {
  constructor(tagName) {
    this.tagName = String(tagName).toLowerCase();
    this.attributes = new Map();
    this.children = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes.set(String(name).toLowerCase(), String(value));
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) || null;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function extractInlineScripts(html) {
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

function extractElementIds(html) {
  const ids = new Map();
  for (const match of html.matchAll(/<([a-zA-Z][\w:-]*)\b[^>]*\sid=["']([^"']+)["'][^>]*>/g)) {
    ids.set(match[2], new TestElement(match[1]));
  }
  return ids;
}

function collectAnchors(root, output = []) {
  if (root.tagName === "a") {
    output.push(root);
  }
  for (const child of root.children) {
    collectAnchors(child, output);
  }
  return output;
}

function collectText(root) {
  return [
    root.textContent,
    ...root.children.map((child) => collectText(child)),
  ].filter(Boolean).join(" ");
}

function simulateRuntimeDom(html, pageUrl) {
  const elementsById = extractElementIds(html);
  const document = {
    createElement: (tagName) => new TestElement(tagName),
    getElementById: (id) => elementsById.get(id) || null,
    addEventListener: (eventName, callback) => {
      if (eventName === "DOMContentLoaded") {
        callback();
      }
    },
  };

  const context = { document };
  for (const script of extractInlineScripts(html)) {
    vm.runInNewContext(script, context, { timeout: 1000 });
  }

  const roots = [...elementsById.values()];
  const anchors = roots.flatMap((root) => collectAnchors(root)).map((anchor) => ({
    rawHref: anchor.getAttribute("href"),
    resolvedUrl: new URL(anchor.getAttribute("href"), pageUrl).toString(),
  }));

  return {
    anchors,
    text: roots.map((root) => collectText(root)).join(" "),
    attributes: roots.flatMap((root) => [
      ...root.attributes.entries(),
      ...root.children.flatMap((child) => [...child.attributes.entries()]),
    ]),
  };
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxPages: 1,
    maxDepth: 0,
    concurrency: 2,
    perHostConcurrency: 2,
    preferGet: true,
    checkExternal: false,
    ...options,
  });
}

function getInventoryObservation(checker, targetUrl) {
  const canonicalUrl = checker.getCanonicalKey(targetUrl);
  const item = checker.inventory.get(canonicalUrl) || null;
  const inventorySources = item?.sources || [];
  const directSources = checker.sources.get(canonicalUrl) || [];
  const sources = [...inventorySources, ...directSources];
  const sourceTypes = [...new Set(sources.map((source) => source.sourceType).filter(Boolean))].sort();
  return {
    canonicalUrl,
    discovered: Boolean(item),
    sourceTypes,
  };
}

async function assertNotStaticallyDiscovered(startUrl, targetUrl) {
  for (const spaLinks of ["auto", "strict"]) {
    const checker = makeChecker(startUrl, { spaLinks });
    const report = await checker.run();
    const observation = getInventoryObservation(checker, targetUrl);
    const checked = report.checked.some((item) => checker.getResultCanonicalKey(item) === observation.canonicalUrl);
    const external = report.externalLinks.some((item) => (item.canonicalUrl || item.url) === observation.canonicalUrl);
    assert(
      !observation.discovered && !checked && !external,
      `challenge-rendered spaLinks:${spaLinks} should not statically discover ${targetUrl}; observed sourceTypes=${observation.sourceTypes.join(",") || "none"}.`,
    );
  }
}

function hasChallengeCondition(text, attributes) {
  const lowered = text.toLowerCase();
  const attributeText = attributes.map(([name, value]) => `${name}=${value}`).join(" ").toLowerCase();
  return lowered.includes("just a moment...")
    && lowered.includes("captcha")
    && attributeText.includes("/cdn-cgi/challenge-platform");
}

async function assertRenderTimeoutFixture(origin) {
  const fixture = dynamicScanFixtures["render-timeout"];
  const html = await httpGetText(fixtureUrl(origin, fixture.id));

  assert(fixture.mutationIntervalMs === 50, "render-timeout should expose deterministic mutation interval metadata.");
  assert(html.includes("setInterval"), "render-timeout should use repeated DOM mutation.");
  assert(html.includes("data-render-timeout-tick"), "render-timeout should expose an observation marker.");
  assert(html.includes("}, 50);"), "render-timeout should use the expected deterministic interval.");
}

async function assertSecurityPrivateUrlFixture(origin) {
  const fixture = dynamicScanFixtures["security-private-url"];
  const html = await httpGetText(fixtureUrl(origin, fixture.id));

  for (const addressClass of fixture.protectedAddressClasses) {
    assert(html.includes(`"${addressClass}"`), `security-private-url should represent ${addressClass}.`);
  }
  assert(html.includes(`${origin}/observe/security/loopback?fixture=security-private-url`), "security-private-url should include controlled loopback endpoint.");
  assert(html.includes("http://192.168.0.1/__dynamic_scan_private_probe__"), "security-private-url should represent a private target as data.");
  assert(html.includes("http://169.254.1.1/__dynamic_scan_link_local_probe__"), "security-private-url should represent a link-local target as data.");
  assert(html.includes("http://169.254.169.254/latest/meta-data/"), "security-private-url should represent a metadata-like target as data.");
  assert(!html.includes("fetch("), "security-private-url should not automatically request sensitive targets.");
}

async function assertSideEffectMethodFixture(server) {
  const fixture = dynamicScanFixtures["side-effect-method"];
  const html = await httpGetText(fixtureUrl(server.origin, fixture.id));

  for (const method of fixture.expectedUnsafeMethods) {
    assert(html.includes(`method: "${method}"`), `side-effect-method should attempt ${method}.`);
  }

  server.resetState();
  for (const method of fixture.expectedUnsafeMethods) {
    await httpGetJson(`${server.origin}/observe/unsafe-method?fixture=side-effect-method&operation=${method.toLowerCase()}`, {
      method,
      headers: { "content-type": "text/plain" },
      body: `body-${method}`,
    });
  }
  const state = server.getState();
  assert(state.unsafeMethods.length === 2, "side-effect-method should record two unsafe method attempts.");
  assert(
    state.unsafeMethods.map((entry) => entry.method).sort().join(",") === "POST,PUT",
    "side-effect-method should record POST and PUT methods.",
  );
  assert(state.unsafeMethods.every((entry) => entry.bodyBytes > 0), "side-effect-method should record request body length.");
}

async function assertPopupDownloadFixture(server) {
  const html = await httpGetText(fixtureUrl(server.origin, "popup-download"));

  assert(html.includes("window.open"), "popup-download should attempt a popup.");
  assert(html.includes("/observe/download?fixture=popup-download"), "popup-download should include a controlled download endpoint.");

  server.resetState();
  await httpGetText(`${server.origin}/observe/popup?fixture=popup-download&opener=test`);
  await fetch(`${server.origin}/observe/download?fixture=popup-download&filename=test.txt`);
  const state = server.getState();
  assert(state.popupRequests.length === 1, "popup-download should record popup endpoint requests.");
  assert(state.downloadRequests.length === 1, "popup-download should record download endpoint requests.");
}

async function assertCrossOriginNavigationFixture(server) {
  const html = await httpGetText(fixtureUrl(server.origin, "render-cross-origin-navigation"));

  assertLocalUrl(server.secondaryOrigin, "secondary origin");
  assert(server.secondaryOrigin !== server.origin, "cross-origin fixture should use a second local origin.");
  assert(html.includes(server.secondaryOrigin), "cross-origin navigation fixture should target the second local origin.");
  assert(html.includes("window.location.assign"), "cross-origin navigation fixture should attempt main-frame navigation.");

  server.resetState();
  await httpGetText(`${server.secondaryOrigin}/observe/cross-origin-target?fixture=render-cross-origin-navigation`);
  const state = server.getState();
  assert(state.crossOriginNavigations.length === 1, "cross-origin fixture should record alternate-origin navigation attempts.");
  assert(state.crossOriginNavigations[0].serverRole === "secondary", "cross-origin target should be served by the secondary local server.");
}

async function assertChallengeRenderedFixture(origin) {
  const fixture = dynamicScanFixtures["challenge-rendered"];
  const startUrl = fixtureUrl(origin, fixture.id);
  const html = await httpGetText(startUrl);
  const loweredRaw = html.toLowerCase();
  const decoyUrl = new URL("/challenge-rendered/decoy-link", origin).toString();

  assert(!loweredRaw.includes("just a moment..."), "challenge-rendered raw HTML should not already contain final challenge title.");
  assert(!loweredRaw.includes("captcha"), "challenge-rendered raw HTML should not already contain final captcha signal.");
  assert(!loweredRaw.includes("/cdn-cgi/challenge-platform"), "challenge-rendered raw HTML should not already contain final challenge platform signal.");
  assert(!html.includes("/challenge-rendered/decoy-link"), "challenge-rendered raw HTML should not contain the complete decoy path.");
  await assertNotStaticallyDiscovered(startUrl, decoyUrl);

  const rendered = simulateRuntimeDom(html, startUrl);
  assert(hasChallengeCondition(rendered.text, rendered.attributes), "challenge-rendered runtime DOM should contain synthetic challenge signals.");
  assert(
    rendered.anchors.some((anchor) => canonicalizeUrl(anchor.resolvedUrl) === canonicalizeUrl(decoyUrl)),
    "challenge-rendered runtime DOM should contain the resolved decoy link.",
  );
}

async function openWebSocketHandshake(wsUrl) {
  const parsed = new URL(wsUrl);
  assert(parsed.protocol === "ws:", `Expected ws URL, got ${wsUrl}`);
  assertLocalUrl(`http://${parsed.host}`, "websocket origin");

  const socket = net.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port),
  });
  socket.setEncoding("utf8");
  await once(socket, "connect");
  const key = randomBytes(16).toString("base64");
  socket.write([
    `GET ${parsed.pathname}${parsed.search} HTTP/1.1`,
    `Host: ${parsed.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Protocol: dynamic-scan-fixture",
    "",
    "",
  ].join("\r\n"));

  const [chunk] = await once(socket, "data");
  socket.end();
  return String(chunk);
}

async function assertWebSocketEgressFixture(server) {
  const html = await httpGetText(fixtureUrl(server.origin, "websocket-egress"));
  const match = html.match(/data-websocket-url="([^"]+)"/);
  assert(match, "websocket-egress should expose its controlled WebSocket URL.");

  const wsUrl = match[1].replaceAll("&amp;", "&");
  assert(wsUrl.startsWith(server.origin.replace(/^http:/, "ws:")), "websocket-egress should target the primary local server.");

  server.resetState();
  const handshake = await openWebSocketHandshake(wsUrl);
  assert(handshake.startsWith("HTTP/1.1 101 Switching Protocols"), "websocket-egress endpoint should accept controlled handshakes.");
  const state = server.getState();
  assert(state.websocketHandshakes.length === 1, "websocket-egress should record handshake attempts.");
  assert(state.websocketHandshakes[0].fixture === "websocket-egress", "websocket-egress should preserve fixture label.");
}

async function assertBrowserRequestBurstFixture(server) {
  const fixture = dynamicScanFixtures["browser-request-burst"];
  const html = await httpGetText(fixtureUrl(server.origin, fixture.id));

  assert(html.includes("observe/burst/resource?id=style-1&type=stylesheet"), "burst fixture should include stylesheet subresource.");
  assert(html.includes("observe/burst/resource?id=script-1&type=script"), "burst fixture should include script subresource.");
  assert(html.includes("index <= 4"), "burst fixture should create four image requests.");
  assert(html.includes("index <= 3"), "burst fixture should create three fetch requests.");

  server.resetState();
  await httpGetText(`${server.origin}/observe/burst/resource?id=style-1&type=stylesheet&fixture=browser-request-burst`);
  await httpGetText(`${server.origin}/observe/burst/resource?id=script-1&type=script&fixture=browser-request-burst`);
  for (let index = 1; index <= fixture.expectedBurstRequests.image; index += 1) {
    await fetch(`${server.origin}/observe/burst/resource?id=image-${index}&type=image&fixture=browser-request-burst`);
  }
  for (let index = 1; index <= fixture.expectedBurstRequests.fetch; index += 1) {
    await httpGetJson(`${server.origin}/observe/burst/fetch?id=fetch-${index}&type=fetch&fixture=browser-request-burst`);
  }

  const state = server.getState();
  const counts = state.burstRequests.reduce((accumulator, entry) => {
    accumulator[entry.resourceType] = (accumulator[entry.resourceType] || 0) + 1;
    return accumulator;
  }, {});

  assert(counts.image === fixture.expectedBurstRequests.image, "burst fixture should record expected image count.");
  assert(counts.fetch === fixture.expectedBurstRequests.fetch, "burst fixture should record expected fetch count.");
  assert(counts.script === fixture.expectedBurstRequests.script, "burst fixture should record expected script count.");
  assert(counts.stylesheet === fixture.expectedBurstRequests.stylesheet, "burst fixture should record expected stylesheet count.");
}

async function main() {
  const fixtureServer = createDynamicScanFixtureServer();
  const server = await fixtureServer.start();
  let closed = false;

  try {
    await assertRenderTimeoutFixture(server.origin);
    await assertSecurityPrivateUrlFixture(server.origin);
    await assertSideEffectMethodFixture(server);
    await assertPopupDownloadFixture(server);
    await assertCrossOriginNavigationFixture(server);
    await assertChallengeRenderedFixture(server.origin);
    await assertWebSocketEgressFixture(server);
    await assertBrowserRequestBurstFixture(server);
    assertAllRecordedRequestsLocal(server.getState());
  } finally {
    await server.close();
    closed = true;
  }

  assert(closed, "Boundary fixture servers should shut down cleanly.");
  console.log("ok p0 boundary fixtures");
}

main().catch((error) => {
  console.error(`test-p0-boundary-fixtures: ${error.message}`);
  process.exitCode = 1;
});
