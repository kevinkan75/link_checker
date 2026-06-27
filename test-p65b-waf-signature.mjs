#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { LinkChecker } from "./link-checker.mjs";

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
  } finally {
    server.close();
    await once(server, "close");
  }
}

function writeCloudflareLikeChallenge(response) {
  response.writeHead(404, {
    "content-type": "text/html; charset=utf-8",
    "server": "cloudflare",
    "cf-ray": "test-ray",
    "x-waf-rule-id": "rule-123",
  });
  response.end(`
    <!doctype html>
    <html>
      <head><title>Attention Required! | Cloudflare</title></head>
      <body>Just a moment... /cdn-cgi/challenge-platform</body>
    </html>
  `);
}

async function assertWafSignatureSchemaDefaults() {
  await withServer((request, response) => {
    writeCloudflareLikeChallenge(response);
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      preferGet: true,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      robotsTxt: false,
    });

    const result = await checker.checkUrl(`${origin}/missing`, { requireBody: false });
    const report = checker.buildReport();
    const checked = report.checked.find((item) => item.url === `${origin}/missing`);
    const broken = report.broken.find((item) => item.url === `${origin}/missing`);

    assert(result.classification === "protected", "WAF body signature should classify as protected, not generic not_found.");
    assert(result.issueType === "protected", "WAF body signature should use protected issueType.");
    assert(checked.protection?.provider === "Cloudflare", "Protection schema should preserve provider.");
    assert(checked.protection.headerEvidence.some((item) => item.header === "cf-ray"), "Protection should include header evidence.");
    assert(checked.protection.bodySignatureRuleIds.includes("cloudflare_attention_required"), "Protection should include body signature rule id.");
    assert(checked.protection.blockedRuleId === "rule-123", "Protection should preserve blocked rule id.");
    assert(checked.bodySignature && !Object.hasOwn(checked.bodySignature, "bodyHash"), "bodyHash should be disabled by default.");
    assert(broken.bodySignature && !Object.hasOwn(broken.bodySignature, "bodyHash"), "broken[] should also omit bodyHash by default.");
    assert(report.compliance.bodyHashEnabled === false, "Compliance should record bodyHash disabled by default.");
    assert(report.options.protectionBodyHash === false, "Report options should record protectionBodyHash default false.");
  });
}

async function assertWafSignatureBodyHashOptIn() {
  await withServer((request, response) => {
    writeCloudflareLikeChallenge(response);
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/`, {
      allowLocalhost: true,
      preferGet: true,
      protectionBodyHash: true,
      retryCount: 0,
      requestDelayMs: 0,
      confirm404: false,
      robotsTxt: false,
    });

    await checker.checkUrl(`${origin}/missing`, { requireBody: false });
    const report = checker.buildReport();
    const checked = report.checked.find((item) => item.url === `${origin}/missing`);

    assert(typeof checked.bodySignature.bodyHash === "string", "bodyHash should be present when protectionBodyHash is enabled.");
    assert(checked.bodySignature.bodyHash.length === 64, "bodyHash should be a SHA-256 hex digest.");
    assert(report.compliance.bodyHashEnabled === true, "Compliance should record bodyHash opt-in.");
    assert(report.options.protectionBodyHash === true, "Report options should record protectionBodyHash opt-in.");
  });
}

async function main() {
  await assertWafSignatureSchemaDefaults();
  await assertWafSignatureBodyHashOptIn();
  console.log("ok p65b waf signature");
}

main().catch((error) => {
  console.error(`test-p65b-waf-signature: ${error.message}`);
  process.exitCode = 1;
});
