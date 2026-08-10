import assert from "node:assert/strict";
import {
  BROWSER_PROVIDER_STATUS,
} from "./browser-provider.mjs";
import {
  DYNAMIC_RENDERER_STATUS,
  DynamicRenderer,
  EPHEMERAL_CONTEXT_OPTIONS,
} from "./dynamic-renderer.mjs";

class FakePage {
  constructor(context, id) {
    this.context = context;
    this.id = id;
  }
}

class FakeContext {
  constructor(browser, id, options) {
    this.browser = browser;
    this.id = id;
    this.options = options;
    this.pages = [];
    this.closed = false;
    this.closeCount = 0;
    this.closeAttemptCount = 0;
    this.closeError = browser.nextContextCloseError;
    browser.nextContextCloseError = null;
    this.newPageError = browser.nextNewPageError;
    browser.nextNewPageError = null;
  }

  async newPage() {
    assert.equal(this.closed, false, "Closed contexts should not create pages.");
    if (this.newPageError) {
      throw this.newPageError;
    }
    const page = new FakePage(this, `${this.id}-page-${this.pages.length + 1}`);
    this.pages.push(page);
    this.browser.pages.push(page);
    return page;
  }

  async close() {
    this.closeAttemptCount += 1;
    if (this.closeError) {
      const closeError = this.closeError;
      this.closeError = null;
      throw closeError;
    }
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeCount += 1;
    this.browser.closedContexts.push(this);
  }
}

class FakeBrowser {
  constructor(id = "browser-1") {
    this.id = id;
    this.contexts = [];
    this.pages = [];
    this.closedContexts = [];
    this.closeCount = 0;
    this.nextContextCloseError = null;
    this.nextNewPageError = null;
    this.handlers = new Map();
  }

  on(eventName, handler) {
    this.handlers.set(eventName, handler);
  }

  async newContext(options) {
    const context = new FakeContext(this, `${this.id}-context-${this.contexts.length + 1}`, options);
    this.contexts.push(context);
    return context;
  }

  async close() {
    this.closeCount += 1;
    this.handlers.get("disconnected")?.();
  }

  disconnectUnexpectedly() {
    this.handlers.get("disconnected")?.();
  }
}

class FakeBrowserProvider {
  constructor(results) {
    this.results = Array.isArray(results) ? results : [results];
    this.launchCount = 0;
    this.launchCalls = [];
  }

  async launchFirstAvailable(options) {
    this.launchCount += 1;
    this.launchCalls.push(options);
    const index = Math.min(this.launchCount - 1, this.results.length - 1);
    const result = this.results[index];
    return typeof result === "function" ? result(options) : result;
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createAvailableResult(fakeBrowser) {
  let normalCloseRequested = false;
  const lifecycle = {
    status: BROWSER_PROVIDER_STATUS.AVAILABLE,
    closedUnexpectedly: false,
  };

  fakeBrowser.on("disconnected", () => {
    if (!normalCloseRequested) {
      lifecycle.status = BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY;
      lifecycle.closedUnexpectedly = true;
    }
  });

  return {
    ok: true,
    requestedBrowser: "auto",
    browser: "msedge",
    browserChannel: "msedge",
    browserVersion: "fake-version",
    browserInstance: fakeBrowser,
    status: BROWSER_PROVIDER_STATUS.AVAILABLE,
    launchOutcome: "available",
    attempts: [],
    lifecycle,
    getStatus: () => lifecycle.status,
    close: async () => {
      normalCloseRequested = true;
      await fakeBrowser.close();
      lifecycle.status = BROWSER_PROVIDER_STATUS.AVAILABLE;
      lifecycle.closedUnexpectedly = false;
      return {
        ok: true,
        status: BROWSER_PROVIDER_STATUS.AVAILABLE,
        browser: "msedge",
        browserChannel: "msedge",
        closeOutcome: "closed",
      };
    },
  };
}

function createUnavailableResult(status) {
  return {
    ok: false,
    requestedBrowser: "auto",
    browser: null,
    browserChannel: null,
    browserVersion: null,
    status,
    launchOutcome: status === BROWSER_PROVIDER_STATUS.NOT_FOUND
      ? "browser_unavailable"
      : "browser_launch_failed",
    attempts: [],
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testFeatureOffDoesNotLaunch() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ browserProvider: provider });

  const result = await renderer.withPage(() => {
    throw new Error("Disabled renderers must not run jobs.");
  });

  assert.equal(provider.launchCount, 0, "Disabled Dynamic Render should not launch a Browser.");
  assert.equal(result.status, BROWSER_PROVIDER_STATUS.NOT_CHECKED);
}

async function testLazyLaunchAndContextDefaults() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  assert.equal(provider.launchCount, 0, "Renderer construction should be lazy.");

  const result = await renderer.withPage(({ context, page }) => {
    assert.ok(context);
    assert.ok(page);
    return "rendered";
  });

