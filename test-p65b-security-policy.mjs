#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import {
  LinkChecker,
  evaluateUrlSecurity,
} from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  }
  finally {
    server.close();
    await once(server, "close");
  }
}

async function assertBlockedDirectTargets() {
  let requested = false;
  await withServer((request, response) => {
    requested = true;
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("should not be requested");
  }, async (origin) => {
    const checker = new LinkChecker("https://example.test/", {
      retryCount: 0,
      confirm404: false,
      requestDelayMs: 0,
    });

    const localhost = await checker.checkUrl(origin, { requireBody: false });
    assert(localhost.classification === "security_blocked", "Localhost should be blocked by default.");
    assert(localhost.issueType === "blocked_localhost", "Expected blocked_localhost issue.");
    assert(localhost.securityPolicy?.reason === "blocked_localhost", "Expected securityPolicy reason.");

    const metadata = await checker.checkUrl("http://169.254.169.254/latest/meta-data/", { requireBody: false });
    assert(metadata.classification === "security_blocked", "Metadata IP should be blocked.");
    assert(metadata.issueType === "blocked_metadata_ip", "Expected blocked_metadata_ip issue.");

    const privateIp = await checker.checkUrl("http://10.0.0.1/", { requireBody: false });
    assert(privateIp.classification === "security_blocked", "Private IP should be blocked.");
    assert(privateIp.issueType === "blocked_private_ip", "Expected blocked_private_ip issue.");

    const blockedScheme = await checker.checkUrl("file:///C:/Windows/win.ini", { requireBody: false });
    assert(blockedScheme.classification === "security_blocked", "Blocked scheme should not be requested.");
    assert(blockedScheme.issueType === "blocked_scheme", "Expected blocked_scheme issue.");
  });

  assert(requested === false, "Blocked localhost target must not receive an HTTP request.");
}

async function assertAllowLocalhostDoesNotAllowMetadata() {
  await withServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("ok");
  }, async (origin) => {
    const checker = new LinkChecker("https://example.test/", {
      allowLocalhost: true,
      retryCount: 0,
      confirm404: false,
      requestDelayMs: 0,
    });

    const allowed = await checker.checkUrl(origin, { requireBody: false });
    assert(allowed.ok === true, "--allow-localhost should allow loopback requests.");

    const metadata = await checker.checkUrl("http://169.254.169.254/latest/meta-data/", { requireBody: false });
    assert(metadata.classification === "security_blocked", "Metadata IP should remain blocked.");
    assert(metadata.issueType === "blocked_metadata_ip", "Metadata IP must remain blocked with --allow-localhost.");
  });
}

async function assertAllowPrivateIpDoesNotAllowLocalhost() {
  const checker = new LinkChecker("https://example.test/", {
    allowPrivateIp: true,
    retryCount: 0,
    confirm404: false,
    requestDelayMs: 0,
  });
  const result = await checker.checkUrl("http://127.0.0.1/", { requireBody: false });
  assert(result.classification === "security_blocked", "--allow-private-ip should not allow loopback.");
  assert(result.issueType === "blocked_localhost", "Loopback should require --allow-localhost.");
}

async function assertRedirectTargetIsRechecked() {
  await withServer((request, response) => {
    response.writeHead(302, {
      location: "http://169.254.169.254/latest/meta-data/",
    });
    response.end();
  }, async (origin) => {
    const checker = new LinkChecker(origin, {
      allowLocalhost: true,
      retryCount: 0,
      confirm404: false,
      requestDelayMs: 0,
    });

    const result = await checker.checkUrl(`${origin}/redirect`, { requireBody: false });
    assert(result.classification === "security_blocked", "Redirect target should be blocked by security policy.");
    assert(result.issueType === "redirect_to_blocked_metadata_ip", "Expected redirect_to_blocked_metadata_ip issue.");
    assert(result.redirectIssues.includes("redirect_to_blocked_metadata_ip"), "Redirect issue should be recorded.");
  });
}

async function assertResolvedPrivateAddressIsBlocked() {
  const decision = await evaluateUrlSecurity(
    "https://public-name.example/",
    {
      blockPrivateIp: true,
      allowLocalhost: false,
      allowPrivateIp: false,
    },
    async () => [{ address: "192.168.1.10", family: 4 }],
  );
  assert(decision.allowed === false, "Public hostname resolving to private IP should be blocked.");
  assert(decision.reason === "blocked_private_ip", "Expected blocked_private_ip for resolved private address.");
  assert(decision.address === "192.168.1.10", "Blocked decision should include resolved address.");
}

async function assertIpv6Classification() {
  const loopback = await evaluateUrlSecurity("http://[::1]/");
  assert(loopback.allowed === false, "IPv6 loopback should be blocked by default.");
  assert(loopback.reason === "blocked_localhost", "Expected blocked_localhost for ::1.");

  const uniqueLocal = await evaluateUrlSecurity("http://[fd00::1]/");
  assert(uniqueLocal.allowed === false, "IPv6 unique local should be blocked by default.");
  assert(uniqueLocal.reason === "blocked_private_ip", "Expected blocked_private_ip for fd00::/8.");

  const mappedLoopback = await evaluateUrlSecurity("http://[::ffff:7f00:1]/");
  assert(mappedLoopback.allowed === false, "IPv4-mapped IPv6 loopback should be blocked by default.");
  assert(mappedLoopback.reason === "blocked_localhost", "Expected blocked_localhost for mapped 127.0.0.1.");
}

async function main() {
  await assertBlockedDirectTargets();
  await assertAllowLocalhostDoesNotAllowMetadata();
  await assertAllowPrivateIpDoesNotAllowLocalhost();
  await assertRedirectTargetIsRechecked();
  await assertResolvedPrivateAddressIsBlocked();
  await assertIpv6Classification();
  console.log("ok p65b security policy");
}

main().catch((error) => {
  console.error(`test-p65b-security-policy: ${error.message}`);
  process.exitCode = 1;
});
