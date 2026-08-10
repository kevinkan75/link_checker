const BROWSER_PROVIDER_STATUS = Object.freeze({
  NOT_CHECKED: "not_checked",
  AVAILABLE: "available",
  NOT_FOUND: "not_found",
  LAUNCH_FAILED: "launch_failed",
  CLOSED_UNEXPECTEDLY: "closed_unexpectedly",
});

const SUPPORTED_BROWSER_REQUESTS = Object.freeze(["auto", "msedge", "chrome"]);
const AUTO_BROWSER_CANDIDATES = Object.freeze(["msedge", "chrome"]);

class BrowserProvider {
  constructor({
    playwright = null,
    loadPlaywright = defaultLoadPlaywright,
  } = {}) {
    this.playwright = playwright;
    this.loadPlaywright = loadPlaywright;
    this.lastStatus = BROWSER_PROVIDER_STATUS.NOT_CHECKED;
  }

  getCandidateChannels(browser = "auto") {
    const requested = normalizeBrowserRequest(browser);
    return requested === "auto" ? [...AUTO_BROWSER_CANDIDATES] : [requested];
  }

  async launchFirstAvailable({ browser = "auto" } = {}) {
    const requestedBrowser = normalizeBrowserRequest(browser);
    const candidates = this.getCandidateChannels(requestedBrowser);
    const attempts = [];

    let playwright;
    try {
      playwright = await this.getPlaywright();
    } catch (error) {
      const attempt = buildFailureAttempt(candidates[0] || requestedBrowser, error, BROWSER_PROVIDER_STATUS.LAUNCH_FAILED);
      attempts.push(attempt);
      return this.buildUnavailableResult({
        requestedBrowser,
        status: BROWSER_PROVIDER_STATUS.LAUNCH_FAILED,
        launchOutcome: "playwright_load_failed",
        attempts,
      });
    }

    for (const candidate of candidates) {
      const attempt = await this.launchCandidate(playwright, candidate);
      attempts.push(attempt);

      if (attempt.status === BROWSER_PROVIDER_STATUS.AVAILABLE) {
        this.lastStatus = BROWSER_PROVIDER_STATUS.AVAILABLE;
        return this.buildAvailableResult({
          requestedBrowser,
          candidate,
          browserInstance: attempt.browserInstance,
          browserVersion: attempt.browserVersion,
          attempts,
        });
      }

      if (attempt.status !== BROWSER_PROVIDER_STATUS.NOT_FOUND) {
        return this.buildUnavailableResult({
          requestedBrowser,
          status: attempt.status,
          launchOutcome: attempt.launchOutcome,
          attempts,
        });
      }
    }

    return this.buildUnavailableResult({
      requestedBrowser,
      status: BROWSER_PROVIDER_STATUS.NOT_FOUND,
      launchOutcome: "browser_unavailable",
      attempts,
    });
  }

  async getPlaywright() {
    if (!this.playwright) {
      this.playwright = await this.loadPlaywright();
    }
    if (!this.playwright?.chromium?.launch) {
      throw new Error("playwright-core chromium launcher is unavailable");
    }
    return this.playwright;
  }

  async launchCandidate(playwright, candidate) {
    try {
      const browserInstance = await playwright.chromium.launch({
        channel: candidate,
      });
      return {
        candidate,
        status: BROWSER_PROVIDER_STATUS.AVAILABLE,
        launchOutcome: "available",
        browserVersion: getBrowserVersion(browserInstance),
        browserInstance,
      };
    } catch (error) {
      return buildFailureAttempt(candidate, error);
    }
  }

