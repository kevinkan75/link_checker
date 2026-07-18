#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const analyzerHtml = readFileSync("public/report-analyzer.html", "utf8");
const analyzerJs = readFileSync("public/report-analyzer.js", "utf8");
const readme = readFileSync("README.md", "utf8");
const technicalSpec = readFileSync("docs/TECHNICAL_SPEC.md", "utf8");

assert(analyzerHtml.includes("待判讀結果"), "Report Analyzer should use handoff-oriented result wording.");
assert(analyzerHtml.includes("判讀分類"), "Report Analyzer should expose interpretation categories.");
assert(!analyzerHtml.includes(">壞連結<"), "Report Analyzer visible headings should not use legacy broken-link wording.");
assert(!analyzerHtml.includes("問題類型"), "Report Analyzer filter label should not use issueType wording.");

for (const text of [
  "INTERPRETATION_LABELS",
  "normalizeInterpretation",
  "renderInterpretationRankList",
  "interpretationBadge",
]) {
  assert(analyzerJs.includes(text), `Report Analyzer should include ${text}.`);
}

for (const column of [
  "\"判讀分類\"",
  "\"建議處理\"",
  "\"是否需人工確認\"",
  "\"優先度\"",
  "\"問題網址\"",
]) {
  assert(analyzerJs.includes(column), `Report Analyzer CSV should include ${column}.`);
}

assert(readme.includes("| 判讀分類 | 代表意義 | 建議處理 |"), "README should document interpretation categories.");
assert(readme.includes("待判讀結果"), "README should use handoff-oriented wording.");
assert(technicalSpec.includes("GUI 與 Report Analyzer 應優先顯示 `interpretation.label`"), "Technical spec should define interpretation-first display.");

console.log("ok p10c report analyzer language");
