#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function withServer(handler, task) {
  const requestCounts = new Map();
  const server = createServer((request, response) => {
    requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
    handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`, requestCounts);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    retryCount: 0,
    confirm404: false,
    preferGet: true,
    requestDelayMs: 0,
    concurrency: 1,
    perHostConcurrency: 1,
    maxDepth: 2,
    maxPages: 20,
    ...options,
  });
}

function html(body) {
  return `<!doctype html><html><body>${body}</body></html>`;
}

function writeHtml(response, body, status = 200) {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html(body));
}

function writeText(response, body, status = 200) {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(body);
}

function writeNotFound(response) {
  writeText(response, "missing", 404);
}

async function assertNormalFrontierSuppressesFallback() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/") {
      writeHtml(response, '<a href="/about">About</a><a href="/site-map">Site map</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const report = await makeChecker(`${origin}/`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "not_needed", "Normal frontier should suppress fallback.");
    assert(fallback.reason === "normal_frontier_present", "Expected normal frontier reason.");
    assert(fallback.candidatesTried === 0, "Fallback should not probe conventional candidates.");
    assert(report.checked.some((item) => item.url === `${origin}/site-map`), "Explicit site-map link should be crawled normally.");
  });
}

async function assertPrefixedConventionalCandidateAccepted() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeHtml(response, '<a href="/zh-tw/a">A</a><a href="/zh-tw/b">B</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin, requestCounts) => {
    const candidate = `${origin}/zh-tw/siteinformation/sitemap`;
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "accepted", "Prefixed conventional candidate should be accepted.");
    assert(fallback.acceptedUrl === candidate, "Accepted URL should be the prefixed candidate.");
    assert(fallback.linksDiscovered === 2, "Candidate should report useful discovered links.");
    assert(requestCounts.get("/zh-tw/siteinformation/sitemap") === 1, "Accepted candidate body should be reused from body cache.");
    assert(report.checked.some((item) => item.url === `${origin}/zh-tw/a`), "Normal processPage should discover candidate links.");
  });
}

async function assertRootFallbackAfterPrefixedRejects() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/siteinformation/sitemap") {
      writeHtml(response, '<a href="/root-a">Root A</a>');
      return;
    }
    writeNotFound(response);
  }, async (origin) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "accepted", "Root candidate should be accepted after prefixed candidates fail.");
    assert(fallback.acceptedUrl === `${origin}/siteinformation/sitemap`, "Expected root siteinformation/sitemap candidate.");
    assert(fallback.candidatesTried === 4, "Should try three prefixed candidates before root candidate.");
  });
}

async function assertNonHtmlCandidateRejected() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeText(response, "not html");
      return;
    }
    if (request.url === "/zh-tw/sitemap") {
      writeHtml(response, '<a href="/zh-tw/from-html">HTML</a>');
      return;
    }
    writeNotFound(response);
  }, async (origin) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "accepted", "Should continue after non-HTML candidate.");
    assert(fallback.acceptedUrl === `${origin}/zh-tw/sitemap`, "Second candidate should be accepted.");
    assert(fallback.candidatesTried === 2, "Non-HTML candidate should count as tried.");
    assert(!report.checked.some((item) => item.url === `${origin}/zh-tw/siteinformation/sitemap`), "Rejected non-HTML probe should not remain in checked results.");
  });
}

async function assertNotFoundCandidateRejected() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeNotFound(response);
      return;
    }
    if (request.url === "/zh-tw/sitemap") {
      writeHtml(response, '<a href="/zh-tw/ok">OK</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "accepted", "Should continue after 404 candidate.");
    assert(fallback.acceptedUrl === `${origin}/zh-tw/sitemap`, "Second candidate should be accepted after 404.");
    assert(!report.broken.some((item) => item.url === `${origin}/zh-tw/siteinformation/sitemap`), "Rejected 404 probe should not become a broken-link finding.");
  });
}

async function assertGeneratedCandidatesStaySameOrigin() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeHtml(response, '<a href="https://example.org/elsewhere">External</a><a href="/zh-tw/local">Local</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "accepted", "Local useful link should accept the candidate.");
    assert([...requestCounts.keys()].every((url) => url.startsWith("/")), "Server should only receive same-origin requests.");
    assert(!report.checked.some((item) => item.url === "https://example.org/elsewhere"), "Cross-origin candidate-page link should not be adopted without --external.");
  });
}

async function assertCandidateFetchBound() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    writeNotFound(response);
  }, async (origin) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "not_found", "No useful candidate should produce not_found.");
    assert(fallback.candidatesTried === 6, "Fallback should stop at six candidates.");
  });
}

async function assertMaxDepthZeroSkipsFallback() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    writeHtml(response, '<a href="/zh-tw/a">A</a>');
  }, async (origin, requestCounts) => {
    const report = await makeChecker(`${origin}/zh-tw`, { maxDepth: 0 }).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(fallback.status === "skipped", "maxDepth=0 should skip fallback.");
    assert(fallback.reason === "max_depth", "Expected max_depth reason.");
    assert(fallback.candidatesTried === 0, "maxDepth=0 should not fetch candidates.");
    assert(requestCounts.get("/zh-tw/siteinformation/sitemap") === undefined, "No candidate should be requested.");
  });
}

async function assertMaxPagesBudgetShared() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeHtml(response, '<a href="/zh-tw/a">A</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const skipped = await makeChecker(`${origin}/zh-tw`, { maxPages: 1 }).run();
    assert(skipped.summary.discoveryFallback.htmlSitemap.status === "skipped", "Exhausted maxPages should skip fallback.");
    assert(skipped.summary.discoveryFallback.htmlSitemap.reason === "max_pages", "Expected max_pages reason.");

    const accepted = await makeChecker(`${origin}/zh-tw`, { maxPages: 2 }).run();
    assert(accepted.summary.discoveryFallback.htmlSitemap.status === "accepted", "One remaining page slot should allow the candidate page.");
    assert(accepted.summary.pagesCrawled === 2, "Candidate should share the normal maxPages budget.");
  });
}

async function assertAcceptedCandidateUsesNormalSources() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url === "/zh-tw/siteinformation/sitemap") {
      writeHtml(response, '<a href="/zh-tw/a">A</a>');
      return;
    }
    writeHtml(response, "<p>ok</p>");
  }, async (origin) => {
    const candidate = `${origin}/zh-tw/siteinformation/sitemap`;
    const child = `${origin}/zh-tw/a`;
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const candidateItem = report.checked.find((item) => item.url === candidate);
    const childItem = report.checked.find((item) => item.url === child);
    assert(candidateItem, "Accepted candidate should enter the normal checked results.");
    assert(childItem, "Candidate links should enter normal checked results.");
    assert(childItem.requestReferer === candidate, "Candidate links should be discovered by normal processPage crawling.");
  });
}

async function assertNoCandidateStillCompletes() {
  await withServer((request, response) => {
    if (request.url === "/robots.txt") {
      writeText(response, "User-agent: *\nAllow: /\n");
      return;
    }
    if (request.url === "/zh-tw") {
      writeHtml(response, "<p>empty frontier</p>");
      return;
    }
    if (request.url.endsWith("/siteinformation/sitemap")) {
      writeHtml(response, '<a href="https://example.org/external">External only</a>');
      return;
    }
    writeNotFound(response);
  }, async (origin) => {
    const report = await makeChecker(`${origin}/zh-tw`).run();
    const fallback = report.summary.discoveryFallback.htmlSitemap;
    assert(report.runStatus.status === "complete", "Scan should complete when no fallback candidate succeeds.");
    assert(fallback.status === "not_found", "No useful same-origin candidate should be not_found.");
    assert(report.broken.length === 0, "Rejected fallback probes should not create broken-link findings.");
  });
}

async function assertNoBrowserDependencyIntroduced() {
  const source = await readFile(new URL("./link-checker.mjs", import.meta.url), "utf8");
  assert(!source.includes("playwright"), "HTML sitemap fallback must not introduce Playwright.");
  assert(!source.includes("dynamic-renderer"), "HTML sitemap fallback must not introduce Dynamic Render.");
}

async function main() {
  await assertNormalFrontierSuppressesFallback();
  await assertPrefixedConventionalCandidateAccepted();
  await assertRootFallbackAfterPrefixedRejects();
  await assertNonHtmlCandidateRejected();
  await assertNotFoundCandidateRejected();
  await assertGeneratedCandidatesStaySameOrigin();
  await assertCandidateFetchBound();
  await assertMaxDepthZeroSkipsFallback();
  await assertMaxPagesBudgetShared();
  await assertAcceptedCandidateUsesNormalSources();
  await assertNoCandidateStillCompletes();
  await assertNoBrowserDependencyIntroduced();
  console.log("ok p12 html sitemap fallback");
}

main().catch((error) => {
  console.error(`test-p12-html-sitemap-fallback: ${error.message}`);
  process.exitCode = 1;
});