  buildAvailableResult({ requestedBrowser, candidate, browserInstance, browserVersion, attempts }) {
    let normalCloseRequested = false;
    const lifecycle = {
      status: BROWSER_PROVIDER_STATUS.AVAILABLE,
      closedUnexpectedly: false,
    };

    if (typeof browserInstance?.on === "function") {
      browserInstance.on("disconnected", () => {
        if (!normalCloseRequested) {
          lifecycle.status = BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY;
          lifecycle.closedUnexpectedly = true;
          this.lastStatus = BROWSER_PROVIDER_STATUS.CLOSED_UNEXPECTEDLY;
        }
      });
    }

    return {
      ok: true,
      requestedBrowser,
      browser: candidate,
      browserChannel: candidate,
      browserVersion,
      browserInstance,
      status: BROWSER_PROVIDER_STATUS.AVAILABLE,
      launchOutcome: "available",
      attempts: sanitizeAttempts(attempts),
      lifecycle,
      getStatus: () => lifecycle.status,
      close: async () => {
        normalCloseRequested = true;
        await browserInstance.close();
        lifecycle.status = BROWSER_PROVIDER_STATUS.AVAILABLE;
        lifecycle.closedUnexpectedly = false;
        this.lastStatus = BROWSER_PROVIDER_STATUS.AVAILABLE;
        return {
          ok: true,
          status: BROWSER_PROVIDER_STATUS.AVAILABLE,
          browser: candidate,
          browserChannel: candidate,
          closeOutcome: "closed",
        };
      },
    };
  }

  buildUnavailableResult({ requestedBrowser, status, launchOutcome, attempts }) {
    this.lastStatus = status;
    return {
      ok: false,
      requestedBrowser,
      browser: null,
      browserChannel: null,
      browserVersion: null,
      status,
      launchOutcome,
      attempts: sanitizeAttempts(attempts),
    };
  }
}

async function defaultLoadPlaywright() {
  return import("playwright-core");
}

function normalizeBrowserRequest(browser) {
  const normalized = String(browser || "auto").toLowerCase();
  if (!SUPPORTED_BROWSER_REQUESTS.includes(normalized)) {
    throw new Error(`Unsupported browser request: ${browser}`);
  }
  return normalized;
}

function getBrowserVersion(browserInstance) {
  try {
    return typeof browserInstance?.version === "function" ? browserInstance.version() : null;
  } catch {
    return null;
  }
}

function buildFailureAttempt(candidate, error, forcedStatus = null) {
  const status = forcedStatus || classifyLaunchError(error);
  return {
    candidate,
    status,
    launchOutcome: status === BROWSER_PROVIDER_STATUS.NOT_FOUND ? "browser_not_found" : "browser_launch_failed",
    errorName: sanitizeDiagnostic(error?.name || "Error"),
    message: sanitizeDiagnostic(error?.message || String(error || "")),
  };
}

function classifyLaunchError(error) {
  if (error?.browserProviderStatus === BROWSER_PROVIDER_STATUS.NOT_FOUND) {
    return BROWSER_PROVIDER_STATUS.NOT_FOUND;
  }
  if (error?.browserProviderStatus === BROWSER_PROVIDER_STATUS.LAUNCH_FAILED) {
    return BROWSER_PROVIDER_STATUS.LAUNCH_FAILED;
  }

  const message = String(error?.message || error || "").toLowerCase();
  if (
    error?.code === "ENOENT"
    || message.includes("executable doesn't exist")
    || message.includes("executable does not exist")
    || message.includes("browser was not found")
    || message.includes("browser is not installed")
    || message.includes("browser executable was not found")
    || message.includes("cannot find browser executable")
    || message.includes("could not find browser executable")
    || message.includes("could not locate browser executable")
    || message.includes("could not locate the browser")
    || message.includes("install msedge")
    || message.includes("install chrome")
  ) {
    return BROWSER_PROVIDER_STATUS.NOT_FOUND;
  }

  return BROWSER_PROVIDER_STATUS.LAUNCH_FAILED;
}

function sanitizeAttempts(attempts) {
  return attempts.map(({ browserInstance, ...attempt }) => attempt);
}

function sanitizeDiagnostic(value) {
  return String(value || "")
    .split(/\r?\n/)
    .slice(0, 2)
    .join(" ")
    .replace(/[A-Za-z]:\\[^\s"']+/g, "[path]")
    .replace(/\/[^\s"']+/g, "[path]")
    .slice(0, 500);
}

export {
  AUTO_BROWSER_CANDIDATES,
  BROWSER_PROVIDER_STATUS,
  BrowserProvider,
  SUPPORTED_BROWSER_REQUESTS,
  classifyLaunchError,
  sanitizeDiagnostic,
};
