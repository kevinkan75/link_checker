#!/usr/bin/env node

import assert from "node:assert/strict";
import { DynamicRenderer } from "./dynamic-renderer.mjs";

class FakeRequest {
  constructor({
    url = "http://policy.test/resource",
    method = "GET",
    resourceType = "fetch",
    navigation = false,
    mainFrame = false,
  } = {}) {
    this._url = url;
    this._method = method;
    this._resourceType = resourceType;
    this._navigation = navigation;
    this._frame = {
      parentFrame: () => mainFrame ? null : {},
    };
  }

  url() {
    return this._url;
  }

  method() {
    return this._method;
  }

  resourceType() {
    return this._resourceType;
  }

  isNavigationRequest() {
    return this._navigation;
  }

  frame() {
    return this._frame;
  }
}

class FakeRoute {
  constructor(request) {
    this._request = request;
    this.continueCount = 0;
    this.abortCount = 0;
    this.abortCode = null;
  }

  request() {
    return this._request;
  }

  async continue() {
    this.continueCount += 1;
  }

  async abort(code) {
    this.abortCount += 1;
    this.abortCode = code;
  }
}

class FakePage {
  constructor(url = "about:blank") {
    this._url = url;
    this.handlers = new Map();
  }

  url() {
    return this._url;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }
}

class FakeContext {
  constructor() {
    this.handlers = new Map();
    this.routeHandler = null;
  }

  on(eventName, handler) {
    const handlers = this.handlers.get(eventName) || [];
    handlers.push(handler);
    this.handlers.set(eventName, handlers);
  }

  emit(eventName, value) {
    for (const handler of this.handlers.get(eventName) || []) {
      handler(value);
    }
  }

  async route(_url, handler) {
    this.routeHandler = handler;
  }

  async routeWebSocket() {}

  async newPage() {
    const page = new FakePage("http://policy.test/source");
    this.emit("page", page);
    return page;
  }

  async close() {}

  async dispatchRequest(options = {}) {
    const request = new FakeRequest(options);
    const route = new FakeRoute(request);
    await this.routeHandler(route, request);
    if (route.continueCount > 0 && options.terminal === "finished") {
      this.emit("requestfinished", request);
    }
    if (route.continueCount > 0 && options.terminal === "failed") {
      this.emit("requestfailed", request);
    }
    return { request, route };
  }
}

class FakeBrowser {
  async newContext() {
    return new FakeContext();
  }

  async close() {}
}

class FakeBrowserProvider {
  constructor() {
    this.launchCount = 0;
    this.browser = new FakeBrowser();
  }

  async launchFirstAvailable() {
    this.launchCount += 1;
    return {
      ok: true,
      browser: "msedge",
      browserChannel: "msedge",
      browserInstance: this.browser,
      status: "available",
      launchOutcome: "available",
      getStatus: () => "available",
      close: async () => ({ ok: true }),
    };
  }
}

async function runPolicyScenario({
  request = {},
  evaluateUrlSecurity = async () => ({ allowed: true, reason: null }),
  allowedOrigin = "http://policy.test",
} = {}) {
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: new FakeBrowserProvider(),
    evaluateUrlSecurity,
  });
  const result = await renderer.withPage(async ({ context }) => {
    const dispatched = await context.dispatchRequest({
      url: "http://policy.test/resource",
      method: "GET",
      resourceType: "fetch",
      terminal: "finished",
      ...request,
    });
    return { dispatched };
  }, {
    renderPage: "http://policy.test/source",
    allowedOrigin,
  });
  await renderer.close();
  return {
    route: result.value.dispatched.route,
    traffic: result.value.traffic,
  };
}

function firstRequestPolicy(traffic) {
  return {
    decision: traffic.requests[0]?.policyDecision,
    reason: traffic.requests[0]?.policyReason,
    requestClass: traffic.requests[0]?.requestClass,
  };
}

function lastBlockedPolicy(traffic) {
  const sample = traffic.blockedRequests.at(-1);
  return {
    category: sample?.reason,
    decision: sample?.policyDecision,
    reason: sample?.policyReason,
    securityReason: sample?.securityReason,
    requestClass: sample?.requestClass,
  };
}

