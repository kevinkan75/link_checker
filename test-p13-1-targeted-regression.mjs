#!/usr/bin/env node

import { AsyncLocalStorage } from "node:async_hooks";
import {
  buildResultRecord,
  createFetchRecorder,
  deriveRequestPath,
  deriveOutcome,
  getDecision,
  rate,
  summarizeResults,
  validateSample,
} from "./scripts/run-p13-1-targeted-regression.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sampleItem(id = "P13-1-001") {
  return {
    sampleId: id,
    sampleType: "positive",
    stratum: "UND_ERR_CONNECT_TIMEOUT",
    url: `https://example.test/site/sample/${id}`,
    baseline: {
      method: "HEAD",
      status: null,
      classification: "network_error",
      issueType: "network_error",
      causeCode: "UND_ERR_CONNECT_TIMEOUT",
      elapsedMs: 15000,
    },
    checks: {
      sameOrigin: true,
      pageLike: true,
      head: true,
      statusNull: true,
    },
  };
}

function result(overrides = {}) {
  return {
    ok: true,
    status: 200,
    method: "GET",
    classification: "ok",
    issueType: "ok",
    cause: null,
    finalUrl: "https://example.test/site/sample",
    redirected: false,
    redirectCount: 0,
    elapsedMs: 1000,
    attempts: 2,
    transportFallback: {
      activated: true,
      fromMethod: "HEAD",
      toMethod: "GET",
      triggerIssueType: "network_error",
      triggerCauseCode: "UND_ERR_CONNECT_TIMEOUT",
    },
    ...overrides,
  };
}

function assertOutcomeDerivation() {
  assert(deriveOutcome(result()).outcome === "recovered_ok", "GET 200 after fallback should be recovered_ok.");
  assert(deriveOutcome(result({ ok: false, status: 404, classification: "http_error", issueType: "not_found" })).outcome === "recovered_http_error", "GET HTTP error should be recovered_http_error.");
  assert(deriveOutcome(result({ ok: false, status: null, method: "GET", classification: "network_error", issueType: "timeout", cause: { code: "UND_ERR_CONNECT_TIMEOUT" } })).outcome === "still_transport_failure", "Final network error after fallback should be still_transport_failure.");
  const headRecovered = deriveOutcome(result({ ok: true, status: 200, method: "HEAD", attempts: 1, transportFallback: null }));
  assert(headRecovered.outcome === "fallback_not_activated", "HEAD direct recovery should not count as fallback recovery.");
  assert(headRecovered.headRecoveredWithoutFallback === true, "HEAD direct recovery should be tracked separately.");
  const httpFallback = deriveOutcome(result({ ok: true, status: 200, method: "GET", attempts: 1, transportFallback: null }));
  assert(httpFallback.outcome === "fallback_not_activated", "Existing HTTP-response fallback should not count as P13-1 transport fallback.");
  assert(httpFallback.headRecoveredWithoutFallback === false, "Existing HTTP-response fallback should not be labeled HEAD direct recovery.");
  assert(httpFallback.httpResponseWithoutTransportFallback === true, "Existing HTTP-response fallback still provides HTTP evidence.");
  assert(deriveOutcome(null, new Error("boom")).outcome === "validation_error", "Unexpected runtime error should be validation_error.");
}

function assertBudgetAndRates() {
  const ok = buildResultRecord(sampleItem("P13-1-001"), result(), {
    requestBudgetMax: 2,
    requestTrace: [
      { method: "HEAD", status: 403 },
      { method: "GET", status: 200 },
    ],
  });
  const violation = buildResultRecord(sampleItem("P13-1-002"), result({ attempts: 3 }), { requestBudgetMax: 2 });
  assert(ok.regression.requestBudgetCompliant === true, "Attempts equal to budget should comply.");
  assert(ok.regression.rawHttpRequests === 2, "One validation attempt may include two raw HTTP requests.");
  assert(ok.regression.requestPath === "transport_adaptive_fallback", "Transport metadata should drive transport path classification.");
  assert(violation.regression.requestBudgetCompliant === false, "Attempts above budget should violate.");
  assert(rate(1, 2) === 0.5, "Rate should divide numerator by denominator.");
  assert(rate(1, 0) === null, "Zero denominator should return null.");
}

