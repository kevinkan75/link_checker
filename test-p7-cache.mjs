#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

async function main() {
  const fixture = await readJson(fixturePath);
  assertCacheFixtureShape(fixture);
  assertRequiredKeyParts(fixture);
  assertEntryShape(fixture);
  assertTtlPolicy(fixture);
  console.log("ok p7 cache fixture contract");
}

main().catch((error) => {
  console.error(`test-p7-cache: ${error.message}`);
  process.exitCode = 1;
});
