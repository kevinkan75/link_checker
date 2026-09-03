#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const appJs = readFileSync("public/app.js", "utf8");
const indexHtml = readFileSync("public/index.html", "utf8");
const fixture = JSON.parse(readFileSync("fixtures/reports/client-redirect-evidence.v1.3.json", "utf8"));

assert(!indexHtml.includes("id=\"filter-bar\""), "Main GUI should not render the interpretation filter workspace.");
assert(!indexHtml.includes("id=\"broken-table\""), "Main GUI should not render the item-level interpretation list.");
assert(!indexHtml.includes("待判讀結果</h2>"), "Main GUI should not carry the item-level interpretation workspace heading.");
assert(indexHtml.includes("id=\"broken-count\""), "Main GUI should keep the scan-status interpretation count summary.");
assert(indexHtml.includes("href=\"/report-analyzer.html\""), "Main GUI should keep navigation to Report Analyzer for item-level review.");
assert(appJs.includes("buildInterpretationView"), "Main GUI should still derive interpretation counts for scan status.");
assert(appJs.includes("updateIssueBreakdown"), "Main GUI should still update scan-status interpretation counts.");
assert(!appJs.includes("renderBrokenTable"), "Main GUI should not render item-level interpretation cards.");
assert(!appJs.includes("formatClientRedirectEvidence"), "Main GUI should leave client redirect evidence formatting to Report Analyzer.");

const cases = fixture.broken.map((item) => item.confirmation?.clientRedirectEvidence);
assert(cases.some((item) => item?.detected && item.reason === "target_reachable"), "Fixture should include reachable target evidence.");
assert(cases.some((item) => item?.detected && item.reason === "target_not_checked_external"), "Fixture should include external target evidence.");
assert(cases.some((item) => item?.detected === false && item.reason === "no_client_redirect"), "Fixture should include no-redirect evidence.");

console.log("ok p11c main gui client redirect");