function assertRequestPathDerivation() {
  const headSuccess = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: 200 }],
    finalResult: result({ method: "HEAD", status: 200, transportFallback: null }),
  });
  assert(headSuccess.requestPath === "head_success", "HEAD 200 should be head_success.");

  const headRedirectSuccess = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: 302 }, { method: "HEAD", status: 200 }],
    finalResult: result({ method: "HEAD", status: 200, transportFallback: null }),
  });
  assert(headRedirectSuccess.requestPath === "head_success", "HEAD redirect then 200 should be head_success.");

  const httpFallback = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: 403 }, { method: "GET", status: 200 }],
    finalResult: result({ method: "GET", status: 200, transportFallback: null }),
  });
  assert(httpFallback.requestPath === "http_response_fallback", "HEAD 403 -> GET 200 should be http_response_fallback.");

  const redirectHttpFallback = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: 302 }, { method: "HEAD", status: 404 }, { method: "GET", status: 200 }],
    finalResult: result({ method: "GET", status: 200, transportFallback: null }),
  });
  assert(redirectHttpFallback.requestPath === "http_response_fallback", "HEAD redirect -> HEAD 404 -> GET should be http_response_fallback.");

  const transportFallback = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: null, errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT" }, { method: "GET", status: 200 }],
    transportFallback: result().transportFallback,
    finalResult: result(),
  });
  assert(transportFallback.requestPath === "transport_adaptive_fallback", "HEAD transport error -> GET should be transport_adaptive_fallback.");
  assert(transportFallback.traceConsistency.ok === true, "Consistent transport trace should pass.");

  const directGet = deriveRequestPath({
    requestTrace: [{ method: "GET", status: 200 }],
    finalResult: result({ method: "GET", status: 200, transportFallback: null }),
    expectedHeadFirst: true,
  });
  assert(directGet.requestPath === "direct_get", "First GET should be direct_get.");
  assert(directGet.traceConsistency.ok === false, "First GET should warn when HEAD-first was expected.");

  const missingGet = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: null, errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT" }],
    transportFallback: result().transportFallback,
    finalResult: result(),
  });
  assert(missingGet.traceConsistency.ok === false, "Transport fallback metadata without GET should be inconsistent.");
  assert(missingGet.traceConsistency.warnings.includes("transport_fallback_activated_without_get"), "Missing GET warning should be present.");

  const finalGetNoTraceGet = deriveRequestPath({
    requestTrace: [{ method: "HEAD", status: 200 }],
    finalResult: result({ method: "GET", status: 200, transportFallback: null }),
  });
  assert(finalGetNoTraceGet.traceConsistency.ok === false, "finalMethod GET without GET trace should be inconsistent.");
}

