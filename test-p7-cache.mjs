#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LinkChecker } from "./link-checker.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(rootDir, "fixtures", "cache", "p7-cache-fixtures.json");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function makeCacheChecker(startUrl, cacheFile, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    cache: true,
    cacheFile,
    ...options,
  });
}

function assertCacheFixtureShape(fixture) {
  assert(fixture.cacheSchemaVersion === "p7-draft-1", "Unexpected P7 cache fixture schema version.");
  assert(fixture.policyVersion === "p7-cache-policy-v1", "Unexpected P7 cache policy version.");
  assert(Array.isArray(fixture.requiredKeyParts), "requiredKeyParts must be an array.");
  assert(fixture.entries && typeof fixture.entries === "object", "entries must be an object keyed by cache key.");
  assert(Array.isArray(fixture.pendingImplementationCases), "pendingImplementationCases must be an array.");
  assert(fixture.pendingImplementationCases.length >= 5, "P7 fixture should document pending implementation cases.");
}

function assertRequiredKeyParts(fixture) {
  const required = [
    "canonicalUrlHash",
    "canonicalStrategy",
    "methodPolicy",
    "userAgentHash",
    "acceptLanguage",
    "refererMode",
    "checkExternal",
    "robotsPolicy",
    "securityPolicy",
    "requestPolicy",
  ];

  for (const key of required) {
    assert(fixture.requiredKeyParts.includes(key), `Missing required key part: ${key}`);
  }
}

function assertEntryShape(fixture) {
  for (const [key, entry] of Object.entries(fixture.entries)) {
    assert(key === entry.key, "Entry map key must match entry.key.");
    assert(/^sha256:/.test(entry.key), "Cache entry key should be a hash label.");
    assert(/^sha256:/.test(entry.canonicalUrlHash), "canonicalUrlHash should be a hash label.");
    assert(typeof entry.displayUrl === "string", "displayUrl should be present for user-facing diagnostics.");
    assert(!entry.displayUrl.includes("secret-value"), "displayUrl must not contain raw sensitive query values.");
    assert(entry.keyParts && typeof entry.keyParts === "object", "keyParts must be present.");
    assert(typeof entry.checkedAt === "string", "checkedAt must be an ISO string.");
    assert(typeof entry.expiresAt === "string", "expiresAt must be an ISO string.");
    assert(Date.parse(entry.expiresAt) > Date.parse(entry.checkedAt), "expiresAt must be after checkedAt.");
    assert(["success", "missing", "temporary_failure", "network_error", "security_blocked"].includes(entry.ttlCategory), "Unexpected ttlCategory.");
    assert(entry.result && typeof entry.result === "object", "result must be present.");
    assert(!Object.hasOwn(entry.result, "body"), "Persistent P7 status cache must not store response body.");
  }
}

function assertTtlPolicy(fixture) {
  const policy = fixture.ttlPolicy;
  assert(policy.successHours > policy.missingHours, "Missing-link TTL should be shorter than success TTL.");
  assert(policy.temporaryFailureMinutes <= 60, "Temporary failure TTL should stay short.");
  assert(policy.networkErrorMinutes <= policy.temporaryFailureMinutes, "Network error TTL should not exceed temporary failure TTL.");
}

