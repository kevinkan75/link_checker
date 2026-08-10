import {
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
} from "./browser-provider.mjs";

const DYNAMIC_RENDERER_STATUS = Object.freeze({
  NOT_CHECKED: "not_checked",
  STOPPED: "stopped",
  COMPLETED: "completed",
});

const DYNAMIC_RENDER_OUTCOME = Object.freeze({
  RENDERED: "rendered",
  RENDERED_UNSETTLED: "rendered_unsettled",
  BROWSER_UNAVAILABLE: "browser_unavailable",
  NAVIGATION_TIMEOUT: "navigation_timeout",
  NAVIGATION_FAILED: "navigation_failed",
  CHALLENGE_DETECTED: "challenge_detected",
  RENDER_HTML_TOO_LARGE: "render_html_too_large",
  STOPPED: "stopped",
});

const EPHEMERAL_CONTEXT_OPTIONS = Object.freeze({
  serviceWorkers: "block",
  acceptDownloads: false,
  ignoreHTTPSErrors: false,
});

const DEFAULT_RENDER_OPTIONS = Object.freeze({
  renderTimeoutMs: 15000,
  renderSettleMinMs: 1000,
  renderSettleIntervalMs: 250,
  renderSettleStableSamples: 3,
  renderSettleMaxMs: 2500,
  maxRenderedHtmlBytes: 5 * 1024 * 1024,
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
    renderTimeoutMs = DEFAULT_RENDER_OPTIONS.renderTimeoutMs,
    renderSettleMinMs = DEFAULT_RENDER_OPTIONS.renderSettleMinMs,
    renderSettleIntervalMs = DEFAULT_RENDER_OPTIONS.renderSettleIntervalMs,
    renderSettleStableSamples = DEFAULT_RENDER_OPTIONS.renderSettleStableSamples,
    renderSettleMaxMs = DEFAULT_RENDER_OPTIONS.renderSettleMaxMs,
    maxRenderedHtmlBytes = DEFAULT_RENDER_OPTIONS.maxRenderedHtmlBytes,
    extractLinks = null,
    getDocumentBaseUrl = null,
    detectChallenge = null,
    now = () => Date.now(),
    sleep = defaultSleep,
  } = {}) {
    this.enabled = enabled === true;
    this.browser = browser;
    this.browserProvider = browserProvider;
    this.renderLimiter = new RenderLimiter(renderConcurrency);
    this.contextOptions = EPHEMERAL_CONTEXT_OPTIONS;
    this.renderOptions = normalizeRenderOptions({
      renderTimeoutMs,
      renderSettleMinMs,
      renderSettleIntervalMs,
      renderSettleStableSamples,
      renderSettleMaxMs,
      maxRenderedHtmlBytes,
    });
    this.extractLinks = extractLinks;
    this.getDocumentBaseUrl = getDocumentBaseUrl;
    this.detectChallenge = detectChallenge;
    this.now = now;
    this.sleep = sleep;
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

  async renderPage(targetUrl) {
    const startedAt = this.now();
    const result = await this.withPage(async ({ page }) => {
      let navigationResult = null;
      try {
        navigationResult = await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: this.renderOptions.renderTimeoutMs,
        });
      } catch (error) {
        return buildRenderResult({
          attempted: true,
          outcome: isTimeoutError(error)
            ? DYNAMIC_RENDER_OUTCOME.NAVIGATION_TIMEOUT
            : DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
          requestedUrl: targetUrl,
          renderFinalUrl: typeof page.url === "function" ? page.url() : targetUrl,
          elapsedMs: this.now() - startedAt,
          error: sanitizeRenderError(error),
        });
      }

      const settle = await this.waitForSettle(page);
      const renderedHtml = await page.content();
      const renderFinalUrl = typeof page.url === "function" ? page.url() : targetUrl;

      if (Buffer.byteLength(renderedHtml, "utf8") > this.renderOptions.maxRenderedHtmlBytes) {
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.RENDER_HTML_TOO_LARGE,
          requestedUrl: targetUrl,
          renderFinalUrl,
          elapsedMs: this.now() - startedAt,
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
        });
      }

      const challenge = typeof this.detectChallenge === "function"
        ? this.detectChallenge(renderedHtml)
        : null;
      if (challenge?.detected) {
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.CHALLENGE_DETECTED,
          requestedUrl: targetUrl,
          renderFinalUrl,
          elapsedMs: this.now() - startedAt,
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
          challenge,
          links: [],
        });
      }

      const documentBaseUrl = this.resolveDocumentBaseUrl(renderedHtml, renderFinalUrl);
      const links = this.extractRenderedLinks(renderedHtml, documentBaseUrl);
      return buildRenderResult({
        attempted: true,
        outcome: settle.settled
          ? DYNAMIC_RENDER_OUTCOME.RENDERED
          : DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED,
        requestedUrl: targetUrl,
        renderFinalUrl,
        documentBaseUrl,
        elapsedMs: this.now() - startedAt,
        settled: settle.settled,
        settle,
        navigationStatus: getNavigationStatus(navigationResult),
        renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
        links,
      });
    });

    if (!result.ok) {
      return buildRenderResult({
        attempted: result.status !== BROWSER_PROVIDER_STATUS.NOT_CHECKED,
        outcome: result.status === DYNAMIC_RENDERER_STATUS.STOPPED
          ? DYNAMIC_RENDER_OUTCOME.STOPPED
          : DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE,
        requestedUrl: targetUrl,
        renderFinalUrl: targetUrl,
        elapsedMs: this.now() - startedAt,
        rendererStatus: result.status,
        launchOutcome: result.launchOutcome,
      });
    }

    return result.value;
  }

  async waitForSettle(page) {
    const startMs = this.now();
    const minUntilMs = startMs + this.renderOptions.renderSettleMinMs;
    const maxUntilMs = startMs + this.renderOptions.renderSettleMaxMs;
    let stableSamples = 0;
    let previousSignature = null;
    let samples = 0;

    while (this.now() < maxUntilMs) {
      const delayMs = Math.min(
        this.renderOptions.renderSettleIntervalMs,
        Math.max(0, maxUntilMs - this.now()),
      );
      if (delayMs > 0) {
        await this.sleep(delayMs);
      }

      samples += 1;
      const signature = await getUrlAttributeSignature(page);
      if (signature === previousSignature) {
        stableSamples += 1;
      } else {
        previousSignature = signature;
        stableSamples = 1;
      }

      if (this.now() >= minUntilMs && stableSamples >= this.renderOptions.renderSettleStableSamples) {
        return {
          settled: true,
          samples,
          stableSamples,
          elapsedMs: this.now() - startMs,
        };
      }
    }

    return {
      settled: false,
      samples,
      stableSamples,
      elapsedMs: this.now() - startMs,
    };
  }

  resolveDocumentBaseUrl(renderedHtml, renderFinalUrl) {
    return typeof this.getDocumentBaseUrl === "function"
      ? this.getDocumentBaseUrl(renderedHtml, renderFinalUrl)
      : renderFinalUrl;
  }

  extractRenderedLinks(renderedHtml, documentBaseUrl) {
    if (typeof this.extractLinks !== "function") {
      return [];
    }
    return this.extractLinks(renderedHtml, documentBaseUrl)
      .map((link) => ({
        ...link,
        sourceType: "rendered_dom",
      }));
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

function normalizeRenderOptions(options) {
  return {
    renderTimeoutMs: normalizePositiveInteger(options.renderTimeoutMs, DEFAULT_RENDER_OPTIONS.renderTimeoutMs),
    renderSettleMinMs: normalizeNonNegativeInteger(options.renderSettleMinMs, DEFAULT_RENDER_OPTIONS.renderSettleMinMs),
    renderSettleIntervalMs: normalizePositiveInteger(options.renderSettleIntervalMs, DEFAULT_RENDER_OPTIONS.renderSettleIntervalMs),
    renderSettleStableSamples: normalizePositiveInteger(options.renderSettleStableSamples, DEFAULT_RENDER_OPTIONS.renderSettleStableSamples),
    renderSettleMaxMs: Math.max(
      normalizeNonNegativeInteger(options.renderSettleMaxMs, DEFAULT_RENDER_OPTIONS.renderSettleMaxMs),
      normalizeNonNegativeInteger(options.renderSettleMinMs, DEFAULT_RENDER_OPTIONS.renderSettleMinMs),
    ),
    maxRenderedHtmlBytes: normalizeNonNegativeInteger(options.maxRenderedHtmlBytes, DEFAULT_RENDER_OPTIONS.maxRenderedHtmlBytes),
  };
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getUrlAttributeSignature(page) {
  if (typeof page.evaluate === "function") {
    return page.evaluate(() => {
      const attributes = [];
      const selector = "a[href],area[href],form[action],iframe[src],img[src],link[href],script[src],source[src],video[src],base[href]";
      for (const element of document.querySelectorAll(selector)) {
        const tag = element.tagName.toLowerCase();
        for (const attribute of ["href", "action", "src"]) {
          if (element.hasAttribute(attribute)) {
            attributes.push(`${tag}:${attribute}:${element.getAttribute(attribute)}`);
          }
        }
      }
      attributes.sort();
      return `${document.URL}|${attributes.join("\n")}`;
    });
  }
  const html = typeof page.content === "function" ? await page.content() : "";
  return html;
}

function getNavigationStatus(navigationResult) {
  try {
    return typeof navigationResult?.status === "function" ? navigationResult.status() : null;
  } catch {
    return null;
  }
}

function isTimeoutError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return error?.name === "TimeoutError" || message.includes("timeout");
}

function sanitizeRenderError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || error || "")
      .split(/\r?\n/)
      .slice(0, 2)
      .join(" ")
      .replace(/[A-Za-z]:\\[^\s"']+/g, "[path]")
      .replace(/\/[^\s"']+/g, "[path]")
      .slice(0, 500),
  };
}

function buildRenderResult({
  attempted,
  outcome,
  requestedUrl,
  renderFinalUrl,
  documentBaseUrl = null,
  elapsedMs,
  settled = false,
  settle = null,
  navigationStatus = null,
  renderedHtmlBytes = 0,
  links = [],
  challenge = null,
  error = null,
  rendererStatus = null,
  launchOutcome = null,
}) {
  return {
    attempted,
    outcome,
    requestedUrl,
    renderFinalUrl,
    documentBaseUrl,
    elapsedMs,
    settled,
    settle,
    navigationStatus,
    renderedHtmlBytes,
    links,
    linkCount: links.length,
    challenge,
    error,
    rendererStatus,
    launchOutcome,
  };
}

export {
  DEFAULT_RENDER_OPTIONS,
  DYNAMIC_RENDER_OUTCOME,
  DYNAMIC_RENDERER_STATUS,
  DynamicRenderer,
  EPHEMERAL_CONTEXT_OPTIONS,
  RenderLimiter,
};
