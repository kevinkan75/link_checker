#!/usr/bin/env node

import { readFileSync } from "node:fs";
import {
  LinkChecker,
  REPORT_SCHEMA_VERSION,
  deriveCoverageStatus,
} from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(list, value, message) {
  assert(Array.isArray(list) && list.includes(value), message);
}

function assertExcludes(list, value, message) {
  assert(!Array.isArray(list) || !list.includes(value), message);
}

function makeRunStatus(overrides = {}) {
  return {
    status: "complete",
    startedAt: "2026-08-27T00:00:00.000Z",
    completedAt: "2026-08-27T00:00:01.000Z",
    stoppedByUser: false,
    pendingPages: 0,
    pendingValidations: 0,
    activeValidationTasks: 0,
    ...overrides,
  };
}

function makeSummary(overrides = {}) {
  return {
    pagesCrawled: 3,
    urlsChecked: 5,
    scanQuality: {
      status: "ok",
      warnings: [],
    },
    incremental: {
      sitemap: {
        enabled: false,
        urlCount: 0,
        seed: {
          seeded: 0,
          ignoredByReason: {},
        },
      },
    },
    discoveryFallback: {
      xmlSitemap: {
        reason: null,
        urlsDiscovered: 0,
        urlsSeeded: 0,
      },
      htmlSitemap: {
        reason: null,
      },
    },
    ...overrides,
  };
}

function derive({ runStatus = makeRunStatus(), summary = makeSummary(), options = { maxPages: 10 } } = {}) {
  return deriveCoverageStatus({ runStatus, summary, options });
}

function assertFullyComplete() {
  const coverage = derive();
  assert(coverage.status === "complete", "Complete report should have complete coverage.");
  assert(coverage.incomplete === false, "Complete report should not be incomplete.");
  assert(coverage.reasons.length === 0, "Complete report should not have coverage reasons.");
}

function assertUserStoppedWithPendingValidation() {
  const coverage = derive({
    runStatus: makeRunStatus({
      status: "partial",
      stoppedByUser: true,
      stopReason: "stopped_by_user",
      pendingValidations: 4,
    }),
  });

  assert(coverage.status === "incomplete", "Stopped report should have incomplete coverage.");
  assertIncludes(coverage.reasons, "stopped_by_user", "Stopped report should include stopped_by_user.");
  assertIncludes(coverage.reasons, "validation_incomplete", "Stopped report with pending validation should include validation_incomplete.");
  assert(coverage.validation.incomplete === true, "Stopped report should mark validation incomplete.");
}

function assertValidationIncompleteWithoutUserStop() {
  const coverage = derive({
    runStatus: makeRunStatus({
      status: "partial",
      pendingValidations: 2,
      activeValidationTasks: 1,
    }),
  });

  assertIncludes(coverage.reasons, "validation_incomplete", "Partial report with pending validation should include validation_incomplete.");
  assertExcludes(coverage.reasons, "stopped_by_user", "Partial report without user stop should not include stopped_by_user.");
}

function assertSitemapSeedTruncatedOnCompleteRun() {
  const coverage = derive({
    runStatus: makeRunStatus(),
    options: { maxPages: 3 },
    summary: makeSummary({
      pagesCrawled: 3,
      incremental: {
        sitemap: {
          enabled: true,
          urlCount: 12,
          seed: {
            seeded: 3,
            ignoredByReason: {
              max_pages: 9,
            },
          },
        },
      },
    }),
  });

  assert(coverage.status === "incomplete", "Complete run with sitemap seed truncation should have incomplete coverage.");
  assertIncludes(coverage.reasons, "sitemap_seed_truncated", "Sitemap discovered > seeded should include sitemap_seed_truncated.");
  assertIncludes(coverage.reasons, "max_pages_reached", "Sitemap seed truncation at maxPages should include max_pages_reached.");
  assert(coverage.validation.incomplete === false, "Complete run with sitemap truncation should not mark validation incomplete.");
}

function assertMaxPagesReachedWithTruncationEvidence() {
  const coverage = derive({
    options: { maxPages: 3 },
    summary: makeSummary({
      pagesCrawled: 3,
      discoveryFallback: {
        xmlSitemap: {
          reason: null,
          urlsDiscovered: 0,
          urlsSeeded: 0,
        },
        htmlSitemap: {
          reason: "max_pages",
        },
      },
    }),
  });

  assertIncludes(coverage.reasons, "max_pages_reached", "maxPages with explicit budget-stop evidence should include max_pages_reached.");
}

function assertNoFalsePositiveMaxPagesEquality() {
  const coverage = derive({
    options: { maxPages: 3 },
    summary: makeSummary({
      pagesCrawled: 3,
    }),
  });

  assertExcludes(coverage.reasons, "max_pages_reached", "pagesCrawled === maxPages alone should not imply max_pages_reached.");
  assert(coverage.status === "complete", "Numeric equality without truncation evidence should remain coverage complete.");
}

function assertReportBuilderAddsCoverageWithoutSchemaBump() {
  const checker = new LinkChecker("https://example.test/", {
    retryCount: 0,
    confirm404: false,
  });
  const report = checker.buildReport();

  assert(report.schemaVersion === REPORT_SCHEMA_VERSION, "Report schema version should remain unchanged.");
  assert(REPORT_SCHEMA_VERSION === "1.3.0", "P12-3 should not bump REPORT_SCHEMA_VERSION.");
  assert(report.summary.coverage?.status === "complete", "Report summary should include derived coverage.");
  assert(report.summary.scanQuality?.status === "ok", "Coverage should not replace scanQuality.");
}

function assertUserFacingNoticeHooks() {
  const appHtml = readFileSync("public/index.html", "utf8");
  const appJs = readFileSync("public/app.js", "utf8");
  const analyzerJs = readFileSync("public/report-analyzer.js", "utf8");

  assert(appHtml.includes('id="coverage-notice"'), "Main GUI should include a coverage notice element.");
  assert(appJs.includes("本次掃描未完整完成，目前結果僅包含已完成驗證的 URL"), "Main GUI should distinguish validation incomplete copy.");
  assert(appJs.includes("本次已完成排定的 URL 驗證，但網站探索範圍受頁面上限或 sitemap seed 限制"), "Main GUI should distinguish discovery coverage limitation copy.");
  assert(analyzerJs.includes("deriveCoverageStatusForReport"), "Report Analyzer should derive coverage for imported reports.");
  assert(analyzerJs.includes("coverage.incomplete"), "Report Analyzer should show coverage notice even when runStatus is complete.");
}

assertFullyComplete();
assertUserStoppedWithPendingValidation();
assertValidationIncompleteWithoutUserStop();
assertSitemapSeedTruncatedOnCompleteRun();
assertMaxPagesReachedWithTruncationEvidence();
assertNoFalsePositiveMaxPagesEquality();
assertReportBuilderAddsCoverageWithoutSchemaBump();
assertUserFacingNoticeHooks();

console.log("ok p12-3 coverage notice");
