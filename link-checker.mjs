#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const DEFAULTS = {
  maxPages: 100,
  maxDepth: 2,
  concurrency: 12,
  perHostConcurrency: 4,
  requestDelayMs: 500,
  timeoutMs: 15000,
  retryCount: 2,
  maxRedirects: 10,
  longRedirectThreshold: 3,
  checkExternal: false,
  progressIntervalMs: 500,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 LocalLinkChecker/1.0",
  acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8",
};

const ASSET_EXTENSIONS = new Set([
  ".7z", ".avi", ".bmp", ".css", ".csv", ".doc", ".docx", ".eot", ".gif",
  ".gz", ".ico", ".jpeg", ".jpg", ".js", ".json", ".map", ".mov", ".mp3",
  ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".rar", ".rss", ".svg", ".tar",
  ".ttf", ".txt", ".wav", ".webm", ".webp", ".woff", ".woff2", ".xls",
  ".xlsx", ".xml", ".zip",
]);

const TAG_ATTRIBUTES = new Map([
  ["a", ["href"]],
  ["area", ["href"]],
  ["audio", ["src"]],
  ["embed", ["src"]],
  ["form", ["action"]],
  ["iframe", ["src"]],
  ["img", ["src", "srcset"]],
  ["input", ["src"]],
  ["link", ["href"]],
  ["object", ["data"]],
  ["script", ["src"]],
  ["source", ["src", "srcset"]],
  ["track", ["src"]],
  ["video", ["src", "poster"]],
]);

class Limiter {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this.next();
    });
  }

  next() {
    if (this.active >= this.limit || this.queue.length === 0) {
      return;
    }

    const item = this.queue.shift();
    this.active += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        this.active -= 1;
        this.next();
      });
  }
}

class HostScheduler {
  constructor({ perHostConcurrency, requestDelayMs, globalLimiter }) {
    this.perHostConcurrency = perHostConcurrency;
    this.requestDelayMs = requestDelayMs;
    this.globalLimiter = globalLimiter;
    this.hosts = new Map();
  }

  run(url, task) {
    const host = new URL(url).host;
    const state = this.getState(host);

    return new Promise((resolve, reject) => {
      state.queue.push({ task, resolve, reject });
      this.pump(host);
    });
  }

  hasPending() {
    for (const state of this.hosts.values()) {
      if (state.active > 0 || state.queue.length > 0 || state.timer) {
        return true;
      }
    }
    return false;
  }

  pendingCount() {
    let count = 0;
    for (const state of this.hosts.values()) {
      count += state.queue.length;
    }
    return count;
  }

  getState(host) {
    if (!this.hosts.has(host)) {
      this.hosts.set(host, {
        active: 0,
        queue: [],
        nextAllowedAt: 0,
        timer: null,
      });
    }
    return this.hosts.get(host);
  }

  pump(host) {
    const state = this.getState(host);
    if (state.timer || state.active >= this.perHostConcurrency || state.queue.length === 0) {
      return;
    }

    const delay = Math.max(0, state.nextAllowedAt - Date.now());
    if (delay > 0) {
      state.timer = setTimeout(() => {
        state.timer = null;
        this.pump(host);
      }, delay);
      return;
    }

    const item = state.queue.shift();
    state.active += 1;
    state.nextAllowedAt = Date.now() + this.requestDelayMs;

    this.globalLimiter.run(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        state.active -= 1;
        this.pump(host);
      });

    this.pump(host);
  }
}

class ProgressReporter {
  constructor({ progress, verbose, intervalMs }) {
    this.progress = progress;
    this.verbose = verbose;
    this.intervalMs = intervalMs;
    this.checker = null;
    this.timer = null;
    this.started = 0;
    this.lastLineLength = 0;
    this.pendingRequests = 0;
    this.finishedRequests = 0;
    this.currentUrl = null;
  }

  start(checker) {
    this.checker = checker;
    this.started = performance.now();
    if (this.progress) {
      this.render();
      this.timer = setInterval(() => this.render(), this.intervalMs);
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.progress) {
      this.render();
      if (process.stderr.isTTY) {
        process.stderr.write(`\r${" ".repeat(this.lastLineLength)}\r`);
      } else {
        process.stderr.write("\n");
      }
    }
  }

  pageStarted(url, depth) {
    this.currentUrl = url;
    this.logVerbose(`[page] depth ${depth} ${url}`);
  }

  pageLinksFound(url, count) {
    this.logVerbose(`[links] ${count} found on ${url}`);
  }

  pageQueued(url, depth) {
    this.logVerbose(`[queue] depth ${depth} ${url}`);
  }

  externalSkipped(url, sourcePage) {
    this.logVerbose(`[skip] external ${url} found on ${sourcePage}`);
  }

  requestQueued(url, method) {
    this.pendingRequests += 1;
    this.currentUrl = url;
    this.logVerbose(`[request] ${method} ${url}`);
  }

  requestFinished(result) {
    this.finishedRequests += 1;
    this.currentUrl = result.url;
    const status = formatIssueReason(result);
    const marker = result.ok ? "ok" : "broken";
    this.logVerbose(`[${marker}] ${status} ${result.url}`);
  }

  render() {
    if (!this.progress || !this.checker) {
      return;
    }

    const elapsedSeconds = Math.max(1, Math.round((performance.now() - this.started) / 1000));
    const brokenItems = [...this.checker.results.values()].filter((result) => !result.ok);
    const broken = brokenItems.length;
    const brokenByType = countBrokenByType(brokenItems);
    const parts = [
      `Crawled ${this.checker.crawledPages.size}/${this.checker.options.maxPages} pages`,
      `Queued ${this.checker.pageQueue.length}`,
      `Checked ${this.checker.results.size} URLs`,
      `Active ${this.checker.fetchLimiter.active}`,
      `Host queues ${this.checker.hostScheduler.pendingCount()}`,
      `Broken ${broken}`,
      `404 ${brokenByType.not_found}`,
      `Blocked ${brokenByType.protected}`,
      `Denied ${brokenByType.access_denied}`,
      `Skipped external ${this.checker.skippedExternal}`,
      `${elapsedSeconds}s`,
    ];

    if (this.currentUrl) {
      parts.push(shortenUrl(this.currentUrl, 60));
    }

    const line = parts.join(" | ");
    if (process.stderr.isTTY) {
      const padding = Math.max(0, this.lastLineLength - line.length);
      process.stderr.write(`\r${line}${" ".repeat(padding)}`);
      this.lastLineLength = line.length;
    } else {
      process.stderr.write(`${line}\n`);
    }
  }

