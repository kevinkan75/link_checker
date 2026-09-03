#!/usr/bin/env node

import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function htmlResponse(body, status = 200) {
  return new Response(`<!doctype html><html>${body}</html>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function withFetchHandler(handler, task) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handler(new URL(String(url)), options);
  try {
    return await task();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function createChecker(origin) {
  return new LinkChecker(`${origin}/`, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    confirm404: false,
    requestDelayMs: 0,
    concurrency: 1,
    perHostConcurrency: 1,
    maxDepth: 0,
    maxPages: 1,
    preferGet: true,
    checkExternal: false,
  });
}

function findChecked(report, url) {
  const result = report.checked.find((item) => item.url === url);
  assert(result, `Expected checked result for ${url}.`);
  return result;
}

async function assertNormalRecaptchaFeatureDoesNotLookBlocked() {
  const origin = "http://127.0.0.1:13104";
  const report = await withFetchHandler((url) => {
    if (url.pathname === "/") {
      return htmlResponse(`
        <head>
          <title>Normal site</title>
          <script src="https://www.google.com/recaptcha/api.js"></script>
        </head>
        <body>
          <h1>Normal content</h1>
          <form>
            <div class="g-recaptcha"></div>
          </form>
          <script>
            if (window.grecaptcha) {
              console.log("normal feature use");
            }
          </script>
        </body>
      `);
    }
    return htmlResponse("<body>not found</body>", 404);
  }, async () => createChecker(origin).run());

  const result = findChecked(report, `${origin}/`);
  assert(result.ok === true, "Normal reCAPTCHA feature page should be HTTP ok.");
  assert(result.classification === "ok", "Normal reCAPTCHA feature page should remain classified as ok.");
  assert(result.interpretation?.category === "ok", "Normal reCAPTCHA feature page should remain interpreted as ok.");
  assert(result.blockedReason !== "captcha_or_challenge", "Normal reCAPTCHA feature should not set captcha_or_challenge.");
  assert(result.suspectedBot === false, "Normal reCAPTCHA feature should not set suspectedBot.");
  assert(!result.bodySignature?.matchedPatterns?.includes("captcha"), "Normal reCAPTCHA identifiers should not be CAPTCHA challenge evidence.");

  const host = report.summary.hostDiagnostics.hosts.find((item) => item.host === new URL(origin).host);
  assert(host?.suspectedBot === 0, "Normal reCAPTCHA feature should not pollute host suspectedBot diagnostics.");
  assert(report.summary.brokenLinks === 0, "Normal reCAPTCHA feature should not create broken results.");
}

async function assertExplicitCaptchaChallengeStillDetected() {
  const origin = "http://127.0.0.1:13105";
  const report = await withFetchHandler((url) => {
    if (url.pathname === "/") {
      return htmlResponse(`
        <head><title>Verification required</title></head>
        <body>
          <h1>Verify you are human</h1>
          <p>Please complete the CAPTCHA to continue.</p>
        </body>
      `);
    }
    return htmlResponse("<body>not found</body>", 404);
  }, async () => createChecker(origin).run());

  const result = findChecked(report, `${origin}/`);
  assert(result.ok === true, "HTTP 200 CAPTCHA challenge response should remain HTTP ok.");
  assert(result.classification === "ok", "HTTP 200 classification semantics should remain unchanged.");
  assert(result.blockedReason === "captcha_or_challenge", "Explicit CAPTCHA challenge should be detected.");
  assert(result.suspectedBot === true, "Explicit CAPTCHA challenge should set suspectedBot.");
  assert(result.bodySignature?.matchedPatterns?.includes("captcha"), "Explicit CAPTCHA challenge should keep CAPTCHA evidence.");
}

async function main() {
  await assertNormalRecaptchaFeatureDoesNotLookBlocked();
  await assertExplicitCaptchaChallengeStillDetected();
  console.log("ok captcha protection detection");
}

main().catch((error) => {
  console.error(`test-captcha-protection-detection: ${error.message}`);
  process.exitCode = 1;
});
