#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const source = readFileSync("gui-server.mjs", "utf8");

for (const text of [
  "Link Checker 已啟動，請在瀏覽器開啟下列頁面：",
  "連結檢查主頁",
  "外部連結分析頁",
  "報告分析頁",
  "提醒：此命令視窗需保持開啟；關閉後 Link Checker 會停止。",
  "系統憑證模式",
  "閒置自動關閉",
]) {
  assert(source.includes(text), `GUI startup output should include: ${text}`);
}

assert(
  source.includes("/report-analyzer.html"),
  "GUI startup output should include the Report Analyzer URL.",
);

assert(
  source.includes("console.log(`Link Checker GUI is running at http://127.0.0.1:${port}`);"),
  "GUI startup output should preserve the launcher-compatible URL marker.",
);

console.log("ok gui startup messages");
