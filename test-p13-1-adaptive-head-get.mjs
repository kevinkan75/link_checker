#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BROWSER_USER_AGENT, DEFAULTS, LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function hashLabel(value) {
  return `sha256:${createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function abortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function networkError(code) {
  const error = new TypeError(`${code} failure`);
  error.cause = {
    name: "Error",
    message: `${code} failure`,
    code,
  };
  return error;
}

function makeResponse(status, body = "", headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/plain",
      ...headers,
    },
  });
}

async function withFetchScript(steps, task) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({
      url: String(url),
      method,
      userAgent: options.headers?.["user-agent"] || null,
      referer: options.headers?.referer || null,
    });

    const step = typeof steps === "function" ? steps({ url: String(url), method, requests }) : steps.shift();
    if (!step) {
      throw new Error(`Unexpected ${method} request to ${url}`);
    }
    if (typeof step === "function") {
      return step({ url: String(url), method, requests });
    }
    if (step.throw) {
      throw step.throw;
    }
    return makeResponse(step.status ?? 200, step.body || "", step.headers || {});
  };

  try {
    return await task(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function makeChecker(origin, options = {}) {
  return new LinkChecker(`${origin}/`, {
    allowLocalhost: true,
    robotsTxt: false,
    confirm404: false,
    requestDelayMs: 0,
    retryCount: 0,
    ...options,
  });
}

async function checkStatus(checker, url) {
  return checker.checkUrl(url, { requireBody: false });
}

async function assertHead200DoesNotGet() {
  const origin = "http://127.0.0.1:13001";
  await withFetchScript([{ status: 200 }], async (requests) => {
    const result = await checkStatus(makeChecker(origin), `${origin}/page`);
    assert(result.ok === true, "HEAD 200 should succeed.");
    assert(requests.map((item) => item.method).join(",") === "HEAD", "HEAD 200 should use one HEAD request.");
    assert(!result.transportFallback, "HEAD 200 should not record adaptive transport fallback metadata.");
  });
}

async function assertHead404KeepsExistingHttpFallback() {
  const origin = "http://127.0.0.1:13002";
  await withFetchScript([{ status: 404 }, { status: 200 }], async (requests) => {
    const result = await checkStatus(makeChecker(origin), `${origin}/missing`);
    assert(result.ok === true, "Existing HEAD 404 -> GET fallback should still recover.");
    assert(result.attempts === 1, "Existing HTTP-response fallback should remain inside one retry attempt.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET", "HEAD 404 should fall back to GET once.");
    assert(!result.transportFallback, "HTTP-response fallback should not be marked as transport fallback.");
  });
}

async function assertHeadTimeoutSwitchesToGet200() {
  const origin = "http://127.0.0.1:13003";
  await withFetchScript([{ throw: abortError() }, { status: 200 }], async (requests) => {
    const result = await checkStatus(makeChecker(origin, { retryCount: 1 }), `${origin}/page`);
    assert(result.ok === true && result.status === 200, "HEAD timeout should switch to GET and recover.");
    assert(result.attempts === 2, "HEAD timeout -> GET 200 should consume two attempts.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET", "HEAD timeout should be followed by one GET.");
    assert(result.transportFallback?.activated === true, "Recovered result should record adaptive fallback metadata.");
    assert(result.transportFallback.triggerIssueType === "timeout", "Fallback trigger should record timeout.");
  });
}

async function assertRetryBudgetKeepsGetAfterSwitch() {
  const origin = "http://127.0.0.1:13004";
  await withFetchScript([
    { throw: abortError() },
    { throw: abortError() },
    { status: 200 },
  ], async (requests) => {
    const result = await checkStatus(makeChecker(origin, { retryCount: 2 }), `${origin}/page`);
    assert(result.ok === true && result.attempts === 3, "retryCount=2 should allow exactly three attempts.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET,GET", "After adaptive switch, retries should stay on GET.");
  });
}

async function assertRetryBudgetStopsAfterGetFailures() {
  const origin = "http://127.0.0.1:13005";
  await withFetchScript([
    { throw: abortError() },
    { throw: abortError() },
    { throw: abortError() },
  ], async (requests) => {
    const result = await checkStatus(makeChecker(origin, { retryCount: 2 }), `${origin}/page`);
    assert(result.ok === false && result.issueType === "timeout", "Final result should remain a timeout.");
    assert(result.attempts === 3, "retryCount=2 should not exceed three attempts.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET,GET", "Failed adaptive path should not switch back to HEAD.");
  });
}

async function assertRetryCountZeroDoesNotGet() {
  const origin = "http://127.0.0.1:13006";
  await withFetchScript([{ throw: abortError() }], async (requests) => {
    const result = await checkStatus(makeChecker(origin, { retryCount: 0 }), `${origin}/page`);
    assert(result.ok === false && result.method === "HEAD", "retryCount=0 should return the HEAD failure.");
    assert(result.attempts === 1, "retryCount=0 should consume one attempt.");
    assert(requests.map((item) => item.method).join(",") === "HEAD", "retryCount=0 should not add an adaptive GET.");
    assert(!result.transportFallback, "retryCount=0 should not mark fallback as activated.");
  });
}

async function assertNonSwitchNetworkErrors() {
  const cases = [
    { code: "ENOTFOUND", origin: "http://127.0.0.1:13007", expected: "HEAD" },
    { code: "ECONNREFUSED", origin: "http://127.0.0.1:13008", expected: "HEAD,HEAD" },
    { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE", origin: "https://127.0.0.1:13009", expected: "HEAD" },
    { code: "EAI_AGAIN", origin: "http://127.0.0.1:13010", expected: "HEAD,HEAD" },
  ];

  for (const item of cases) {
    const steps = item.expected.split(",").map(() => ({ throw: networkError(item.code) }));
    await withFetchScript(steps, async (requests) => {
      const result = await checkStatus(makeChecker(item.origin, { retryCount: 1 }), `${item.origin}/page`);
      assert(result.ok === false, `${item.code} should fail in this fixture.`);
      assert(requests.map((request) => request.method).join(",") === item.expected, `${item.code} should not switch to GET.`);
      assert(!result.transportFallback, `${item.code} should not record adaptive fallback metadata.`);
    });
  }
}

async function assertExternalAndPdfDoNotSwitch() {
  const startOrigin = "http://127.0.0.1:13011";
  const externalOrigin = "http://127.0.0.1:13012";
  await withFetchScript([{ throw: abortError() }, { throw: abortError() }], async (requests) => {
    const result = await checkStatus(makeChecker(startOrigin, { retryCount: 1, checkExternal: true }), `${externalOrigin}/page`);
    assert(result.ok === false, "External timeout fixture should fail.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,HEAD", "External page timeout should not switch to GET in P13-1.");
  });

  await withFetchScript([{ throw: abortError() }, { throw: abortError() }], async (requests) => {
    const result = await checkStatus(makeChecker(startOrigin, { retryCount: 1 }), `${startOrigin}/file.pdf`);
    assert(result.ok === false, "PDF timeout fixture should fail.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,HEAD", "Same-origin PDF timeout should not switch to GET.");
  });
}

async function assertRequireBodyAndPreferGetUnaffected() {
  const origin = "http://127.0.0.1:13013";
  await withFetchScript([{ status: 200, body: "<html></html>", headers: { "content-type": "text/html" } }], async (requests) => {
    const result = await makeChecker(origin).checkUrl(`${origin}/page`, { requireBody: true });
    assert(result.ok === true && result.method === "GET", "requireBody should use GET directly.");
    assert(requests.map((item) => item.method).join(",") === "GET", "requireBody should not issue HEAD.");
  });

  await withFetchScript([{ status: 200 }], async (requests) => {
    const result = await checkStatus(makeChecker(origin, { preferGet: true }), `${origin}/page`);
    assert(result.ok === true && result.method === "GET", "preferGet should use GET directly.");
    assert(requests.map((item) => item.method).join(",") === "GET", "preferGet should not issue HEAD.");
  });
}

async function assertUserStopPreventsAdaptiveGet() {
  const origin = "http://127.0.0.1:13014";
  let checker = null;
  await withFetchScript(() => {
    checker.stop("stopped_by_user");
    throw abortError();
  }, async (requests) => {
    checker = makeChecker(origin, { retryCount: 1 });
    const result = await checkStatus(checker, `${origin}/page`);
    assert(result.cancelledByStop === true, "User stop should produce a cancelled result.");
    assert(requests.map((item) => item.method).join(",") === "HEAD", "User stop after HEAD failure should not issue GET.");
  });
}

async function assertAdaptiveGet404SkipsImmediateSourceGetButKeepsFormalConfirmation() {
  const origin = "http://127.0.0.1:13015";
  await withFetchScript([
    { throw: abortError() },
    { status: 404 },
    { status: 404 },
  ], async (requests) => {
    const checker = makeChecker(origin, { retryCount: 1, confirm404: true });
    const url = `${origin}/missing`;
    checker.addSource(url, {
      page: `${origin}/source`,
      tag: "a",
      attribute: "href",
      text: "missing",
    });

    const result = await checkStatus(checker, url);
    assert(result.status === 404 && result.transportFallback?.activated === true, "Adaptive GET 404 should be the status result.");
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET", "Adaptive GET 404 should not trigger an immediate duplicate source GET.");

    await checker.confirmNotFoundResults();
    assert(requests.map((item) => item.method).join(",") === "HEAD,GET,GET", "Formal 404 confirmation should still run after status validation.");
    assert(requests[2].userAgent === BROWSER_USER_AGENT, "Formal confirmation should retain browser-like User-Agent.");
  });
}

async function assertOldHeadOnlyCacheDoesNotBlockAdaptivePolicy() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p13-1-cache-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    const origin = "http://127.0.0.1:13016";
    const url = `${origin}/page`;
    const checkerForKey = makeChecker(origin, { cache: true, cacheFile, retryCount: 1 });
    const adaptiveKeyParts = checkerForKey.buildPersistentCacheKey(url).keyParts;
    const oldHeadKeyParts = {
      ...adaptiveKeyParts,
      methodPolicy: "HEAD",
    };
    const oldHeadKey = hashLabel(stableStringify(oldHeadKeyParts));
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await writeFile(cacheFile, `${JSON.stringify({
      cacheSchemaVersion: "1.0.0",
      policyVersion: "p7-cache-policy-v1",
      generatedBy: { name: "test" },
      updatedAt: now,
      entries: {
        [oldHeadKey]: {
          key: oldHeadKey,
          canonicalUrlHash: oldHeadKeyParts.canonicalUrlHash,
          displayUrl: url,
          keyParts: oldHeadKeyParts,
          checkedAt: now,
          expiresAt,
          ttlCategory: "network_error",
          lastStatus: null,
          lastFinalUrlHash: hashLabel(url),
          result: {
            url,
            canonicalUrl: url,
            checkedAt: now,
            ok: false,
            status: null,
            method: "HEAD",
            finalUrl: null,
            contentType: null,
            contentLength: null,
            cacheHeaders: {},
            wafHeaders: {},
            blockedReason: null,
            blockedRuleId: null,
            bodySignature: null,
            suspectedWaf: false,
            suspectedBot: false,
            redirected: false,
            redirectCount: 0,
            redirectChain: [],
            redirectType: "none",
            redirectIssues: [],
            redirectLabels: [],
            elapsedMs: 1,
            error: "old timeout",
            cause: null,
            classification: "network_error",
            issueType: "timeout",
            diagnosis: "old cached HEAD timeout",
          },
        },
      },
    }, null, 2)}\n`, "utf8");

    await withFetchScript([{ throw: abortError() }, { status: 200 }], async (requests) => {
      const checker = makeChecker(origin, { cache: true, cacheFile, retryCount: 1 });
      const result = await checkStatus(checker, url);
      assert(result.ok === true, "Adaptive cache policy should miss old HEAD-only network error and recover.");
      assert(result.cache?.hit !== true, "Old HEAD-only cache entry should not be used.");
      assert(requests.map((item) => item.method).join(",") === "HEAD,GET", "Old HEAD-only cache should not block adaptive requests.");
      assert(result.transportFallback?.activated === true, "Adaptive behavior should run after old cache miss.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  assert(DEFAULTS.preferGet === false, "Default status checks should still start with HEAD.");
  await assertHead200DoesNotGet();
  await assertHead404KeepsExistingHttpFallback();
  await assertHeadTimeoutSwitchesToGet200();
  await assertRetryBudgetKeepsGetAfterSwitch();
  await assertRetryBudgetStopsAfterGetFailures();
  await assertRetryCountZeroDoesNotGet();
  await assertNonSwitchNetworkErrors();
  await assertExternalAndPdfDoNotSwitch();
  await assertRequireBodyAndPreferGetUnaffected();
  await assertUserStopPreventsAdaptiveGet();
  await assertAdaptiveGet404SkipsImmediateSourceGetButKeepsFormalConfirmation();
  await assertOldHeadOnlyCacheDoesNotBlockAdaptivePolicy();
  console.log("ok p13-1 adaptive head get");
}

main().catch((error) => {
  console.error(`test-p13-1-adaptive-head-get: ${error.message}`);
  process.exitCode = 1;
});
