#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const reportAnalyzerHtml = readFileSync("public/report-analyzer.html", "utf8");
const externalAnalyzerHtml = readFileSync("public/analyzer.html", "utf8");
const reportAnalyzer = readFileSync("public/report-analyzer.js", "utf8");
const externalAnalyzer = readFileSync("public/analyzer.js", "utf8");

assert(
  reportAnalyzerHtml.includes(".ndjson"),
  "Report Analyzer file picker should accept broken.ndjson.",
);
assert(
  externalAnalyzerHtml.includes(".ndjson"),
  "External Link Analyzer file picker should accept external-links.ndjson.",
);

assert(
  reportAnalyzer.includes("isNdjsonFile(file)") && reportAnalyzer.includes("makeBrokenSidecarReport"),
  "Report Analyzer should route broken.ndjson through a sidecar report model.",
);
assert(
  reportAnalyzer.includes("isBrokenNdjsonFile(file)") && reportAnalyzer.includes("只支援 broken.ndjson"),
  "Report Analyzer should reject unsupported NDJSON sidecars.",
);
assert(
  reportAnalyzer.includes("parseNdjsonContent(text)") && reportAnalyzer.includes("kind === \"ndjson\""),
  "Report Analyzer should parse NDJSON line-by-line and expose NDJSON-specific errors.",
);
assert(
  reportAnalyzer.includes("status: \"partial\""),
  "Report Analyzer should mark broken.ndjson sidecar loads as partial reports.",
);

assert(
  externalAnalyzer.includes("name.endsWith(\".ndjson\")"),
  "External Link Analyzer should detect external-links.ndjson by extension.",
);
assert(
  externalAnalyzer.includes("isExternalLinksNdjsonFile(file)") && externalAnalyzer.includes("只支援 external-links.ndjson"),
  "External Link Analyzer should reject unsupported NDJSON sidecars.",
);
assert(
  externalAnalyzer.includes("normalizeLinksFromNdjson"),
  "External Link Analyzer should normalize external-links.ndjson rows.",
);
assert(
  externalAnalyzer.includes("external-links.ndjson"),
  "External Link Analyzer should mention external-links.ndjson in user-facing guidance.",
);

console.log("ok p9b4 ndjson import");
