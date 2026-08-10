#!/usr/bin/env node

import {
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
} from "./browser-provider.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const acceptedStatuses = new Set([
  BROWSER_PROVIDER_STATUS.AVAILABLE,
  BROWSER_PROVIDER_STATUS.NOT_FOUND,
  BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
]);

async function attemptBrowser(browser) {
  const provider = new BrowserProvider();
  const result = await provider.launchFirstAvailable({ browser });
  assert(acceptedStatuses.has(result.status), `${browser} returned unexpected status: ${result.status}`);

  let closeResult = null;
  if (result.ok) {
    closeResult = await result.close();
    assert(closeResult.ok, `${browser} normal close should succeed.`);
    assert(result.getStatus() === BROWSER_PROVIDER_STATUS.AVAILABLE, `${browser} normal close should not be unexpected.`);
  }

  return {
    requestedBrowser: browser,
    ok: result.ok,
    status: result.status,
    selectedBrowser: result.browser,
    browserChannel: result.browserChannel,
    browserVersion: result.browserVersion,
    launchOutcome: result.launchOutcome,
    closeOutcome: closeResult?.closeOutcome || null,
    evidenceState: result.ok ? "AUTOMATED_PASS" : "ENV_BLOCKED",
    attempts: result.attempts.map((attempt) => ({
      candidate: attempt.candidate,
      status: attempt.status,
      launchOutcome: attempt.launchOutcome,
      message: attempt.message,
    })),
  };
}

const evidence = {
  msedge: await attemptBrowser("msedge"),
  chrome: await attemptBrowser("chrome"),
  auto: await attemptBrowser("auto"),
};

console.log(`p1 browser provider smoke ${JSON.stringify(evidence)}`);
