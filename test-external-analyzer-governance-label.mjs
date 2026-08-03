#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const analyzerJs = readFileSync("public/analyzer.js", "utf8");
const analyzerCss = readFileSync("public/analyzer.css", "utf8");

assert(
  analyzerJs.includes("白名單需檢視"),
  "External Link Analyzer should label allowed domains that still need review.",
);

assert(
  analyzerJs.includes("status === \"allowed\" && needsReview"),
  "External Link Analyzer should detect allowed domains with needsReview.",
);

assert(
  analyzerCss.includes(".governance.allowed.needs-review"),
  "External Link Analyzer should style allowed domains that still need review as a warning.",
);

assert(
  analyzerJs.includes("RISK_REASON_GROUPS"),
  "External Link Analyzer should group risk reasons for TA readability.",
);

for (const label of ["治理規則", "內容分類", "HTTP 狀態", "轉址", "防護限制"]) {
  assert(
    analyzerJs.includes(label),
    `External Link Analyzer should include the ${label} risk reason group.`,
  );
}

assert(
  analyzerCss.includes(".reason-groups"),
  "External Link Analyzer should style grouped risk reasons.",
);

console.log("ok external analyzer governance label");