  logVerbose(message) {
    if (!this.verbose) {
      return;
    }

    if (this.progress && process.stderr.isTTY) {
      process.stderr.write(`\r${" ".repeat(this.lastLineLength)}\r`);
    }
    process.stderr.write(`${message}\n`);
    if (this.progress && process.stderr.isTTY) {
      this.render();
    }
  }
}

class LinkChecker {
  constructor(startUrl, options) {
    this.startUrl = normalizeUrl(startUrl);
    this.options = options;
    this.startOrigin = new URL(this.startUrl).origin;
    this.startFinalOrigin = null;
    this.fetchLimiter = new Limiter(options.concurrency);
    this.hostScheduler = new HostScheduler({
      perHostConcurrency: options.perHostConcurrency,
      requestDelayMs: options.requestDelayMs,
      globalLimiter: this.fetchLimiter,
    });
    this.pageQueue = [{ url: this.startUrl, depth: 0 }];
    this.queuedPages = new Set([this.startUrl]);
    this.crawledPages = new Set();
    this.statusCache = new Map();
    this.bodyCache = new Map();
    this.results = new Map();
    this.sources = new Map();
    this.skippedExternal = 0;
    this.reporter = options.reporter || null;
    this.currentPages = new Map();
    this.stopped = false;
  }

  async run() {
    this.reporter?.start(this);
    const workers = Array.from(
      { length: this.options.concurrency },
      () => this.pageWorker(),
    );
    try {
      await Promise.all(workers);
      return this.buildReport();
    } finally {
      this.reporter?.stop();
    }
  }

  async pageWorker() {
    while (true) {
      if (this.stopped) {
        return;
      }

      const item = this.pageQueue.shift();
      if (!item) {
        if (this.isCrawlFinished()) {
          return;
        }
        await sleep(50);
        continue;
      }

      await this.processPage(item);
    }
  }

  isCrawlFinished() {
    return this.stopped || (
      this.pageQueue.length === 0
      && this.fetchLimiter.active === 0
      && !this.hostScheduler.hasPending()
    );
  }

  stop() {
    this.stopped = true;
  }

  async processPage({ url, depth }) {
    if (this.stopped || this.crawledPages.has(url) || this.crawledPages.size >= this.options.maxPages) {
      return;
    }

    this.crawledPages.add(url);
    this.currentPages.set(url, depth);
    this.reporter?.pageStarted(url, depth);
    try {
      const pageResult = await this.checkUrl(url, { requireBody: true });

      if (url === this.startUrl && pageResult.finalUrl) {
        this.startFinalOrigin = new URL(pageResult.finalUrl).origin;
      }

      if (this.stopped || !pageResult.ok || !isHtml(pageResult.contentType) || !pageResult.body) {
        return;
      }

      const pageBaseUrl = getDocumentBaseUrl(pageResult.body, pageResult.finalUrl || url);
      const links = extractLinks(pageResult.body, pageBaseUrl);
      this.reporter?.pageLinksFound(url, links.length);
      const checks = [];

      for (const link of links) {
        if (this.stopped) {
          break;
        }

        const resolved = resolveHttpUrl(link.value, pageBaseUrl);
        if (!resolved) {
          continue;
        }

        const fallbackUrls = getResolutionFallbackUrls(link.value, pageResult.finalUrl || url, resolved);
        this.addSource(resolved, {
          page: url,
          tag: link.tag,
          attribute: link.attribute,
          text: link.value,
          fallbackUrls,
        });

        if (this.shouldCheck(resolved)) {
          checks.push(this.checkUrl(resolved, { requireBody: false }));
        } else {
          this.skippedExternal += 1;
          this.reporter?.externalSkipped(resolved, url);
        }

        if (this.shouldCrawl(resolved, link, depth + 1)) {
          this.enqueuePage(resolved, depth + 1);
        }
      }

      await Promise.all(checks);
    } finally {
      this.currentPages.delete(url);
    }
  }

  shouldCheck(url) {
    return this.isCrawlOrigin(url) || this.options.checkExternal;
  }

  shouldCrawl(url, link, depth) {
    if (depth > this.options.maxDepth) {
      return false;
    }
    if (!this.isCrawlOrigin(url)) {
      return false;
    }
    if (!["a", "area", "form"].includes(link.tag)) {
      return false;
    }
    if (this.queuedPages.has(url) || this.crawledPages.has(url)) {
      return false;
    }
    if (this.queuedPages.size >= this.options.maxPages) {
      return false;
    }

    return looksLikePage(url);
  }

  isCrawlOrigin(url) {
    return sameOrigin(url, this.startUrl)
      || Boolean(this.startFinalOrigin && new URL(url).origin === this.startFinalOrigin);
  }

  enqueuePage(url, depth) {
    this.queuedPages.add(url);
    this.pageQueue.push({ url, depth });
    this.reporter?.pageQueued(url, depth);
  }

  addSource(url, source) {
    if (!this.sources.has(url)) {
      this.sources.set(url, []);
    }
    const list = this.sources.get(url);
    const key = `${source.page}|${source.tag}|${source.attribute}|${source.text}`;
    if (!list.some((item) => item.key === key)) {
      list.push({ key, ...source });
    }
  }

  async checkUrl(url, { requireBody }) {
    if (requireBody) {
      if (!this.bodyCache.has(url)) {
        this.bodyCache.set(url, this.fetchWithCache(url, true));
      }
      return this.bodyCache.get(url);
    }

    if (this.bodyCache.has(url)) {
      return this.bodyCache.get(url);
    }

    if (!this.statusCache.has(url)) {
      this.statusCache.set(url, this.fetchWithCache(url, false));
    }
    return this.statusCache.get(url);
  }

