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
assert(analyzerHtml.includes("處理建議分類"), "Report Analyzer should use task-friendly interpretation wording.");
assert(analyzerHtml.includes("技術狀態"), "Report Analyzer should describe HTTP status as supporting technical status.");
assert(analyzerHtml.includes("匯出目前清單 CSV"), "Report Analyzer export action should refer to the visible list.");
assert(analyzerHtml.includes("匯入單一 report.json"), "Report Analyzer should describe local file selection as importing instead of uploading.");
assert(!analyzerHtml.includes("上傳單一 report.json"), "Report Analyzer should not imply report files are uploaded.");
assert(!analyzerJs.includes("metaBadge(formatInterpretationPriority(item.interpretation.severity), \"priority\")"), "Report Analyzer should not show unexplained priority badges in the visible list.");
assert(
  analyzerHtml.indexOf("<h2>待判讀清單</h2>") < analyzerHtml.indexOf("<h2>處理建議分類</h2>"),
  "Report Analyzer should place the actionable list before supporting summaries.",
);
assert(!analyzerHtml.includes(">壞連結<"), "Report Analyzer visible headings should not use legacy broken-link wording.");
assert(!analyzerHtml.includes("問題類型"), "Report Analyzer filter label should not use issueType wording.");

for (const text of [
  "INTERPRETATION_LABELS",
  "normalizeInterpretation",
  "renderInterpretationRankList",
  "interpretationBadge",
  "formatStatusFilterLabel",
  "issue-decision-summary",
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