function assertSummaryAndDecision() {
  const sample = {
    baselineReport: "synthetic-report.json",
    samples: [sampleItem("P13-1-001"), sampleItem("P13-1-002"), sampleItem("P13-1-003")],
  };
  const records = [
    buildResultRecord(sample.samples[0], result(), {
      requestBudgetMax: 2,
      requestTrace: [{ method: "HEAD", status: null, errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT" }, { method: "GET", status: 200 }],
    }),
    buildResultRecord(sample.samples[1], result({ ok: false, status: 404, classification: "http_error", issueType: "not_found" }), {
      requestBudgetMax: 2,
      requestTrace: [{ method: "HEAD", status: null, errorName: "TypeError", causeCode: "UND_ERR_CONNECT_TIMEOUT" }, { method: "GET", status: 404 }],
    }),
    buildResultRecord(sample.samples[2], result({ ok: true, status: 200, method: "HEAD", attempts: 1, transportFallback: null }), {
      requestBudgetMax: 2,
      requestTrace: [{ method: "HEAD", status: 200 }],
    }),
  ];
  const summary = summarizeResults(records, {
    sample,
    baselineReport: "synthetic-report.json",
    baselineSettings: { retryCount: 1 },
    regressionOptions: { retryCount: 1 },
    runStatus: "complete",
    startedAt: "2026-08-27T00:00:00.000Z",
    completedAt: "2026-08-27T00:00:01.000Z",
    sourceContext: {},
  });
  assert(summary.counts.fallbackActivated === 2, "Two records should activate fallback.");
  assert(summary.counts.headRecoveredWithoutFallback === 1, "HEAD spontaneous recovery should be separate.");
  assert(summary.requestPathCounts.transport_adaptive_fallback === 2, "Two records should be transport adaptive fallback.");
  assert(summary.requestPathCounts.head_success === 1, "One record should be head_success.");
  assert(summary.requestTrace.rawHttpRequestsDistribution["2"] === 2, "Two records should have two raw requests.");
  assert(summary.requestTrace.validationAttemptsDistribution["2"] === 2, "Two records should have two validation attempts.");
  assert(summary.rates.httpResponseRecoveryRate === 1, "Both activated records got HTTP responses.");
  assert(summary.rates.headRecoveredWithoutFallbackRate === 1 / 3, "HEAD recovery rate should use full sample denominator.");
  assert(summary.decision.result === "STRONG_SUPPORT", "100% HTTP response recovery should strongly support.");

  const noFallbackDecision = getDecision({
    runStatus: "complete",
    httpResponseRecoveryRate: null,
    requestBudgetViolations: 0,
    fallbackActivated: 0,
  });
  assert(noFallbackDecision.result === "NO_DECISION", "Zero activated fallback cases should not force a decision.");

  const partialDecision = getDecision({
    runStatus: "partial",
    httpResponseRecoveryRate: 1,
    requestBudgetViolations: 0,
    fallbackActivated: 1,
  });
  assert(partialDecision.result === "NO_DECISION", "Partial run should not produce final decision.");
}

async function assertFetchWrapperRestoresGlobalFetch() {
  const originalFetch = globalThis.fetch;
  const asyncLocalStorage = new AsyncLocalStorage();
  const recorder = createFetchRecorder(asyncLocalStorage);
  globalThis.fetch = async () => new Response("ok", { status: 200 });
  const stubFetch = globalThis.fetch;
  const recorderForStub = createFetchRecorder(asyncLocalStorage);
  recorderForStub.install();
  try {
    await asyncLocalStorage.run({ sampleId: "P13-1-001", sampleUrl: "https://example.test/site/sample" }, async () => {
      const response = await globalThis.fetch("https://example.test/site/sample", { method: "HEAD" });
      assert(response.status === 200, "Wrapper should return original fetch response.");
    });
    const trace = recorderForStub.traces.get("P13-1-001");
    assert(trace.length === 1, "Wrapper should record one request.");
    assert(trace[0].method === "HEAD" && trace[0].status === 200, "Wrapper should record method and status.");
  } finally {
    recorderForStub.restore();
    assert(globalThis.fetch === stubFetch, "Recorder should restore the fetch it wrapped.");
    globalThis.fetch = originalFetch;
    recorder.restore();
  }
  assert(globalThis.fetch === originalFetch, "Test should restore global fetch.");
}

function assertSampleValidation() {
  const valid = {
    samples: [
      sampleItem("P13-1-001"),
      {
        ...sampleItem("P13-1-002"),
        stratum: "ECONNRESET",
        baseline: {
          ...sampleItem("P13-1-002").baseline,
          causeCode: "ECONNRESET",
        },
      },
      {
        ...sampleItem("P13-1-003"),
        stratum: "ETIMEDOUT_OR_TIMEOUT",
        baseline: {
          ...sampleItem("P13-1-003").baseline,
          issueType: "timeout",
          causeCode: null,
        },
      },
    ],
  };
  assert(validateSample(valid).passed === true, "Expected synthetic transport-failure sample should validate.");
  const invalid = {
    samples: [sampleItem("P13-1-001"), { ...sampleItem("P13-1-002"), sampleType: "other" }],
  };
  assert(validateSample(invalid).passed === false, "Unsupported sample type should fail sample validation.");
  const invalidBaseline = {
    samples: [{
      ...sampleItem("P13-1-001"),
      baseline: {
        ...sampleItem("P13-1-001").baseline,
        classification: "ok",
        issueType: "ok",
      },
    }],
  };
  assert(validateSample(invalidBaseline).passed === false, "Non-transport baseline should fail sample validation.");
}

async function main() {
  assertOutcomeDerivation();
  assertBudgetAndRates();
  assertRequestPathDerivation();
  assertSummaryAndDecision();
  assertSampleValidation();
  await assertFetchWrapperRestoresGlobalFetch();
  console.log("ok p13-1 targeted regression");
}

main().catch((error) => {
  console.error(`test-p13-1-targeted-regression: ${error.message}`);
  process.exitCode = 1;
});