  async fetchWithCache(url, requireBody) {
    this.reporter?.requestQueued(url, requireBody ? "GET" : "HEAD");
    const referer = this.getRequestReferer(url);
    const result = await fetchUrl(url, {
      requireBody,
      timeoutMs: this.options.timeoutMs,
      retryCount: this.options.retryCount,
      maxRedirects: this.options.maxRedirects,
      longRedirectThreshold: this.options.longRedirectThreshold,
      userAgent: this.options.userAgent,
      acceptLanguage: this.options.acceptLanguage,
      referer,
      scheduleRequest: (requestUrl, task) => this.hostScheduler.run(requestUrl, task),
    });

    if (this.shouldConfirmWithHomepageFallback(url, result, requireBody)) {
      const homepageFallback = await this.confirmWithHomepageFallback(url);
      if (homepageFallback.ok) {
        this.results.set(url, stripBody(homepageFallback));
        this.reporter?.requestFinished(homepageFallback);
        return homepageFallback;
      }
    }

    if (this.shouldConfirmWithSourceGet(url, result)) {
      const confirmed = await this.confirmWithSourceGet(url);
      if (confirmed.ok) {
        this.results.set(url, stripBody(confirmed));
        this.reporter?.requestFinished(confirmed);
        return confirmed;
      }
    }

    if (!result.ok && result.status === 404) {
      const fallbackResult = await this.confirmWithFallbackUrls(url, result);
      if (fallbackResult !== result && fallbackResult.ok) {
        this.results.set(url, stripBody(fallbackResult));
        this.reporter?.requestFinished(fallbackResult);
        return fallbackResult;
      }
    }

    this.results.set(url, stripBody(result));
    this.reporter?.requestFinished(result);
    return result;
  }

  shouldConfirmWithHomepageFallback(url, result, requireBody) {
    return requireBody
      && url === this.startUrl
      && result.status === 403
      && getHomepageFallbackUrls(url).length > 0;
  }

  async confirmWithHomepageFallback(url) {
    for (const fallbackUrl of getHomepageFallbackUrls(url)) {
      const fallbackResult = await fetchUrl(fallbackUrl, {
        requireBody: true,
        forceGet: true,
        timeoutMs: this.options.timeoutMs,
        retryCount: this.options.retryCount,
        maxRedirects: this.options.maxRedirects,
        longRedirectThreshold: this.options.longRedirectThreshold,
        userAgent: this.options.userAgent,
        acceptLanguage: this.options.acceptLanguage,
        referer: url,
        scheduleRequest: (requestUrl, task) => this.hostScheduler.run(requestUrl, task),
      });

      if (fallbackResult.ok) {
        return {
          ...fallbackResult,
          url,
          finalUrl: fallbackResult.finalUrl || fallbackUrl,
          homepageFallback: true,
          homepageFallbackUrl: fallbackUrl,
          normalizedFrom: url,
        };
      }
    }

    return { ok: false };
  }

  shouldConfirmWithSourceGet(url, result) {
    return !result.ok
      && result.status === 404
      && result.method === "GET"
      && this.sources.has(url)
      && this.sources.get(url).some((source) => sameOrigin(source.page, url));
  }

  async confirmWithSourceGet(url) {
    for (const source of this.sources.get(url) || []) {
      if (!sameOrigin(source.page, url)) {
        continue;
      }

      const result = await fetchUrl(url, {
        requireBody: false,
        forceGet: true,
        timeoutMs: this.options.timeoutMs,
        retryCount: 0,
        maxRedirects: this.options.maxRedirects,
        longRedirectThreshold: this.options.longRedirectThreshold,
        userAgent: this.options.userAgent,
        acceptLanguage: this.options.acceptLanguage,
        referer: source.page,
        scheduleRequest: (requestUrl, task) => this.hostScheduler.run(requestUrl, task),
      });
      result.confirmedWithReferer = source.page;
      if (result.ok) {
        return result;
      }
    }

    return { ok: false };
  }

  async confirmWithFallbackUrls(url, result) {
    if (!this.sources.has(url)) {
      return result;
    }

    for (const source of this.sources.get(url) || []) {
      for (const fallbackUrl of source.fallbackUrls || []) {
        if (fallbackUrl === url || this.results.has(fallbackUrl)) {
          continue;
        }

        const referer = sameOrigin(source.page, fallbackUrl) ? source.page : null;
        const fallbackResult = await fetchUrl(fallbackUrl, {
          requireBody: false,
          forceGet: true,
          timeoutMs: this.options.timeoutMs,
          retryCount: 0,
          maxRedirects: this.options.maxRedirects,
          longRedirectThreshold: this.options.longRedirectThreshold,
          userAgent: this.options.userAgent,
          acceptLanguage: this.options.acceptLanguage,
          referer,
          scheduleRequest: (requestUrl, task) => this.hostScheduler.run(requestUrl, task),
        });
        fallbackResult.normalizedFrom = url;
        fallbackResult.normalizationFallback = true;
        fallbackResult.confirmedWithReferer = referer;

        if (fallbackResult.ok) {
          return fallbackResult;
        }
      }
    }

    return result;
  }

  getRequestReferer(url) {
    const source = this.sources.get(url)?.[0]?.page;
    if (!source) {
      return null;
    }

    return sameOrigin(source, url) ? source : null;
  }

  buildReport() {
    const checked = [...this.results.values()];
    const broken = checked
      .filter((result) => !result.ok)
      .map((result) => ({
        ...result,
        sources: (this.sources.get(result.url) || []).map(({ key, ...source }) => source),
      }))
      .sort((a, b) => a.url.localeCompare(b.url));

    return {
      startedAt: new Date().toISOString(),
      startUrl: this.startUrl,
      options: {
        maxPages: this.options.maxPages,
        maxDepth: this.options.maxDepth,
        concurrency: this.options.concurrency,
        perHostConcurrency: this.options.perHostConcurrency,
        requestDelayMs: this.options.requestDelayMs,
        timeoutMs: this.options.timeoutMs,
        retryCount: this.options.retryCount,
        maxRedirects: this.options.maxRedirects,
        longRedirectThreshold: this.options.longRedirectThreshold,
        userAgent: this.options.userAgent,
        acceptLanguage: this.options.acceptLanguage,
        checkExternal: this.options.checkExternal,
      },
      summary: {
        pagesCrawled: this.crawledPages.size,
        urlsChecked: checked.length,
        brokenLinks: broken.length,
        brokenByType: countBrokenByType(broken),
        redirects: countRedirected(checked),
        redirectByType: countRedirectByType(checked),
        skippedExternal: this.skippedExternal,
      },
      broken,
      checked,
    };
  }
}

