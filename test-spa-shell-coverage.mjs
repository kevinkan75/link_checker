#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { runInNewContext } from "node:vm";
import { LinkChecker, deriveCoverageStatus } from "./link-checker.mjs";

const execFileAsync = promisify(execFile);
const reason = "client_rendered_content_not_scanned";
// Reduced from the tourism.hccg.gov.tw HTML supplied with the v1.5.4 report.
const shell = `<!doctype html>
<html lang="zh-Hant-TW">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="新竹市官方觀光旅遊網" />
    <base href="/" />
    <title>新竹市觀光旅遊網</title>
    <script type="module" crossorigin src="/assets/index-CqC2tbN-.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-DlxR6G_T.css">
  </head>
  <body><div id="root"></div></body>
</html>`;

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    confirm404: false,
    retryCount: 0,
    requestDelayMs: 0,
    maxPages: 100,
    maxDepth: 2,
    ...options,
  });
}

function assertDetection() {
  const checker = makeChecker("https://example.test/");
  const detect = (html) => checker.extractPageLinks(html, checker.startUrl).spaDetection;
  assert.equal(detect(shell).detected, true, "Small generic CSR shell must be detected.");
  assert.equal(detect(shell).framework, "unknown", "Mount ID must not imply a framework.");
  assert(detect(shell).signals.includes("client_rendered_shell"));
  assert.equal(detect(shell).stats.anchorCount, 0);
  assert(detect(shell).stats.htmlLength > 0);
  const shellWithInlinePath = shell.replace("</head>", '<script>const route = "/client-only-path";</script></head>');
  assert(!checker.extractPageLinks(shellWithInlinePath, checker.startUrl).links.some((link) => link.sourceType === "spa_payload"),
    "Diagnostic-only shell detection must not change auto payload extraction.");
  for (const variant of [
    shell.replace('id="root"', "id='app'").replace('type="module"', "defer"),
    shell.replace('<div id="root"></div>', '<main id="root"> <!-- mount --> </main><noscript>請啟用 JavaScript</noscript>'),
  ]) {
    assert(detect(variant).signals.includes("client_rendered_shell"), "Equivalent app shells must be detected.");
  }
  for (const html of [
    "<html><body><p>Static page without links</p></body></html>",
    shell.replace('<div id="root"></div>', '<div id="root"><h1>Server rendered content</h1></div>'),
    shell.replace('<div id="root"></div>', '<div id="root"></div><p>Static content with an optional widget</p>'),
    shell.replace('<div id="root"></div>', '<div id="root"></div><a href="/news">News</a>'),
    shell.replace('<div id="root"></div>', '<div id="root"></div><area href="/map">'),
    shell.replace('<div id="root"></div>', '<div id="root"></div><img src="/notice.png" alt="Notice">'),
    shell.replace('<div id="root"></div>', ""),
    shell.replace('<script type="module" crossorigin src="/assets/index-CqC2tbN-.js"></script>', ""),
    shell.replace('type="module"', 'type="application/json"'),
    `<html><body><!-- ${shell} --><p>Static content</p></body></html>`,
    `<html><body><script type="application/json">${JSON.stringify(shell)}</script></body></html>`,
  ]) {
    assert(!detect(html).signals.includes("client_rendered_shell"), "Static/SSR pages and inert markup must not be flagged as empty app shells.");
  }
  assert.equal(detect('<html><body><div id="__nuxt"><a href="/news">News</a></div><script src="/_nuxt/main.js"></script></body></html>').framework, "nuxt");
}

function assertNotices(report) {
  for (const [file, formatter, helpers] of [
    ["public/app.js", "buildCoverageNotice", ["deriveCoverageStatusForReport", "hasSitemapSeedTruncation"]],
    ["public/report-analyzer.js", "formatCoverageNotice", ["deriveCoverageStatusForReport", "hasSitemapSeedTruncation", "normalizeRunStatus", "toNumber"]],
  ]) {
    const source = readFileSync(file, "utf8");
    const functions = [formatter, ...helpers].map((name) => {
      const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"));
      assert(match, `${file} must contain ${name}.`);
      return match[0];
    }).join("\n");
    const api = runInNewContext(`${functions}\n({ derive: deriveCoverageStatusForReport, format: ${formatter} });`);
    for (const input of [report, { ...report, summary: { ...report.summary, coverage: undefined } }]) {
      const coverage = api.derive(input);
      assert(coverage.discovery.incomplete, `${file} must preserve the discovery limitation.`);
      assert(!coverage.validation.incomplete, `${file} must keep completed validation distinct.`);
      const notice = api.format(formatter === "buildCoverageNotice" ? input : coverage);
      assert.match(notice, /JavaScript/);
      assert.match(notice, /人工確認/);
      assert.doesNotMatch(notice, /頁面上限|sitemap seed/, "Must explain the actual limitation.");
    }
    const conventional = { ...report, summary: { scanQuality: { warnings: [] } } };
    assert(!api.derive(conventional).incomplete, "Legacy reports without shell evidence must not acquire a guessed limitation.");
  }
}

async function assertScanAndCli() {
  let origin;
  const server = createServer((request, response) => {
    if (request.url === "/sitemap.xml") {
      response.writeHead(200, { "content-type": "application/xml" });
      response.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
        ["/", ...Array.from({ length: 67 }, (_, i) => `/page/${i}`)]
          .map((path) => `<url><loc>${origin}${path}</loc></url>`).join("")
      }</urlset>`);
    } else if (request.url.startsWith("/assets/")) {
      response.writeHead(200, { "content-type": request.url.endsWith(".js") ? "text/javascript" : "text/css" });
      response.end("");
    } else {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(shell);
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    let report;
    for (const spaLinks of ["auto", "off", "strict"]) {
      report = await makeChecker(`${origin}/`, { spaLinks }).run();
      assert.equal(report.runStatus.status, "complete");
      assert.equal(report.schemaVersion, "1.3.0");
      assert.equal(report.summary.pagesCrawled, 68, "Sitemap fallback must keep working.");
      assert.equal(report.summary.urlsChecked, 70);
      assert.equal(report.summary.brokenLinks, 0, "Discovery warning must not manufacture broken links.");
      assert.equal(report.summary.spaDetection.pagesDetected, 68);
      assert.equal(report.summary.spaDetection.framework, "unknown");
      assert(report.summary.scanQuality.warnings.includes(reason));
      assert.equal(report.summary.scanQuality.status, "suspicious");
      assert.equal(report.summary.coverage.status, "incomplete");
      assert(report.summary.coverage.discovery.reasons.includes(reason));
      assert.equal(report.summary.coverage.validation.incomplete, false);
      assert.equal(report.summary.discoveryFallback.xmlSitemap.accepted, true);
      assert.equal(report.summary.coverage.reasons.includes("max_pages_reached"), false);
      assert(report.checked.every((entry) => entry.ok && entry.status === 200));
    }
    assertNotices(report);
    assert(deriveCoverageStatus(report).discovery.reasons.includes(reason));
    const { stdout } = await execFileAsync(process.execPath, [
      "link-checker.mjs", `${origin}/`, "--allow-localhost", "--no-robots", "--no-confirm-404",
      "--request-delay", "0", "--max-pages", "100", "--max-depth", "2",
    ], { timeout: 15000 });
    assert.match(stdout, /Coverage notice:.*JavaScript/);
    assert.match(stdout, /Broken links: 0/);
    assert.match(stdout, /client_rendered_content_not_scanned/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

assertDetection();
await assertScanAndCli();
console.log("ok SPA shell detection, sitemap coverage, CLI and GUI notices");
