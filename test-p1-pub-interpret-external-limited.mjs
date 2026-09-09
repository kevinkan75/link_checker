#!/usr/bin/env node

import { readFileSync } from "node:fs";
import vm from "node:vm";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeElement() {
  return {
    addEventListener() {},
    append() {},
    appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    files: [],
    innerHTML: "",
    querySelector() {
      return makeElement();
    },
    removeAttribute() {},
    setAttribute() {},
    style: {},
    textContent: "",
    value: "",
  };
}

const elements = new Map();
function getElement(selector) {
  if (!elements.has(selector)) {
    elements.set(selector, makeElement());
  }
  return elements.get(selector);
}

const sandbox = {
  Blob,
  URL,
  clearInterval() {},
  console,
  document: {
    body: makeElement(),
    createElement: makeElement,
    querySelector: getElement,
  },
  fetch: async () => ({
    ok: true,
    json: async () => ({ sessionToken: "test-session" }),
  }),
  setInterval() {},
  window: {
    addEventListener() {},
  },
};
sandbox.globalThis = sandbox;

const source = readFileSync("public/report-analyzer.js", "utf8");
const html = readFileSync("public/report-analyzer.html", "utf8");
vm.runInNewContext(
  `${source}\nglobalThis.__reportAnalyzerTest = { analyzeReport, applyFilters };`,
  sandbox,
  { filename: "public/report-analyzer.js" },
);

const report = {
  startUrl: "https://in.example/",
  summary: {},
  broken: [
    { url: "https://out.example/denied", status: 403 },
    { url: "https://out.example/rate-limit", status: "429" },
    { url: "https://out.example/protected", classification: "protected", suspectedWaf: true },
    { url: "https://out.example/timeout", issueType: "timeout", error: "Timeout after 15000ms" },
    { url: "https://out.example/network", classification: "network_error", error: "fetch failed" },
    { url: "https://in.example/denied", status: 403 },
    { url: "https://in.example/rate-limit", status: 429 },
    { url: "https://in.example/protected", classification: "protected", suspectedWaf: true },
    { url: "https://in.example/timeout", issueType: "timeout", error: "Timeout after 15000ms" },
    { url: "https://in.example/network", classification: "network_error", error: "fetch failed" },
    {
      url: "https://out.example/existing",
      status: 403,
      interpretation: {
        category: "action_required",
        label: "Existing decision",
      },
    },
    { url: "https://out.example/redirect-error", issueType: "redirect_to_error" },
    { url: "https://out.example/redirect-missing-unconfirmed", status: 404, issueType: "redirect_to_error" },
    { url: "https://out.example/redirect-missing-confirmed", status: 404, issueType: "redirect_to_error", confirmation: { outcome: "confirmed_missing" } },
    { url: "https://out.example/missing-confirmed", issueType: "not_found", confirmation: { outcome: "confirmed_missing" } },
    { url: "https://out.example/missing-unconfirmed", status: 404 },
  ],
};

const originalFirstRow = { ...report.broken[0] };
const analysis = sandbox.__reportAnalyzerTest.analyzeReport(report);
const categories = new Map(analysis.broken.map((item) => [item.url, item.interpretation.category]));
const labels = new Map(analysis.broken.map((item) => [item.url, item.interpretation.label]));

assert(categories.get("https://out.example/denied") === "external_limited", "external 403 fallback should be external_limited.");
assert(categories.get("https://out.example/rate-limit") === "external_limited", "external 429 fallback should be external_limited.");
assert(categories.get("https://out.example/protected") === "external_limited", "external protected/WAF fallback should be external_limited.");
assert(categories.get("https://out.example/timeout") === "external_limited", "external timeout fallback should be external_limited.");
assert(categories.get("https://out.example/network") === "external_limited", "external network_error fallback should be external_limited.");

for (const url of [
  "https://in.example/denied",
  "https://in.example/rate-limit",
  "https://in.example/protected",
  "https://in.example/timeout",
  "https://in.example/network",
]) {
  assert(categories.get(url) === "needs_review", `${url} should remain needs_review.`);
}