  assert.equal(result.ok, true);
  assert.equal(provider.launchCount, 1, "First job should launch exactly once.");
  assert.deepEqual(browser.contexts[0].options, EPHEMERAL_CONTEXT_OPTIONS);
  assert.equal(Object.hasOwn(browser.contexts[0].options, "storageState"), false);
  assert.equal(Object.hasOwn(browser.contexts[0].options, "httpCredentials"), false);
  assert.equal(Object.hasOwn(browser.contexts[0].options, "permissions"), false);
  assert.equal(browser.closedContexts.length, 1, "Job context should close after success.");
}

async function testSingleFlightConcurrentLaunch() {
  const browser = new FakeBrowser();
  const deferredLaunch = createDeferred();
  const provider = new FakeBrowserProvider(() => deferredLaunch.promise);
  const renderer = new DynamicRenderer({
    enabled: true,
    browserProvider: provider,
    renderConcurrency: 3,
  });

  const jobs = [1, 2, 3].map(() => renderer.withPage(({ browser: browserResult }) => {
    return browserResult.browserInstance.id;
  }));

  await flushMicrotasks();
  assert.equal(provider.launchCount, 1, "Concurrent first jobs should share one launch.");

  deferredLaunch.resolve(createAvailableResult(browser));
  const results = await Promise.all(jobs);

  assert.deepEqual(results.map((result) => result.value), ["browser-1", "browser-1", "browser-1"]);
  assert.equal(provider.launchCount, 1);
  assert.equal(browser.contexts.length, 3);
  assert.equal(new Set(browser.contexts).size, 3, "Each job should receive a fresh Context.");
  assert.equal(browser.pages.length, 3);
  assert.equal(new Set(browser.pages).size, 3, "Each job should receive a fresh Page.");
  assert.equal(browser.closedContexts.length, 3);
}

async function testSequentialBrowserReuseAndIdempotentClose() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  await renderer.withPage(({ browser: browserResult }) => browserResult.browserInstance.id);
  await renderer.withPage(({ browser: browserResult }) => browserResult.browserInstance.id);

  assert.equal(provider.launchCount, 1, "Sequential jobs should reuse one Browser.");
  assert.equal(browser.contexts.length, 2);
  assert.equal(browser.closedContexts.length, 2);

  const closeA = await renderer.close();
  const closeB = await renderer.close();

  assert.equal(closeA.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(closeB.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(browser.closeCount, 1, "Renderer close should close the Browser once.");
}

async function testErrorCleanup() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  await assert.rejects(
    renderer.withPage(() => {
      throw new Error("job failed");
    }),
    /job failed/,
  );

  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.closedContexts.length, 1, "Job context should close after callback failure.");
}

async function testNewPageFailureCleansContextAndPreservesError() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });
  const pageError = new Error("new page failed");
  browser.nextNewPageError = pageError;

  await assert.rejects(
    renderer.withPage(() => {
      throw new Error("Callback should not run after newPage failure.");
    }),
    (error) => error === pageError,
  );

  assert.equal(browser.contexts.length, 1);
  assert.equal(browser.pages.length, 0);
  assert.equal(browser.contexts[0].closeAttemptCount, 1);
  assert.equal(browser.closedContexts.length, 1);
  assert.equal(renderer.activeContexts.size, 0);

  const second = await renderer.withPage(() => "browser still reusable");
  assert.equal(second.ok, true);
  assert.equal(provider.launchCount, 1);
}

async function testCallbackErrorWinsOverCleanupError() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });
  const callbackError = new Error("callback failed");
  const cleanupError = new Error("context close failed");
  browser.nextContextCloseError = cleanupError;

  await assert.rejects(
    renderer.withPage(() => {
      throw callbackError;
    }),
    (error) => {
      assert.equal(error, callbackError);
      assert.equal(error.cleanupError, cleanupError);
      return true;
    },
  );

  assert.equal(browser.contexts[0].closeAttemptCount, 1);
  assert.equal(renderer.activeContexts.size, 0);
}

async function testCleanupErrorFailsSuccessfulJob() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });
  const cleanupError = new Error("context close failed");
  browser.nextContextCloseError = cleanupError;

  await assert.rejects(
    renderer.withPage(() => "successful callback"),
    (error) => error === cleanupError,
  );

  assert.equal(browser.contexts[0].closeAttemptCount, 1);
  assert.equal(renderer.activeContexts.size, 0);
}

