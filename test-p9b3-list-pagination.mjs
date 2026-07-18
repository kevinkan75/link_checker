#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const reportAnalyzer = readFileSync("public/report-analyzer.js", "utf8");
const externalAnalyzer = readFileSync("public/analyzer.js", "utf8");
const reportAnalyzerCss = readFileSync("public/report-analyzer.css", "utf8");
const externalAnalyzerCss = readFileSync("public/analyzer.css", "utf8");

assert(
  reportAnalyzer.includes("const BROKEN_LIST_INITIAL_COUNT = 200;"),
  "Report Analyzer should initially render 200 broken links.",
);
assert(
  reportAnalyzer.includes("const BROKEN_LIST_INCREMENT = 200;"),
  "Report Analyzer should load 200 more broken links at a time.",
);
assert(
  !reportAnalyzer.includes("sortedItems.slice(0, 800)"),
  "Report Analyzer must not return to the fixed 800 item cap.",
);
assert(
  reportAnalyzer.includes("renderLoadMoreControl"),
  "Report Analyzer should render a load-more control.",
);

assert(
  externalAnalyzer.includes("const LINK_LIST_INITIAL_COUNT = 200;"),
  "External Link Analyzer should initially render 200 links.",
);
assert(
  externalAnalyzer.includes("const LINK_LIST_INCREMENT = 200;"),
  "External Link Analyzer should load 200 more links at a time.",
);
assert(
  !externalAnalyzer.includes("sortedLinks.slice(0, 500)"),
  "External Link Analyzer must not return to the fixed 500 item cap.",
);
assert(
  externalAnalyzer.includes("renderLoadMoreControl"),
  "External Link Analyzer should render a load-more control.",
);

for (const [name, css] of [
  ["Report Analyzer", reportAnalyzerCss],
  ["External Link Analyzer", externalAnalyzerCss],
]) {
  assert(css.includes(".list-pagination"), `${name} should style the pagination row.`);
  assert(css.includes(".load-more-button"), `${name} should style the load-more button.`);
}

console.log("ok p9b3 list pagination");