async function fetchUrl(url, {
  requireBody,
  forceGet = false,
  timeoutMs,
  retryCount,
  maxRedirects,
  longRedirectThreshold,
  userAgent,
  acceptLanguage,
  referer,
  scheduleRequest,
}) {
  const started = performance.now();
  let result = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    result = await fetchUrlOnce(url, {
      requireBody,
      forceGet,
      timeoutMs,
      maxRedirects,
      longRedirectThreshold,
      userAgent,
      acceptLanguage,
      referer,
      scheduleRequest,
      started,
    });
    result.attempts = attempt + 1;

    if (attempt >= retryCount || !shouldRetryResult(result)) {
      return result;
    }

    await sleep(getRetryDelayMs(attempt));
  }

  return result;
}

async function fetchUrlOnce(url, {
  requireBody,
  forceGet,
  timeoutMs,
  maxRedirects,
  longRedirectThreshold,
  userAgent,
  acceptLanguage,
  referer,
  scheduleRequest,
  started,
}) {
  try {
    if (requireBody || forceGet) {
      return await request(url, "GET", {
        timeoutMs,
        maxRedirects,
        longRedirectThreshold,
        userAgent,
        acceptLanguage,
        referer,
        readBody: true,
        scheduleRequest,
        started,
      });
    }

    const head = await request(url, "HEAD", {
      timeoutMs,
      maxRedirects,
      longRedirectThreshold,
      userAgent,
      acceptLanguage,
      referer,
      readBody: false,
      scheduleRequest,
      started,
    });
    if (head.ok || !shouldFallbackFromHeadToGet(head)) {
      return head;
    }

    return await request(url, "GET", {
      timeoutMs,
      maxRedirects,
      longRedirectThreshold,
      userAgent,
      acceptLanguage,
      referer,
      readBody: false,
      scheduleRequest,
      started,
    });
  } catch (error) {
    const cause = getErrorCause(error);
    return {
      url,
      ok: false,
      status: null,
      method: requireBody ? "GET" : "HEAD",
      finalUrl: null,
      contentType: null,
      redirected: false,
      redirectCount: 0,
      redirectChain: [],
      redirectType: "none",
      redirectIssues: [],
      redirectLabels: [],
      elapsedMs: Math.round(performance.now() - started),
      error: error.name === "AbortError" ? `Timeout after ${timeoutMs}ms` : error.message,
      cause,
      classification: "network_error",
      issueType: error.name === "AbortError" || cause?.code === "ETIMEDOUT" ? "timeout" : "network_error",
      diagnosis: error.name === "AbortError"
        ? `Request timed out after ${timeoutMs}ms.`
        : getNetworkDiagnosis(cause),
    };
  }
}

function getErrorCause(error) {
  if (!error.cause) {
    return null;
  }

  return {
    name: error.cause.name,
    message: error.cause.message || null,
    code: error.cause.code || null,
    errno: error.cause.errno || null,
    syscall: error.cause.syscall || null,
    host: error.cause.hostname || error.cause.host || null,
  };
}

function getNetworkDiagnosis(cause) {
  if (cause?.code === "EACCES") {
    return "Network request was blocked before an HTTP response was received.";
  }
  if (cause?.code === "ENOTFOUND") {
    return "Domain name could not be resolved.";
  }
  if (cause?.code === "ECONNREFUSED") {
    return "Remote server refused the TCP connection.";
  }
  if (cause?.code === "ETIMEDOUT") {
    return "Network connection timed out before an HTTP response was received.";
  }
  return "Network request failed before an HTTP response was received.";
}

async function request(url, method, {
  timeoutMs,
  maxRedirects,
  longRedirectThreshold,
  userAgent,
  acceptLanguage,
  referer,
  readBody,
  scheduleRequest,
  started,
}) {
  let currentUrl = url;
  let currentMethod = method;
  const redirectChain = [];
  const seenUrls = new Set([normalizeRedirectVisitUrl(currentUrl)]);

  while (true) {
    const response = await scheduleRequest(currentUrl, () => rawRequest(currentUrl, currentMethod, {
      timeoutMs,
      userAgent,
      acceptLanguage,
      referer,
    }));

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        const result = await buildResponseResult(response, {
          url,
          method,
          currentMethod,
          readBody,
          referer,
          started,
          redirectChain,
          maxRedirects,
          longRedirectThreshold,
        });
        result.redirectIssues.push("redirect_without_location");
        result.redirectLabels.push("redirect_without_location");
        return result;
      }

      const nextUrl = new URL(location, currentUrl).toString();
      redirectChain.push({
        from: currentUrl,
        status: response.status,
        to: nextUrl,
      });

      if (redirectChain.length > maxRedirects) {
        return buildRedirectFailureResult({
          url,
          finalUrl: nextUrl,
          method,
          status: response.status,
          error: `Too many redirects after ${maxRedirects} redirects.`,
          issueType: "too_many_redirects",
          diagnosis: `Redirect chain exceeded the configured limit of ${maxRedirects}.`,
          redirectChain,
          maxRedirects,
          longRedirectThreshold,
          started,
        });
      }

      const visitUrl = normalizeRedirectVisitUrl(nextUrl);
      if (seenUrls.has(visitUrl)) {
        return buildRedirectFailureResult({
          url,
          finalUrl: nextUrl,
          method,
          status: response.status,
          error: "Redirect loop detected.",
          issueType: "redirect_loop",
          diagnosis: "Redirect chain points back to a URL already seen.",
          redirectChain,
          maxRedirects,
          longRedirectThreshold,
          started,
        });
      }

      seenUrls.add(visitUrl);
      currentUrl = nextUrl;
      currentMethod = getRedirectMethod(currentMethod, response.status);
      continue;
    }

    return await buildResponseResult(response, {
      url,
      method,
      currentMethod,
      readBody,
      referer,
      started,
      redirectChain,
      maxRedirects,
      longRedirectThreshold,
    });
  }
}