async function assertPersistentCacheHit() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p7-cache-hit-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    let requests = 0;
    await withServer((request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("ok");
    }, async (origin) => {
      const url = `${origin}/target?token=secret-value`;
      const first = await makeCacheChecker(origin, cacheFile, { redactSensitiveQuery: false }).checkUrl(url, { requireBody: false });
      const second = await makeCacheChecker(origin, cacheFile, { redactSensitiveQuery: false }).checkUrl(url, { requireBody: false });
      const cache = await readJson(cacheFile);
      const cacheText = await readFile(cacheFile, "utf8");

      assert(first.ok === true, "First status check should succeed.");
      assert(second.ok === true, "Second status check should succeed from cache.");
      assert(second.cache?.hit === true, "Second result should be marked as cache hit.");
      assert(requests === 1, "Persistent cache hit should avoid a second HTTP request.");
      assert(Object.keys(cache.entries).length === 1, "Cache file should contain one entry.");
      assert(!cacheText.includes("secret-value"), "Cache file must not store raw sensitive query values.");
      assert(cacheText.includes("token=REDACTED"), "Cache display URL should redact sensitive query values.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertRefreshCacheBypassesEntry() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p7-refresh-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    let requests = 0;
    await withServer((request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(`ok-${requests}`);
    }, async (origin) => {
      const url = `${origin}/refresh`;
      await makeCacheChecker(origin, cacheFile).checkUrl(url, { requireBody: false });
      const refreshed = await makeCacheChecker(origin, cacheFile, { refreshCache: true }).checkUrl(url, { requireBody: false });

      assert(refreshed.cache?.hit !== true, "Refresh result should not be marked as cache hit.");
      assert(requests === 2, "--refresh-cache should bypass the existing entry.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertExpiredCacheMiss() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p7-expired-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    let requests = 0;
    await withServer((request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const url = `${origin}/expired`;
      await makeCacheChecker(origin, cacheFile).checkUrl(url, { requireBody: false });
      const cache = await readJson(cacheFile);
      for (const entry of Object.values(cache.entries)) {
        entry.expiresAt = "2000-01-01T00:00:00.000Z";
      }
      await writeFile(cacheFile, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

      const result = await makeCacheChecker(origin, cacheFile).checkUrl(url, { requireBody: false });
      assert(result.cache?.hit !== true, "Expired entry should not be used.");
      assert(requests === 2, "Expired entry should trigger a fresh HTTP request.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertPolicyMismatchMiss() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p7-policy-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    let requests = 0;
    await withServer((request, response) => {
      requests += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const url = `${origin}/policy`;
      await makeCacheChecker(origin, cacheFile, { userAgent: "P7Test/A" }).checkUrl(url, { requireBody: false });
      const result = await makeCacheChecker(origin, cacheFile, { userAgent: "P7Test/B" }).checkUrl(url, { requireBody: false });

      assert(result.cache?.hit !== true, "Different userAgent policy should not hit cache.");
      assert(requests === 2, "Policy mismatch should trigger a fresh HTTP request.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertBodyFetchBypassesPersistentStatusCache() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p7-body-"));
  try {
    const cacheFile = path.join(tempDir, "cache.json");
    let headRequests = 0;
    let getRequests = 0;
    await withServer((request, response) => {
      if (request.method === "HEAD") {
        headRequests += 1;
        response.writeHead(200, { "content-type": "text/html" });
        response.end();
        return;
      }
      getRequests += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><body><a href=\"/next\">next</a></body></html>");
    }, async (origin) => {
      const url = `${origin}/page`;
      await makeCacheChecker(origin, cacheFile).checkUrl(url, { requireBody: false });
      const bodyResult = await makeCacheChecker(origin, cacheFile).checkUrl(url, { requireBody: true });

      assert(headRequests === 1, "Initial status check should use one HEAD request.");
      assert(getRequests === 1, "Body fetch should still issue a GET request.");
      assert(bodyResult.body?.includes("/next"), "Body fetch should return HTML body.");
      assert(bodyResult.cache?.hit !== true, "Body fetch must not be served by persistent status cache.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const fixture = await readJson(fixturePath);
  assertCacheFixtureShape(fixture);
  assertRequiredKeyParts(fixture);
  assertEntryShape(fixture);
  assertTtlPolicy(fixture);
  await assertPersistentCacheHit();
  await assertRefreshCacheBypassesEntry();
  await assertExpiredCacheMiss();
  await assertPolicyMismatchMiss();
  await assertBodyFetchBypassesPersistentStatusCache();
  console.log("ok p7 cache");
}

main().catch((error) => {
  console.error(`test-p7-cache: ${error.message}`);
  process.exitCode = 1;
});
