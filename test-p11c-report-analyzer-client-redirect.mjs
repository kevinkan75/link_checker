#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const analyzerJs = readFileSync("public/report-analyzer.js", "utf8");
const fixture = JSON.parse(readFileSync("fixtures/reports/client-redirect-evidence.v1.3.json", "utf8"));

assert(analyzerJs.includes("normalizeClientRedirectEvidence"), "Report Analyzer should normalize client redirect evidence.");
assert(analyzerJs.includes("shouldShowClientRedirectEvidence"), "Report Analyzer should decide when to display client redirect evidence.");
assert(analyzerJs.includes("formatClientRedirectEvidence"), "Report Analyzer should format client redirect evidence.");
assert(analyzerJs.includes("瀏覽器端導向"), "Report Analyzer should use TA-friendly client redirect wording.");
assert(analyzerJs.includes("導向目標可開啟，建議確認原連結是否應更新"), "Report Analyzer should explain reachable client redirect targets.");
assert(analyzerJs.includes("導向目標是外部網站，請人工確認是否可開啟"), "Report Analyzer should explain external target boundaries.");

const cases = fixture.checked.map((item) => item.confirmation?.clientRedirectEvidence);
assert(cases.some((item) => item?.detected && item.reason === "target_reachable"), "Fixture should include reachable target evidence.");
assert(cases.some((item) => item?.detected && item.reason === "target_not_checked_external"), "Fixture should include external target evidence.");
assert(cases.some((item) => item?.detected === false && item.reason === "no_client_redirect"), "Fixture should include no-redirect evidence.");

console.log("ok p11c report analyzer client redirect");
