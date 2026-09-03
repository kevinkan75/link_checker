#!/usr/bin/env node

import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function networkError(code, message = `${code} failure`) {
  const error = new TypeError(message);
  error.cause = {
    name: "Error",
    message,
    code,
  };
  return error;
}

async function withFetchScript(steps, task) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    const method = options.method || "GET";
    requests.push({ url: String(url), method });
    const step = steps.shift();
    if (!step) {
      throw new Error(`Unexpected ${method} request to ${url}`);
    }
    if (step.throw) {
      throw step.throw;
    }
    return new Response(step.body || "", { status: step.status ?? 200 });
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

async function assertCertificateDiagnosisSuggestsSystemCaWhenDisabled() {
  const origin = "http://127.0.0.1:13051";
  await withFetchScript([
    { throw: networkError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate") },
  ], async () => {
    const result = await checkStatus(makeChecker(origin, { systemCa: false }), `${origin}/page`);
    assert(result.classification === "network_error", "Certificate chain failure should remain a network error.");
    assert(result.issueType === "network_error", "Certificate chain failure should keep the existing issue type.");
    assert(
      result.diagnosis.includes("Node could not build a trusted certificate chain"),
      "Diagnosis should explain the trusted certificate chain failure.",
    );
    assert(
      result.diagnosis.includes("Retry with system CA enabled"),
      "Diagnosis should suggest system CA when the execution context has not enabled it.",
    );
  });
}

async function assertCertificateDiagnosisDoesNotLoopWhenSystemCaEnabled() {
  const origin = "http://127.0.0.1:13052";
  await withFetchScript([
    { throw: networkError("UNABLE_TO_VERIFY_LEAF_SIGNATURE", "unable to verify the first certificate") },
  ], async () => {
    const checker = makeChecker(origin, { systemCa: false });
    checker.options.systemCa = true;
    const result = await checkStatus(checker, `${origin}/page`);
    assert(result.classification === "network_error", "Certificate chain failure should remain a network error.");
    assert(
      result.diagnosis.includes("system CA mode was enabled"),
      "Diagnosis should acknowledge that system CA mode was already enabled.",
    );
    assert(
      !result.diagnosis.includes("Retry with system CA enabled"),
      "Diagnosis should not repeat the enable-system-CA recommendation.",
    );
    assert(result.diagnosis.includes("browser or curl"), "Diagnosis should recommend external confirmation.");
    assert(result.diagnosis.includes("certificate chain"), "Diagnosis should mention certificate-chain review.");
    assert(
      result.diagnosis.includes("local network trust environment"),
      "Diagnosis should mention the local trust or network environment.",
    );
  });
}

async function assertNonCertificateDiagnosisIsUnchanged() {
  const origin = "http://127.0.0.1:13053";
  await withFetchScript([
    { throw: networkError("ENOTFOUND") },
  ], async () => {
    const result = await checkStatus(makeChecker(origin, { systemCa: true }), `${origin}/page`);
    assert(result.classification === "network_error", "DNS failure should remain a network error.");
    assert(
      result.diagnosis === "Domain name could not be resolved.",
      "DNS diagnosis should not change when system CA mode is enabled.",
    );
  });
}

async function main() {
  await assertCertificateDiagnosisSuggestsSystemCaWhenDisabled();
  await assertCertificateDiagnosisDoesNotLoopWhenSystemCaEnabled();
  await assertNonCertificateDiagnosisIsUnchanged();
  console.log("ok m2 tls diagnosis");
}

main().catch((error) => {
  console.error(`test-m2-tls-diagnosis: ${error.message}`);
  process.exitCode = 1;
});
