import { performance } from "node:perf_hooks";
import {
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
} from "./browser-provider.mjs";

const DYNAMIC_RENDERER_STATUS = Object.freeze({
  NOT_CHECKED: "not_checked",
  STOPPED: "stopped",
  RENDER_TIMEOUT: "render_timeout",
  COMPLETED: "completed",
});

const DYNAMIC_RENDER_OUTCOME = Object.freeze({
  RENDERED: "rendered",
  RENDERED_UNSETTLED: "rendered_unsettled",
  BROWSER_UNAVAILABLE: "browser_unavailable",
  NAVIGATION_TIMEOUT: "navigation_timeout",
  RENDER_TIMEOUT: "render_timeout",
  NAVIGATION_FAILED: "navigation_failed",
  RENDER_SCOPE_BLOCKED: "render_scope_blocked",
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

const SAFE_BROWSER_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const TRAFFIC_REQUEST_SAMPLE_LIMIT = 200;
const TRAFFIC_BLOCKED_SAMPLE_LIMIT = 100;
const TRAFFIC_INTERVAL_SAMPLE_LIMIT = 200;
const BROWSER_REQUEST_POLICY_DECISION = Object.freeze({
  ALLOW: "ALLOW",
  BLOCK: "BLOCK",
  ERROR_OR_FAIL_CLOSED: "ERROR_OR_FAIL_CLOSED",
});
const BROWSER_REQUEST_POLICY_REASON = Object.freeze({
  UNSAFE_METHOD: "unsafe_method",
  MAIN_FRAME_SCOPE_BLOCKED: "main_frame_scope_blocked",
  URL_SECURITY_BLOCKED: "url_security_blocked",
  SECURITY_EVALUATOR_FAILED: "security_evaluator_failed",
  INVALID_SECURITY_DECISION: "invalid_security_decision",
  UNKNOWN_REQUEST_CLASS: "unknown_request_class",
});
const BROWSER_REQUEST_CLASSES = new Set([
  "main_document",
  "iframe_frame",
  "fetch",
  "xhr",
  "image",
  "script",
  "stylesheet",
  "font",
  "media",
  "other",
]);

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
    evaluateUrlSecurity = null,
    securityPolicy = null,
    now = monotonicNow,
    trafficNow = monotonicNow,
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
    this.evaluateUrlSecurity = evaluateUrlSecurity;
    this.securityPolicy = securityPolicy;
    this.now = now;
    this.trafficNow = trafficNow;
    this.sleep = sleep;
    this.browserResult = null;
    this.launchPromise = null;
    this.launchWaiters = new Set();
    this.terminalLaunchResult = null;
    this.activeContexts = new Set();
    this.closedBrowserResults = new WeakSet();
    this.stopWaiters = new Set();
    this.stopped = false;
    this.closePromise = null;
  }

  async withPage(callback, jobOptions = {}) {
    if (!this.enabled) {
      return buildRendererResult({
        ok: false,
        status: BROWSER_PROVIDER_STATUS.NOT_CHECKED,
        launchOutcome: "dynamic_render_disabled",
      });
    }

    return this.renderLimiter.run(() => this.runJob(callback, jobOptions));
  }

  async renderPage(targetUrl) {
    const deadline = this.createRenderDeadline();
    const startedAt = deadline.startedAtMs;
    let result;
    try {
      result = await this.withPage(async ({ page, context, trafficTelemetry }) => {
      let navigationResult = null;
      let failureStage = "navigation";
      try {
        const navigation = await this.awaitLifecycleOperation(() => page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: Math.max(1, deadline.remainingMs()),
        }), {
          deadline,
          onInterrupt: () => closeIfPossible(context),
        });
        if (navigation.type === "stopped") {
          return this.buildStoppedRenderResult(targetUrl, page, deadline);
        }
        if (navigation.type === "timeout") {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage);
        }
        navigationResult = navigation.value;
      } catch (error) {
        if (this.stopped) {
          return this.buildStoppedRenderResult(targetUrl, page, deadline, error);
        }
        if (deadline.expired()) {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage, error);
        }
        if (this.isBrowserUnexpectedlyClosed()) {
          return this.buildBrowserUnavailableRenderResult(targetUrl, page, deadline, error);
        }
        return buildRenderResult({
          attempted: true,
          outcome: isTimeoutError(error)
            ? DYNAMIC_RENDER_OUTCOME.NAVIGATION_TIMEOUT
            : DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
          requestedUrl: targetUrl,
          renderFinalUrl: typeof page.url === "function" ? page.url() : targetUrl,
          elapsedMs: deadline.elapsedMs(),
          failureStage,
          error: sanitizeRenderError(error),
        });
      }

      failureStage = "settle";
      let settle;
      try {
        settle = await this.waitForSettle(page, deadline, () => closeIfPossible(context));
      } catch (error) {
        if (this.stopped) {
          return this.buildStoppedRenderResult(targetUrl, page, deadline, error);
        }
        if (deadline.expired()) {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage, error);
        }
        if (this.isBrowserUnexpectedlyClosed()) {
          return this.buildBrowserUnavailableRenderResult(targetUrl, page, deadline, error);
        }
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
          requestedUrl: targetUrl,
          renderFinalUrl: typeof page.url === "function" ? page.url() : targetUrl,
          elapsedMs: deadline.elapsedMs(),
          failureStage,
          error: sanitizeRenderError(error),
        });
      }
      if (settle.stopped) {
        return this.buildStoppedRenderResult(targetUrl, page, deadline);
      }
      if (settle.timedOut) {
        return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage);
      }

      failureStage = "content";
      let renderedHtml = "";
      try {
        const content = await this.awaitLifecycleOperation(() => page.content(), {
          deadline,
          onInterrupt: () => closeIfPossible(context),
        });
        if (content.type === "stopped") {
          return this.buildStoppedRenderResult(targetUrl, page, deadline);
        }
        if (content.type === "timeout") {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage);
        }
        renderedHtml = content.value;
      } catch (error) {
        if (this.stopped) {
          return this.buildStoppedRenderResult(targetUrl, page, deadline, error);
        }
        if (deadline.expired()) {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage, error);
        }
        if (this.isBrowserUnexpectedlyClosed()) {
          return this.buildBrowserUnavailableRenderResult(targetUrl, page, deadline, error);
        }
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
          requestedUrl: targetUrl,
          renderFinalUrl: typeof page.url === "function" ? page.url() : targetUrl,
          elapsedMs: deadline.elapsedMs(),
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          failureStage,
          error: sanitizeRenderError(error),
        });
      }

      const renderFinalUrl = typeof page.url === "function" ? page.url() : targetUrl;

      if (trafficTelemetry?.hasMainFrameNavigationBlocked()) {
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.RENDER_SCOPE_BLOCKED,
          requestedUrl: targetUrl,
          renderFinalUrl,
          elapsedMs: deadline.elapsedMs(),
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
          links: [],
        });
      }

      if (Buffer.byteLength(renderedHtml, "utf8") > this.renderOptions.maxRenderedHtmlBytes) {
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.RENDER_HTML_TOO_LARGE,
          requestedUrl: targetUrl,
          renderFinalUrl,
          elapsedMs: deadline.elapsedMs(),
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
          elapsedMs: deadline.elapsedMs(),
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
          challenge,
          links: [],
        });
      }

      if (this.stopped) {
        return this.buildStoppedRenderResult(targetUrl, page, deadline);
      }
      if (deadline.expired()) {
        return this.buildRenderTimeoutResult(targetUrl, page, deadline, "extraction");
      }

      failureStage = "extraction";
      const documentBaseUrl = this.resolveDocumentBaseUrl(renderedHtml, renderFinalUrl);
      let links = [];
      try {
        links = this.extractRenderedLinks(renderedHtml, documentBaseUrl);
      } catch (error) {
        if (this.stopped) {
          return this.buildStoppedRenderResult(targetUrl, page, deadline, error);
        }
        if (deadline.expired()) {
          return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage, error);
        }
        if (this.isBrowserUnexpectedlyClosed()) {
          return this.buildBrowserUnavailableRenderResult(targetUrl, page, deadline, error);
        }
        return buildRenderResult({
          attempted: true,
          outcome: DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED,
          requestedUrl: targetUrl,
          renderFinalUrl,
          documentBaseUrl,
          elapsedMs: deadline.elapsedMs(),
          settled: settle.settled,
          settle,
          navigationStatus: getNavigationStatus(navigationResult),
          renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
          failureStage,
          error: sanitizeRenderError(error),
        });
      }
      if (this.stopped) {
        return this.buildStoppedRenderResult(targetUrl, page, deadline);
      }
      if (deadline.expired()) {
        return this.buildRenderTimeoutResult(targetUrl, page, deadline, failureStage);
      }
      return buildRenderResult({
        attempted: true,
        outcome: settle.settled
          ? DYNAMIC_RENDER_OUTCOME.RENDERED
          : DYNAMIC_RENDER_OUTCOME.RENDERED_UNSETTLED,
        requestedUrl: targetUrl,
        renderFinalUrl,
        documentBaseUrl,
        elapsedMs: deadline.elapsedMs(),
        settled: settle.settled,
        settle,
        navigationStatus: getNavigationStatus(navigationResult),
        renderedHtmlBytes: Buffer.byteLength(renderedHtml, "utf8"),
        links,
      });
      }, {
        renderPage: targetUrl,
        allowedOrigin: getOrigin(targetUrl),
        deadline,
      });
    } catch (error) {
      const outcome = this.stopped
        ? DYNAMIC_RENDER_OUTCOME.STOPPED
        : (deadline.expired()
            ? DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT
            : DYNAMIC_RENDER_OUTCOME.NAVIGATION_FAILED);
      return buildRenderResult({
        attempted: true,
        outcome,
        requestedUrl: targetUrl,
        renderFinalUrl: targetUrl,
        elapsedMs: deadline.elapsedMs(),
        failureStage: "setup",
        error: sanitizeRenderError(error),
      });
    }

    if (!result.ok) {
      return buildRenderResult({
        attempted: result.status !== BROWSER_PROVIDER_STATUS.NOT_CHECKED,
        outcome: mapRendererStatusToRenderOutcome(result.status),
        requestedUrl: targetUrl,
        renderFinalUrl: targetUrl,
        elapsedMs: deadline.elapsedMs(),
        rendererStatus: result.status,
        launchOutcome: result.launchOutcome,
        failureStage: result.status === DYNAMIC_RENDERER_STATUS.STOPPED
          || result.status === DYNAMIC_RENDERER_STATUS.RENDER_TIMEOUT
          ? "setup"
          : null,
      });
    }

    if (!isRenderResult(result.value)) {
      return buildRenderResult({
        attempted: result.value?.status !== BROWSER_PROVIDER_STATUS.NOT_CHECKED,
        outcome: mapRendererStatusToRenderOutcome(result.value?.status),
        requestedUrl: targetUrl,
        renderFinalUrl: targetUrl,
        elapsedMs: deadline.elapsedMs(),
        rendererStatus: result.value?.status || null,
        launchOutcome: result.value?.launchOutcome || null,
        failureStage: "setup",
      });
    }

    return result.value;
  }

  async waitForSettle(page, deadline = null, onInterrupt = null) {
    const startMs = this.now();
    const minUntilMs = startMs + this.renderOptions.renderSettleMinMs;
    const maxUntilMs = startMs + this.renderOptions.renderSettleMaxMs;
    let stableSamples = 0;
    let previousSignature = null;
    let samples = 0;

    while (this.now() < maxUntilMs) {
      if (this.stopped) {
        return {
          settled: false,
          stopped: true,
          samples,
          stableSamples,
          elapsedMs: Math.max(0, this.now() - startMs),
        };
      }
      if (deadline?.expired()) {
        return {
          settled: false,
          timedOut: true,
          samples,
          stableSamples,
          elapsedMs: Math.max(0, this.now() - startMs),
        };
      }
      const delayMs = Math.min(
        this.renderOptions.renderSettleIntervalMs,
        Math.max(0, maxUntilMs - this.now()),
      );
      if (delayMs > 0) {
        const sleepResult = await this.awaitLifecycleOperation(() => this.sleep(delayMs), {
          deadline,
          onInterrupt,
        });
        if (sleepResult.type === "stopped") {
          return {
            settled: false,
            stopped: true,
            samples,
            stableSamples,
            elapsedMs: Math.max(0, this.now() - startMs),
          };
        }
        if (sleepResult.type === "timeout") {
          return {
            settled: false,
            timedOut: true,
            samples,
            stableSamples,
            elapsedMs: Math.max(0, this.now() - startMs),
          };
        }
      }

      samples += 1;
      const signatureResult = await this.awaitLifecycleOperation(() => getUrlAttributeSignature(page), {
        deadline,
        onInterrupt,
      });
      if (signatureResult.type === "stopped") {
        return {
          settled: false,
          stopped: true,
          samples,
          stableSamples,
          elapsedMs: Math.max(0, this.now() - startMs),
        };
      }
      if (signatureResult.type === "timeout") {
        return {
          settled: false,
          timedOut: true,
          samples,
          stableSamples,
          elapsedMs: Math.max(0, this.now() - startMs),
        };
      }
      const signature = signatureResult.value;
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
          elapsedMs: Math.max(0, this.now() - startMs),
        };
      }
    }

    return {
      settled: false,
      samples,
      stableSamples,
      elapsedMs: Math.max(0, this.now() - startMs),
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

  async runJob(callback, jobOptions = {}) {
    if (this.stopped) {
      return buildRendererResult({
        ok: false,
        status: DYNAMIC_RENDERER_STATUS.STOPPED,
        launchOutcome: "renderer_stopped",
      });
    }
    if (jobOptions.deadline?.expired()) {
      return this.buildRenderTimeoutRendererResult();
    }

    const browserResult = await this.ensureBrowserForJob(jobOptions.deadline || null);
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
    const contextWait = await this.awaitLifecycleOperation(
      () => browserInstance.newContext({ ...this.contextOptions }),
      {
        deadline: jobOptions.deadline || null,
        onLateValue: (context) => closeIfPossible(context),
      },
    );
    if (contextWait.type === "stopped") {
      return this.buildStoppedResult(browserResult);
    }
    if (contextWait.type === "timeout") {
      return this.buildRenderTimeoutRendererResult(browserResult);
    }
    const context = contextWait.value;
    this.activeContexts.add(context);
    const trafficTelemetry = new BrowserTrafficTelemetry({
      renderPage: jobOptions.renderPage || null,
      now: this.trafficNow,
    });
    await this.installBoundaryHooks(context, trafficTelemetry, jobOptions);
    let primaryError = null;
    let value;
    try {
      if (this.stopped) {
        return this.buildStoppedResult(browserResult);
      }
      if (jobOptions.deadline?.expired()) {
        return this.buildRenderTimeoutRendererResult(browserResult);
      }
      const pageWait = await this.awaitLifecycleOperation(() => context.newPage(), {
        deadline: jobOptions.deadline || null,
        onLateValue: (page) => closeIfPossible(page),
      });
      if (pageWait.type === "stopped") {
        return this.buildStoppedResult(browserResult);
      }
      if (pageWait.type === "timeout") {
        return this.buildRenderTimeoutRendererResult(browserResult);
      }
      const page = pageWait.value;
      this.attachPageBoundaryHooks(page, trafficTelemetry);
      value = await callback({
        browser: browserResult,
        context,
        page,
        trafficTelemetry,
      });
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
    attachTrafficTelemetry(value, trafficTelemetry.finalize());
    return {
      ok: true,
      status: DYNAMIC_RENDERER_STATUS.COMPLETED,
      browser: browserResult.browser,
      browserChannel: browserResult.browserChannel,
      value,
    };
  }

  async installBoundaryHooks(context, trafficTelemetry, jobOptions = {}) {
    if (typeof context.on === "function") {
      context.on("requestfinished", (request) => {
        trafficTelemetry.recordRequestFinished(request);
      });
      context.on("requestfailed", (request) => {
        trafficTelemetry.recordRequestFailed(request);
      });
      let firstPage = true;
      context.on("page", (page) => {
        this.attachPageBoundaryHooks(page, trafficTelemetry);
        if (firstPage) {
          firstPage = false;
          return;
        }
        if (trafficTelemetry.recordPopupClosed(page)) {
          closeIfPossible(page).catch(() => {});
        }
      });
    }

    if (typeof context.route === "function") {
      await context.route("**/*", async (route, requestFromHandler = null) => {
        const request = requestFromHandler || (typeof route.request === "function" ? route.request() : null);
        await this.handleRoutedRequest(route, request, trafficTelemetry, jobOptions);
      });
    }

    if (typeof context.routeWebSocket === "function") {
      await context.routeWebSocket(/.*/, async (webSocketRoute) => {
        trafficTelemetry.recordWebSocketBlocked(getWebSocketUrl(webSocketRoute));
        if (typeof webSocketRoute?.close === "function") {
          await webSocketRoute.close({
            code: 1008,
            reason: "blocked_by_policy",
          });
        }
      });
    }
  }

  attachPageBoundaryHooks(page, trafficTelemetry) {
    if (!page || typeof page.on !== "function" || trafficTelemetry.pageHooks.has(page)) {
      return;
    }
    trafficTelemetry.pageHooks.add(page);
    page.on("download", async (download) => {
      trafficTelemetry.recordDownloadCancelled(getDownloadUrl(download));
      if (typeof download?.cancel === "function") {
        await download.cancel().catch(() => {});
      }
    });
    page.on("popup", async (popup) => {
      if (trafficTelemetry.recordPopupClosed(popup)) {
        await closeIfPossible(popup).catch(() => {});
      }
    });
  }

  async handleRoutedRequest(route, request, trafficTelemetry, jobOptions = {}) {
    const record = trafficTelemetry.recordRequestStarted(request);
    try {
      const policyDecision = await this.evaluateBrowserRequestPolicy(request, jobOptions);
      trafficTelemetry.recordPolicyDecision(request, policyDecision);

      if (policyDecision.decision === BROWSER_REQUEST_POLICY_DECISION.ALLOW) {
        if (typeof route?.continue === "function") {
          await route.continue();
        }
        return;
      }

      if (policyDecision.reason === BROWSER_REQUEST_POLICY_REASON.UNSAFE_METHOD) {
        trafficTelemetry.recordMethodBlocked(request, record.method, policyDecision.reason);
        await abortRoute(route);
        return;
      }

      if (policyDecision.reason === BROWSER_REQUEST_POLICY_REASON.MAIN_FRAME_SCOPE_BLOCKED) {
        trafficTelemetry.recordMainFrameNavigationBlocked(request, jobOptions.allowedOrigin, policyDecision.reason);
        await abortRoute(route);
        return;
      }

      if (policyDecision.reason === BROWSER_REQUEST_POLICY_REASON.URL_SECURITY_BLOCKED) {
        trafficTelemetry.recordSecurityBlocked(
          request,
          policyDecision.urlSecurityReason || "blocked_by_security_policy",
          policyDecision.reason,
        );
        await abortRoute(route);
        return;
      }

      trafficTelemetry.recordPolicyBlocked(request, policyDecision);
      await abortRoute(route);
    } catch (error) {
      trafficTelemetry.recordRequestFailed(request, sanitizeRenderError(error));
      throw error;
    }
  }

  async evaluateBrowserRequestPolicy(request, jobOptions = {}) {
    const input = normalizeBrowserRequestPolicyInput(request, jobOptions);

    if (!SAFE_BROWSER_METHODS.has(input.method)) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.BLOCK, {
        input,
        reason: BROWSER_REQUEST_POLICY_REASON.UNSAFE_METHOD,
      });
    }

    if (!BROWSER_REQUEST_CLASSES.has(input.requestClass)) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.BLOCK, {
        input,
        reason: BROWSER_REQUEST_POLICY_REASON.UNKNOWN_REQUEST_CLASS,
      });
    }

    if (input.isMainFrame && input.allowedOrigin && input.origin && input.origin !== input.allowedOrigin) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.BLOCK, {
        input,
        reason: BROWSER_REQUEST_POLICY_REASON.MAIN_FRAME_SCOPE_BLOCKED,
      });
    }

    if (typeof this.evaluateUrlSecurity !== "function") {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.ALLOW, { input });
    }

    let urlSecurityDecision;
    try {
      urlSecurityDecision = await this.evaluateUrlSecurity(input.url, this.securityPolicy);
    } catch (error) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.ERROR_OR_FAIL_CLOSED, {
        input,
        reason: BROWSER_REQUEST_POLICY_REASON.SECURITY_EVALUATOR_FAILED,
        error,
      });
    }

    if (!isValidUrlSecurityDecision(urlSecurityDecision)) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.ERROR_OR_FAIL_CLOSED, {
        input: normalizeBrowserRequestPolicyInput(request, jobOptions, urlSecurityDecision),
        reason: BROWSER_REQUEST_POLICY_REASON.INVALID_SECURITY_DECISION,
      });
    }

    const inputWithSecurityDecision = normalizeBrowserRequestPolicyInput(request, jobOptions, urlSecurityDecision);
    if (urlSecurityDecision.allowed === false) {
      return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.BLOCK, {
        input: inputWithSecurityDecision,
        reason: BROWSER_REQUEST_POLICY_REASON.URL_SECURITY_BLOCKED,
        urlSecurityReason: urlSecurityDecision.reason || "blocked_by_security_policy",
      });
    }

    return buildBrowserRequestPolicyDecision(BROWSER_REQUEST_POLICY_DECISION.ALLOW, {
      input: inputWithSecurityDecision,
    });
  }

  async ensureBrowser() {
    return this.ensureBrowserForJob(null);
  }

  async ensureBrowserForJob(deadline = null) {
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
      this.startBrowserLaunch();
    }

    const launchWaiter = {};
    this.launchWaiters.add(launchWaiter);
    let released = false;
    const releaseWaiter = async (result = null) => {
      if (!released) {
        released = true;
        this.launchWaiters.delete(launchWaiter);
      }
      if (result?.ok && !this.browserResult?.ok && this.launchWaiters.size === 0) {
        await this.disposeBrowserResult(result);
      }
    };

    try {
      const launchWait = await this.awaitLifecycleOperation(() => this.launchPromise, { deadline });
      if (launchWait.type === "stopped") {
        await releaseWaiter();
        return this.buildStoppedResult();
      }
      if (launchWait.type === "timeout") {
        await releaseWaiter();
        return this.buildRenderTimeoutRendererResult();
      }

      const result = launchWait.value;
      if (!result.ok) {
        await releaseWaiter();
        return result;
      }
      if (this.stopped) {
        await releaseWaiter(result);
        return this.buildStoppedResult(result);
      }
      if (deadline?.expired()) {
        await releaseWaiter(result);
        return this.buildRenderTimeoutRendererResult(result);
      }

      if (!this.browserResult?.ok) {
        this.browserResult = result;
      }
      await releaseWaiter();
      return result;
    } catch (error) {
      await releaseWaiter();
      if (this.stopped) {
        return this.buildStoppedResult();
      }
      throw error;
    }
  }

  startBrowserLaunch() {
    this.launchPromise = this.browserProvider.launchFirstAvailable({ browser: this.browser })
      .then(async (result) => {
        if (result.ok) {
          if (this.stopped || this.launchWaiters.size === 0) {
            await this.disposeBrowserResult(result);
            return this.stopped
              ? this.buildStoppedResult(result)
              : this.buildRenderTimeoutRendererResult(result);
          }
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

  async requestStop() {
    this.stopped = true;
    this.notifyStopWaiters();
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

  createRenderDeadline() {
    const startedAtMs = normalizeTelemetryTimestamp(this.now());
    const timeoutMs = this.renderOptions.renderTimeoutMs;
    const expiresAtMs = startedAtMs + timeoutMs;
    return {
      startedAtMs,
      timeoutMs,
      expiresAtMs,
      remainingMs: () => Math.max(0, expiresAtMs - normalizeTelemetryTimestamp(this.now())),
      elapsedMs: () => Math.max(0, normalizeTelemetryTimestamp(this.now()) - startedAtMs),
      expired: () => normalizeTelemetryTimestamp(this.now()) >= expiresAtMs,
    };
  }

  async awaitLifecycleOperation(operation, {
    deadline = null,
    onInterrupt = null,
    onLateValue = null,
  } = {}) {
    if (this.stopped) {
      return { type: "stopped" };
    }
    if (deadline?.expired()) {
      return { type: "timeout" };
    }

    const lifecycle = this.createLifecycleSignal(deadline);
    const operationPromise = Promise.resolve()
      .then(operation);
    const wrappedOperation = operationPromise
      .then((value) => ({ type: "value", value }))
      .catch((error) => ({ type: "error", error }));
    const winner = await Promise.race([wrappedOperation, lifecycle.promise]);
    lifecycle.cancel();

    if (winner.type === "value") {
      return winner;
    }
    if (winner.type === "error") {
      if (this.stopped) {
        return { type: "stopped" };
      }
      if (deadline?.expired()) {
        return { type: "timeout" };
      }
      throw winner.error;
    }

    wrappedOperation
      .then((late) => {
        if (late.type === "value" && typeof onLateValue === "function") {
          return onLateValue(late.value);
        }
        return null;
      })
      .catch(() => {});

    if (typeof onInterrupt === "function") {
      await Promise.resolve(onInterrupt(winner.type)).catch(() => {});
    }
    return winner;
  }

  createLifecycleSignal(deadline = null) {
    if (this.stopped) {
      return {
        promise: Promise.resolve({ type: "stopped" }),
        cancel: () => {},
      };
    }

    const remainingMs = deadline ? deadline.remainingMs() : null;
    if (remainingMs !== null && remainingMs <= 0) {
      return {
        promise: Promise.resolve({ type: "timeout" }),
        cancel: () => {},
      };
    }

    let settled = false;
    let timeoutId = null;
    let stopWaiter = null;
    const promise = new Promise((resolve) => {
      const finish = (type) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (stopWaiter) {
          this.stopWaiters.delete(stopWaiter);
          stopWaiter = null;
        }
        resolve({ type });
      };
      stopWaiter = () => finish("stopped");
      this.stopWaiters.add(stopWaiter);
      if (remainingMs !== null) {
        timeoutId = setTimeout(() => finish("timeout"), remainingMs);
      }
    });

    return {
      promise,
      cancel: () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (stopWaiter) {
          this.stopWaiters.delete(stopWaiter);
          stopWaiter = null;
        }
      },
    };
  }

  notifyStopWaiters() {
    for (const stopWaiter of [...this.stopWaiters]) {
      stopWaiter();
    }
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

  buildRenderTimeoutRendererResult(browserResult = null) {
    return buildRendererResult({
      ok: false,
      status: DYNAMIC_RENDERER_STATUS.RENDER_TIMEOUT,
      launchOutcome: "render_timeout",
      browser: browserResult?.browser || null,
      browserChannel: browserResult?.browserChannel || null,
    });
  }

  buildStoppedRenderResult(targetUrl, page, deadline, error = null) {
    return buildRenderResult({
      attempted: true,
      outcome: DYNAMIC_RENDER_OUTCOME.STOPPED,
      requestedUrl: targetUrl,
      renderFinalUrl: typeof page?.url === "function" ? page.url() : targetUrl,
      elapsedMs: deadline.elapsedMs(),
      error: error ? sanitizeRenderError(error) : null,
    });
  }

  buildRenderTimeoutResult(targetUrl, page, deadline, failureStage, error = null) {
    return buildRenderResult({
      attempted: true,
      outcome: DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT,
      requestedUrl: targetUrl,
      renderFinalUrl: typeof page?.url === "function" ? page.url() : targetUrl,
      elapsedMs: Math.min(deadline.timeoutMs, deadline.elapsedMs()),
      failureStage,
      error: error ? sanitizeRenderError(error) : null,
    });
  }

  buildBrowserUnavailableRenderResult(targetUrl, page, deadline, error = null) {
    return buildRenderResult({
      attempted: true,
      outcome: DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE,
      requestedUrl: targetUrl,
      renderFinalUrl: typeof page?.url === "function" ? page.url() : targetUrl,
      elapsedMs: deadline.elapsedMs(),
      rendererStatus: BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY,
      launchOutcome: "browser_closed_unexpectedly",
      error: error ? sanitizeRenderError(error) : null,
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

function isRenderResult(value) {
  return Boolean(value)
    && typeof value === "object"
    && Object.hasOwn(value, "outcome");
}

function mapRendererStatusToRenderOutcome(status) {
  if (status === DYNAMIC_RENDERER_STATUS.STOPPED) {
    return DYNAMIC_RENDER_OUTCOME.STOPPED;
  }
  if (status === DYNAMIC_RENDERER_STATUS.RENDER_TIMEOUT) {
    return DYNAMIC_RENDER_OUTCOME.RENDER_TIMEOUT;
  }
  return DYNAMIC_RENDER_OUTCOME.BROWSER_UNAVAILABLE;
}

class BrowserTrafficTelemetry {
  constructor({ renderPage = null, now = monotonicNow } = {}) {
    this.renderPage = renderPage;
    this.now = now;
    this.requestSequence = 0;
    this.records = new Map();
    this.pageHooks = new WeakSet();
    this.popupPages = new WeakSet();
    this.currentInflight = 0;
    this.currentInflightByHost = new Map();
    this.lastStartByHost = new Map();
    this.lastObservedAtMs = null;
    this.data = {
      renderPage,
      hostKeyType: "host",
      timingUnit: "milliseconds_from_monotonic_process_clock",
      requestSampleLimit: TRAFFIC_REQUEST_SAMPLE_LIMIT,
      blockedRequestSampleLimit: TRAFFIC_BLOCKED_SAMPLE_LIMIT,
      requestStartIntervalSampleLimit: TRAFFIC_INTERVAL_SAMPLE_LIMIT,
      requestSamplesDropped: 0,
      blockedRequestSamplesDropped: 0,
      requestStartIntervalSamplesDropped: 0,
      requestsStarted: 0,
      requestsFinished: 0,
      requestsFailed: 0,
      requestsStartedByHost: {},
      requestsFinishedByHost: {},
      requestsFailedByHost: {},
      requestsByMethod: {},
      requestsByResourceType: {},
      requestsByClass: {},
      policyDecisionsByDecision: {},
      policyDecisionsByReason: {},
      peakInflight: 0,
      peakInflightByHost: {},
      requestStartIntervals: [],
      securityBlockedRequests: 0,
      methodBlockedRequests: 0,
      websocketBlockedRequests: 0,
      popupClosed: 0,
      downloadCancelled: 0,
      mainFrameNavigationBlocked: 0,
      policyBlockedRequests: 0,
      blockedRequests: [],
      requests: [],
    };
  }

  recordRequestStarted(request) {
    const existing = this.records.get(request);
    if (existing) {
      return existing;
    }

    const startedAtMs = this.nextMonotonicTimestamp();
    const url = getRequestUrl(request);
    const host = getHostKey(url);
    const method = getRequestMethod(request);
    const resourceType = getRequestResourceType(request);
    const requestClass = getBrowserRequestClass(request);
    const record = {
      id: ++this.requestSequence,
      request,
      url,
      host,
      method,
      resourceType,
      requestClass,
      policyDecision: null,
      policyReason: null,
      startedAtMs,
      terminal: false,
    };
    this.records.set(request, record);

    this.data.requestsStarted += 1;
    incrementObjectCounter(this.data.requestsStartedByHost, host);
    incrementObjectCounter(this.data.requestsByMethod, method);
    incrementObjectCounter(this.data.requestsByResourceType, resourceType);
    incrementObjectCounter(this.data.requestsByClass, requestClass);

    this.currentInflight += 1;
    this.data.peakInflight = Math.max(this.data.peakInflight, this.currentInflight);
    const hostInflight = (this.currentInflightByHost.get(host) || 0) + 1;
    this.currentInflightByHost.set(host, hostInflight);
    this.data.peakInflightByHost[host] = Math.max(this.data.peakInflightByHost[host] || 0, hostInflight);

    if (this.lastStartByHost.has(host)) {
      this.pushSample(this.data.requestStartIntervals, {
        host,
        intervalMs: Math.max(0, startedAtMs - this.lastStartByHost.get(host)),
      }, TRAFFIC_INTERVAL_SAMPLE_LIMIT, "requestStartIntervalSamplesDropped");
    }
    this.lastStartByHost.set(host, startedAtMs);

    this.pushSample(this.data.requests, {
      id: record.id,
      host,
      method,
      resourceType,
      requestClass,
      path: getUrlPath(url),
      startedAtMs,
      policyDecision: null,
      policyReason: null,
      terminal: null,
    }, TRAFFIC_REQUEST_SAMPLE_LIMIT, "requestSamplesDropped");
    return record;
  }

  recordRequestFinished(request) {
    this.recordRequestTerminal(request, "finished");
  }

  recordRequestFailed(request, error = null) {
    this.recordRequestTerminal(request, "failed", error);
  }

  recordPolicyDecision(request, policyDecision) {
    const record = this.recordRequestStarted(request);
    const decision = sanitizePolicyReason(policyDecision?.decision, BROWSER_REQUEST_POLICY_DECISION.ERROR_OR_FAIL_CLOSED);
    const reason = policyDecision?.reason ? sanitizePolicyReason(policyDecision.reason, null) : null;
    record.policyDecision = decision;
    record.policyReason = reason;
    incrementObjectCounter(this.data.policyDecisionsByDecision, decision);
    if (reason) {
      incrementObjectCounter(this.data.policyDecisionsByReason, reason);
    }

    const requestEntry = this.data.requests.find((candidate) => candidate.id === record.id);
    if (requestEntry) {
      requestEntry.policyDecision = decision;
      requestEntry.policyReason = reason;
    }
  }

  recordMethodBlocked(request, method, policyReason = BROWSER_REQUEST_POLICY_REASON.UNSAFE_METHOD) {
    const record = this.recordRequestStarted(request);
    this.data.methodBlockedRequests += 1;
    this.pushBlockedSample({
      id: record.id,
      reason: "method",
      policyDecision: BROWSER_REQUEST_POLICY_DECISION.BLOCK,
      policyReason,
      method,
      host: record.host,
      resourceType: record.resourceType,
      requestClass: record.requestClass,
      path: getUrlPath(record.url),
    });
    this.recordRequestTerminal(request, "blocked");
  }

  recordSecurityBlocked(request, reason, policyReason = BROWSER_REQUEST_POLICY_REASON.URL_SECURITY_BLOCKED) {
    const record = this.recordRequestStarted(request);
    this.data.securityBlockedRequests += 1;
    this.pushBlockedSample({
      id: record.id,
      reason: "security",
      policyDecision: BROWSER_REQUEST_POLICY_DECISION.BLOCK,
      policyReason,
      securityReason: reason,
      method: record.method,
      host: record.host,
      resourceType: record.resourceType,
      requestClass: record.requestClass,
      path: getUrlPath(record.url),
    });
    this.recordRequestTerminal(request, "blocked");
  }

  recordMainFrameNavigationBlocked(
    request,
    allowedOrigin,
    policyReason = BROWSER_REQUEST_POLICY_REASON.MAIN_FRAME_SCOPE_BLOCKED,
  ) {
    const record = this.recordRequestStarted(request);
    this.data.mainFrameNavigationBlocked += 1;
    this.pushBlockedSample({
      id: record.id,
      reason: "main_frame_origin",
      policyDecision: BROWSER_REQUEST_POLICY_DECISION.BLOCK,
      policyReason,
      allowedOrigin,
      method: record.method,
      host: record.host,
      resourceType: record.resourceType,
      requestClass: record.requestClass,
      path: getUrlPath(record.url),
    });
    this.recordRequestTerminal(request, "blocked");
  }

  recordPolicyBlocked(request, policyDecision) {
    const record = this.recordRequestStarted(request);
    this.data.policyBlockedRequests += 1;
    this.pushBlockedSample({
      id: record.id,
      reason: "policy",
      policyDecision: sanitizePolicyReason(
        policyDecision?.decision,
        BROWSER_REQUEST_POLICY_DECISION.ERROR_OR_FAIL_CLOSED,
      ),
      policyReason: sanitizePolicyReason(
        policyDecision?.reason,
        BROWSER_REQUEST_POLICY_REASON.INVALID_SECURITY_DECISION,
      ),
      method: record.method,
      host: record.host,
      resourceType: record.resourceType,
      requestClass: record.requestClass,
      path: getUrlPath(record.url),
    });
    this.recordRequestTerminal(request, "blocked");
  }

  recordWebSocketBlocked(url) {
    this.data.websocketBlockedRequests += 1;
    this.pushBlockedSample({
      reason: "websocket",
      host: getHostKey(url),
      path: getUrlPath(url),
    });
  }

  recordPopupClosed(pageOrUrl) {
    if (pageOrUrl && typeof pageOrUrl === "object") {
      if (this.popupPages.has(pageOrUrl)) {
        return false;
      }
      this.popupPages.add(pageOrUrl);
    }
    const url = typeof pageOrUrl === "string" ? pageOrUrl : getPageUrl(pageOrUrl);
    this.data.popupClosed += 1;
    this.pushBlockedSample({
      reason: "popup",
      host: getHostKey(url),
      path: getUrlPath(url),
    });
    return true;
  }

  recordDownloadCancelled(url) {
    this.data.downloadCancelled += 1;
    this.pushBlockedSample({
      reason: "download",
      host: getHostKey(url),
      path: getUrlPath(url),
    });
  }

  nextMonotonicTimestamp() {
    const timestamp = normalizeTelemetryTimestamp(this.now());
    if (this.lastObservedAtMs === null || timestamp >= this.lastObservedAtMs) {
      this.lastObservedAtMs = timestamp;
      return timestamp;
    }
    return this.lastObservedAtMs;
  }

  pushBlockedSample(sample) {
    this.pushSample(
      this.data.blockedRequests,
      sample,
      TRAFFIC_BLOCKED_SAMPLE_LIMIT,
      "blockedRequestSamplesDropped",
    );
  }

  pushSample(target, sample, limit, droppedCounter) {
    if (target.length < limit) {
      target.push(sample);
      return;
    }
    this.data[droppedCounter] += 1;
  }

  recordRequestTerminal(request, terminal, error = null) {
    const record = this.records.get(request);
    if (!record || record.terminal) {
      return;
    }
    record.terminal = terminal;
    if (terminal === "finished") {
      this.data.requestsFinished += 1;
      incrementObjectCounter(this.data.requestsFinishedByHost, record.host);
    } else {
      this.data.requestsFailed += 1;
      incrementObjectCounter(this.data.requestsFailedByHost, record.host);
    }

    this.currentInflight = Math.max(0, this.currentInflight - 1);
    this.currentInflightByHost.set(record.host, Math.max(0, (this.currentInflightByHost.get(record.host) || 0) - 1));

    const requestEntry = this.data.requests.find((candidate) => candidate.id === record.id);
    if (requestEntry) {
      requestEntry.terminal = terminal;
      if (error) {
        requestEntry.error = typeof error === "string" ? error : error.message || error.name || "request_failed";
      }
    }
  }

  hasMainFrameNavigationBlocked() {
    return this.data.mainFrameNavigationBlocked > 0;
  }

  finalize() {
    return JSON.parse(JSON.stringify({
      ...this.data,
      inflightAtFinalize: this.currentInflight,
    }));
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

function monotonicNow() {
  return performance.now();
}

function normalizeTelemetryTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function abortRoute(route) {
  if (typeof route?.abort === "function") {
    await route.abort("blockedbyclient");
  }
}

function attachTrafficTelemetry(value, traffic) {
  if (value && typeof value === "object" && !Object.hasOwn(value, "traffic")) {
    value.traffic = traffic;
  }
}

function incrementObjectCounter(target, key) {
  const normalizedKey = key || "unknown";
  target[normalizedKey] = (target[normalizedKey] || 0) + 1;
}

function normalizeBrowserRequestPolicyInput(request, jobOptions = {}, urlSecurityDecision = null) {
  const url = getRequestUrl(request);
  const resourceType = getRequestResourceType(request);
  const isMainFrame = isMainFrameNavigationRequest(request);
  return {
    url,
    method: getRequestMethod(request),
    resourceType,
    requestClass: getBrowserRequestClass(request),
    isMainFrame,
    origin: getOrigin(url),
    allowedOrigin: jobOptions.allowedOrigin || null,
    urlSecurityDecision: summarizeUrlSecurityDecision(urlSecurityDecision),
  };
}

function buildBrowserRequestPolicyDecision(decision, {
  input,
  reason = null,
  urlSecurityReason = null,
  error = null,
} = {}) {
  const normalizedDecision = Object.values(BROWSER_REQUEST_POLICY_DECISION).includes(decision)
    ? decision
    : BROWSER_REQUEST_POLICY_DECISION.ERROR_OR_FAIL_CLOSED;
  return {
    decision: normalizedDecision,
    reason: reason ? sanitizePolicyReason(reason, BROWSER_REQUEST_POLICY_REASON.INVALID_SECURITY_DECISION) : null,
    method: input?.method || "UNKNOWN",
    resourceType: input?.resourceType || "unknown",
    requestClass: input?.requestClass || "unknown",
    isMainFrame: input?.isMainFrame === true,
    urlSecurityAllowed: input?.urlSecurityDecision?.allowed ?? null,
    urlSecurityReason: urlSecurityReason
      ? sanitizePolicyReason(urlSecurityReason, "blocked_by_security_policy")
      : input?.urlSecurityDecision?.reason || null,
    error: error ? { name: String(error?.name || "Error").slice(0, 80) } : null,
  };
}

function isValidUrlSecurityDecision(decision) {
  return Boolean(decision)
    && typeof decision === "object"
    && typeof decision.allowed === "boolean";
}

function summarizeUrlSecurityDecision(decision) {
  if (!decision || typeof decision !== "object") {
    return null;
  }
  return {
    allowed: typeof decision.allowed === "boolean" ? decision.allowed : null,
    reason: decision.reason ? sanitizePolicyReason(decision.reason, null) : null,
  };
}

function sanitizePolicyReason(value, fallback) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value)
    .slice(0, 120)
    .replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function getRequestUrl(request) {
  try {
    return typeof request?.url === "function" ? request.url() : "about:blank";
  } catch {
    return "about:blank";
  }
}

function getRequestMethod(request) {
  try {
    return String(typeof request?.method === "function" ? request.method() : "UNKNOWN").toUpperCase();
  } catch {
    return "UNKNOWN";
  }
}

function getRequestResourceType(request) {
  try {
    return String(typeof request?.resourceType === "function" ? request.resourceType() : "unknown").toLowerCase();
  } catch {
    return "unknown";
  }
}

function getBrowserRequestClass(request) {
  const resourceType = getRequestResourceType(request);
  if (resourceType === "document") {
    return isMainFrameNavigationRequest(request) ? "main_document" : "iframe_frame";
  }
  if (BROWSER_REQUEST_CLASSES.has(resourceType)) {
    return resourceType;
  }
  return "unknown";
}

function getOrigin(urlValue) {
  try {
    return new URL(urlValue).origin;
  } catch {
    return null;
  }
}

function getHostKey(urlValue) {
  try {
    return new URL(urlValue).host.toLowerCase();
  } catch {
    return "unknown";
  }
}

function getUrlPath(urlValue) {
  try {
    return new URL(urlValue).pathname;
  } catch {
    return "";
  }
}

function getPageUrl(page) {
  try {
    return typeof page?.url === "function" ? page.url() : "about:blank";
  } catch {
    return "about:blank";
  }
}

function getDownloadUrl(download) {
  try {
    return typeof download?.url === "function" ? download.url() : "about:blank";
  } catch {
    return "about:blank";
  }
}

function getWebSocketUrl(webSocketRoute) {
  try {
    return typeof webSocketRoute?.url === "function" ? webSocketRoute.url() : "ws://unknown/";
  } catch {
    return "ws://unknown/";
  }
}

function isBlockedMainFrameNavigation(request, allowedOrigin) {
  if (!allowedOrigin || !isMainFrameNavigationRequest(request)) {
    return false;
  }
  const requestOrigin = getOrigin(getRequestUrl(request));
  return Boolean(requestOrigin && requestOrigin !== allowedOrigin);
}

function isMainFrameNavigationRequest(request) {
  try {
    if (typeof request?.isNavigationRequest === "function" && !request.isNavigationRequest()) {
      return false;
    }
    if (getRequestResourceType(request) !== "document") {
      return false;
    }
    const frame = typeof request?.frame === "function" ? request.frame() : null;
    if (!frame || typeof frame.parentFrame !== "function") {
      return true;
    }
    return frame.parentFrame() === null;
  } catch {
    return getRequestResourceType(request) === "document";
  }
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
  failureStage = null,
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
    failureStage,
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
