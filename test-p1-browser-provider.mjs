#!/usr/bin/env node

import {
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
  classifyLaunchError,
  sanitizeDiagnostic,
} from "./browser-provider.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}\nexpected: ${JSON.stringify(expected, null, 2)}\nactual: ${JSON.stringify(actual, null, 2)}`);
  }
}

class FakeBrowser {
  constructor(version = "fake-browser/1.0") {
    this.versionValue = version;
    this.closed = false;
    this.handlers = new Map();
  }

  version() {
    return this.versionValue;
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  async close() {
    this.closed = true;
    this.emit("disconnected");
  }

  emit(eventName) {
    const handler = this.handlers.get(eventName);
    if (handler) {
      handler();
    }
  }
}

function makeLaunchError(message, browserProviderStatus) {
  const error = new Error(message);
  error.browserProviderStatus = browserProviderStatus;
  return error;
}

function makeProvider(behaviors) {
  const attempts = [];
  const chromium = {
    launch: async (options) => {
      attempts.push(options.channel);
      const behavior = behaviors[options.channel];
      if (!behavior) {
        throw makeLaunchError(`No fake behavior for ${options.channel}`, BROWSER_PROVIDER_STATUS.NOT_FOUND);
      }
      if (behavior.error) {
        throw behavior.error;
      }
      return behavior.browser || new FakeBrowser(`${options.channel}/99.0`);
    },
  };
  return {
    attempts,
    provider: new BrowserProvider({ playwright: { chromium } }),
  };
}

async function assertAutoEdgePreferred() {
  const edge = new FakeBrowser("edge/120");
  const { provider, attempts } = makeProvider({
    msedge: { browser: edge },
    chrome: { browser: new FakeBrowser("chrome/120") },
  });
  const result = await provider.launchFirstAvailable({ browser: "auto" });

  assert(result.ok, "auto should succeed when Edge succeeds.");
  assert(result.browser === "msedge", "auto should select Edge first.");
  assert(result.browserChannel === "msedge", "auto should report msedge channel.");
  assert(result.browserVersion === "edge/120", "auto should report selected browser version.");
  assertDeepEqual(attempts, ["msedge"], "auto should not try Chrome after Edge succeeds.");
  const closeResult = await result.close();
  assert(closeResult.ok, "normal close should succeed.");
  assert(edge.closed, "normal close should close the launched browser.");
  assert(result.getStatus() === BROWSER_PROVIDER_STATUS.AVAILABLE, "normal close must not manufacture closed_unexpectedly.");
}

async function assertAutoFallbackToChrome() {
  const { provider, attempts } = makeProvider({
    msedge: { error: makeLaunchError("Executable doesn't exist at C:\\Users\\kevin\\Edge\\msedge.exe", BROWSER_PROVIDER_STATUS.NOT_FOUND) },
    chrome: { browser: new FakeBrowser("chrome/121") },
  });
  const result = await provider.launchFirstAvailable({ browser: "auto" });

  assert(result.ok, "auto should succeed when Chrome succeeds after Edge not_found.");
  assert(result.browser === "chrome", "auto should select Chrome fallback.");
  assertDeepEqual(attempts, ["msedge", "chrome"], "auto should try Edge then Chrome.");
  assertDeepEqual(result.attempts.map((attempt) => attempt.status), ["not_found", "available"], "auto fallback statuses changed.");
  await result.close();
}

async function assertAutoUnavailable() {
  const { provider, attempts } = makeProvider({
    msedge: { error: makeLaunchError("Edge browser was not found", BROWSER_PROVIDER_STATUS.NOT_FOUND) },
    chrome: { error: makeLaunchError("Chrome browser was not found", BROWSER_PROVIDER_STATUS.NOT_FOUND) },
  });
  const result = await provider.launchFirstAvailable({ browser: "auto" });

  assert(!result.ok, "auto should fail when both candidates are unavailable.");
  assert(result.status === BROWSER_PROVIDER_STATUS.NOT_FOUND, "auto unavailable should use not_found.");
  assert(result.launchOutcome === "browser_unavailable", "auto unavailable outcome changed.");
  assertDeepEqual(attempts, ["msedge", "chrome"], "auto unavailable should try both candidates.");
}

async function assertExplicitCandidateBehavior() {
  const edgeCase = makeProvider({
    msedge: { error: makeLaunchError("Edge browser was not found", BROWSER_PROVIDER_STATUS.NOT_FOUND) },
    chrome: { browser: new FakeBrowser("chrome/should-not-launch") },
  });
  const edgeResult = await edgeCase.provider.launchFirstAvailable({ browser: "msedge" });
  assert(!edgeResult.ok, "explicit msedge should not fallback.");
  assertDeepEqual(edgeCase.attempts, ["msedge"], "explicit msedge should attempt only Edge.");

  const chromeCase = makeProvider({
    msedge: { browser: new FakeBrowser("edge/should-not-launch") },
    chrome: { browser: new FakeBrowser("chrome/122") },
  });
  const chromeResult = await chromeCase.provider.launchFirstAvailable({ browser: "chrome" });
  assert(chromeResult.ok, "explicit chrome should launch Chrome.");
  assert(chromeResult.browser === "chrome", "explicit chrome should report Chrome.");
  assertDeepEqual(chromeCase.attempts, ["chrome"], "explicit chrome should attempt only Chrome.");
  await chromeResult.close();
}

async function assertLaunchFailedDoesNotFallback() {
  const { provider, attempts } = makeProvider({
    msedge: { error: makeLaunchError("Profile is locked by policy", BROWSER_PROVIDER_STATUS.LAUNCH_FAILED) },
    chrome: { browser: new FakeBrowser("chrome/should-not-launch") },
  });
  const result = await provider.launchFirstAvailable({ browser: "auto" });

  assert(!result.ok, "auto should fail on Edge launch_failed.");
  assert(result.status === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED, "launch failure should use launch_failed.");
  assert(result.launchOutcome === "browser_launch_failed", "launch failure outcome changed.");
  assertDeepEqual(attempts, ["msedge"], "auto should not fallback after launch_failed.");
}

async function assertUnexpectedCloseHook() {
  const browser = new FakeBrowser("edge/123");
  const { provider } = makeProvider({
    msedge: { browser },
  });
  const result = await provider.launchFirstAvailable({ browser: "msedge" });
  browser.emit("disconnected");
  assert(result.getStatus() === BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY, "unexpected disconnect should be observable.");
}

async function assertInvalidBrowserOption() {
  const { provider, attempts } = makeProvider({
    msedge: { browser: new FakeBrowser("edge/should-not-launch") },
    chrome: { browser: new FakeBrowser("chrome/should-not-launch") },
  });
  let rejected = false;
  try {
    await provider.launchFirstAvailable({ browser: "firefox" });
  } catch (error) {
    rejected = true;
    assert(error.message.includes("Unsupported browser request"), "invalid browser option should explain unsupported request.");
  }
  assert(rejected, "invalid browser option should reject.");
  assertDeepEqual(attempts, [], "invalid browser option should not attempt any browser launch.");
}

function assertClassificationAndSanitization() {
  assert(
    classifyLaunchError(new Error("Executable doesn't exist at C:\\Users\\kevin\\AppData\\Local\\msedge.exe")) === BROWSER_PROVIDER_STATUS.NOT_FOUND,
    "missing executable should classify as not_found.",
  );
  assert(
    classifyLaunchError(new Error("Browser executable was not found for channel msedge")) === BROWSER_PROVIDER_STATUS.NOT_FOUND,
    "browser executable absence should classify as not_found.",
  );
  assert(
    classifyLaunchError(new Error("Permission denied while launching browser process")) === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
    "permission denied should classify as launch_failed.",
  );
  assert(
    classifyLaunchError(new Error("Enterprise policy blocked browser launch")) === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
    "policy restriction should classify as launch_failed.",
  );
  assert(
    classifyLaunchError(new Error("Browser process exited unexpectedly")) === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
    "process crash should classify as launch_failed.",
  );
  assert(
    classifyLaunchError(new Error("Configuration profile not found after process launch")) === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
    "generic not found text should not classify as Browser absence.",
  );
  const sanitized = sanitizeDiagnostic("Executable doesn't exist at C:\\Users\\kevin\\AppData\\Local\\msedge.exe\nsecond line\nthird line");
  assert(!sanitized.includes("C:\\Users\\kevin"), "diagnostics should not expose full personal paths.");
  assert(!sanitized.includes("third line"), "diagnostics should be concise.");
}

await assertAutoEdgePreferred();
await assertAutoFallbackToChrome();
await assertAutoUnavailable();
await assertExplicitCandidateBehavior();
await assertLaunchFailedDoesNotFallback();
await assertUnexpectedCloseHook();
await assertInvalidBrowserOption();
assertClassificationAndSanitization();

console.log("ok p1 browser provider");
