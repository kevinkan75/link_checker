#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const analyzerJs = readFileSync("public/analyzer.js", "utf8").replace(/\r\n?/g, "\n");
const analyzerHtml = readFileSync("public/analyzer.html", "utf8");
const analyzerCss = readFileSync("public/analyzer.css", "utf8");
const indexHtml = readFileSync("public/index.html", "utf8");
const buildPortable = readFileSync("build-portable.ps1", "utf8");

assert(
  analyzerJs.includes("if (items.length === 0) {\n    return [];\n  }"),
  "External Link Analyzer should accept empty external-links.ndjson sidecars.",
);

assert(
  analyzerJs.includes("if (rows.length === 1) {\n    return [];\n  }"),
  "External Link Analyzer should accept header-only external-links.csv files.",
);

assert(
  analyzerJs.includes("throw new Error(\"CSV 沒有表頭列\")"),
  "External Link Analyzer should still reject CSV without a header row.",
);

assert(!existsSync("analyzer.cmd"), "The redundant root analyzer.cmd launcher should be removed.");
assert(!buildPortable.includes("analyzer.cmd") && !buildPortable.includes("$analyzerCmd"), "Portable build should not generate analyzer.cmd.");
assert(buildPortable.includes('"gui.cmd"') && buildPortable.includes('"check-links.cmd"'), "Portable build should retain gui.cmd and check-links.cmd.");
assert(existsSync("public/analyzer.html") && existsSync("public/analyzer.js") && existsSync("public/analyzer.css"), "Analyzer route assets should remain available.");
assert(indexHtml.includes('href="/analyzer.html"'), "Main GUI should retain Analyzer navigation.");

assert(analyzerHtml.includes("選擇分析檔案"), "Analyzer should use the simplified file-selection label.");
assert(!analyzerHtml.includes('id="analyze-button"') && !analyzerHtml.includes("載入並分析"), "Analyzer should not require a second Analyze action.");
assert(!analyzerHtml.includes("import-flow"), "Analyzer should not present a three-step wizard.");
assert(analyzerHtml.includes("載入後會自動整理外部網域、風險分類與治理狀態"), "Empty state should explain automatic analysis.");
assert(!analyzerJs.includes("analyzeButton") && !analyzerJs.includes("setImportFlow"), "Analyzer script should remove obsolete button and stepper state.");
assert(analyzerJs.includes('linksFileInput.addEventListener("change", async () =>') && analyzerJs.includes("await loadAndAnalyzeSelectedFile(file, requestId)"), "File selection should trigger automatic analysis.");
assert(analyzerJs.includes("requestId !== analysisRequestId"), "Repeated file selection should ignore stale analysis completion.");
assert(!analyzerJs.includes("FILE_SIZE_WARN_BYTES"), "The 15 MB warning tier should be removed.");
assert(analyzerJs.includes("FILE_SIZE_LARGE_BYTES = 50 * 1024 * 1024"), "The conservative 50 MB notice should remain.");
assert(!analyzerCss.includes(".import-flow") && !analyzerCss.includes("#analyze-button"), "Obsolete stepper and Analyze-button styles should be removed.");

function makeElement(value = "") {
  return {
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    append() {},
    appendChild() {},
    classList: { add() {}, remove() {}, toggle() {} },
    click() {},
    closest() { return null; },
    dataset: {},
    disabled: false,
    files: [],
    hidden: false,
    innerHTML: "",
    querySelector() { return makeElement(); },
    remove() {},
    replaceChildren() {},
    setAttribute() {},
    style: {},
    textContent: "",
    value,
  };
}

const defaults = new Map([
  ["#high-risk-categories", "malware,phishing"],
  ["#medium-risk-categories", "shortener"],
  ["#risk-filter", "all"],
  ["#governance-filter", "all"],
  ["#ut1-min-domains", "1"],
]);
const elements = new Map();
const querySelector = (selector) => {
  if (!elements.has(selector)) {
    elements.set(selector, makeElement(defaults.get(selector) || ""));
  }
  return elements.get(selector);
};
const sandbox = {
  Blob,
  URL,
  console,
  document: {
    body: makeElement(),
    createElement: () => makeElement(),
    querySelector,
  },
  fetch: async () => ({ ok: true, json: async () => ({ sessionToken: "test-session" }) }),
  setInterval() {},
  setTimeout,
  window: { addEventListener() {} },
};
sandbox.globalThis = sandbox;

