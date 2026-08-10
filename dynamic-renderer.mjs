import {
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
} from "./browser-provider.mjs";

const DYNAMIC_RENDERER_STATUS = Object.freeze({
  NOT_CHECKED: "not_checked",
  STOPPED: "stopped",
  COMPLETED: "completed",
});

const EPHEMERAL_CONTEXT_OPTIONS = Object.freeze({
  serviceWorkers: "block",
  acceptDownloads: false,
  ignoreHTTPSErrors: false,
});

class RenderLimiter {
  constructor(limit = 1) {
    this.limit = Math.max(1, Number.parseInt(limit, 10) || 1);
    this.active = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.pump();
    });
  }

  pump() {
    while (this.active < this.limit && this.queue.length > 0) {
      const item = this.queue.shift();
      this.active += 1;
      Promise.resolve()
        .then(item.task)
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

class DynamicRenderer {
  constructor({
    enabled = false,
    browser = "auto",
    browserProvider = new BrowserProvider(),
    renderConcurrency = 1,
  } = {}) {
    this.enabled = enabled === true;
    this.browser = browser;
    this.browserProvider = browserProvider;
    this.renderLimiter = new RenderLimiter(renderConcurrency);
    this.contextOptions = EPHEMERAL_CONTEXT_OPTIONS;
    this.browserResult = null;
    this.launchPromise = null;
    this.terminalLaunchResult = null;
    this.activeContexts = new Set();
    this.closedBrowserResults = new WeakSet();
    this.stopped = false;
    this.closePromise = null;
  }

  async withPage(callback) {
    if (!this.enabled) {
      return buildRendererResult({
        ok: false,
        status: BROWSER_PROVIDER_STATUS.NOT_CHECKED,
        launchOutcome: "dynamic_render_disabled",
      });
    }

    return this.renderLimiter.run(() => this.runJob(callback));
  }

  async runJob(callback) {
    if (this.stopped) {
      return buildRendererResult({
        ok: false,
        status: DYNAMIC_RENDERER_STATUS.STOPPED,
        launchOutcome: "renderer_stopped",
      });
    }

    const browserResult = await this.ensureBrowser();
    if (!browserResult.ok) {
      return browserResult;
    }

    if (this.stopped) {
      return this.buildStoppedResult(browserResult);
    }

    if (this.isBrowserUnexpectedlyClosed()) {
      return this.buildUnexpectedCloseResult();
    }

    const browserInstance = browserResult.browserInstance;
    const context = await browserInstance.newContext({ ...this.contextOptions });
    this.activeContexts.add(context);
    let primaryError = null;
    try {
      if (this.stopped) {
        return this.buildStoppedResult(browserResult);
      }
      const page = await context.newPage();
      const value = await callback({
        browser: browserResult,
        context,
        page,
      });
      return {
        ok: true,
        status: DYNAMIC_RENDERER_STATUS.COMPLETED,
        browser: browserResult.browser,
        browserChannel: browserResult.browserChannel,
        value,
      };
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      try {
        await closeIfPossible(context);
      } catch (cleanupError) {
        if (primaryError) {
          attachCleanupError(primaryError, cleanupError);
        } else {
          throw cleanupError;
        }
      } finally {
        this.activeContexts.delete(context);
      }
    }
  }

  async ensureBrowser() {
    if (this.stopped) {
      return buildRendererResult({
        ok: false,
        status: DYNAMIC_RENDERER_STATUS.STOPPED,
        launchOutcome: "renderer_stopped",
      });
    }

    if (this.isBrowserUnexpectedlyClosed()) {
      return this.buildUnexpectedCloseResult();
    }

    if (this.browserResult?.ok) {
      return this.browserResult;
    }

    if (this.terminalLaunchResult) {
      return this.terminalLaunchResult;
    }

    if (!this.launchPromise) {
      this.launchPromise = this.browserProvider.launchFirstAvailable({ browser: this.browser })
        .then(async (result) => {
          if (result.ok) {
            if (this.stopped) {
              await this.disposeBrowserResult(result);
              return this.buildStoppedResult(result);
            }
            this.browserResult = result;
            return result;
          }
          if (this.stopped) {
            return this.buildStoppedResult(result);
          }
          this.terminalLaunchResult = result;
          return result;
        })
        .catch((error) => {
          if (this.stopped) {
            return this.buildStoppedResult();
          }
          throw error;
        })
        .finally(() => {
          this.launchPromise = null;
        });
    }

    return this.launchPromise;
  }

  async requestStop() {
    this.stopped = true;
    await this.closeActiveContexts();
    return {
      ok: true,
      status: DYNAMIC_RENDERER_STATUS.STOPPED,
      activeContexts: this.activeContexts.size,
    };
  }

  async close() {
    if (!this.closePromise) {
      this.closePromise = (async () => {
        await this.requestStop();
        const pendingLaunch = this.launchPromise;
        if (pendingLaunch) {
          const launchResult = await pendingLaunch;
          if (launchResult?.ok) {
            await this.disposeBrowserResult(launchResult);
          }
        }
        if (this.browserResult?.ok) {
          await this.disposeBrowserResult(this.browserResult);
        }
        return {
          ok: true,
          status: this.isBrowserUnexpectedlyClosed()
            ? BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY
            : DYNAMIC_RENDERER_STATUS.STOPPED,
        };
      })();
    }
    return this.closePromise;
  }

  async closeActiveContexts() {
    await Promise.all([...this.activeContexts].map((context) => closeIfPossible(context)));
  }

  isBrowserUnexpectedlyClosed() {
    return this.browserResult?.ok
      && typeof this.browserResult.getStatus === "function"
      && this.browserResult.getStatus() === BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY;
  }

  buildUnexpectedCloseResult() {
    return buildRendererResult({
      ok: false,
      status: BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY,
      launchOutcome: "browser_closed_unexpectedly",
      browser: this.browserResult?.browser || null,
      browserChannel: this.browserResult?.browserChannel || null,
    });
  }

  buildStoppedResult(browserResult = null) {
    return buildRendererResult({
      ok: false,
      status: DYNAMIC_RENDERER_STATUS.STOPPED,
      launchOutcome: "renderer_stopped",
      browser: browserResult?.browser || null,
      browserChannel: browserResult?.browserChannel || null,
    });
  }

  async disposeBrowserResult(browserResult) {
    if (!browserResult?.ok || typeof browserResult.close !== "function") {
      return;
    }
    if (this.closedBrowserResults.has(browserResult)) {
      return;
    }
    this.closedBrowserResults.add(browserResult);
    await browserResult.close();
  }
}

async function closeIfPossible(target) {
  if (target && typeof target.close === "function") {
    await target.close();
  }
}

function buildRendererResult({
  ok,
  status,
  launchOutcome,
  browser = null,
  browserChannel = null,
}) {
  return {
    ok,
    status,
    launchOutcome,
    browser,
    browserChannel,
  };
}

function attachCleanupError(primaryError, cleanupError) {
  if (primaryError && typeof primaryError === "object" && !Object.hasOwn(primaryError, "cleanupError")) {
    primaryError.cleanupError = cleanupError;
  }
}

export {
  DYNAMIC_RENDERER_STATUS,
  DynamicRenderer,
  EPHEMERAL_CONTEXT_OPTIONS,
  RenderLimiter,
};