async function assertMethodMatrix() {
  const cases = [
    { method: "GET", decision: "ALLOW", continued: 1 },
    { method: "HEAD", decision: "ALLOW", continued: 1 },
    { method: "OPTIONS", decision: "ALLOW", continued: 1 },
    { method: "POST", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "PUT", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "PATCH", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "DELETE", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "CONNECT", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "TRACE", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
    { method: "CUSTOM", decision: "BLOCK", reason: "unsafe_method", continued: 0 },
  ];

  for (const testCase of cases) {
    const { route, traffic } = await runPolicyScenario({
      request: { method: testCase.method, terminal: "finished" },
    });
    assert.equal(route.continueCount, testCase.continued, `${testCase.method} continue count`);
    assert.equal(route.abortCount, testCase.continued === 0 ? 1 : 0, `${testCase.method} abort count`);
    assert.equal(firstRequestPolicy(traffic).decision, testCase.decision, `${testCase.method} decision`);
    if (testCase.reason) {
      assert.equal(lastBlockedPolicy(traffic).reason, testCase.reason, `${testCase.method} reason`);
    }
  }
}

async function assertMainFramePolicy() {
  const sameOrigin = await runPolicyScenario({
    request: {
      url: "http://policy.test/same-origin",
      resourceType: "document",
      navigation: true,
      mainFrame: true,
    },
  });
  assert.equal(sameOrigin.route.continueCount, 1);
  assert.equal(firstRequestPolicy(sameOrigin.traffic).decision, "ALLOW");
  assert.equal(firstRequestPolicy(sameOrigin.traffic).requestClass, "main_document");

  const escape = await runPolicyScenario({
    request: {
      url: "http://other.test/escape",
      resourceType: "document",
      navigation: true,
      mainFrame: true,
    },
  });
  assert.equal(escape.route.continueCount, 0);
  assert.equal(escape.route.abortCount, 1);
  assert.equal(lastBlockedPolicy(escape.traffic).decision, "BLOCK");
  assert.equal(lastBlockedPolicy(escape.traffic).reason, "main_frame_scope_blocked");
  assert.equal(escape.traffic.mainFrameNavigationBlocked, 1);
}

async function assertUrlSecurityPolicy() {
  const rejected = await runPolicyScenario({
    request: { url: "http://policy.test/private?token=SECRET" },
    evaluateUrlSecurity: async () => ({ allowed: false, reason: "blocked_private_ip" }),
  });
  assert.equal(rejected.route.continueCount, 0);
  assert.equal(rejected.route.abortCount, 1);
  assert.equal(lastBlockedPolicy(rejected.traffic).decision, "BLOCK");
  assert.equal(lastBlockedPolicy(rejected.traffic).reason, "url_security_blocked");
  assert.equal(lastBlockedPolicy(rejected.traffic).securityReason, "blocked_private_ip");
  assert.equal(rejected.traffic.securityBlockedRequests, 1);

  const evaluatorFailure = await runPolicyScenario({
    evaluateUrlSecurity: async () => {
      throw Object.assign(new Error("resolver exploded"), { name: "ResolverError" });
    },
  });
  assert.equal(evaluatorFailure.route.continueCount, 0);
  assert.equal(evaluatorFailure.route.abortCount, 1);
  assert.equal(lastBlockedPolicy(evaluatorFailure.traffic).decision, "ERROR_OR_FAIL_CLOSED");
  assert.equal(lastBlockedPolicy(evaluatorFailure.traffic).reason, "security_evaluator_failed");

  const malformed = await runPolicyScenario({
    evaluateUrlSecurity: async () => ({ allowed: "yes", reason: "not_boolean" }),
  });
  assert.equal(malformed.route.continueCount, 0);
  assert.equal(malformed.route.abortCount, 1);
  assert.equal(lastBlockedPolicy(malformed.traffic).decision, "ERROR_OR_FAIL_CLOSED");
  assert.equal(lastBlockedPolicy(malformed.traffic).reason, "invalid_security_decision");

  const serialized = JSON.stringify(rejected.traffic);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("token="), false);
}

async function assertRequestClassModel() {
  const cases = [
    { resourceType: "document", navigation: true, mainFrame: true, requestClass: "main_document" },
    { resourceType: "document", navigation: true, mainFrame: false, requestClass: "iframe_frame" },
    { resourceType: "fetch", requestClass: "fetch" },
    { resourceType: "xhr", requestClass: "xhr" },
    { resourceType: "image", requestClass: "image" },
    { resourceType: "script", requestClass: "script" },
    { resourceType: "stylesheet", requestClass: "stylesheet" },
    { resourceType: "font", requestClass: "font" },
    { resourceType: "media", requestClass: "media" },
    { resourceType: "other", requestClass: "other" },
  ];

  for (const testCase of cases) {
    const { route, traffic } = await runPolicyScenario({ request: testCase });
    assert.equal(route.continueCount, 1, `${testCase.requestClass} continue count`);
    assert.equal(firstRequestPolicy(traffic).requestClass, testCase.requestClass);
    assert.equal(traffic.requestsByClass[testCase.requestClass], 1);
  }

  const unknown = await runPolicyScenario({
    request: { resourceType: "manifest" },
  });
  assert.equal(unknown.route.continueCount, 0);
  assert.equal(unknown.route.abortCount, 1);
  assert.equal(lastBlockedPolicy(unknown.traffic).decision, "BLOCK");
  assert.equal(lastBlockedPolicy(unknown.traffic).reason, "unknown_request_class");
}

await assertMethodMatrix();
await assertMainFramePolicy();
await assertUrlSecurityPolicy();
await assertRequestClassModel();

console.log("p2 browser request security policy", JSON.stringify({
  decisionStates: ["ALLOW", "BLOCK", "ERROR_OR_FAIL_CLOSED"],
  reasons: [
    "unsafe_method",
    "main_frame_scope_blocked",
    "url_security_blocked",
    "security_evaluator_failed",
    "invalid_security_decision",
    "unknown_request_class",
  ],
  nodePolicy: "NODE_POLICY_UNCHANGED_BY_SCOPE",
}));