async function rawRequest(url, method, { timeoutMs, userAgent, acceptLanguage, referer }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "user-agent": userAgent,
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": acceptLanguage,
  };
  if (referer) {
    headers.referer = referer;
  }

  try {
    return await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function buildResponseResult(response, {
  url,
  method,
  currentMethod,
  readBody,
  referer,
  started,
  redirectChain,
  maxRedirects,
  longRedirectThreshold,
}) {
  const contentType = response.headers.get("content-type");
  const result = {
    url,
    ok: response.status < 400,
    status: response.status,
    method,
    finalMethod: currentMethod,
    finalUrl: response.url,
    contentType,
    server: response.headers.get("server"),
    requestReferer: referer || null,
    elapsedMs: Math.round(performance.now() - started),
    error: null,
  };

  if (readBody) {
    result.body = await response.text();
  } else if (!result.ok && isHtml(contentType)) {
    result.diagnosticBody = (await response.text()).slice(0, 4096);
  }

    applyRedirectMetadata(result, {
      originalUrl: url,
      redirectChain,
      maxRedirects,
      longRedirectThreshold,
    });
    applyResponseClassification(result, response.headers);
    applyRedirectIssueClassification(result);
    return result;
}

function buildRedirectFailureResult({
  url,
  finalUrl,
  method,
  status,
  error,
  issueType,
  diagnosis,
  redirectChain,
  maxRedirects,
  longRedirectThreshold,
  started,
}) {
  const result = {
    url,
    ok: false,
    status,
    method,
    finalUrl,
    contentType: null,
    server: null,
    elapsedMs: Math.round(performance.now() - started),
    error,
    classification: "redirect_error",
    issueType,
    diagnosis,
  };

  applyRedirectMetadata(result, {
    originalUrl: url,
    redirectChain,
    maxRedirects,
    longRedirectThreshold,
  });

  if (!result.redirectIssues.includes(issueType)) {
    result.redirectIssues.push(issueType);
  }
  if (!result.redirectLabels.includes(issueType)) {
    result.redirectLabels.push(issueType);
  }

  return result;
}

function shouldRetryResult(result) {
  if (
    result.ok
    || result.classification === "protected"
    || result.classification === "redirect_error"
    || result.status === 404
  ) {
    return false;
  }

  if (result.status === 429 || [500, 502, 503, 504].includes(result.status)) {
    return true;
  }

  if (result.classification === "network_error") {
    return result.issueType === "timeout" || [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "EAI_AGAIN",
    ].includes(result.cause?.code);
  }

  return false;
}

function getRetryDelayMs(attempt) {
  return Math.min(4000, 500 * 2 ** attempt);
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function getRedirectMethod(method, status) {
  if (method === "HEAD") {
    return "HEAD";
  }
  if (status === 303) {
    return "GET";
  }
  return method;
}

function normalizeRedirectVisitUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function applyRedirectMetadata(result, {
  originalUrl,
  redirectChain,
  longRedirectThreshold,
}) {
  const redirectType = getRedirectType(redirectChain);
  const redirectIssues = [];
  const redirectLabels = [];
  const finalUrl = result.finalUrl || redirectChain.at(-1)?.to || originalUrl;

  if (redirectChain.length > 0) {
    redirectLabels.push(redirectType);
  }
  if (redirectChain.length > longRedirectThreshold) {
    redirectIssues.push("long_redirect_chain");
    redirectLabels.push("long_redirect_chain");
  }
  if (finalUrl && new URL(finalUrl).host !== new URL(originalUrl).host) {
    redirectIssues.push("cross_host_redirect");
    redirectLabels.push("cross_host_redirect");
  }
  if (redirectChain.length > 0 && result.status >= 400) {
    redirectIssues.push("redirect_to_error");
    redirectLabels.push("redirect_to_error");
  }

  result.redirected = redirectChain.length > 0;
  result.redirectCount = redirectChain.length;
  result.redirectChain = redirectChain;
  result.redirectType = redirectType;
  result.redirectIssues = [...new Set(redirectIssues)];
  result.redirectLabels = [...new Set(redirectLabels)];
}

function getRedirectType(redirectChain) {
  if (redirectChain.length === 0) {
    return "none";
  }

  const hasPermanent = redirectChain.some((item) => item.status === 301 || item.status === 308);
  const hasTemporary = redirectChain.some((item) => [302, 303, 307].includes(item.status));
  if (hasPermanent && hasTemporary) {
    return "mixed_redirect";
  }
  if (hasPermanent) {
    return "permanent_redirect";
  }
  return "temporary_redirect";
}

function applyRedirectIssueClassification(result) {
  if (!result.redirected) {
    return;
  }

  if (result.classification === "redirect_error") {
    return;
  }

  if (result.redirectIssues.includes("redirect_to_error")) {
    result.classification = "redirect_error";
    result.issueType = "redirect_to_error";
    result.diagnosis = `Redirect chain ended with HTTP ${result.status}.`;
  }
}

function applyResponseClassification(result, headers) {
  if (result.ok) {
    result.classification = "ok";
    result.issueType = "ok";
    result.diagnosis = "HTTP response is successful.";
    return;
  }

  const protection = detectProtectionLayer(result, headers);
  if (protection) {
    result.classification = "protected";
    result.issueType = "protected";
    result.protection = protection;
    result.diagnosis = `Blocked by protection layer${protection.provider ? ` (${protection.provider})` : ""}.`;
    return;
  }

  if (result.status === 403) {
    result.classification = "access_denied";
    result.issueType = "access_denied";
    result.diagnosis = "HTTP 403 Forbidden. The server rejected this checker request; verify with a browser, login state, cookies, Referer, or site policy.";
    return;
  }

  result.classification = "http_error";
  result.issueType = getIssueType(result);
  result.diagnosis = result.status
    ? `HTTP ${result.status} response.`
    : "HTTP request failed.";
}

function detectProtectionLayer(result, headers) {
  const server = (result.server || "").toLowerCase();
  const body = (result.body || result.diagnosticBody || "").toLowerCase();
  const title = extractTitle(result.body || result.diagnosticBody || "");
  const statusLooksBlocked = result.status === 403 || result.status === 429 || result.status === 503;
  const evidence = [];
  let provider = null;

  if (server.includes("cloudflare") || headers.get("cf-ray") || headers.get("cf-cache-status")) {
    provider = "Cloudflare";
    evidence.push("Cloudflare response header");
  }
  if (body.includes("attention required! | cloudflare") || body.includes("/cdn-cgi/challenge-platform")) {
    provider = "Cloudflare";
    evidence.push("Cloudflare challenge page");
  }
  if (body.includes("just a moment...") && body.includes("cloudflare")) {
    provider = "Cloudflare";
    evidence.push("Cloudflare browser verification page");
  }
  if (server.includes("akamai") || headers.get("akamai-origin-hop")) {
    provider = provider || "Akamai";
    evidence.push("Akamai response header");
  }
  if (server.includes("imperva") || body.includes("incapsula incident id")) {
    provider = provider || "Imperva";
    evidence.push("Imperva/Incapsula block page");
  }
  if (headers.get("x-sucuri-id") || body.includes("sucuri website firewall")) {
    provider = provider || "Sucuri";
    evidence.push("Sucuri firewall page");
  }
  if (body.includes("access denied") || body.includes("request blocked")) {
    evidence.push("Access denied wording");
  }

  if (!statusLooksBlocked || evidence.length === 0) {
    return null;
  }

  return {
    provider,
    status: result.status,
    title,
    evidence,
  };
}

function extractTitle(html) {
  return (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldRetryWithGet(status) {
  return status === 403 || status === 404 || status === 405 || status === 501 || status >= 500;
}

function shouldFallbackFromHeadToGet(result) {
  return shouldRetryWithGet(result.status)
    || result.classification === "redirect_error"
    || result.issueType === "redirect_to_error"
    || result.issueType === "too_many_redirects"
    || result.issueType === "redirect_loop";
}

function extractLinks(html, baseUrl) {
  const links = [];
  const tagRegex = /<([a-zA-Z][\w:-]*)(\s[^<>]*?)?>/g;
  let tagMatch;

  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[1].toLowerCase();
    const attributesToRead = TAG_ATTRIBUTES.get(tag);
    if (!attributesToRead) {
      continue;
    }

    const attributes = parseAttributes(tagMatch[2] || "");
    for (const attribute of attributesToRead) {
      const value = attributes.get(attribute);
      if (!value) {
        continue;
      }

      if (attribute === "srcset") {
        for (const src of parseSrcset(value)) {
          links.push({ tag, attribute, value: src });
        }
      } else {
        links.push({ tag, attribute, value });
      }
    }
  }

  const metaRefresh = extractMetaRefresh(html, baseUrl);
  if (metaRefresh) {
    links.push({ tag: "meta", attribute: "http-equiv=refresh", value: metaRefresh });
  }

  return links;
}

function getDocumentBaseUrl(html, pageUrl) {
  const baseHref = extractBaseHref(html);
  if (!baseHref) {
    return pageUrl;
  }

  const resolved = resolveHttpUrl(baseHref, pageUrl);
  return resolved || pageUrl;
}

function getHomepageFallbackUrls(url) {
  try {
    const parsed = new URL(url);
    if (parsed.search || parsed.hash || parsed.pathname !== "/") {
      return [];
    }

    return [new URL("/Default.aspx", parsed.origin).href];
  } catch {
    return [];
  }
}

function extractBaseHref(html) {
  const match = /<base\s+[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i.exec(html);
  return match ? decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "").trim() : null;
}

function parseAttributes(input) {
  const attributes = new Map();
  const attrRegex = /([^\s"'=<>`]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match;

  while ((match = attrRegex.exec(input)) !== null) {
    const name = match[1].toLowerCase();
    const value = decodeHtmlEntities(match[3] ?? match[4] ?? match[5] ?? "").trim();
    attributes.set(name, value);
  }

  return attributes;
}

function parseSrcset(value) {
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function extractMetaRefresh(html) {
  const metaRegex = /<meta\s+[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi;
  const contentRegex = /\bcontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i;
  const urlRegex = /url\s*=\s*([^;]+)/i;
  let match;

  while ((match = metaRegex.exec(html)) !== null) {
    const content = contentRegex.exec(match[0]);
    const value = content?.[2] ?? content?.[3] ?? content?.[4];
    if (!value) {
      continue;
    }

    const url = urlRegex.exec(decodeHtmlEntities(value));
    if (url?.[1]) {
      return url[1].trim().replace(/^['"]|['"]$/g, "");
    }
  }

  return null;
}

function resolveHttpUrl(rawValue, baseUrl) {
  const raw = decodeHtmlEntities(rawValue || "").trim();
  if (!raw || raw.startsWith("#")) {
    return null;
  }

  const lowered = raw.toLowerCase();
  if (
    lowered.startsWith("mailto:") ||
    lowered.startsWith("tel:") ||
    lowered.startsWith("sms:") ||
    lowered.startsWith("javascript:") ||
    lowered.startsWith("data:") ||
    lowered.startsWith("blob:") ||
    lowered.startsWith("about:")
  ) {
    return null;
  }

  try {
    return normalizeUrl(new URL(raw, baseUrl).toString());
  } catch {
    return null;
  }
}

function getResolutionFallbackUrls(rawValue, pageUrl, primaryUrl) {
  const raw = decodeHtmlEntities(rawValue || "").trim();
  if (!raw || raw.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(raw) || raw.startsWith("//") || raw.startsWith("/")) {
    return [];
  }

  const candidates = [];
  const rootFallback = resolveHttpUrl(`/${raw}`, pageUrl);
  if (rootFallback && rootFallback !== primaryUrl) {
    candidates.push(rootFallback);
  }

  const pageAsDirectoryBase = getRouteDirectoryBaseUrl(pageUrl);
  if (pageAsDirectoryBase && pageAsDirectoryBase !== pageUrl) {
    const routeFallback = resolveHttpUrl(raw, pageAsDirectoryBase);
    if (routeFallback && routeFallback !== primaryUrl) {
      candidates.push(routeFallback);
    }
  }

  return [...new Set(candidates)];
}

function getRouteDirectoryBaseUrl(pageUrl) {
  const url = new URL(pageUrl);
  if (url.pathname.endsWith("/")) {
    return url.toString();
  }

  const lastSegment = url.pathname.split("/").pop() || "";
  if (lastSegment.includes(".")) {
    return url.toString();
  }

  url.pathname = `${url.pathname}/`;
  return url.toString();
}

function normalizeUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Only http and https URLs are supported: ${value}`);
  }

  url.hash = "";
  return url.toString();
}

function sameOrigin(left, right) {
  return new URL(left).origin === new URL(right).origin;
}

function looksLikePage(urlValue) {
  const pathname = new URL(urlValue).pathname;
  const lastSegment = pathname.split("/").pop() || "";
  const dot = lastSegment.lastIndexOf(".");
  if (dot === -1) {
    return true;
  }

  return !ASSET_EXTENSIONS.has(lastSegment.slice(dot).toLowerCase());
}

function isHtml(contentType) {
  return Boolean(contentType && /(^|;|\s)(text\/html|application\/xhtml\+xml)\b/i.test(contentType));
}

function stripBody(result) {
  const { body, diagnosticBody, ...withoutBody } = result;
  return withoutBody;
}

function getIssueType(result) {
  if (result.ok) {
    return "ok";
  }
  if (result.classification === "redirect_error") {
    return result.issueType || "redirect_error";
  }
  if (result.classification === "protected") {
    return "protected";
  }
  if (result.classification === "access_denied" || result.status === 403) {
    return "access_denied";
  }
  if (result.status === 404) {
    return "not_found";
  }
  if (result.classification === "network_error") {
    return result.error?.toLowerCase().includes("timeout") || result.cause?.code === "ETIMEDOUT"
      ? "timeout"
      : "network_error";
  }
  if (result.status >= 400) {
    return "http_error";
  }
  return "unknown_error";
}

function countBrokenByType(items) {
  const counts = {
    not_found: 0,
    protected: 0,
    access_denied: 0,
    http_error: 0,
    redirect_to_error: 0,
    too_many_redirects: 0,
    redirect_loop: 0,
    timeout: 0,
    network_error: 0,
    unknown_error: 0,
  };

  for (const item of items) {
    const issueType = item.issueType || getIssueType(item);
    if (Object.prototype.hasOwnProperty.call(counts, issueType)) {
      counts[issueType] += 1;
    } else {
      counts.unknown_error += 1;
    }
  }

  return counts;
}

function countRedirected(items) {
  return items.filter((item) => item.redirected).length;
}

function countRedirectByType(items) {
  const counts = {
    permanent_redirect: 0,
    temporary_redirect: 0,
    mixed_redirect: 0,
    cross_host_redirect: 0,
    long_redirect_chain: 0,
    redirect_to_error: 0,
    too_many_redirects: 0,
    redirect_loop: 0,
    redirect_without_location: 0,
  };

  for (const item of items) {
    for (const label of item.redirectLabels || []) {
      if (Object.prototype.hasOwnProperty.call(counts, label)) {
        counts[label] += 1;
      }
    }
  }

  return counts;
}

function getIssueTypeLabel(issueType) {
  const labels = {
    not_found: "404 not found",
    protected: "Blocked by protection layer",
    access_denied: "Access denied / needs review",
    http_error: "Other HTTP errors",
    redirect_to_error: "Redirects ending in errors",
    too_many_redirects: "Too many redirects",
    redirect_loop: "Redirect loops",
    timeout: "Timeout",
    network_error: "Network errors",
    unknown_error: "Unknown errors",
  };
  return labels[issueType] || issueType;
}

function getRedirectTypeLabel(redirectType) {
  const labels = {
    permanent_redirect: "Permanent redirects",
    temporary_redirect: "Temporary redirects",
    mixed_redirect: "Mixed redirects",
    cross_host_redirect: "Cross-host redirects",
    long_redirect_chain: "Long redirect chains",
    redirect_to_error: "Redirects ending in errors",
    too_many_redirects: "Too many redirects",
    redirect_loop: "Redirect loops",
    redirect_without_location: "Redirects without Location",
  };
  return labels[redirectType] || redirectType;
}

function formatIssueReason(result) {
  if (result.ok) {
    return result.status ? `HTTP ${result.status}` : "OK";
  }
  if (result.classification === "redirect_error") {
    if (result.issueType === "redirect_to_error") {
      return `Redirect ended in HTTP ${result.status}`;
    }
    if (result.issueType === "too_many_redirects") {
      return "Too many redirects";
    }
    if (result.issueType === "redirect_loop") {
      return "Redirect loop";
    }
    return "Redirect error";
  }
  if (result.classification === "protected") {
    const provider = result.protection?.provider ? `: ${result.protection.provider}` : "";
    const status = result.status ? `HTTP ${result.status}` : "blocked";
    return `Blocked by protection layer${provider} (${status})`;
  }
  if (result.classification === "access_denied" || result.issueType === "access_denied") {
    return "Access denied / needs review (HTTP 403)";
  }
  if (result.status) {
    return `HTTP ${result.status}`;
  }
  return result.error || "Request failed";
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortenUrl(url, maxLength) {
  if (url.length <= maxLength) {
    return url;
  }
  return `${url.slice(0, Math.max(0, maxLength - 3))}...`;
}

function parseArgs(argv) {
  const args = [...argv];
  const options = { ...DEFAULTS };
  let startUrl = null;
  let output = null;
  let json = false;
  let progress = false;
  let verbose = false;

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--external") {
      options.checkExternal = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--progress") {
      progress = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--max-pages") {
      options.maxPages = readPositiveInteger(args.shift(), "--max-pages");
      continue;
    }
    if (arg === "--max-depth") {
      options.maxDepth = readPositiveInteger(args.shift(), "--max-depth");
      continue;
    }
    if (arg === "--concurrency") {
      options.concurrency = readPositiveInteger(args.shift(), "--concurrency");
      continue;
    }
    if (arg === "--global-concurrency") {
      options.concurrency = readPositiveInteger(args.shift(), "--global-concurrency");
      continue;
    }
    if (arg === "--per-host-concurrency") {
      options.perHostConcurrency = readPositiveInteger(args.shift(), "--per-host-concurrency");
      continue;
    }
    if (arg === "--request-delay-ms") {
      options.requestDelayMs = readNonNegativeInteger(args.shift(), "--request-delay-ms");
      continue;
    }
    if (arg === "--request-delay") {
      options.requestDelayMs = Math.round(readNonNegativeNumber(args.shift(), "--request-delay") * 1000);
      continue;
    }
    if (arg === "--timeout") {
      options.timeoutMs = readPositiveInteger(args.shift(), "--timeout");
      continue;
    }
    if (arg === "--timeout-seconds") {
      options.timeoutMs = Math.round(readPositiveInteger(args.shift(), "--timeout-seconds") * 1000);
      continue;
    }
    if (arg === "--retry-count") {
      options.retryCount = readNonNegativeInteger(args.shift(), "--retry-count");
      continue;
    }
    if (arg === "--max-redirects") {
      options.maxRedirects = readNonNegativeInteger(args.shift(), "--max-redirects");
      continue;
    }
    if (arg === "--long-redirect-threshold") {
      options.longRedirectThreshold = readNonNegativeInteger(args.shift(), "--long-redirect-threshold");
      continue;
    }
    if (arg === "--accept-language") {
      options.acceptLanguage = args.shift();
      if (!options.acceptLanguage) {
        throw new Error("--accept-language requires a value");
      }
      continue;
    }
    if (arg === "--user-agent") {
      options.userAgent = args.shift();
      if (!options.userAgent) {
        throw new Error("--user-agent requires a value");
      }
      continue;
    }
    if (arg === "--output" || arg === "-o") {
      output = args.shift();
      if (!output) {
        throw new Error(`${arg} requires a file path`);
      }
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (startUrl) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    startUrl = arg;
  }

  if (!startUrl) {
    throw new Error("Missing start URL");
  }

  options.concurrency = Math.max(1, Math.min(options.concurrency, 100));
  options.perHostConcurrency = Math.max(1, Math.min(options.perHostConcurrency, 50));
  options.requestDelayMs = Math.max(0, Math.min(options.requestDelayMs, 60000));
  options.retryCount = Math.max(0, Math.min(options.retryCount, 5));
  options.maxRedirects = Math.max(0, Math.min(options.maxRedirects, 20));
  options.longRedirectThreshold = Math.max(0, Math.min(options.longRedirectThreshold, options.maxRedirects));
  return { startUrl, options, output, json, progress, verbose };
}

function readPositiveInteger(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function readNonNegativeInteger(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return number;
}

function readNonNegativeNumber(value, name) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return number;
}

function printHelp() {
  console.log(`Local Link Checker

Usage:
  node link-checker.mjs <url> [options]
  check-links.cmd <url> [options]

Options:
  --max-pages <n>     Maximum same-origin pages to crawl. Default: ${DEFAULTS.maxPages}
  --max-depth <n>     Maximum crawl depth from the start page. Default: ${DEFAULTS.maxDepth}
  --concurrency <n>   Global concurrent requests. Default: ${DEFAULTS.concurrency}
  --global-concurrency <n>
                       Same as --concurrency.
  --per-host-concurrency <n>
                       Concurrent requests per host. Default: ${DEFAULTS.perHostConcurrency}
  --request-delay-ms <n>
                       Minimum delay between requests per host. Default: ${DEFAULTS.requestDelayMs}
  --request-delay <s>  Same delay in seconds, for example 1.5.
  --timeout <ms>      Request timeout in milliseconds. Default: ${DEFAULTS.timeoutMs}
  --timeout-seconds <n>
                       Request timeout in seconds.
  --retry-count <n>   Retries for transient failures. Default: ${DEFAULTS.retryCount}
  --max-redirects <n> Maximum redirects to follow. Default: ${DEFAULTS.maxRedirects}
  --long-redirect-threshold <n>
                       Mark redirect chains longer than this. Default: ${DEFAULTS.longRedirectThreshold}
  --accept-language <value>
                       Accept-Language header. Default: ${DEFAULTS.acceptLanguage}
  --user-agent <value> User-Agent header.
  --external          Also check links that point to other domains.
  --progress          Show a live progress line while checking.
  --verbose           Show detailed page, request, skip, and result events.
  --output, -o <file> Write the full JSON report to a file.
  --json              Print the full JSON report to the console.
  --help, -h          Show this help.
`);
}

function printSummary(report) {
  const summary = report.summary;
  console.log(`Start URL: ${report.startUrl}`);
  console.log(`Pages crawled: ${summary.pagesCrawled}`);
  console.log(`URLs checked: ${summary.urlsChecked}`);
  console.log(`Broken links: ${summary.brokenLinks}`);
  if (summary.brokenLinks > 0) {
    for (const [issueType, count] of Object.entries(summary.brokenByType || {})) {
      if (count > 0) {
        console.log(`  ${getIssueTypeLabel(issueType)}: ${count}`);
      }
    }
  }
  if (!report.options.checkExternal) {
    console.log(`External links skipped: ${summary.skippedExternal}`);
  }
  if (summary.redirects > 0) {
    console.log(`Redirected URLs: ${summary.redirects}`);
    for (const [redirectType, count] of Object.entries(summary.redirectByType || {})) {
      if (count > 0) {
        console.log(`  ${getRedirectTypeLabel(redirectType)}: ${count}`);
      }
    }
  }

  if (report.broken.length === 0) {
    console.log("No broken links found.");
    return;
  }

  console.log("");
  console.log("Broken links:");
  for (const item of report.broken) {
    const reason = formatIssueReason(item);
    console.log(`- ${reason}: ${item.url}`);
    if (item.classification === "protected") {
      const evidence = item.protection?.evidence?.join(", ");
      console.log(`  diagnosis: ${item.diagnosis}${evidence ? ` Evidence: ${evidence}.` : ""}`);
    }
    if (item.redirected) {
      console.log(`  redirect: ${item.redirectCount} step(s), final URL: ${item.finalUrl}`);
    }
    for (const source of item.sources.slice(0, 3)) {
      console.log(`  found on ${source.page} (${source.tag}[${source.attribute}])`);
    }
    if (item.sources.length > 3) {
      console.log(`  and ${item.sources.length - 3} more source(s)`);
    }
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  const reporter = parsed.json
    ? null
    : new ProgressReporter({
        progress: parsed.progress,
        verbose: parsed.verbose,
        intervalMs: parsed.options.progressIntervalMs,
      });
  const checker = new LinkChecker(parsed.startUrl, {
    ...parsed.options,
    reporter,
  });
  const report = await checker.run();

  if (parsed.output) {
    await writeFile(parsed.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
    if (parsed.output) {
      console.log(`Full report written to: ${parsed.output}`);
    }
  }

  process.exitCode = report.summary.brokenLinks > 0 ? 2 : 0;
}

export { DEFAULTS, LinkChecker };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