vm.runInNewContext(
  `${analyzerJs}\nglobalThis.__analyzerTest = { getFileSizeProfile, makeFilteredExport, getCurrentAnalysis: () => currentAnalysis };`,
  sandbox,
  { filename: "public/analyzer.js" },
);

function makeFile(name, text, size = Buffer.byteLength(text)) {
  return { name, size, async text() { return text; } };
}

async function selectFile(file) {
  const input = elements.get("#links-file");
  input.files = file ? [file] : [];
  await input.listeners.change();
  return sandbox.__analyzerTest.getCurrentAnalysis();
}

const reportAnalysis = await selectFile(makeFile("report.json", JSON.stringify({
  externalLinks: [{ url: "https://report.example/path", hostname: "report.example" }],
})));
assert(reportAnalysis?.enriched.length === 1, "Valid report.json should analyze automatically.");
assert(elements.get("#export-json-button").disabled === false && elements.get("#export-csv-button").disabled === false, "Exports should be enabled after analysis.");

const csvAnalysis = await selectFile(makeFile("external-links.csv", "url,hostname\nhttps://csv.example/path,csv.example\n"));
assert(csvAnalysis?.enriched[0]?.hostname === "csv.example", "A second selection should replace the previous analysis with legacy CSV data.");

const ndjsonAnalysis = await selectFile(makeFile("external-links.ndjson", '{"url":"https://ndjson.example/path","hostname":"ndjson.example"}\n'));
assert(ndjsonAnalysis?.enriched[0]?.hostname === "ndjson.example", "Legacy NDJSON should remain supported.");

elements.get("#search").value = "does-not-match";
elements.get("#search").listeners.input();
assert(sandbox.__analyzerTest.getCurrentAnalysis().filteredLinks.length === 0, "Filter changes should reuse the current loaded links.");
elements.get("#search").value = "";
elements.get("#trusted-domains").value = "ndjson.example";
elements.get("#trusted-domains").listeners.input();
assert(sandbox.__analyzerTest.getCurrentAnalysis().enriched[0].trusted === true, "Whitelist changes should reanalyze current loaded links.");
assert(sandbox.__analyzerTest.makeFilteredExport(sandbox.__analyzerTest.getCurrentAnalysis()).links.length === 1, "Filtered export should remain available.");

elements.get("#rules-file").files = [makeFile("rules.json", JSON.stringify({ rules: [{ category: "malware", domains: ["ndjson.example"] }] }))];
await elements.get("#rules-file").listeners.change();
assert(sandbox.__analyzerTest.getCurrentAnalysis().enriched[0].categories.includes("malware"), "Rule-file changes should reanalyze current loaded links without reparsing them.");

const invalidAnalysis = await selectFile(makeFile("invalid.json", "{"));
assert(invalidAnalysis === null && elements.get("#file-status").className === "file-status error", "Invalid files should show an error and allow another selection.");
assert((await selectFile(makeFile("report.json", JSON.stringify({ externalLinks: [] }))))?.enriched.length === 0, "A valid file should load after an import error.");

assert(sandbox.__analyzerTest.getFileSizeProfile({ name: "normal.json", size: 20 * 1024 * 1024 }).level === "ok", "Files below 50 MB should not receive the removed 15 MB warning.");
const largeProfile = sandbox.__analyzerTest.getFileSizeProfile({ name: "large.json", size: 50 * 1024 * 1024 });
assert(largeProfile.level === "warn" && largeProfile.message.includes("可能出現短暫停頓"), "Files at 50 MB should retain a conservative notice.");

console.log("ok p11b external analyzer import UX and launcher cleanup");
