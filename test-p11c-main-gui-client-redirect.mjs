#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const appJs = readFileSync("public/app.js", "utf8");
const fixture = JSON.parse(readFileSync("fixtures/reports/client-redirect-evidence.v1.3.json", "utf8"));

assert(appJs.includes("shouldShowClientRedirectEvidence"), "Main GUI should decide when to display client redirect evidence.");
assert(appJs.includes("formatClientRedirectEvidence"), "Main GUI should format client redirect evidence.");
assert(appJs.includes("瀏覽器端導向"), "Main GUI should use TA-friendly client redirect wording.");
assert(appJs.includes("導向目標可開啟，建議確認原連結是否應更新"), "Main GUI should explain reachable client redirect targets.");
assert(appJs.includes("導向目標是外部網站，請人工確認是否可開啟"), "Main GUI should explain external target boundaries.");
assert(appJs.includes("row.append(detailLine(\"瀏覽器端導向\""), "Main GUI should render client redirect evidence as an issue detail line.");
assert(appJs.includes("header.append(metaBadge(\"瀏覽器端導向\", \"impact\"))"), "Main GUI should render a client redirect evidence badge.");

const cases = fixture.broken.map((item) => item.confirmation?.clientRedirectEvidence);
assert(cases.some((item) => item?.detected && item.reason === "target_reachable"), "Fixture should include reachable target evidence.");
assert(cases.some((item) => item?.detected && item.reason === "target_not_checked_external"), "Fixture should include external target evidence.");
assert(cases.some((item) => item?.detected === false && item.reason === "no_client_redirect"), "Fixture should include no-redirect evidence.");

console.log("ok p11c main gui client redirect");
