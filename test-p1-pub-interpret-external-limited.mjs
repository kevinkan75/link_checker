#!/usr/bin/env node

import { readFileSync } from "node:fs";
import vm from "node:vm";

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

const sandbox = {
  Blob,
  URL,
  clearInterval() {},
  console,
  document: {
    body: makeElement(),
    createElement: makeElement,
    querySelector: makeElement,
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
vm.runInNewContext(
  `${source}\nglobalThis.__reportAnalyzerTest = { analyzeReport };`,
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
    { url: "https://out.example/missing-confirmed", issueType: "not_found", confirmation: { outcome: "confirmed_missing" } },
    { url: "https://out.example/missing-unconfirmed", status: 404 },
  ],
};

const originalFirstRow = { ...report.broken[0] };
const analysis = sandbox.__reportAnalyzerTest.analyzeReport(report);
const categories = new Map(analysis.broken.map((item) => [item.url, item.interpretation.category]));

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
assert(categories.get("https://out.example/missing-confirmed") === "action_required", "confirmed not_found fallback should remain action_required.");
assert(categories.get("https://out.example/missing-unconfirmed") === "likely_problem", "unconfirmed not_found fallback should remain likely_problem.");
assert(report.broken[0].interpretation === originalFirstRow.interpretation, "analysis should not mutate imported rows.");

console.log("ok p1 pub interp external limited");
