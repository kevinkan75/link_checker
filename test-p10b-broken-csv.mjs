#!/usr/bin/env node

import { makeBrokenCsv } from "./gui-server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = text.charCodeAt(0) === 0xFEFF ? 1 : 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes && char === "\"" && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && char === "\r" && next === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
      continue;
    }
    cell += char;
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function column(row, header, name) {
  const index = header.indexOf(name);
  assert(index >= 0, `Missing CSV column: ${name}.`);
  return row[index];
}

const csv = makeBrokenCsv([
  {
    url: "https://example.test/missing?token=link-secret&keep=visible",
    status: 404,
    issueType: "not_found",
    classification: "http_error",
    checkedAt: "2026-07-18T00:00:00.000Z",
    canonicalUrl: "https://example.test/missing?token=link-secret&keep=visible",
    method: "GET",
    finalUrl: "https://example.test/missing-final?token=final-secret&keep=visible",
    confirmation: {
      outcome: "confirmed_missing",
      finalUrl: "https://example.test/missing?token=confirm-secret&keep=visible",
    },
    interpretation: {
      category: "action_required",
      label: "需處理",
      severity: "high",
      action: "請優先確認來源頁，並修正或移除連結。",
      needsManualReview: false,
    },
    sources: [
      {
        page: "https://example.test/source?session=source-secret&keep=visible",
        tag: "a",
        attribute: "href",
        text: "原公告連結",
      },
    ],
  },
  {
    url: "https://external.test/blocked?api_key=external-secret",
    status: 403,
    issueType: "protected",
    classification: "protected",
    checkedAt: "2026-07-18T00:01:00.000Z",
    interpretation: {
      category: "external_limited",
      label: "外站限制",
      severity: "review",
      action: "外部網站可能拒絕或限制工具請求，建議人工確認或與對方網站窗口協調。",
      needsManualReview: true,
    },
    sources: [
      {
        page: "https://example.test/source",
        tag: "a",
        attribute: "href",
        text: "外部系統",
      },
    ],
  },
], {
  redactSensitiveQuery: true,
  redactQueryKeys: ["token", "session", "api_key"],
});

assert(csv.charCodeAt(0) === 0xFEFF, "broken.csv must start with UTF-8 BOM.");
assert(csv.includes("\r\n"), "broken.csv should use CRLF line endings.");
assert(!csv.includes("link-secret"), "broken.csv leaked link token.");
assert(!csv.includes("source-secret"), "broken.csv leaked source session.");
assert(!csv.includes("final-secret"), "broken.csv leaked final token.");
assert(!csv.includes("external-secret"), "broken.csv leaked external api key.");
assert(csv.includes("token=REDACTED"), "broken.csv should include redacted token marker.");
assert(csv.includes("session=REDACTED"), "broken.csv should include redacted session marker.");

const rows = parseCsv(csv);
const header = rows[0];
const actionRow = rows[1];
const externalRow = rows[2];

assert(header[0] === "判讀分類", "CSV should put handoff columns first.");
assert(header[1] === "建議處理", "CSV should expose recommended action near the front.");
assert(header.includes("url"), "CSV should preserve the original technical url column.");
assert(header.includes("issueType"), "CSV should preserve the original technical issueType column.");

assert(column(actionRow, header, "判讀分類") === "需處理", "Confirmed missing link should be action_required.");
assert(column(actionRow, header, "是否需人工確認") === "否", "Confirmed missing link should not require manual review.");
assert(column(actionRow, header, "優先度") === "高", "High severity should become high priority.");
assert(column(actionRow, header, "問題網址").includes("token=REDACTED"), "Display URL should be redacted.");
assert(column(actionRow, header, "來源頁").includes("session=REDACTED"), "Source page should be redacted.");
assert(column(actionRow, header, "最終網址").includes("token=REDACTED"), "Final URL should be redacted.");
assert(column(actionRow, header, "確認結果") === "二次確認仍不存在", "Confirmation outcome should be human readable.");

assert(column(externalRow, header, "判讀分類") === "外站限制", "External limited result should keep P10a interpretation.");
assert(column(externalRow, header, "是否需人工確認") === "是", "External limited result should require manual review.");
assert(column(externalRow, header, "優先度") === "需確認", "Review severity should become review priority.");

console.log("ok p10b broken csv");