assert(categories.get("https://out.example/existing") === "action_required", "existing interpretation.category should override fallback.");
assert(categories.get("https://out.example/redirect-error") === "action_required", "redirect error fallback should remain action_required.");
assert(categories.get("https://out.example/redirect-missing-unconfirmed") === "likely_problem", "unconfirmed redirect-to-404 fallback should be likely_problem.");
assert(labels.get("https://out.example/redirect-missing-unconfirmed") === "請人工確認", "unconfirmed redirect-to-404 fallback should use human-review wording.");
assert(categories.get("https://out.example/redirect-missing-confirmed") === "action_required", "confirmed redirect-to-404 fallback should be action_required.");
assert(labels.get("https://out.example/redirect-missing-confirmed") === "已確認失效", "confirmed redirect-to-404 fallback should use confirmed-missing wording.");
assert(categories.get("https://out.example/missing-confirmed") === "action_required", "confirmed not_found fallback should remain action_required.");
assert(labels.get("https://out.example/missing-confirmed") === "已確認失效", "confirmed not_found fallback should use confirmed-missing wording.");
assert(categories.get("https://out.example/missing-unconfirmed") === "likely_problem", "unconfirmed not_found fallback should remain likely_problem.");
assert(labels.get("https://out.example/missing-unconfirmed") === "請人工確認", "unconfirmed not_found fallback should use human-review wording.");
assert(report.broken[0].interpretation === originalFirstRow.interpretation, "analysis should not mutate imported rows.");

const managementStartUrl = "https://www.hsinchu.gov.tw/";
const managementTargets = [
  ["http://www.hsinchu.gov.tw/test", "internal"],
  ["https://ws.hsinchu.gov.tw/file.pdf", "same_domain"],
  ["https://travel.hsinchu.gov.tw/", "same_domain"],
  ["https://www.facebook.com/test", "external"],
  ["https://www.railway.gov.tw/", "external"],
  ["https://hsinchu.gov.tw/", "same_domain"],
];
const scopeChecker = new LinkChecker(managementStartUrl);
for (const [url] of managementTargets) {
  scopeChecker.addExternalLink(url, { tag: "a", attribute: "href" }, {
    page: managementStartUrl,
    tag: "a",
    attribute: "href",
    text: url,
    sourceType: "html_attribute",
  });
}
const managementReport = {
  startUrl: managementStartUrl,
  summary: {},
  externalLinks: scopeChecker.buildExternalLinks([]),
  broken: managementTargets.map(([url]) => ({ url, status: 404 })),
};
const managementAnalysis = sandbox.__reportAnalyzerTest.analyzeReport(managementReport);
const managementScopes = new Map(managementAnalysis.broken.map((item) => [item.url, item.managementScope]));
for (const [url, expected] of managementTargets) {
  assert(managementScopes.get(url) === expected, `${url} should have management scope ${expected}.`);
}
getElement("#search").value = "";
getElement("#issue-filter").value = "all";
getElement("#scope-filter").value = "same_domain";
getElement("#status-filter").value = "all";
const sameDomainResults = sandbox.__reportAnalyzerTest.applyFilters(managementAnalysis).filteredBroken;
assert(sameDomainResults.length === 3, "Same-domain filter should keep exactly the three same-domain results.");
assert(sameDomainResults.every((item) => item.managementScope === "same_domain"), "Same-domain filter should exclude other management scopes.");
assert(
  managementReport.externalLinks.find((item) => item.hostname === "ws.hsinchu.gov.tw")?.registrableDomain === "hsinchu.gov.tw",
  "Management scope should reuse existing registrable-domain evidence.",
);
assert(scopeChecker.isCrawlOrigin("http://www.hsinchu.gov.tw/test") === false, "Protocol changes should remain cross-origin for crawling.");
assert(scopeChecker.isCrawlOrigin("https://ws.hsinchu.gov.tw/file.pdf") === false, "Same-domain subdomains should remain outside the crawl origin.");

for (const option of [
  '<option value="internal">本站</option>',
  '<option value="same_domain">同網域</option>',
  '<option value="external">外部網站</option>',
]) {
  assert(html.includes(option), `Management scope filter should include ${option}.`);
}
assert(source.includes('metaBadge(getManagementScopeLabel(item.managementScope), "scope")'), "Management scope should be shown on each supported result.");

console.log("ok p1 pub interp external limited");
