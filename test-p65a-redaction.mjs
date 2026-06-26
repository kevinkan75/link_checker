#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import {
  DEFAULTS,
  LinkChecker,
  buildOutputManifest,
  redactSensitiveQueryValue,
} from "./link-checker.mjs";
import {
  makeBrokenCsv,
  makeEventsLog,
  makeExternalLinksCsv,
} from "./gui-server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoSecrets(text, label) {
  for (const secret of [
    "start-secret",
    "link-secret",
    "person@example.com",
    "external-secret",
    "event-secret",
    "csv-secret",
  ]) {
    assert(!text.includes(secret), `${label} leaked ${secret}`);
  }
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  }
  finally {
    server.close();
    await once(server, "close");
  }
}

async function main() {
  const direct = redactSensitiveQueryValue(
    "Visit https://example.test/callback?token=abc&keep=visible, then /local?email=person@example.com",
    DEFAULTS,
  );
  assert(direct.includes("token=REDACTED"), "Expected token redaction in embedded URL.");
  assert(direct.includes("email=REDACTED"), "Expected email redaction in relative URL.");
  assert(direct.includes("keep=visible"), "Expected non-sensitive query value to remain.");
  assert(
    redactSensitiveQueryValue("https://example.test/?token=abc", { ...DEFAULTS, redactSensitiveQuery: false }).includes("token=abc"),
    "Redaction should be disableable.",
  );

  const requestedPaths = [];
  const report = await withServer((request, response) => {
    requestedPaths.push(request.url);
    if (request.url.startsWith("/missing")) {
      response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      response.end("<html><title>Missing</title><body>missing</body></html>");
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <html>
        <body>
          <a href="/missing?token=link-secret&email=person@example.com&keep=visible">missing</a>
        </body>
      </html>
    `);
  }, async (origin) => {
    const checker = new LinkChecker(`${origin}/?token=start-secret&keep=visible`, {
      maxPages: 1,
      retryCount: 0,
      confirm404: false,
      concurrency: 2,
      perHostConcurrency: 2,
      requestDelayMs: 0,
    });
    return checker.run();
  });

  assert(requestedPaths.some((path) => path.includes("token=start-secret")), "Actual request lost the original start token.");
  assert(requestedPaths.some((path) => path.includes("token=link-secret")), "Actual request lost the original link token.");

  const reportJson = JSON.stringify(report);
  assertNoSecrets(reportJson, "report");
  assert(reportJson.includes("token=REDACTED"), "Report should contain redacted token marker.");
  assert(reportJson.includes("email=REDACTED"), "Report should contain redacted email marker.");
  assert(reportJson.includes("keep=visible"), "Report should preserve non-sensitive query values.");

  const manifest = buildOutputManifest({
    startUrl: "https://example.test/?token=start-secret&keep=visible",
    options: report.options,
    generatedFiles: [
      { path: "report.json", kind: "report", schemaVersion: report.schemaVersion },
    ],
  });
  const manifestJson = JSON.stringify(manifest);
  assertNoSecrets(manifestJson, "manifest");
  assert(manifestJson.includes("token=REDACTED"), "Manifest should redact startUrl.");

  const brokenCsv = makeBrokenCsv(report.broken, report.options);
  assert(brokenCsv.charCodeAt(0) === 0xFEFF, "broken.csv must start with UTF-8 BOM.");
  assertNoSecrets(brokenCsv, "broken csv");
  assert(brokenCsv.includes("token=REDACTED"), "broken.csv should contain redacted token marker.");

  const externalCsv = makeExternalLinksCsv([
    {
      url: "https://external.test/file?api_key=external-secret&keep=visible",
      hostname: "external.test",
      registrableDomain: "external.test",
      type: "document",
      categories: [],
      externalRisk: {},
      sourceCount: 1,
      checked: false,
      ok: null,
      sources: [
        {
          page: "https://source.test/page?session=csv-secret",
          tag: "a",
          attribute: "href",
          text: "https://external.test/file?api_key=external-secret",
        },
      ],
    },
  ], report.options);
  assert(externalCsv.charCodeAt(0) === 0xFEFF, "external-links.csv must start with UTF-8 BOM.");
  assertNoSecrets(externalCsv, "external csv");
  assert(externalCsv.includes("api_key=REDACTED"), "external-links.csv should redact api_key.");
  assert(externalCsv.includes("session=REDACTED"), "external-links.csv should redact source session.");

  const eventsLog = makeEventsLog([
    {
      at: "2026-01-01T00:00:00.000Z",
      type: "request",
      message: "GET https://example.test/path?token=event-secret&keep=visible",
      detail: "/next?token=event-secret",
    },
  ], report.options);
  assertNoSecrets(eventsLog, "events log");
  assert(eventsLog.includes("token=REDACTED"), "events.log should redact token.");

  console.log("ok p65a redaction");
}

main().catch((error) => {
  console.error(`test-p65a-redaction: ${error.message}`);
  process.exitCode = 1;
});
