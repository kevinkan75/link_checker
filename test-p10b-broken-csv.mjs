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

const expectedHeaders = [
  "判讀分類",
  "建議處理",
  "是否需人工確認",
  "問題網址",
  "來源頁",
  "連結文字",
  "HTTP 狀態",
  "檢查結果",
  "最終網址",
];

const csv = makeBrokenCsv([
  {
    url: "https://example.test/missing?token=link-secret&keep=visible",
    status: 404,
    issueType: "not_found",
    classification: "http_error",
    canonicalUrl: "https://example.test/missing?token=link-secret&keep=visible",
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
    sources: [{
      page: "https://example.test/source?session=source-secret&keep=visible",
      text: "原公告連結",
    }],
  },
  {
    url: "https://external.test/blocked?api_key=external-secret",
    status: 403,
    issueType: "access_denied",
    classification: "protected",
    needsReview: false,
    suspectedWaf: true,
    interpretation: {
      category: "external_limited",
      label: "外站限制",
      severity: "review",
      action: "外部網站可能拒絕或限制工具請求，建議人工確認或與對方網站窗口協調。",
      needsManualReview: true,
    },
    sources: [{ page: "https://example.test/source", text: "外部系統" }],
  },
  {
    url: "https://example.test/timeout",
    issueType: "timeout",
    classification: "timeout",
    interpretation: {
      category: "needs_review",
      label: "需人工確認",
      severity: "review",
      action: "請用瀏覽器人工確認是否可正常開啟，再決定是否交辦修正。",
      needsManualReview: true,
    },
    sources: [{ page: "https://example.test/source", text: "逾時連結" }],
  },
  {
    url: "https://example.test/error",
    status: 500,
    issueType: "http_error",
    classification: "http_error",
    interpretation: {
      category: "likely_problem",
      label: "可能失效",
      severity: "medium",
      action: "請確認網址、伺服器狀態或頁面是否仍存在。",
      needsManualReview: true,
    },
    sources: [{ page: "https://example.test/source", text: "含,逗號 \"引號\"\n第二行" }],
  },
  {
    url: "https://example.test/redirect-missing",
    status: 404,
    issueType: "redirect_to_error",
    classification: "redirect_to_error",
    interpretation: {
      category: "redirect_ok",
      label: "已轉址仍可用",
      severity: "info",
      action: "連結目前可到達；若 final URL 穩定，可視情況更新原連結。",
      needsManualReview: false,
    },
    sources: [{ page: "https://example.test/source", text: "轉址樣本" }],
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

const rows = parseCsv(csv);
const [header, actionRow, externalRow, timeoutRow, likelyProblemRow, redirectRow] = rows;

assert(JSON.stringify(header) === JSON.stringify(expectedHeaders), "broken.csv headers must match the exact nine-column handoff contract.");
assert(header.length === 9, "broken.csv must contain exactly nine columns.");
assert(!header.includes("優先度"), "broken.csv must not expose priority.");
assert(!header.includes("檢查時間"), "broken.csv must not expose per-row timestamps.");
assert(!header.includes("needsReview"), "broken.csv must not expose raw needsReview.");

assert(column(actionRow, header, "判讀分類") === "需處理", "Confirmed missing link should use final action_required interpretation.");
assert(column(actionRow, header, "是否需人工確認") === "否", "Confirmed missing link should not require manual review.");
assert(column(actionRow, header, "問題網址").includes("token=REDACTED"), "Display URL should be redacted.");
assert(column(actionRow, header, "來源頁").includes("session=REDACTED"), "Source page should be redacted.");
assert(column(actionRow, header, "最終網址").includes("token=REDACTED"), "Final URL should be redacted.");
assert(column(actionRow, header, "檢查結果") === "二次確認後仍不存在", "Confirmed missing outcome should be human readable.");

assert(column(externalRow, header, "判讀分類") === "外站限制", "External limited result should retain its distinct interpretation.");
assert(column(externalRow, header, "是否需人工確認") === "是", "Final interpretation manual-review flag must override raw needsReview=false.");
assert(column(externalRow, header, "檢查結果") === "網站防護可能阻擋自動檢查", "Protection evidence should be explained without changing the interpretation.");

assert(column(timeoutRow, header, "判讀分類") === "需人工確認", "Timeout should retain needs_review interpretation.");
assert(column(timeoutRow, header, "檢查結果") === "連線逾時", "Timeout should have a human-readable check result.");

assert(column(likelyProblemRow, header, "判讀分類") === "可能失效", "Likely problem must remain distinct.");
assert(column(likelyProblemRow, header, "檢查結果") === "HTTP 500", "Generic HTTP error should use a concise status result.");
assert(column(likelyProblemRow, header, "連結文字") === "含,逗號 \"引號\"\n第二行", "CSV escaping should preserve commas, quotes, and newlines.");

assert(column(redirectRow, header, "檢查結果") === "轉址後頁面不存在", "Redirect error should have a human-readable result.");

console.log("ok p10b broken csv");
