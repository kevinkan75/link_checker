#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const analyzerJs = readFileSync("public/analyzer.js", "utf8");

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

console.log("ok p11b empty external analyzer");
