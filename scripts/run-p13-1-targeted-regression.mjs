#!/usr/bin/env node

import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { LinkChecker } from "../link-checker.mjs";

const OUTCOMES = [
  "recovered_ok",
  "recovered_http_error",
  "still_transport_failure",
  "fallback_not_activated",
  "validation_error",
];

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function average(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  if (numbers.length === 0) {
    return null;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function median(values) {
  const numbers = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (numbers.length === 0) {
    return null;
  }
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2 === 1) {
    return numbers[middle];
  }
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function rate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function percent(value) {
  if (!Number.isFinite(value)) {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function increment(map, key) {
  map[key] = (map[key] || 0) + 1;
}

function countBy(items, selector) {
  const counts = {};
  for (const item of items) {
    increment(counts, selector(item) || "unknown");
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function getBaselineSettings(report) {
  const options = report.options || {};
  return {
    timeoutMs: options.timeoutMs,
    retryCount: options.retryCount,
    concurrency: options.concurrency,
    perHostConcurrency: options.perHostConcurrency,
    requestDelayMs: options.requestDelayMs,
    requestDelayMinMs: options.requestDelayMinMs,
    requestDelayMaxMs: options.requestDelayMaxMs,
    preferGet: options.preferGet,
    externalReferer: options.externalReferer,
    userAgent: options.userAgent,
    acceptLanguage: options.acceptLanguage,
    keepAlive: options.keepAlive,
    maxRedirects: options.maxRedirects,
    longRedirectThreshold: options.longRedirectThreshold,
    retryAfterMaxMs: options.retryAfterMaxMs,
    legacyTls: options.legacyTls,
    systemCa: options.systemCa,
    blockPrivateIp: options.blockPrivateIp,
    allowLocalhost: options.allowLocalhost,
    allowPrivateIp: options.allowPrivateIp,
    confirm404: options.confirm404,
  };
}

function buildRegressionOptions(baselineReport) {
  const options = baselineReport.options || {};
  return {
    timeoutMs: options.timeoutMs,
    retryCount: options.retryCount,
    concurrency: options.concurrency,
    perHostConcurrency: options.perHostConcurrency,
    requestDelayMs: options.requestDelayMs,
    requestDelayMinMs: options.requestDelayMinMs,
    requestDelayMaxMs: options.requestDelayMaxMs,
    preferGet: options.preferGet,
    externalReferer: options.externalReferer,
    userAgent: options.userAgent,
    acceptLanguage: options.acceptLanguage,
    keepAlive: options.keepAlive,
    maxRedirects: options.maxRedirects,
    longRedirectThreshold: options.longRedirectThreshold,
    retryAfterMaxMs: options.retryAfterMaxMs,
    legacyTls: options.legacyTls,
    systemCa: options.systemCa,
    blockPrivateIp: options.blockPrivateIp,
    allowLocalhost: options.allowLocalhost,
    allowPrivateIp: options.allowPrivateIp,
    cache: false,
    refreshCache: true,
    incremental: false,
    changedOnly: false,
    robotsTxt: false,
  };
}

function validateSample(sample) {
  const samples = Array.isArray(sample.samples) ? sample.samples : [];
  const urls = new Set();
  const errors = [];
  if (samples.length === 0) {
    errors.push("sample has no URLs");
  }
  for (const item of samples) {
    if (urls.has(item.url)) {
      errors.push(`duplicate URL ${item.url}`);
    }
    urls.add(item.url);
    if (!["positive", "negative_control"].includes(item.sampleType)) {
      errors.push(`${item.sampleId} sampleType is not supported`);
    }
    if (!item.stratum) {
      errors.push(`${item.sampleId} has no stratum`);
    }
    if (item.baseline?.method !== "HEAD") {
      errors.push(`${item.sampleId} baseline method is not HEAD`);
    }
    if (item.baseline?.status !== null) {
      errors.push(`${item.sampleId} baseline status is not null`);
    }
    if (
      item.baseline?.classification !== "network_error"
      && item.baseline?.issueType !== "timeout"
      && item.baseline?.issueType !== "network_error"
    ) {
      errors.push(`${item.sampleId} baseline is not a transport failure`);
    }
    if (item.checks?.sameOrigin !== true || item.checks?.pageLike !== true) {
      errors.push(`${item.sampleId} is not same-origin page-like`);
    }
  }
  return {
    passed: errors.length === 0,
    errors,
  };
}

function getBaselineTriggerKey(item) {
  return item?.baseline?.causeCode || item?.baseline?.issueType || item?.baseline?.classification || "unknown";
}

function deriveOutcome(result, error = null) {
  if (error) {
    return {
      outcome: "validation_error",
      headRecoveredWithoutFallback: false,
    };
  }

  const fallbackActivated = result?.transportFallback?.activated === true;
  if (!fallbackActivated) {
    return {
      outcome: "fallback_not_activated",
      headRecoveredWithoutFallback: result?.status != null && result.method === "HEAD",
      httpResponseWithoutTransportFallback: result?.status != null,
    };
  }

  if (result.status != null && result.ok === true) {
    return {
      outcome: "recovered_ok",
      headRecoveredWithoutFallback: false,
      httpResponseWithoutTransportFallback: false,
    };
  }
  if (result.status != null) {
    return {
      outcome: "recovered_http_error",
      headRecoveredWithoutFallback: false,
      httpResponseWithoutTransportFallback: false,
    };
  }
  if (result.classification === "network_error" || result.issueType === "timeout" || result.issueType === "network_error") {
    return {
      outcome: "still_transport_failure",
      headRecoveredWithoutFallback: false,
      httpResponseWithoutTransportFallback: false,
    };
  }
  return {
    outcome: "validation_error",
    headRecoveredWithoutFallback: false,
    httpResponseWithoutTransportFallback: false,
  };
}

function buildResultRecord(sample, result, { requestBudgetMax, error = null, requestTrace = [] } = {}) {
  const outcomeInfo = deriveOutcome(result, error);
  const validationAttempts = error ? null : numberOrNull(result?.attempts);
  const requestBudgetCompliant = Number.isFinite(validationAttempts)
    ? validationAttempts <= requestBudgetMax
    : false;
  const requestPath = deriveRequestPath({
    requestTrace,
    transportFallback: result?.transportFallback || null,
    finalResult: result || null,
    expectedHeadFirst: true,
  });
  return {
    sampleId: sample.sampleId,
    url: sample.url,
    baseline: {
      method: sample.baseline?.method || null,
      status: sample.baseline?.status ?? null,
      classification: sample.baseline?.classification || null,
      issueType: sample.baseline?.issueType || null,
      causeCode: sample.baseline?.causeCode || null,
      elapsedMs: sample.baseline?.elapsedMs ?? null,
    },
    regression: {
      fallbackActivated: result?.transportFallback?.activated === true,
      triggerIssueType: result?.transportFallback?.triggerIssueType || null,
      triggerCauseCode: result?.transportFallback?.triggerCauseCode || null,
      validationAttempts,
      requestBudgetMax,
      requestBudgetCompliant,
      finalMethod: result?.method || null,
      finalStatus: result?.status ?? null,
      finalClassification: result?.classification || null,
      finalIssueType: result?.issueType || null,
      finalCauseCode: result?.cause?.code || null,
      finalUrl: result?.finalUrl || null,
      redirected: result?.redirected === true,
      redirectCount: result?.redirectCount ?? null,
      elapsedMs: result?.elapsedMs ?? null,
      error: error ? String(error.message || error) : null,
      rawHttpRequests: requestTrace.length,
      requestPath: requestPath.requestPath,
      traceConsistency: requestPath.traceConsistency,
      firstRequestMethod: requestTrace[0]?.method || null,
      firstRequestStatus: requestTrace[0]?.status ?? null,
      firstRequestError: requestTrace[0]?.errorName || null,
      firstRequestCauseCode: requestTrace[0]?.causeCode || null,
      headResponseStatuses: requestTrace
        .filter((item) => item.method === "HEAD" && item.status != null)
        .map((item) => item.status),
      getResponseStatuses: requestTrace
        .filter((item) => item.method === "GET" && item.status != null)
        .map((item) => item.status),
    },
    requestTrace,
    confirmation: {
      executed: false,
      status: null,
      outcome: null,
      attempts: null,
    },
    headRecoveredWithoutFallback: outcomeInfo.headRecoveredWithoutFallback,
    httpResponseWithoutTransportFallback: outcomeInfo.httpResponseWithoutTransportFallback === true,
    outcome: outcomeInfo.outcome,
  };
}

function deriveRequestPath({ requestTrace = [], transportFallback = null, finalResult = null, expectedHeadFirst = false } = {}) {
  const warnings = [];
  const first = requestTrace[0] || null;
  const firstGetIndex = requestTrace.findIndex((item) => item.method === "GET");
  const hasGet = firstGetIndex !== -1;
  const hasHead = requestTrace.some((item) => item.method === "HEAD");
  const headBeforeGet = requestTrace.filter((item, index) => item.method === "HEAD" && (firstGetIndex === -1 || index < firstGetIndex));
  const headTransportFailureBeforeGet = headBeforeGet.some((item) => item.status == null && (item.errorName || item.causeCode));
  const headHttpResponseBeforeGet = headBeforeGet.some((item) => item.status != null);
  const transportActivated = transportFallback?.activated === true;

  if (requestTrace.length === 0) {
    warnings.push("request_trace_empty");
  }
  if (transportActivated && !headTransportFailureBeforeGet) {
    warnings.push("transport_fallback_activated_without_head_transport_failure");
  }
  if (transportActivated && !hasGet) {
    warnings.push("transport_fallback_activated_without_get");
  }
  if (finalResult?.method === "GET" && !hasGet) {
    warnings.push("final_method_get_but_trace_has_no_get");
  }
  if (finalResult?.method === "HEAD" && hasGet) {
    warnings.push("final_method_head_but_trace_contains_get");
  }
  if (first?.method === "GET" && expectedHeadFirst) {
    warnings.push("first_request_get_but_expected_head_first");
  }

  let requestPath = "other";
  if (first?.method === "GET") {
    requestPath = "direct_get";
  } else if (transportActivated) {
    requestPath = "transport_adaptive_fallback";
  } else if (first?.method === "HEAD" && !hasGet && finalResult?.status != null) {
    requestPath = "head_success";
  } else if (first?.method === "HEAD" && hasGet && headHttpResponseBeforeGet && !headTransportFailureBeforeGet) {
    requestPath = "http_response_fallback";
  }

  return {
    requestPath,
    traceConsistency: {
      ok: warnings.length === 0,
      warnings,
    },
  };
}

function summarizeResults(records, { sample, baselineReport, baselineSettings, regressionOptions, runStatus = "complete", startedAt, completedAt, sourceContext }) {
  const counts = Object.fromEntries(OUTCOMES.map((item) => [item, 0]));
  for (const record of records) {
    increment(counts, record.outcome);
  }

  const fallbackActivated = records.filter((item) => item.regression.fallbackActivated).length;
  const recoveredOk = counts.recovered_ok || 0;
  const recoveredHttpError = counts.recovered_http_error || 0;
  const stillTransportFailure = counts.still_transport_failure || 0;
  const headRecoveredWithoutFallback = records.filter((item) => item.headRecoveredWithoutFallback).length;
  const httpResponseWithoutTransportFallback = records.filter((item) => item.httpResponseWithoutTransportFallback).length;
  const requestBudgetViolations = records.filter((item) => item.regression.requestBudgetCompliant !== true).length;
  const validationAttempts = records
    .map((item) => item.regression.validationAttempts)
    .filter(Number.isFinite);
  const rawHttpRequests = records
    .map((item) => item.regression.rawHttpRequests)
    .filter(Number.isFinite);
  const traceConsistencyErrors = records.filter((item) => item.regression.traceConsistency?.ok !== true).length;
  const configuredMaxValidationAttempts = (baselineSettings.retryCount ?? regressionOptions.retryCount ?? 0) + 1;
  const httpResponseRecoveryRate = rate(recoveredOk + recoveredHttpError, fallbackActivated);
  const okRecoveryRate = rate(recoveredOk, fallbackActivated);
  const stillFailureRate = rate(stillTransportFailure, fallbackActivated);
  const headSpontaneousRecoveryRate = rate(headRecoveredWithoutFallback, records.length);
  const decision = getDecision({
    runStatus,
    httpResponseRecoveryRate,
    requestBudgetViolations,
    fallbackActivated,
  });

  return {
    runStatus,
    startedAt,
    completedAt,
    sampleInput: sample.baselineReport || null,
    baselineReport,
    sampleSize: records.length,
    completedSamples: records.length,
    pendingSamples: Math.max(0, (sample.samples?.length || 0) - records.length),
    baselineTriggerDistribution: countBy(sample.samples || [], getBaselineTriggerKey),
    baselineSettings,
    regressionSettings: {
      ...regressionOptions,
      cacheBypassedForRegression: true,
      incrementalBypassedForRegression: true,
      fullCrawlExecuted: false,
      formalConfirmationExecuted: false,
    },
    sourceContext,
    counts: {
      fallbackActivated,
      headRecoveredWithoutFallback,
      recoveredOk,
      recoveredHttpError,
      stillTransportFailure,
      fallbackNotActivated: counts.fallback_not_activated || 0,
      httpResponseWithoutTransportFallback,
      validationError: counts.validation_error || 0,
      requestBudgetViolations,
    },
    requestPathCounts: {
      head_success: 0,
      http_response_fallback: 0,
      transport_adaptive_fallback: 0,
      direct_get: 0,
      other: 0,
      ...countBy(records, (item) => item.regression.requestPath),
    },
    requestTrace: {
      traceConsistencyErrors,
      firstRequestMethodDistribution: countBy(records, (item) => item.regression.firstRequestMethod),
      finalMethodDistribution: countBy(records, (item) => item.regression.finalMethod),
      finalStatusDistribution: countBy(records, (item) => String(item.regression.finalStatus ?? "null")),
      validationAttemptsDistribution: countBy(records, (item) => String(item.regression.validationAttempts ?? "null")),
      rawHttpRequestsDistribution: countBy(records, (item) => String(item.regression.rawHttpRequests ?? "null")),
      headFirstResponseStatusDistribution: countBy(records, (item) => {
        const firstHeadResponse = item.requestTrace.find((request) => request.method === "HEAD" && request.status != null);
        return String(firstHeadResponse?.status ?? "none");
      }),
      headTransportFailures: records.filter((item) => item.requestTrace.some((request) => request.method === "HEAD" && request.status == null && (request.errorName || request.causeCode))).length,
    },
    rates: {
      httpResponseRecoveryRate,
      okRecoveryRate,
      stillTransportFailureRate: stillFailureRate,
      headRecoveredWithoutFallbackRate: headSpontaneousRecoveryRate,
    },
    requestBudget: {
      configuredMaxValidationAttempts,
      maxValidationAttemptsObserved: validationAttempts.length ? Math.max(...validationAttempts) : null,
      violations: requestBudgetViolations,
      compliant: requestBudgetViolations === 0,
    },
    rawHttpRequests: {
      average: average(rawHttpRequests),
      median: median(rawHttpRequests),
      max: rawHttpRequests.length ? Math.max(...rawHttpRequests) : null,
    },
    elapsedMs: {
      baselineAverage: average(records.map((item) => item.baseline.elapsedMs)),
      baselineMedian: median(records.map((item) => item.baseline.elapsedMs)),
      regressionAverage: average(records.map((item) => item.regression.elapsedMs)),
      regressionMedian: median(records.map((item) => item.regression.elapsedMs)),
      fallbackActivatedAverage: average(records.filter((item) => item.regression.fallbackActivated).map((item) => item.regression.elapsedMs)),
      fallbackActivatedMedian: median(records.filter((item) => item.regression.fallbackActivated).map((item) => item.regression.elapsedMs)),
      recoveredAverage: average(records.filter((item) => item.outcome === "recovered_ok" || item.outcome === "recovered_http_error").map((item) => item.regression.elapsedMs)),
      recoveredMedian: median(records.filter((item) => item.outcome === "recovered_ok" || item.outcome === "recovered_http_error").map((item) => item.regression.elapsedMs)),
      stillFailureAverage: average(records.filter((item) => item.outcome === "still_transport_failure").map((item) => item.regression.elapsedMs)),
      stillFailureMedian: median(records.filter((item) => item.outcome === "still_transport_failure").map((item) => item.regression.elapsedMs)),
    },
    decision,
  };
}

function getDecision({ runStatus, httpResponseRecoveryRate, requestBudgetViolations, fallbackActivated }) {
  if (runStatus !== "complete") {
    return {
      result: "NO_DECISION",
      reason: "partial_run",
    };
  }
  if (fallbackActivated <= 0 || httpResponseRecoveryRate === null) {
    return {
      result: "NO_DECISION",
      reason: "no_fallback_activated",
    };
  }
  if (requestBudgetViolations > 0) {
    return {
      result: "WEAK_SUPPORT",
      reason: "request_budget_violation",
    };
  }
  if (httpResponseRecoveryRate >= 0.3) {
    return {
      result: "STRONG_SUPPORT",
      reason: "http_response_recovery_rate_at_least_30_percent",
    };
  }
  if (httpResponseRecoveryRate >= 0.1) {
    return {
      result: "PARTIAL_SUPPORT",
      reason: "http_response_recovery_rate_between_10_and_30_percent",
    };
  }
  return {
    result: "WEAK_SUPPORT",
    reason: "http_response_recovery_rate_below_10_percent",
  };
}

function toCsv(records) {
  const headers = [
    "sample_id",
    "url",
    "baseline_method",
    "baseline_issue_type",
    "baseline_cause_code",
    "baseline_elapsed_ms",
    "fallback_activated",
    "trigger_issue_type",
    "trigger_cause_code",
    "validation_attempts",
    "request_budget_max",
    "request_budget_compliant",
    "final_method",
    "final_status",
    "final_classification",
    "final_issue_type",
    "final_cause_code",
    "final_url",
    "head_recovered_without_fallback",
    "http_response_without_transport_fallback",
    "outcome",
    "elapsed_ms",
    "confirmation_executed",
    "confirmation_status",
    "confirmation_outcome",
    "request_path",
    "raw_http_requests",
    "first_request_method",
    "first_request_status",
    "first_request_error",
    "first_request_cause_code",
    "head_response_statuses",
    "get_response_statuses",
    "trace_consistency_ok",
    "trace_warnings",
  ];
  const rows = records.map((item) => [
    item.sampleId,
    item.url,
    item.baseline.method,
    item.baseline.issueType,
    item.baseline.causeCode,
    item.baseline.elapsedMs,
    item.regression.fallbackActivated,
    item.regression.triggerIssueType,
    item.regression.triggerCauseCode,
    item.regression.validationAttempts,
    item.regression.requestBudgetMax,
    item.regression.requestBudgetCompliant,
    item.regression.finalMethod,
    item.regression.finalStatus,
    item.regression.finalClassification,
    item.regression.finalIssueType,
    item.regression.finalCauseCode,
    item.regression.finalUrl,
    item.headRecoveredWithoutFallback,
    item.httpResponseWithoutTransportFallback,
    item.outcome,
    item.regression.elapsedMs,
    item.confirmation.executed,
    item.confirmation.status,
    item.confirmation.outcome,
    item.regression.requestPath,
    item.regression.rawHttpRequests,
    item.regression.firstRequestMethod,
    item.regression.firstRequestStatus,
    item.regression.firstRequestError,
    item.regression.firstRequestCauseCode,
    item.regression.headResponseStatuses.join("|"),
    item.regression.getResponseStatuses.join("|"),
    item.regression.traceConsistency.ok,
    item.regression.traceConsistency.warnings.join("|"),
  ]);
  return `${[headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}\n`;
}

function toMarkdown(summary) {
  const rates = summary.rates;
  return `# P13-1 Targeted Regression

## Baseline
- source report: ${summary.baselineReport}
- sample size: ${summary.sampleSize}
- baseline trigger distribution: ${JSON.stringify(summary.baselineTriggerDistribution)}

## Regression Settings
- timeoutMs: ${summary.baselineSettings.timeoutMs}
- retryCount: ${summary.baselineSettings.retryCount}
- concurrency: ${summary.baselineSettings.concurrency}
- perHostConcurrency: ${summary.baselineSettings.perHostConcurrency}
- requestDelayMs: ${summary.baselineSettings.requestDelayMs}
- requestDelayMinMs: ${summary.baselineSettings.requestDelayMinMs}
- requestDelayMaxMs: ${summary.baselineSettings.requestDelayMaxMs}
- preferGet: ${summary.baselineSettings.preferGet}
- externalReferer: ${summary.baselineSettings.externalReferer}
- cacheBypassedForRegression: true
- fullCrawlExecuted: false
- formalConfirmationExecuted: false

## Results
- fallback activated: ${summary.counts.fallbackActivated}
- HEAD recovered without fallback: ${summary.counts.headRecoveredWithoutFallback}
- recovered OK: ${summary.counts.recoveredOk}
- recovered HTTP error: ${summary.counts.recoveredHttpError}
- still transport failure: ${summary.counts.stillTransportFailure}
- fallback not activated: ${summary.counts.fallbackNotActivated}
- HTTP response without transport fallback: ${summary.counts.httpResponseWithoutTransportFallback}
- validation error: ${summary.counts.validationError}
- request budget violations: ${summary.counts.requestBudgetViolations}

## Rates
- HTTP response recovery: ${percent(rates.httpResponseRecoveryRate)}
- OK recovery: ${percent(rates.okRecoveryRate)}
- still transport failure: ${percent(rates.stillTransportFailureRate)}
- HEAD spontaneous recovery: ${percent(rates.headRecoveredWithoutFallbackRate)}

## Request-path Analysis
- head_success: ${summary.requestPathCounts.head_success}
- http_response_fallback: ${summary.requestPathCounts.http_response_fallback}
- transport_adaptive_fallback: ${summary.requestPathCounts.transport_adaptive_fallback}
- direct_get: ${summary.requestPathCounts.direct_get}
- other: ${summary.requestPathCounts.other}
- trace consistency errors: ${summary.requestTrace.traceConsistencyErrors}

## Raw Request Behavior
- average raw HTTP requests: ${summary.rawHttpRequests.average ?? "N/A"}
- median raw HTTP requests: ${summary.rawHttpRequests.median ?? "N/A"}
- max raw HTTP requests: ${summary.rawHttpRequests.max ?? "N/A"}
- validationAttempts distribution: ${JSON.stringify(summary.requestTrace.validationAttemptsDistribution)}
- rawHttpRequests distribution: ${JSON.stringify(summary.requestTrace.rawHttpRequestsDistribution)}

## Decision
- ${summary.decision.result}
- reason: ${summary.decision.reason}

## Interpretation
This result only applies to this targeted sample. It evaluates whether the sampled transport trigger should remain in the P13-1 adaptive HEAD -> GET switch predicate without changing the request budget.
`;
}

function getFetchMethod(input, init = {}) {
  return String(init?.method || input?.method || "GET").toUpperCase();
}

function getFetchUrl(input) {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input?.url ? String(input.url) : String(input);
}

function getErrorCauseCode(error) {
  return error?.cause?.code || error?.code || null;
}

function createFetchRecorder(asyncLocalStorage) {
  const originalFetch = globalThis.fetch;
  const traces = new Map();
  const getTrace = (sampleId) => {
    if (!traces.has(sampleId)) {
      traces.set(sampleId, []);
    }
    return traces.get(sampleId);
  };

  const wrapper = async (input, init = {}) => {
    const context = asyncLocalStorage.getStore();
    if (!context?.sampleId) {
      return originalFetch(input, init);
    }

    const trace = getTrace(context.sampleId);
    const record = {
      sampleId: context.sampleId,
      sampleUrl: context.sampleUrl || null,
      requestIndex: trace.length + 1,
      method: getFetchMethod(input, init),
      url: getFetchUrl(input),
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: null,
      ok: null,
      errorName: null,
      errorMessage: null,
      causeCode: null,
      elapsedMs: null,
    };
    const started = performance.now();
    trace.push(record);

    try {
      const response = await originalFetch(input, init);
      record.finishedAt = new Date().toISOString();
      record.status = response.status ?? null;
      record.ok = response.ok ?? null;
      record.elapsedMs = Math.round(performance.now() - started);
      return response;
    } catch (error) {
      record.finishedAt = new Date().toISOString();
      record.errorName = error?.name || null;
      record.errorMessage = error?.message || null;
      record.causeCode = getErrorCauseCode(error);
      record.elapsedMs = Math.round(performance.now() - started);
      throw error;
    }
  };

  return {
    traces,
    install: () => {
      globalThis.fetch = wrapper;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function bindSchedulerContext(scheduler, asyncLocalStorage) {
  const originalRun = scheduler.run.bind(scheduler);
  scheduler.run = (requestUrl, task) => {
    const context = asyncLocalStorage.getStore();
    if (!context?.sampleId) {
      return originalRun(requestUrl, task);
    }
    return originalRun(requestUrl, () => asyncLocalStorage.run(context, task));
  };
  return () => {
    scheduler.run = originalRun;
  };
}

async function writeOutputs({ records, summary }, outputDir) {
  await mkdir(outputDir, { recursive: true });
  const resultsJsonPath = path.join(outputDir, "regression-results.json");
  const resultsCsvPath = path.join(outputDir, "regression-results.csv");
  const summaryJsonPath = path.join(outputDir, "regression-summary.json");
  const summaryMdPath = path.join(outputDir, "regression-summary.md");
  await writeFile(resultsJsonPath, `${JSON.stringify({ results: records }, null, 2)}\n`, "utf8");
  await writeFile(resultsCsvPath, toCsv(records), "utf8");
  await writeFile(summaryJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(summaryMdPath, toMarkdown(summary), "utf8");
  return {
    resultsJsonPath,
    resultsCsvPath,
    summaryJsonPath,
    summaryMdPath,
  };
}

async function runRegression({ samplePath, baselinePath, outputDir }) {
  const sample = JSON.parse(await readFile(samplePath, "utf8"));
  const baselineReport = JSON.parse(await readFile(baselinePath, "utf8"));
  const sampleValidation = validateSample(sample);
  if (!sampleValidation.passed) {
    throw new Error(`Sample validation failed: ${sampleValidation.errors.join("; ")}`);
  }

  const baselineSettings = getBaselineSettings(baselineReport);
  const regressionOptions = buildRegressionOptions(baselineReport);
  const requestBudgetMax = (regressionOptions.retryCount ?? 0) + 1;
  const checker = new LinkChecker(sample.startUrl || baselineReport.startUrl, regressionOptions);
  const asyncLocalStorage = new AsyncLocalStorage();
  const fetchRecorder = createFetchRecorder(asyncLocalStorage);
  const restoreHostScheduler = bindSchedulerContext(checker.hostScheduler, asyncLocalStorage);
  const restoreConfirmationScheduler = bindSchedulerContext(checker.confirmationScheduler, asyncLocalStorage);
  const records = [];
  let interrupted = false;
  const sourceContext = {
    baselineCheckedSourcesAvailable: false,
    reconstructedSources: 0,
    note: "Baseline checked[] records do not include source page evidence; targeted validation uses production path with no reconstructed source Referer.",
  };
  const onSigint = () => {
    interrupted = true;
    checker.stop("stopped_by_user");
  };
  process.once("SIGINT", onSigint);
  const startedAt = new Date().toISOString();

  const runSample = async (item) => {
    if (interrupted) {
      return null;
    }
    return asyncLocalStorage.run({ sampleId: item.sampleId, sampleUrl: item.url }, async () => {
      try {
        const result = await checker.checkUrl(item.url, { requireBody: false });
        return buildResultRecord(item, result, {
          requestBudgetMax,
          requestTrace: fetchRecorder.traces.get(item.sampleId) || [],
        });
      } catch (error) {
        return buildResultRecord(item, null, {
          requestBudgetMax,
          error,
          requestTrace: fetchRecorder.traces.get(item.sampleId) || [],
        });
      }
    });
  };

  try {
    fetchRecorder.install();
    const settledRecords = await Promise.all(sample.samples.map((item) => runSample(item)));
    for (const record of settledRecords) {
      if (record) {
        records.push(record);
      }
    }
  } finally {
    fetchRecorder.restore();
    restoreHostScheduler();
    restoreConfirmationScheduler();
    process.removeListener("SIGINT", onSigint);
  }

  const completedAt = new Date().toISOString();
  const runStatus = interrupted || records.length < sample.samples.length ? "partial" : "complete";
  const summary = summarizeResults(records, {
    sample,
    baselineReport: path.resolve(baselinePath),
    baselineSettings,
    regressionOptions,
    runStatus,
    startedAt,
    completedAt,
    sourceContext,
  });
  const outputs = await writeOutputs({ records, summary }, outputDir);
  return { records, summary, outputs };
}

async function main() {
  const samplePath = process.argv[2];
  const outputDir = process.argv[3] || "logs/p13-1-targeted-regression";
  if (!samplePath) {
    throw new Error("Usage: node scripts/run-p13-1-targeted-regression.mjs <sample.json> [output-dir]");
  }
  const sample = JSON.parse(await readFile(samplePath, "utf8"));
  if (!sample.baselineReport) {
    throw new Error("Sample JSON must include baselineReport.");
  }
  const baselinePath = sample.baselineReport;
  const result = await runRegression({
    samplePath,
    baselinePath,
    outputDir,
  });
  console.log(JSON.stringify({
    runStatus: result.summary.runStatus,
    sampleSize: result.summary.sampleSize,
    counts: result.summary.counts,
    rates: result.summary.rates,
    requestBudget: result.summary.requestBudget,
    requestPathCounts: result.summary.requestPathCounts,
    requestTrace: result.summary.requestTrace,
    rawHttpRequests: result.summary.rawHttpRequests,
    elapsedMs: result.summary.elapsedMs,
    decision: result.summary.decision,
    outputs: result.outputs,
  }, null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
  main().catch((error) => {
    console.error(`run-p13-1-targeted-regression: ${error.message}`);
    process.exitCode = 1;
  });
}

export {
  buildResultRecord,
  createFetchRecorder,
  deriveRequestPath,
  deriveOutcome,
  getDecision,
  rate,
  runRegression,
  summarizeResults,
  validateSample,
};