async function testUnavailableAndLaunchFailedDoNotCreateContext() {
  for (const status of [BROWSER_PROVIDER_STATUS.NOT_FOUND, BROWSER_PROVIDER_STATUS.LAUNCH_FAILED]) {
    const provider = new FakeBrowserProvider(createUnavailableResult(status));
    const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

    const result = await renderer.withPage(() => {
      throw new Error("Unavailable Browsers must not run jobs.");
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, status);
    assert.equal(provider.launchCount, 1);
  }
}

async function testStopLifecycle() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  const result = await renderer.withPage(async ({ context }) => {
    const stopResult = await renderer.requestStop();
    assert.equal(stopResult.status, DYNAMIC_RENDERER_STATUS.STOPPED);
    assert.equal(context.closed, true, "requestStop should close active contexts.");
    return "stopped";
  });

  assert.equal(result.ok, true);
  assert.equal(browser.closedContexts.length, 1);

  const afterStop = await renderer.withPage(() => {
    throw new Error("Stopped renderers must reject new jobs.");
  });

  assert.equal(afterStop.ok, false);
  assert.equal(afterStop.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(provider.launchCount, 1);
}

async function testRepeatedStopAndCloseCombinations() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  await renderer.withPage(() => "active browser");

  const stopA = await renderer.requestStop();
  const stopB = await renderer.requestStop();
  const closeA = await renderer.close();
  const closeB = await renderer.close();
  const stopAfterClose = await renderer.requestStop();

  assert.equal(stopA.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(stopB.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(stopAfterClose.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(closeA.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(closeB.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(browser.closeCount, 1);
  assert.equal(provider.launchCount, 1);

  const afterStop = await renderer.withPage(() => {
    throw new Error("Stopped renderer should not run future jobs.");
  });
  assert.equal(afterStop.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(provider.launchCount, 1);
}

async function testStopDuringLaunchDisposesLateBrowser() {
  const browser = new FakeBrowser("late-browser");
  const deferredLaunch = createDeferred();
  const provider = new FakeBrowserProvider(() => deferredLaunch.promise);
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  const job = renderer.withPage(() => {
    throw new Error("Stopped launch must not create a job Page.");
  });

  await flushMicrotasks();
  assert.equal(provider.launchCount, 1);

  const stopResult = await renderer.requestStop();
  assert.equal(stopResult.status, DYNAMIC_RENDERER_STATUS.STOPPED);

  deferredLaunch.resolve(createAvailableResult(browser));
  const jobResult = await job;

  assert.equal(jobResult.ok, false);
  assert.equal(jobResult.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(browser.contexts.length, 0);
  assert.equal(browser.pages.length, 0);
  assert.equal(browser.closeCount, 1);
  assert.equal(provider.launchCount, 1);

  const futureJob = await renderer.withPage(() => {
    throw new Error("Stopped renderer should not relaunch.");
  });
  assert.equal(futureJob.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(provider.launchCount, 1);
}

async function testCloseDuringLaunchWaitsAndDisposesLateBrowser() {
  const browser = new FakeBrowser("close-during-launch-browser");
  const deferredLaunch = createDeferred();
  const provider = new FakeBrowserProvider(() => deferredLaunch.promise);
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  const job = renderer.withPage(() => {
    throw new Error("Closed renderer must not create a job Page.");
  });

  await flushMicrotasks();
  assert.equal(provider.launchCount, 1);

  let closeSettled = false;
  const closePromise = renderer.close().then((result) => {
    closeSettled = true;
    return result;
  });

  await flushMicrotasks();
  assert.equal(closeSettled, false, "close() should wait for the pending launch to resolve.");

  deferredLaunch.resolve(createAvailableResult(browser));
  const [jobResult, closeResult] = await Promise.all([job, closePromise]);

  assert.equal(jobResult.ok, false);
  assert.equal(jobResult.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(closeResult.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(browser.contexts.length, 0);
  assert.equal(browser.pages.length, 0);
  assert.equal(browser.closeCount, 1);
  assert.equal(provider.launchCount, 1);

  const futureJob = await renderer.withPage(() => {
    throw new Error("Closed renderer should not relaunch.");
  });
  assert.equal(futureJob.status, DYNAMIC_RENDERER_STATUS.STOPPED);
  assert.equal(provider.launchCount, 1);
}

async function testUnexpectedDisconnectDoesNotRelaunch() {
  const browser = new FakeBrowser();
  const provider = new FakeBrowserProvider(createAvailableResult(browser));
  const renderer = new DynamicRenderer({ enabled: true, browserProvider: provider });

  const first = await renderer.withPage(() => "first");
  assert.equal(first.ok, true);

  browser.disconnectUnexpectedly();

  const second = await renderer.withPage(() => {
    throw new Error("Unexpectedly closed Browser should not run another job.");
  });

  assert.equal(second.ok, false);
  assert.equal(second.status, BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY);
  assert.equal(provider.launchCount, 1, "Unexpected disconnect should not trigger endless relaunch.");
}

const tests = [
  testFeatureOffDoesNotLaunch,
  testLazyLaunchAndContextDefaults,
  testSingleFlightConcurrentLaunch,
  testSequentialBrowserReuseAndIdempotentClose,
  testErrorCleanup,
  testNewPageFailureCleansContextAndPreservesError,
  testCallbackErrorWinsOverCleanupError,
  testCleanupErrorFailsSuccessfulJob,
  testUnavailableAndLaunchFailedDoNotCreateContext,
  testStopLifecycle,
  testRepeatedStopAndCloseCombinations,
  testStopDuringLaunchDisposesLateBrowser,
  testCloseDuringLaunchWaitsAndDisposesLateBrowser,
  testUnexpectedDisconnectDoesNotRelaunch,
];

for (const test of tests) {
  await test();
}

console.log(`P1-02 DynamicRenderer lifecycle tests passed (${tests.length}).`);
