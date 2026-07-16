#!/usr/bin/env node

import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LinkChecker } from "./link-checker.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const RECENT_CHECKED_AT = new Date().toISOString();

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function withServer(handler, task) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  try {
    return await task(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

function makeChecker(startUrl, options = {}) {
  return new LinkChecker(startUrl, {
    allowLocalhost: true,
    robotsTxt: false,
    retryCount: 0,
    requestDelayMs: 0,
    confirm404: false,
    maxDepth: 1,
    ...options,
  });
}

function baselineReportFor(origin, overrides = {}) {
  return {
    schemaVersion: "1.2.0",
    runStatus: { status: "complete" },
    startUrl: origin,
    checked: [
      {
        url: `${origin}/known?token=secret-value`,
        canonicalUrl: `${origin}/known?token=secret-value`,
        ok: true,
        status: 200,
        checkedAt: RECENT_CHECKED_AT,
      },
      {
        url: `${origin}/gone`,
        canonicalUrl: `${origin}/gone`,
        ok: true,
        status: 200,
        checkedAt: RECENT_CHECKED_AT,
      },
    ],
    ...overrides,
  };
}

async function assertBaselineClassificationAndStateRedaction() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-baseline-"));
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <a href="/known?token=secret-value">known</a>
          <a href="/new">new</a>
        `);
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(baselineFile, `${JSON.stringify(baselineReportFor(origin), null, 2)}\n`, "utf8");

      const checker = makeChecker(origin, {
        incremental: true,
        baselineReport: baselineFile,
        stateFile,
      });
      const report = await checker.run();
      const summary = report.summary.incremental;
      const stateText = await readFile(stateFile, "utf8");
      const state = JSON.parse(stateText);

      assert(summary.enabled === true, "Incremental summary should be enabled.");
      assert(summary.baselineRead === true, "Baseline report should be read.");
      assert(summary.known === 1, "Baseline known URL should classify as known.");
      assert(summary.new === 1, "Current-only URL should classify as new.");
      assert(summary.disappeared === 1, "Baseline-only URL should classify as disappeared.");
      assert(summary.reused === 0, "P8a must not reuse status results.");
      assert(Object.keys(state.urls).length === 2, "State should contain current inventory URLs only.");
      assert(!stateText.includes("secret-value"), "Incremental state must not store raw sensitive query values.");
      assert(stateText.includes("token=REDACTED"), "Incremental state should keep a redacted display URL.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertStateReadClassifiesKnown() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-state-"));
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<a href="/stable">stable</a>');
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const stateFile = path.join(tempDir, "state.json");
      await makeChecker(origin, { incremental: true, stateFile }).run();
      const secondReport = await makeChecker(origin, { incremental: true, stateFile }).run();
      const summary = secondReport.summary.incremental;

      assert(summary.stateRead === true, "Second run should read the state file.");
      assert(summary.known === 1, "State-backed URL should classify as known.");
      assert(summary.new === 0, "No current URLs should be new on second run.");
      assert(summary.disappeared === 0, "No previous URLs should disappear on second run.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertRedactedBaselineStillMatchesSensitiveUrl() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-redacted-baseline-"));
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<a href="/known?token=secret-value">known</a>');
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(baselineFile, `${JSON.stringify({
        schemaVersion: "1.2.0",
        runStatus: { status: "complete" },
        startUrl: origin,
        checked: [
          {
            url: `${origin}/`,
            canonicalUrl: `${origin}/`,
            ok: true,
            status: 200,
            checkedAt: RECENT_CHECKED_AT,
          },
          {
            url: `${origin}/known?token=REDACTED`,
            canonicalUrl: `${origin}/known?token=REDACTED`,
            ok: true,
            status: 200,
            checkedAt: RECENT_CHECKED_AT,
          },
        ],
      }, null, 2)}\n`, "utf8");

      const report = await makeChecker(origin, {
        incremental: true,
        baselineReport: baselineFile,
        stateFile,
      }).run();
      const summary = report.summary.incremental;

      assert(summary.known === 1, "Redacted baseline URL should match current sensitive URL.");
      assert(summary.new === 0, "Current sensitive URL should not become new only because baseline is redacted.");
      assert(summary.disappeared === 0, "Baseline start URL should not count as disappeared.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertPolicyMismatchClassification() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-policy-"));
  try {
    await withServer((request, response) => {
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<a href="/known?token=secret-value">known</a>');
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(baselineFile, `${JSON.stringify(baselineReportFor(origin, {
        checked: [
          {
            url: `${origin}/known?token=secret-value`,
            canonicalUrl: `${origin}/known?token=secret-value`,
            ok: true,
            status: 200,
            checkedAt: RECENT_CHECKED_AT,
          },
        ],
        options: {
          canonicalStrategy: "safe",
          userAgent: "DifferentAgent/1.0",
          acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8",
          checkExternal: false,
          preferGet: false,
          externalReferer: false,
          spaLinks: "auto",
          blockPrivateIp: true,
          allowLocalhost: true,
          allowPrivateIp: false,
        },
        scanPolicy: {
          robotsTxt: {
            mode: "disabled",
            status: "disabled",
            pathEnforcement: false,
          },
        },
      }), null, 2)}\n`, "utf8");

      const report = await makeChecker(origin, {
        incremental: true,
        baselineReport: baselineFile,
        stateFile,
      }).run();

      assert(report.summary.incremental.policyMismatch === 1, "Policy mismatch should force recheck classification.");
      assert(report.summary.incremental.known === 0, "Policy mismatch URL should not count as plain known.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertIncrementalPriorityOrder() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-priority-"));
  try {
    const requestOrder = [];
    await withServer((request, response) => {
      if (request.url !== "/" && request.method !== "GET") {
        requestOrder.push(request.url);
      }
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <a href="/stable">stable</a>
          <a href="/previous-error">previous error</a>
          <a href="/redirected">redirected</a>
          <a href="/fresh">fresh</a>
        `);
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      await writeFile(baselineFile, `${JSON.stringify({
        schemaVersion: "1.2.0",
        runStatus: { status: "complete" },
        startUrl: origin,
        checked: [
          {
            url: `${origin}/stable`,
            canonicalUrl: `${origin}/stable`,
            ok: true,
            status: 200,
            checkedAt: RECENT_CHECKED_AT,
          },
          {
            url: `${origin}/previous-error`,
            canonicalUrl: `${origin}/previous-error`,
            ok: false,
            status: 500,
            issueType: "server_error",
            classification: "server_error",
            checkedAt: RECENT_CHECKED_AT,
          },
          {
            url: `${origin}/redirected`,
            canonicalUrl: `${origin}/redirected`,
            ok: true,
            status: 200,
            redirected: true,
            redirectCount: 1,
            finalUrl: `${origin}/redirected-final`,
            checkedAt: RECENT_CHECKED_AT,
          },
        ],
      }, null, 2)}\n`, "utf8");

      const report = await makeChecker(origin, {
        incremental: true,
        baselineReport: baselineFile,
        stateFile,
        maxDepth: 0,
        concurrency: 1,
        perHostConcurrency: 1,
      }).run();
      const summary = report.summary.incremental;

      assert(summary.new === 1, "Priority fixture should include one new URL.");
      assert(summary.previousError === 1, "Priority fixture should include one previous-error URL.");
      assert(summary.unstableRedirect === 1, "Priority fixture should include one unstable redirect URL.");
      assert(summary.known === 1, "Priority fixture should include one stable known URL.");
      assert(summary.priority.boosted === 3, "New/error/redirect URLs should be boosted.");
      assert(summary.priority.deferred === 1, "Stable known URL should be deferred.");
      assert(requestOrder[0] === "/fresh", "New URL should be checked before lower-priority known URLs.");
      assert(requestOrder[1] === "/previous-error", "Previous error should be checked after new URL.");
      assert(requestOrder[2] === "/redirected", "Unstable redirect should be checked before stable known URL.");
      assert(requestOrder[3] === "/stable", "Stable known URL should be checked last.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertChangedOnlyReusesOnlyStableKnownResults() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-changed-only-"));
  try {
    const requestCounts = new Map();
    await withServer((request, response) => {
      requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end(`
          <a href="/stable">stable</a>
          <a href="/previous-error">previous error</a>
        `);
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      const checkedAt = new Date().toISOString();
      await writeFile(baselineFile, `${JSON.stringify({
        schemaVersion: "1.2.0",
        runStatus: { status: "complete" },
        startUrl: origin,
        checked: [
          {
            url: `${origin}/stable`,
            canonicalUrl: `${origin}/stable`,
            ok: true,
            status: 200,
            issueType: "ok",
            classification: "ok",
            checkedAt,
          },
          {
            url: `${origin}/previous-error`,
            canonicalUrl: `${origin}/previous-error`,
            ok: false,
            status: 500,
            issueType: "server_error",
            classification: "server_error",
            checkedAt,
          },
        ],
      }, null, 2)}\n`, "utf8");

      const report = await makeChecker(origin, {
        incremental: true,
        changedOnly: true,
        baselineReport: baselineFile,
        stateFile,
        maxDepth: 0,
        concurrency: 1,
        perHostConcurrency: 1,
      }).run();
      const summary = report.summary.incremental;
      const stable = report.checked.find((item) => item.url.endsWith("/stable"));
      const previousError = report.checked.find((item) => item.url.endsWith("/previous-error"));

      assert(summary.mode === "changed_only", "Changed-only mode should be visible in the summary.");
      assert(summary.reused === 1, "Only the stable known URL should be reused.");
      assert(summary.reuse.enabled === true, "Reuse summary should be enabled.");
      assert(summary.reuse.bySource.baseline_report === 1, "Reuse summary should count baseline report provenance.");
      assert(summary.previousError === 1, "Previous error should remain classified for recheck.");
      assert(requestCounts.get("/stable") === undefined, "Stable known URL should not make a status request in changed-only mode.");
      assert(requestCounts.get("/previous-error") === 1, "Previous error must still be requested.");
      assert(stable?.incremental?.reused === true, "Reused result should be marked on the checked item.");
      assert(stable?.incremental?.reuseSource === "baseline_report", "Reused result should identify its primary reuse source.");
      assert(stable?.incremental?.reuseSources?.includes("baseline_report"), "Reused result should keep all reuse sources.");
      assert(stable?.incremental?.baselineCheckedAt === checkedAt, "Reused result should preserve the baseline checked time.");
      assert(stable?.incremental?.reason === "stable_known_policy_match_ttl_valid", "Reused result should explain why it was reused.");
      assert(previousError?.incremental?.reused !== true, "Previous error result must not be reused.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function assertChangedOnlyDoesNotReuseRiskyPreviousResults() {
  const cases = [
    {
      name: "policy-mismatch",
      path: "/policy-mismatch",
      expectedSummaryKey: "policyMismatch",
      baselineOptions: {
        canonicalStrategy: "safe",
        userAgent: "DifferentAgent/1.0",
        acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8",
        checkExternal: false,
        preferGet: false,
        externalReferer: false,
        spaLinks: "auto",
        blockPrivateIp: true,
        allowLocalhost: true,
        allowPrivateIp: false,
      },
      baselineScanPolicy: {
        robotsTxt: {
          mode: "disabled",
          status: "disabled",
          pathEnforcement: false,
        },
      },
      checkedOverrides: {},
    },
    {
      name: "ttl-expired",
      path: "/ttl-expired",
      expectedSummaryKey: "ttlExpired",
      checkedOverrides: {
        cache: {
          expiresAt: "2000-01-01T00:00:00.000Z",
        },
      },
    },
    {
      name: "unstable-redirect",
      path: "/unstable-redirect",
      expectedSummaryKey: "unstableRedirect",
      checkedOverrides: {
        redirected: true,
        redirectCount: 1,
      },
    },
  ];

  for (const testCase of cases) {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), `link-checker-p8-changed-only-${testCase.name}-`));
    try {
      const requestCounts = new Map();
      await withServer((request, response) => {
        requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
        if (request.url === "/") {
          response.writeHead(200, { "content-type": "text/html" });
          response.end(`<a href="${testCase.path}">${testCase.name}</a>`);
          return;
        }
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("ok");
      }, async (origin) => {
        const baselineFile = path.join(tempDir, "baseline.json");
        const stateFile = path.join(tempDir, "state.json");
        const checkedAt = new Date().toISOString();
        const baseline = {
          schemaVersion: "1.2.0",
          runStatus: { status: "complete" },
          startUrl: origin,
          checked: [
            {
              url: `${origin}${testCase.path}`,
              canonicalUrl: `${origin}${testCase.path}`,
              ok: true,
              status: 200,
              issueType: "ok",
              classification: "ok",
              checkedAt,
              ...testCase.checkedOverrides,
            },
          ],
        };
        if (testCase.baselineOptions) {
          baseline.options = testCase.baselineOptions;
        }
        if (testCase.baselineScanPolicy) {
          baseline.scanPolicy = testCase.baselineScanPolicy;
        }
        await writeFile(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

        const report = await makeChecker(origin, {
          incremental: true,
          changedOnly: true,
          baselineReport: baselineFile,
          stateFile,
          maxDepth: 0,
          concurrency: 1,
          perHostConcurrency: 1,
        }).run();
        const summary = report.summary.incremental;
        const checked = report.checked.find((item) => item.url.endsWith(testCase.path));

        assert(summary.mode === "changed_only", `${testCase.name} should run in changed-only mode.`);
        assert(summary.reused === 0, `${testCase.name} must not reuse the previous result.`);
        assert(summary.reuse.enabled === true, `${testCase.name} should keep reuse summary enabled.`);
        assert(summary[testCase.expectedSummaryKey] === 1, `${testCase.name} should increment ${testCase.expectedSummaryKey}.`);
        assert(requestCounts.get(testCase.path) === 1, `${testCase.name} must make a fresh status request.`);
        assert(checked?.incremental?.reused !== true, `${testCase.name} checked item must not be marked as reused.`);
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

async function assertChangedOnlyStillFetchesHtmlAndBuildsCurrentInventory() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "link-checker-p8-changed-only-html-discovery-"));
  try {
    const requestCounts = new Map();
    await withServer((request, response) => {
      requestCounts.set(request.url, (requestCounts.get(request.url) || 0) + 1);
      if (request.url === "/") {
        response.writeHead(200, { "content-type": "text/html" });
        response.end('<a href="/current-only.html">current-only</a>');
        return;
      }
      if (request.url === "/current-only.html") {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("missing");
        return;
      }
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
    }, async (origin) => {
      const baselineFile = path.join(tempDir, "baseline.json");
      const stateFile = path.join(tempDir, "state.json");
      const checkedAt = new Date().toISOString();
      await writeFile(baselineFile, `${JSON.stringify({
        schemaVersion: "1.2.0",
        runStatus: { status: "complete" },
        startUrl: origin,
        checked: [
          {
            url: `${origin}/`,
            canonicalUrl: `${origin}/`,
            ok: true,
            status: 200,
            issueType: "ok",
            classification: "ok",
            checkedAt,
          },
        ],
      }, null, 2)}\n`, "utf8");

      const report = await makeChecker(origin, {
        incremental: true,
        changedOnly: true,
        baselineReport: baselineFile,
        stateFile,
        maxDepth: 1,
        concurrency: 1,
        perHostConcurrency: 1,
      }).run();
      const summary = report.summary.incremental;
      const currentOnly = report.checked.find((item) => item.url.endsWith("/current-only.html"));
      const currentOnlyBroken = report.broken.find((item) => item.url.endsWith("/current-only.html"));

      assert(summary.mode === "changed_only", "HTML discovery fixture should run in changed-only mode.");
      assert(requestCounts.get("/") === 1, "Changed-only must still fetch the start page HTML body.");
      assert(requestCounts.get("/current-only.html") >= 1, "Current-only discovered URL must receive a current request.");
      assert(summary.new === 1, "Current-only discovered URL should classify as new.");
      assert(currentOnly, "Current-only URL should appear in checked results.");
      assert(currentOnly?.incremental?.reused !== true, "Current-only URL must not be marked as reused.");
      assert(currentOnlyBroken?.sourceCount === 1, "Broken current-only URL should keep one current source.");
      assert(currentOnlyBroken?.sources?.[0]?.page === `${origin}/`, "Broken source should come from the current page crawl.");
      assert(currentOnlyBroken?.sources?.[0]?.text === "/current-only.html", "Broken source should use the current HTML link value.");
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

await assertBaselineClassificationAndStateRedaction();
await assertStateReadClassifiesKnown();
await assertRedactedBaselineStillMatchesSensitiveUrl();
await assertPolicyMismatchClassification();
await assertIncrementalPriorityOrder();
await assertChangedOnlyReusesOnlyStableKnownResults();
await assertChangedOnlyDoesNotReuseRiskyPreviousResults();
await assertChangedOnlyStillFetchesHtmlAndBuildsCurrentInventory();

console.log("ok p8 incremental state");
