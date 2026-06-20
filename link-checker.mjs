#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const CANONICAL_STRATEGIES = new Set(["safe", "moderate", "aggressive"]);
const SPA_LINK_MODES = new Set(["auto", "off", "strict"]);
const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "msclkid", "yclid"]);
const BODY_SIGNATURE_SNIPPET_LENGTH = 240;
const WAF_HEADER_NAMES = [
  "server",
  "cf-ray",
  "cf-cache-status",
  "akamai-origin-hop",
  "x-akamai-request-id",
  "x-sucuri-id",
  "x-sucuri-cache",
  "x-iinfo",
  "x-cdn",
  "x-waf-rule-id",
  "x-mod-security-message",
  "x-blocked-by",
];
const BLOCK_RULE_HEADER_NAMES = [
  "x-waf-rule-id",
  "x-mod-security-message",
  "x-blocked-by",
  "x-sucuri-block",
];
const PROTECTION_BODY_PATTERNS = [
  { id: "cloudflare_attention_required", text: "attention required! | cloudflare", provider: "Cloudflare", reason: "cloudflare_challenge", suspectedWaf: true, suspectedBot: true, evidence: "Cloudflare challenge page" },
  { id: "cloudflare_challenge_platform", text: "/cdn-cgi/challenge-platform", provider: "Cloudflare", reason: "cloudflare_challenge", suspectedWaf: true, suspectedBot: true, evidence: "Cloudflare challenge page" },
  { id: "cloudflare_just_a_moment", text: "just a moment...", provider: "Cloudflare", reason: "cloudflare_browser_verification", suspectedWaf: true, suspectedBot: true, evidence: "Cloudflare browser verification page" },
  { id: "imperva_incapsula", text: "incapsula incident id", provider: "Imperva", reason: "imperva_block", suspectedWaf: true, suspectedBot: false, evidence: "Imperva/Incapsula block page" },
  { id: "sucuri_firewall", text: "sucuri website firewall", provider: "Sucuri", reason: "sucuri_firewall", suspectedWaf: true, suspectedBot: false, evidence: "Sucuri firewall page" },
  { id: "captcha", text: "captcha", provider: null, reason: "captcha_or_challenge", suspectedWaf: false, suspectedBot: true, evidence: "CAPTCHA wording" },
  { id: "bot_verification", text: "bot verification", provider: null, reason: "bot_verification", suspectedWaf: false, suspectedBot: true, evidence: "Bot verification wording" },
  { id: "access_denied", text: "access denied", provider: null, reason: "access_denied_wording", suspectedWaf: false, suspectedBot: false, evidence: "Access denied wording" },
  { id: "request_blocked", text: "request blocked", provider: null, reason: "request_blocked_wording", suspectedWaf: true, suspectedBot: false, evidence: "Access denied wording" },
];

const CONSERVATIVE_DEFAULTS = {
  concurrency: 3,
  perHostConcurrency: 1,
  requestDelayMinMs: 2000,
  requestDelayMaxMs: 5000,
  retryCount: 1,
  checkExternal: false,
  preferGet: true,
  externalReferer: true,
  userAgent: BROWSER_USER_AGENT,
};

const DEFAULTS = {
  maxPages: 100,
  maxDepth: 2,
  concurrency: 12,
  perHostConcurrency: 4,
  requestDelayMs: 500,
  requestDelayMinMs: null,
  requestDelayMaxMs: null,
  timeoutMs: 15000,
  retryCount: 2,
  maxRedirects: 10,
  longRedirectThreshold: 3,
  checkExternal: false,
  progressIntervalMs: 500,
  preferGet: false,
  externalReferer: false,
  conservativeMode: false,
  canonicalStrategy: "safe",
  legacyTls: false,
  systemCa: false,
  confirm404: true,
  confirmationMaxUrls: 100,
  confirmationMaxPerHost: 20,
  confirmationConcurrency: 2,
  confirmationPerHostConcurrency: 1,
  confirmationDelayMinMs: 1000,
  confirmationDelayMaxMs: 3000,
  spaLinks: "auto",
  userAgent: `${BROWSER_USER_AGENT} LocalLinkChecker/1.0`,
  acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8",
};

const PAGE_NAVIGATION_TAGS = new Set(["a", "area", "form", "meta", "script"]);
let runtimeSystemCaEnabled = false;

function applyConservativeDefaults(options, explicitOptions = new Set()) {
  for (const [key, value] of Object.entries(CONSERVATIVE_DEFAULTS)) {
    if (!explicitOptions.has(key)) {
      options[key] = value;
    }
  }
  options.conservativeMode = true;
  return options;
}

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

const COMMON_MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.jp", "co.kr", "co.nz", "co.uk", "com.au", "com.br", "com.cn",
  "com.hk", "com.sg", "com.tw", "com.vn", "edu.au", "edu.cn", "edu.hk",
  "edu.sg", "edu.tw", "gov.au", "gov.cn", "gov.hk", "gov.sg", "gov.tw",
  "net.au", "net.cn", "net.tw", "org.au", "org.cn", "org.tw",
  "appspot.com", "firebaseapp.com", "github.io", "netlify.app",
  "pages.dev", "vercel.app", "web.app",
]);

const EXTERNAL_CATEGORY_RULES = [
  { category: "social", domains: ["facebook.com", "instagram.com", "line.me", "linkedin.com", "threads.net", "tiktok.com", "x.com", "twitter.com", "youtube.com"] },
  { category: "cdn", domains: ["akamaihd.net", "bootstrapcdn.com", "cloudflare.com", "cloudflare.net", "cdnjs.com", "fastly.net", "gstatic.com", "jsdelivr.net", "unpkg.com"] },
  { category: "tracking_or_analytics", domains: ["clarity.ms", "doubleclick.net", "facebook.net", "googletagmanager.com", "google-analytics.com", "googleadservices.com", "hotjar.com"] },
  { category: "shortener", domains: ["bit.ly", "goo.gl", "is.gd", "reurl.cc", "tinyurl.com", "t.co"] },
  { category: "maps", domains: ["maps.googleapis.com", "maps.gstatic.com", "openstreetmap.org"] },
  { category: "webmail", domains: ["gmail.com", "outlook.com", "yahoo.com"] },
];

const EXTERNAL_RISK_CATEGORY_LEVELS = new Map([
  ["shortener", "medium"],
  ["tracking_or_analytics", "medium"],
  ["download", "medium"],
  ["embedded_content", "medium"],
  ["social", "low"],
  ["cdn", "low"],
  ["maps", "low"],
  ["webmail", "low"],
  ["asset", "low"],
  ["media", "low"],
]);

const EXTERNAL_RISK_RANK = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

const EXTERNAL_RISK_RULE_ACTIONS = new Map([
  ["allow", "allowed"],
  ["allowed", "allowed"],
  ["allowlist", "allowed"],
  ["block", "blocked"],
  ["blocked", "blocked"],
  ["blocklist", "blocked"],
  ["deny", "blocked"],
  ["watch", "watchlisted"],
  ["watchlisted", "watchlisted"],
  ["watchlist", "watchlisted"],
]);

const DOWNLOAD_EXTENSIONS = new Set([
  ".7z", ".csv", ".doc", ".docx", ".gz", ".pdf", ".ppt", ".pptx",
  ".rar", ".tar", ".txt", ".xls", ".xlsx", ".zip",
]);

const MEDIA_EXTENSIONS = new Set([
  ".avi", ".bmp", ".gif", ".jpeg", ".jpg", ".mov", ".mp3", ".mp4",
  ".png", ".svg", ".wav", ".webm", ".webp",
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
  constructor({ perHostConcurrency, requestDelayMs, requestDelayMinMs, requestDelayMaxMs, globalLimiter }) {
    this.perHostConcurrency = perHostConcurrency;
    this.requestDelayMs = requestDelayMs;
    this.requestDelayMinMs = requestDelayMinMs;
    this.requestDelayMaxMs = requestDelayMaxMs;
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

    if (!this.hasRandomDelay()) {
      const delay = Math.max(0, state.nextAllowedAt - Date.now());
      if (delay > 0) {
        state.timer = setTimeout(() => {
          state.timer = null;
          this.pump(host);
        }, delay);
        return;
      }
    }

    const item = state.queue.shift();
    state.active += 1;
    if (!this.hasRandomDelay()) {
      state.nextAllowedAt = Date.now() + this.requestDelayMs;
    }

    this.runScheduledTask(item.task)
      .then(item.resolve, item.reject)
      .finally(() => {
        state.active -= 1;
        this.pump(host);
      });

    this.pump(host);
  }

  hasRandomDelay() {
    return Number.isFinite(this.requestDelayMinMs)
      && Number.isFinite(this.requestDelayMaxMs)
      && this.requestDelayMaxMs >= this.requestDelayMinMs;
  }

  async runScheduledTask(task) {
    if (this.hasRandomDelay()) {
      await sleep(randomInteger(this.requestDelayMinMs, this.requestDelayMaxMs));
    }
    return this.globalLimiter.run(task);
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
      `Validation ${this.checker.validationQueue.length}/${this.checker.activeValidationTasks}`,
      `Checked ${this.checker.results.size} URLs`,
      `Active ${this.checker.fetchLimiter.active}`,
      `Host queues ${this.checker.hostScheduler.pendingCount()}`,
      `Broken ${broken}`,
      `404/410 ${brokenByType.not_found}`,
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
  constructor(startUrl, options = {}) {
    this.startUrl = normalizeUrl(startUrl);
    this.options = { ...DEFAULTS, ...options };
    if (this.options.systemCa) {
      enableSystemCa();
    }
    this.startOrigin = new URL(this.startUrl).origin;
    this.startFinalOrigin = null;
    this.fetchLimiter = new Limiter(this.options.concurrency);
    this.hostScheduler = new HostScheduler({
      perHostConcurrency: this.options.perHostConcurrency,
      requestDelayMs: this.options.requestDelayMs,
      requestDelayMinMs: this.options.requestDelayMinMs,
      requestDelayMaxMs: this.options.requestDelayMaxMs,
      globalLimiter: this.fetchLimiter,
    });
    this.confirmationScheduler = new HostScheduler({
      perHostConcurrency: this.options.confirmationPerHostConcurrency,
      requestDelayMs: 0,
      requestDelayMinMs: this.options.confirmationDelayMinMs,
      requestDelayMaxMs: this.options.confirmationDelayMaxMs,
      globalLimiter: new Limiter(this.options.confirmationConcurrency),
    });
    this.pageQueue = [{ url: this.startUrl, depth: 0 }];
    this.queuedPages = new Set([this.startUrl]);
    this.crawledPages = new Set();
    this.validationQueue = [];
    this.activeValidationTasks = 0;
    this.validationError = null;
    this.statusCache = new Map();
    this.bodyCache = new Map();
    this.results = new Map();
    this.sources = new Map();
    this.externalLinks = new Map();
    this.inventory = new Map();
    this.inventoryMetrics = {
      urlsDiscovered: 0,
      validationSkippedByInventory: 0,
      statusCacheHits: 0,
      bodyCacheHits: 0,
    };
    this.spaDetections = [];
    this.domainCategoryRules = [
      ...EXTERNAL_CATEGORY_RULES,
      ...normalizeDomainCategoryRules(options.domainCategoryRules || []),
    ];
    this.externalRiskRules = normalizeExternalRiskRules(options.externalRiskRules || []);
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
      await this.confirmNotFoundResults();
      return this.buildReport();
    } finally {
      this.reporter?.stop();
    }
  }

  async pageWorker() {
    while (true) {
      if (this.validationError) {
        throw this.validationError;
      }
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
      && this.validationQueue.length === 0
      && this.activeValidationTasks === 0
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
      const pageInventoryEntry = this.getInventoryEntry(url);
      if (pageInventoryEntry) {
        this.scheduleInventoryValidation(pageInventoryEntry, { requireBody: true });
      }
      const pageResult = pageInventoryEntry
        ? await this.checkInventoryUrl(pageInventoryEntry, url, { requireBody: true })
        : await this.checkUrl(url, { requireBody: true });

      if (url === this.startUrl && pageResult.finalUrl) {
        this.startFinalOrigin = new URL(pageResult.finalUrl).origin;
      }

      if (this.stopped || !pageResult.ok || !isHtml(pageResult.contentType) || !pageResult.body) {
        return;
      }

      const pageBaseUrl = getDocumentBaseUrl(pageResult.body, pageResult.finalUrl || url);
      const spaDetection = detectSpaFramework(pageResult.body);
      this.recordSpaDetection(url, pageResult.finalUrl || url, spaDetection);
      const htmlLinks = extractLinks(pageResult.body, pageBaseUrl);
      const frameworkLinks = this.shouldExtractFrameworkLinks(spaDetection)
        ? extractFrameworkLinks(pageResult.body, pageBaseUrl)
        : [];
      const links = [...htmlLinks, ...frameworkLinks];
      this.reporter?.pageLinksFound(url, links.length);

      for (const link of links) {
        if (this.stopped) {
          break;
        }

        const resolved = resolveHttpUrl(link.value, pageBaseUrl);
        if (!resolved) {
          continue;
        }

        const fallbackUrls = getResolutionFallbackUrls(link.value, pageResult.finalUrl || url, resolved);
        const source = {
          page: url,
          tag: link.tag,
          attribute: link.attribute,
          text: link.value,
          sourceType: link.sourceType || "html_attribute",
          fallbackUrls,
        };
        this.addSource(resolved, source);

        const isExternal = !this.isCrawlOrigin(resolved);
        const shouldCheck = this.shouldCheck(resolved);
        const shouldCrawl = this.shouldCrawl(resolved, link, depth + 1);
        const inventoryEntry = this.addInventoryItem(resolved, source, link, {
          isExternal,
          shouldCheck,
          shouldCrawl,
          needsStatusCheck: shouldCheck,
          needsBodyFetch: shouldCrawl,
        });

        if (isExternal) {
          this.addExternalLink(resolved, link, source);
        }

        if (shouldCheck && this.scheduleInventoryValidation(inventoryEntry, { requireBody: false })) {
          this.enqueueValidation(inventoryEntry, resolved, { requireBody: false });
        } else if (shouldCheck) {
          this.inventoryMetrics.validationSkippedByInventory += 1;
        } else {
          this.skippedExternal += 1;
          this.reporter?.externalSkipped(resolved, url);
        }

        if (shouldCrawl) {
          this.enqueuePage(resolved, depth + 1);
        }
      }
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
    if (!PAGE_NAVIGATION_TAGS.has(link.tag) && !isPayloadLink(link)) {
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

  shouldExtractFrameworkLinks(spaDetection) {
    if (this.options.spaLinks === "off") {
      return false;
    }
    if (this.options.spaLinks === "strict") {
      return true;
    }
    return Boolean(spaDetection?.detected);
  }

  recordSpaDetection(pageUrl, finalUrl, detection) {
    if (!detection?.detected) {
      return;
    }
    this.spaDetections.push({
      pageUrl,
      finalUrl,
      framework: detection.framework,
      signals: detection.signals,
      stats: detection.stats,
    });
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
    const key = this.getCanonicalKey(url);
    if (!this.sources.has(key)) {
      this.sources.set(key, []);
    }
    const list = this.sources.get(key);
    const sourceKey = `${source.page}|${source.tag}|${source.attribute}|${source.sourceType || "html_attribute"}|${source.text}`;
    if (!list.some((item) => item.key === sourceKey)) {
      list.push({ key: sourceKey, ...source });
    }
  }

  addExternalLink(url, link, source) {
    const key = this.getCanonicalKey(url);
    const parsed = new URL(url);
    if (!this.externalLinks.has(key)) {
      const classification = classifyExternalLink(url, link, this.domainCategoryRules);
      this.externalLinks.set(key, {
        url,
        canonicalUrl: key,
        hostname: parsed.hostname,
        registrableDomain: getRegistrableDomain(parsed.hostname),
        type: classification.type,
        categories: classification.categories,
        categorySources: classification.categorySources,
        sources: [],
      });
    }

    const item = this.externalLinks.get(key);
    const sourceKey = `${source.page}|${source.tag}|${source.attribute}|${source.sourceType || "html_attribute"}|${source.text}`;
    if (!item.sources.some((existing) => existing.key === sourceKey)) {
      item.sources.push({ key: sourceKey, ...source });
    }
  }

  getCanonicalKey(url) {
    return canonicalizeCheckedUrl(url, this.options.canonicalStrategy);
  }

  getResultCanonicalKey(result) {
    if (result?.normalizedFrom) {
      return this.getCanonicalKey(result.normalizedFrom);
    }
    return this.getCanonicalKey(result?.url || "");
  }

  setResultForUrl(url, result) {
    this.results.set(this.getCanonicalKey(url), stripBody(result));
  }

  hasResultForUrl(url) {
    return this.results.has(this.getCanonicalKey(url));
  }

  getSourcesForUrl(url) {
    return this.sources.get(this.getCanonicalKey(url)) || [];
  }

  getSourcesForResult(result) {
    if (result?.normalizedFrom) {
      return this.getSourcesForUrl(result.normalizedFrom);
    }
    return this.getSourcesForUrl(result.url);
  }

  addInventoryItem(resolvedUrl, source, link, intent) {
    this.inventoryMetrics.urlsDiscovered += 1;

    const canonicalUrl = this.getCanonicalKey(resolvedUrl);
    const isNewCanonical = !this.inventory.has(canonicalUrl);
    if (isNewCanonical) {
      const classification = intent.isExternal
        ? classifyExternalLink(resolvedUrl, link, this.domainCategoryRules)
        : null;
      this.inventory.set(canonicalUrl, {
        canonicalUrl,
        originalUrls: [],
        resolvedUrls: [],
        representativeUrl: resolvedUrl,
        sources: [],
        isExternal: intent.isExternal,
        linkType: classification?.type || null,
        categories: classification?.categories || [],
        categorySources: classification?.categorySources || [],
        shouldCheck: Boolean(intent.shouldCheck),
        shouldCrawl: Boolean(intent.shouldCrawl),
        needsStatusCheck: Boolean(intent.needsStatusCheck),
        needsBodyFetch: Boolean(intent.needsBodyFetch),
        statusValidationScheduled: false,
        bodyValidationScheduled: false,
        checked: false,
        bodyFetched: false,
      });
    }

    const item = this.inventory.get(canonicalUrl);
    addUnique(item.originalUrls, link.value);
    addUnique(item.resolvedUrls, resolvedUrl);
    item.isExternal = item.isExternal || intent.isExternal;
    item.shouldCheck = item.shouldCheck || Boolean(intent.shouldCheck);
    item.shouldCrawl = item.shouldCrawl || Boolean(intent.shouldCrawl);
    item.needsStatusCheck = item.needsStatusCheck || Boolean(intent.needsStatusCheck);
    item.needsBodyFetch = item.needsBodyFetch || Boolean(intent.needsBodyFetch);

    const sourceEntry = {
      page: source.page,
      tag: source.tag,
      attribute: source.attribute,
      text: source.text,
      sourceType: source.sourceType || "html_attribute",
      rawValue: link.value,
      resolvedUrl,
    };
    const key = `${sourceEntry.page}|${sourceEntry.tag}|${sourceEntry.attribute}|${sourceEntry.sourceType}|${sourceEntry.text}|${sourceEntry.resolvedUrl}`;
    let sourceAdded = false;
    if (!item.sources.some((existing) => existing.key === key)) {
      item.sources.push({ key, ...sourceEntry });
      sourceAdded = true;
    }

    return { item, canonicalUrl, isNewCanonical, sourceAdded };
  }

  getInventoryEntry(url) {
    const canonicalUrl = this.getCanonicalKey(url);
    const item = this.inventory.get(canonicalUrl);
    return item ? { item, canonicalUrl, isNewCanonical: false, sourceAdded: false } : null;
  }

  scheduleInventoryValidation({ item }, { requireBody }) {
    if (requireBody) {
      item.needsBodyFetch = true;
      if (item.bodyValidationScheduled || item.bodyFetched) {
        return false;
      }

      item.bodyValidationScheduled = true;
      return true;
    }

    item.needsStatusCheck = true;
    if (item.statusValidationScheduled || item.checked || item.bodyFetched) {
      return false;
    }

    item.statusValidationScheduled = true;
    return true;
  }

  async checkInventoryUrl({ item }, url, options) {
    const result = await this.checkUrl(url, options);
    item.checked = true;
    if (options.requireBody) {
      item.bodyFetched = true;
    }
    return result;
  }

  enqueueValidation(inventoryEntry, url, options) {
    this.validationQueue.push({ inventoryEntry, url, options });
    this.pumpValidationQueue();
  }

  pumpValidationQueue() {
    while (
      !this.stopped
      && !this.validationError
      && this.activeValidationTasks < this.options.concurrency
      && this.validationQueue.length > 0
    ) {
      const job = this.validationQueue.shift();
      this.activeValidationTasks += 1;
      this.checkInventoryUrl(job.inventoryEntry, job.url, job.options)
        .catch((error) => {
          this.validationError = error;
          this.stopped = true;
        })
        .finally(() => {
          this.activeValidationTasks -= 1;
          this.pumpValidationQueue();
        });
    }
  }

  async checkUrl(url, { requireBody }) {
    const key = this.getCanonicalKey(url);
    if (requireBody) {
      if (this.bodyCache.has(key)) {
        this.inventoryMetrics.bodyCacheHits += 1;
      } else {
        this.bodyCache.set(key, this.fetchWithCache(url, true));
      }
      return this.bodyCache.get(key);
    }

    if (this.bodyCache.has(key)) {
      this.inventoryMetrics.bodyCacheHits += 1;
      return this.bodyCache.get(key);
    }

    if (this.statusCache.has(key)) {
      this.inventoryMetrics.statusCacheHits += 1;
    } else {
      this.statusCache.set(key, this.fetchWithCache(url, false));
    }
    return this.statusCache.get(key);
  }

  async fetchWithCache(url, requireBody) {
    this.reporter?.requestQueued(url, requireBody || this.options.preferGet ? "GET" : "HEAD");
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
      preferGet: this.options.preferGet,
      canonicalStrategy: this.options.canonicalStrategy,
      legacyTls: this.options.legacyTls,
      scheduleRequest: (requestUrl, task) => this.hostScheduler.run(requestUrl, task),
    });

    if (this.shouldConfirmWithHomepageFallback(url, result, requireBody)) {
      const homepageFallback = await this.confirmWithHomepageFallback(url);
      if (homepageFallback.ok) {
        this.setResultForUrl(url, homepageFallback);
        this.reporter?.requestFinished(homepageFallback);
        return homepageFallback;
      }
    }

    if (this.shouldConfirmWithSourceGet(url, result)) {
      const confirmed = await this.confirmWithSourceGet(url);
      if (confirmed.ok) {
        this.setResultForUrl(url, confirmed);
        this.reporter?.requestFinished(confirmed);
        return confirmed;
      }
    }

    if (!result.ok && result.status === 404) {
      const fallbackResult = await this.confirmWithFallbackUrls(url, result);
      if (fallbackResult !== result && fallbackResult.ok) {
        this.setResultForUrl(url, fallbackResult);
        this.reporter?.requestFinished(fallbackResult);
        return fallbackResult;
      }
    }

    this.setResultForUrl(url, result);
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
        preferGet: this.options.preferGet,
        canonicalStrategy: this.options.canonicalStrategy,
        legacyTls: this.options.legacyTls,
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
    const sources = this.getSourcesForUrl(url);
    return !result.ok
      && result.status === 404
      && result.method === "GET"
      && sources.some((source) => sameOrigin(source.page, url));
  }

  async confirmWithSourceGet(url) {
    for (const source of this.getSourcesForUrl(url)) {
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
        preferGet: this.options.preferGet,
        canonicalStrategy: this.options.canonicalStrategy,
        legacyTls: this.options.legacyTls,
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
    const sources = this.getSourcesForUrl(url);
    if (sources.length === 0) {
      return result;
    }

    for (const source of sources) {
      for (const fallbackUrl of source.fallbackUrls || []) {
        if (fallbackUrl === url || this.hasResultForUrl(fallbackUrl)) {
          continue;
        }

        const referer = sameOrigin(source.page, fallbackUrl) || this.options.externalReferer ? source.page : null;
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
          preferGet: this.options.preferGet,
          canonicalStrategy: this.options.canonicalStrategy,
          legacyTls: this.options.legacyTls,
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
    const source = this.getSourcesForUrl(url)[0]?.page;
    if (!source) {
      return null;
    }

    if (sameOrigin(source, url)) {
      return source;
    }

    return this.options.externalReferer ? source : null;
  }

  async confirmNotFoundResults() {
    if (!this.options.confirm404) {
      this.applyConfirmationDefaults(false);
      return;
    }

    this.applyConfirmationDefaults(true);
    const candidates = this.getNotFoundConfirmationCandidates();
    await Promise.all(candidates.map((result) => this.confirmNotFoundResult(result)));
  }

  applyConfirmationDefaults(enabled) {
    for (const result of this.results.values()) {
      result.confirmation = {
        enabled,
        candidate: false,
        checked: false,
        status: null,
        ok: null,
        finalUrl: null,
        checkedAt: null,
        method: null,
        referer: null,
        elapsedMs: null,
        outcome: null,
        reason: enabled ? "not_candidate" : "disabled",
      };
      result.transientFailure = false;
      result.needsReview = false;
    }
  }

  getNotFoundConfirmationCandidates() {
    const hostCounts = new Map();
    const candidates = [];

    for (const result of this.results.values()) {
      if (!this.isNotFoundConfirmationCandidate(result)) {
        continue;
      }

      const host = new URL(result.url).hostname;
      const hostCount = hostCounts.get(host) || 0;
      if (hostCount >= this.options.confirmationMaxPerHost) {
        result.confirmation = {
          ...result.confirmation,
          candidate: true,
          reason: "per_host_limit",
        };
        result.needsReview = true;
        continue;
      }
      if (candidates.length >= this.options.confirmationMaxUrls) {
        result.confirmation = {
          ...result.confirmation,
          candidate: true,
          reason: "global_limit",
        };
        result.needsReview = true;
        continue;
      }

      hostCounts.set(host, hostCount + 1);
      result.confirmation = {
        ...result.confirmation,
        candidate: true,
        reason: "queued",
      };
      candidates.push(result);
    }

    return candidates;
  }

  isNotFoundConfirmationCandidate(result) {
    return !this.stopped
      && !result.ok
      && result.issueType === "not_found"
      && (result.status === 404 || result.status === 410)
      && this.isCrawlOrigin(result.url)
      && result.classification !== "protected"
      && !result.suspectedWaf
      && !result.suspectedBot;
  }

  async confirmNotFoundResult(result) {
    if (this.stopped) {
      result.confirmation = {
        ...result.confirmation,
        checked: false,
        outcome: "needs_review",
        reason: "stopped",
      };
      result.needsReview = true;
      return;
    }

    const referer = this.getConfirmationReferer(result.url);
    const confirmed = await fetchUrl(result.url, {
      requireBody: false,
      forceGet: true,
      timeoutMs: this.options.timeoutMs,
      retryCount: 0,
      maxRedirects: this.options.maxRedirects,
      longRedirectThreshold: this.options.longRedirectThreshold,
      userAgent: BROWSER_USER_AGENT,
      acceptLanguage: this.options.acceptLanguage,
      referer,
      preferGet: true,
      canonicalStrategy: this.options.canonicalStrategy,
      legacyTls: this.options.legacyTls,
      scheduleRequest: (requestUrl, task) => this.confirmationScheduler.run(requestUrl, task),
    });

    const outcome = getConfirmationOutcome(confirmed);
    result.confirmation = {
      enabled: true,
      candidate: true,
      checked: true,
      status: confirmed.status ?? null,
      ok: confirmed.ok ?? null,
      finalUrl: confirmed.finalUrl || null,
      checkedAt: confirmed.checkedAt || null,
      method: confirmed.method || "GET",
      referer,
      elapsedMs: confirmed.elapsedMs ?? null,
      outcome,
      reason: getConfirmationReason(confirmed),
    };
    result.transientFailure = outcome === "needs_review" && isTransientConfirmationResult(confirmed);
    result.needsReview = outcome === "needs_review";
  }

  getConfirmationReferer(url) {
    const source = this.getSourcesForUrl(url).find((item) => sameOrigin(item.page, url));
    return source?.page || null;
  }

  buildReport() {
    const checked = [...this.results.values()];
    const externalLinks = this.buildExternalLinks(checked);
    const inventorySummary = this.buildInventorySummary();
    const spaDetection = this.buildSpaDetectionSummary();
    const scanQuality = this.buildScanQuality(checked, spaDetection);
    const broken = checked
      .filter((result) => !result.ok)
      .map((result) => ({
        ...result,
        sources: this.getSourcesForResult(result).map(({ key, ...source }) => source),
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
        requestDelayMinMs: this.options.requestDelayMinMs,
        requestDelayMaxMs: this.options.requestDelayMaxMs,
        timeoutMs: this.options.timeoutMs,
        retryCount: this.options.retryCount,
        maxRedirects: this.options.maxRedirects,
        longRedirectThreshold: this.options.longRedirectThreshold,
        userAgent: this.options.userAgent,
        acceptLanguage: this.options.acceptLanguage,
        checkExternal: this.options.checkExternal,
        preferGet: this.options.preferGet,
        externalReferer: this.options.externalReferer,
        conservativeMode: this.options.conservativeMode,
        canonicalStrategy: this.options.canonicalStrategy,
        legacyTls: this.options.legacyTls,
        systemCa: this.options.systemCa,
        confirm404: this.options.confirm404,
        confirmationMaxUrls: this.options.confirmationMaxUrls,
        confirmationMaxPerHost: this.options.confirmationMaxPerHost,
        confirmationConcurrency: this.options.confirmationConcurrency,
        confirmationPerHostConcurrency: this.options.confirmationPerHostConcurrency,
        confirmationDelayMinMs: this.options.confirmationDelayMinMs,
        confirmationDelayMaxMs: this.options.confirmationDelayMaxMs,
        spaLinks: this.options.spaLinks,
        domainCategoryRulesSource: this.options.domainCategoryRulesSource || null,
        externalRiskRulesSource: this.options.externalRiskRulesSource || null,
      },
      summary: {
        pagesCrawled: this.crawledPages.size,
        urlsChecked: checked.length,
        brokenLinks: broken.length,
        brokenByType: countBrokenByType(broken),
        redirects: countRedirected(checked),
        redirectByType: countRedirectByType(checked),
        skippedExternal: this.skippedExternal,
        externalLinks: externalLinks.length,
        externalDomains: countUnique(externalLinks.map((item) => item.registrableDomain || item.hostname)),
        externalByType: countExternalByType(externalLinks),
        externalByCategory: countExternalByCategory(externalLinks),
        externalRiskByLevel: countExternalRiskByLevel(externalLinks),
        externalRiskByGovernanceStatus: countExternalRiskByGovernanceStatus(externalLinks),
        externalRiskByDomain: summarizeExternalRiskDomains(externalLinks),
        confirmation: countConfirmationByOutcome(checked),
        inventorySummary,
        spaDetection,
        scanQuality,
      },
      broken,
      checked,
      externalLinks,
    };
  }

  buildSpaDetectionSummary() {
    const signals = new Set();
    const frameworks = new Map();
    let anchorCount = 0;
    let urlLiteralCount = 0;
    let htmlLength = 0;

    for (const detection of this.spaDetections) {
      for (const signal of detection.signals || []) {
        signals.add(signal);
      }
      if (detection.framework && detection.framework !== "unknown") {
        frameworks.set(detection.framework, (frameworks.get(detection.framework) || 0) + 1);
      }
      anchorCount += detection.stats?.anchorCount || 0;
      urlLiteralCount += detection.stats?.urlLiteralCount || 0;
      htmlLength += detection.stats?.htmlLength || 0;
    }

    const framework = [...frameworks.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)[0] || "unknown";

    return {
      detected: this.spaDetections.length > 0,
      framework,
      pagesDetected: this.spaDetections.length,
      signals: [...signals].sort(),
      stats: {
        htmlLength,
        anchorCount,
        urlLiteralCount,
      },
      recommendation: this.spaDetections.length > 0
        ? "SPA/framework signals were detected; keep SPA payload extraction enabled or review scan quality warnings."
        : "No strong SPA/framework signals were detected.",
    };
  }

  buildScanQuality(checked, spaDetection) {
    const checkedUrls = checked.map((result) => result.url || "");
    const assetUrls = checkedUrls.filter((url) => isAssetUrl(url));
    const nuxtAssetUrls = checkedUrls.filter((url) => url.includes("/_nuxt/"));
    const assetRatio = checkedUrls.length > 0 ? assetUrls.length / checkedUrls.length : 0;
    const nuxtAssetRatio = checkedUrls.length > 0 ? nuxtAssetUrls.length / checkedUrls.length : 0;
    const warnings = [];

    if (nuxtAssetRatio > 0.7) {
      warnings.push("nuxt_asset_dominant_scan");
    } else if (assetRatio > 0.7) {
      warnings.push("asset_dominant_scan");
    }
    if (this.crawledPages.size <= 1 && (spaDetection?.stats?.urlLiteralCount || 0) >= 10) {
      warnings.push("low_page_count_with_many_url_literals");
    }
    if (spaDetection?.detected && this.options.spaLinks === "off") {
      warnings.push("spa_links_disabled");
    }

    return {
      status: warnings.length > 0 ? "suspicious" : "ok",
      warnings,
      checkedUrls: checkedUrls.length,
      assetUrls: assetUrls.length,
      assetRatio: Number(assetRatio.toFixed(4)),
      nuxtAssetUrls: nuxtAssetUrls.length,
      nuxtAssetRatio: Number(nuxtAssetRatio.toFixed(4)),
    };
  }

  buildInventorySummary() {
    const uniqueCanonicalUrls = this.inventory.size;
    const sourceReferences = [...this.inventory.values()]
      .reduce((total, item) => total + item.sources.length, 0);
    const duplicateUrlReferences = Math.max(0, this.inventoryMetrics.urlsDiscovered - uniqueCanonicalUrls);
    const sourcesMerged = Math.max(0, sourceReferences - uniqueCanonicalUrls);

    return {
      urlsDiscovered: this.inventoryMetrics.urlsDiscovered,
      uniqueCanonicalUrls,
      duplicateUrlReferences,
      sourcesMerged,
      validationSkippedByInventory: this.inventoryMetrics.validationSkippedByInventory,
      statusCacheHits: this.inventoryMetrics.statusCacheHits,
      bodyCacheHits: this.inventoryMetrics.bodyCacheHits,
      inventoryMergeRatio: this.inventoryMetrics.urlsDiscovered > 0
        ? Number((duplicateUrlReferences / this.inventoryMetrics.urlsDiscovered).toFixed(4))
        : 0,
    };
  }

  buildExternalLinks(checked) {
    const resultsByUrl = new Map(checked.map((result) => [this.getResultCanonicalKey(result), result]));
    return [...this.externalLinks.values()]
      .map((item) => {
        const result = resultsByUrl.get(item.canonicalUrl || this.getCanonicalKey(item.url));
        const sourceCount = item.sources.length;
        const externalRisk = evaluateExternalRisk(item, result, {
          sourceCount,
          externalRiskRules: this.externalRiskRules,
        });
        return {
          ...item,
          checked: Boolean(result),
          status: result?.status ?? null,
          ok: result?.ok ?? null,
          method: result?.method || null,
          checkedAt: result?.checkedAt || null,
          canonicalUrl: result?.canonicalUrl || item.canonicalUrl || null,
          finalUrl: result?.finalUrl || null,
          contentLength: result?.contentLength ?? null,
          cacheHeaders: result?.cacheHeaders || null,
          issueType: result?.issueType || null,
          classification: result?.classification || null,
          redirected: result?.redirected || false,
          redirectCount: result?.redirectCount || 0,
          redirectType: result?.redirectType || null,
          redirectIssues: result?.redirectIssues || [],
          redirectLabels: result?.redirectLabels || [],
          blockedReason: result?.blockedReason || null,
          suspectedWaf: result?.suspectedWaf || false,
          suspectedBot: result?.suspectedBot || false,
          protection: result?.protection || null,
          bodySignature: result?.bodySignature || null,
          externalRisk,
          sourceCount,
          sources: item.sources.map(({ key, fallbackUrls, ...source }) => source),
        };
      })
      .sort((a, b) => a.url.localeCompare(b.url));
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
  preferGet = false,
  canonicalStrategy = DEFAULTS.canonicalStrategy,
  legacyTls = false,
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
      preferGet,
      canonicalStrategy,
      legacyTls,
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
  preferGet,
  canonicalStrategy,
  legacyTls,
  scheduleRequest,
  started,
}) {
  try {
    if (requireBody) {
      return await request(url, "GET", {
        timeoutMs,
        maxRedirects,
        longRedirectThreshold,
        userAgent,
        acceptLanguage,
        referer,
        canonicalStrategy,
        legacyTls,
        readBody: true,
        scheduleRequest,
        started,
      });
    }

    if (forceGet || preferGet) {
      return await request(url, "GET", {
        timeoutMs,
        maxRedirects,
        longRedirectThreshold,
        userAgent,
        acceptLanguage,
        referer,
        canonicalStrategy,
        legacyTls,
        readBody: false,
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
      canonicalStrategy,
      legacyTls,
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
      canonicalStrategy,
      legacyTls,
      readBody: false,
      scheduleRequest,
      started,
    });
  } catch (error) {
    const cause = getErrorCause(error);
    return {
      url,
      canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
      checkedAt: new Date().toISOString(),
      ok: false,
      status: null,
      method: requireBody || forceGet || preferGet ? "GET" : "HEAD",
      finalUrl: null,
      contentType: null,
      contentLength: null,
      cacheHeaders: emptyCacheHeaders(),
      wafHeaders: {},
      blockedReason: null,
      blockedRuleId: null,
      bodySignature: null,
      suspectedWaf: false,
      suspectedBot: false,
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
  if (isWeakDiffieHellmanError(cause)) {
    return "TLS handshake failed because the server uses a weak Diffie-Hellman key. Enable legacy TLS compatibility only when this site must be checked.";
  }
  if (isCertificateChainError(cause)) {
    return "TLS certificate verification failed because Node could not build a trusted certificate chain. Retry with system CA enabled when the site works in the operating-system browser or curl.";
  }
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

function isWeakDiffieHellmanError(cause) {
  return cause?.code === "ERR_SSL_DH_KEY_TOO_SMALL"
    || /dh key too small/i.test(cause?.message || "");
}

function isCertificateChainError(cause) {
  return [
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
  ].includes(cause?.code)
    || /unable to verify|certificate|issuer cert|self[- ]signed/i.test(cause?.message || "");
}

function isSystemCaEnabled() {
  return runtimeSystemCaEnabled
    || process.execArgv.includes("--use-system-ca")
    || /\b--use-system-ca\b/.test(process.env.NODE_OPTIONS || "");
}

function canEnableSystemCaAtRuntime() {
  return typeof tls.getCACertificates === "function"
    && typeof tls.setDefaultCACertificates === "function";
}

function enableSystemCa() {
  if (isSystemCaEnabled()) {
    return true;
  }
  if (!canEnableSystemCaAtRuntime()) {
    throw new Error("System CA mode requires Node.js --use-system-ca support. Start with: gui.cmd --system-ca");
  }

  const certificates = [
    ...tls.getCACertificates("default"),
    ...tls.getCACertificates("system"),
  ];
  tls.setDefaultCACertificates([...new Set(certificates)]);
  runtimeSystemCaEnabled = true;
  return true;
}

async function request(url, method, {
  timeoutMs,
  maxRedirects,
  longRedirectThreshold,
  userAgent,
  acceptLanguage,
  referer,
  canonicalStrategy,
  legacyTls,
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
      legacyTls,
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
          canonicalStrategy,
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
        await releaseResponseBody(response);
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
          canonicalStrategy,
          started,
        });
      }

      const visitUrl = normalizeRedirectVisitUrl(nextUrl);
      if (seenUrls.has(visitUrl)) {
        await releaseResponseBody(response);
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
          canonicalStrategy,
          started,
        });
      }

      await releaseResponseBody(response);
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
      canonicalStrategy,
      redirectChain,
      maxRedirects,
      longRedirectThreshold,
    });
  }
}

async function rawRequest(url, method, { timeoutMs, userAgent, acceptLanguage, referer, legacyTls }) {
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
    if (legacyTls) {
      return await legacyTlsRequest(url, method, { timeoutMs, headers });
    }

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

function legacyTlsRequest(url, method, { timeoutMs, headers }) {
  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    const requestOptions = {
      method,
      headers,
      timeout: timeoutMs,
    };

    if (parsed.protocol === "https:") {
      requestOptions.ciphers = "DEFAULT@SECLEVEL=0";
    }

    const request = client.request(url, requestOptions, (response) => {
      resolve(new LegacyResponse(url, response));
    });

    request.on("timeout", () => {
      request.destroy(createAbortError());
    });
    request.on("error", reject);
    request.end();
  });
}

class LegacyResponse {
  constructor(url, response) {
    this.url = url;
    this.status = response.statusCode || 0;
    this.response = response;
    this.body = {
      cancel: async () => {
        response.destroy();
      },
    };
    this.headers = {
      get: (name) => {
        const value = response.headers[String(name).toLowerCase()];
        return Array.isArray(value) ? value.join(", ") : value ?? null;
      },
    };
  }

  async text() {
    return (await this.buffer()).toString("utf8");
  }

  async arrayBuffer() {
    const buffer = await this.buffer();
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  buffer() {
    if (!this.bufferPromise) {
      this.bufferPromise = new Promise((resolve, reject) => {
        const chunks = [];
        this.response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        this.response.on("end", () => resolve(Buffer.concat(chunks)));
        this.response.on("error", reject);
      });
    }
    return this.bufferPromise;
  }
}

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

async function buildResponseResult(response, {
  url,
  method,
  currentMethod,
  readBody,
  referer,
  started,
  canonicalStrategy,
  redirectChain,
  maxRedirects,
  longRedirectThreshold,
}) {
  const contentType = response.headers.get("content-type");
  const result = {
    url,
    canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
    checkedAt: new Date().toISOString(),
    ok: response.status < 400,
    status: response.status,
    method,
    finalMethod: currentMethod,
    finalUrl: response.url,
    contentType,
    contentLength: parseContentLength(response.headers),
    cacheHeaders: extractCacheHeaders(response.headers),
    server: response.headers.get("server"),
    wafHeaders: extractWafHeaders(response.headers),
    blockedReason: null,
    blockedRuleId: extractBlockedRuleId(response.headers),
    bodySignature: null,
    suspectedWaf: false,
    suspectedBot: false,
    requestReferer: referer || null,
    elapsedMs: Math.round(performance.now() - started),
    error: null,
  };

  if (readBody) {
    result.body = await response.text();
  } else if (!result.ok && isHtml(contentType)) {
    result.diagnosticBody = (await response.text()).slice(0, 4096);
  } else {
    await releaseResponseBody(response);
  }

  const signature = buildBodySignature(result.body || result.diagnosticBody || "");
  if (signature && (!result.ok || signature.matchedPatterns.length > 0)) {
    result.bodySignature = signature;
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

async function releaseResponseBody(response, { maxDrainBytes = 64 * 1024 } = {}) {
  if (!response.body) {
    return;
  }

  try {
    const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
    if (Number.isFinite(contentLength) && contentLength <= maxDrainBytes) {
      await response.arrayBuffer();
      return;
    }

    await response.body.cancel();
  } catch {
    // Cleanup is best-effort; keep the original HTTP result intact.
  }
}

function canonicalizeCheckedUrl(value, strategy = DEFAULTS.canonicalStrategy) {
  try {
    return canonicalizeUrl(value, { strategy });
  } catch {
    return value;
  }
}

function emptyCacheHeaders() {
  return {
    cacheControl: null,
    etag: null,
    expires: null,
    lastModified: null,
    age: null,
    vary: null,
  };
}

function extractCacheHeaders(headers) {
  return {
    cacheControl: headers.get("cache-control"),
    etag: headers.get("etag"),
    expires: headers.get("expires"),
    lastModified: headers.get("last-modified"),
    age: headers.get("age"),
    vary: headers.get("vary"),
  };
}

function extractWafHeaders(headers) {
  const result = {};
  for (const name of WAF_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) {
      result[toCamelCase(name)] = value;
    }
  }
  return result;
}

function extractBlockedRuleId(headers) {
  for (const name of BLOCK_RULE_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) {
      return value;
    }
  }
  return null;
}

function parseContentLength(headers) {
  const value = Number.parseInt(headers.get("content-length") || "", 10);
  return Number.isFinite(value) ? value : null;
}

function toCamelCase(headerName) {
  return headerName.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function buildBodySignature(body) {
  if (!body) {
    return null;
  }

  const text = String(body);
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const matchedPatterns = PROTECTION_BODY_PATTERNS
    .filter((pattern) => lower.includes(pattern.text))
    .map((pattern) => pattern.id);

  return {
    signatureType: "html_text",
    matchedPatterns,
    bodyHash: createHash("sha256").update(text).digest("hex"),
    title: extractTitle(text) || null,
    snippet: sanitizeSnippet(normalized),
  };
}

function sanitizeSnippet(value) {
  return value
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:\d[ -]*?){12,19}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BODY_SIGNATURE_SNIPPET_LENGTH);
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
  canonicalStrategy,
  started,
}) {
  const result = {
    url,
    canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
    checkedAt: new Date().toISOString(),
    ok: false,
    status,
    method,
    finalUrl,
    contentType: null,
    contentLength: null,
    cacheHeaders: emptyCacheHeaders(),
    server: null,
    wafHeaders: {},
    blockedReason: null,
    blockedRuleId: null,
    bodySignature: null,
    suspectedWaf: false,
    suspectedBot: false,
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
    applyBodySignatureDiagnostics(result);
    result.classification = "ok";
    result.issueType = "ok";
    result.diagnosis = result.blockedReason
      ? "HTTP response is successful, but the body contains challenge or block-page indicators."
      : "HTTP response is successful.";
    return;
  }

  const protection = detectProtectionLayer(result, headers);
  if (protection) {
    result.classification = "protected";
    result.issueType = "protected";
    result.protection = protection;
    result.blockedReason = protection.blockedReason;
    result.blockedRuleId = result.blockedRuleId || protection.blockedRuleId || null;
    result.suspectedWaf = protection.suspectedWaf;
    result.suspectedBot = protection.suspectedBot;
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

function applyBodySignatureDiagnostics(result) {
  const matched = result.bodySignature?.matchedPatterns || [];
  for (const id of matched) {
    const pattern = PROTECTION_BODY_PATTERNS.find((item) => item.id === id);
    if (!pattern) {
      continue;
    }
    result.blockedReason = result.blockedReason || pattern.reason;
    result.suspectedWaf = result.suspectedWaf || pattern.suspectedWaf;
    result.suspectedBot = result.suspectedBot || pattern.suspectedBot;
  }
}

function detectProtectionLayer(result, headers) {
  const server = (result.server || "").toLowerCase();
  const body = (result.body || result.diagnosticBody || "").toLowerCase();
  const title = extractTitle(result.body || result.diagnosticBody || "");
  const statusLooksBlocked = result.status === 403 || result.status === 429 || result.status === 503;
  const evidence = [];
  const matchedPatterns = [];
  let blockedReason = null;
  let provider = null;
  let suspectedWaf = false;
  let suspectedBot = false;

  if (server.includes("cloudflare") || headers.get("cf-ray") || headers.get("cf-cache-status")) {
    provider = "Cloudflare";
    blockedReason = blockedReason || "cloudflare_header";
    suspectedWaf = true;
    evidence.push("Cloudflare response header");
  }
  if (server.includes("akamai") || headers.get("akamai-origin-hop")) {
    provider = provider || "Akamai";
    blockedReason = blockedReason || "akamai_header";
    suspectedWaf = true;
    evidence.push("Akamai response header");
  }
  if (headers.get("x-sucuri-id") || body.includes("sucuri website firewall")) {
    provider = provider || "Sucuri";
    blockedReason = blockedReason || "sucuri_header";
    suspectedWaf = true;
    if (headers.get("x-sucuri-id")) {
      evidence.push("Sucuri response header");
    }
  }

  for (const pattern of PROTECTION_BODY_PATTERNS) {
    if (!body.includes(pattern.text)) {
      continue;
    }
    if (pattern.id === "cloudflare_just_a_moment" && !body.includes("cloudflare")) {
      continue;
    }
    matchedPatterns.push(pattern.id);
    provider = provider || pattern.provider;
    blockedReason = blockedReason || pattern.reason;
    suspectedWaf = suspectedWaf || pattern.suspectedWaf;
    suspectedBot = suspectedBot || pattern.suspectedBot;
    if (!evidence.includes(pattern.evidence)) {
      evidence.push(pattern.evidence);
    }
  }

  if (!statusLooksBlocked || evidence.length === 0) {
    return null;
  }

  return {
    provider,
    status: result.status,
    title,
    blockedReason,
    blockedRuleId: extractBlockedRuleId(headers),
    matchedPatterns,
    suspectedWaf,
    suspectedBot,
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

  for (const redirect of extractJavaScriptRedirects(html)) {
    links.push({ tag: "script", attribute: redirect.attribute, value: redirect.value, sourceType: "script_literal" });
  }

  return links.map((link) => ({ sourceType: "html_attribute", ...link }));
}

function detectSpaFramework(html) {
  const signals = [];
  const htmlLength = html.length;
  const anchorCount = countRegexMatches(html, /<a\b[^>]*\shref\s*=/gi);
  const urlLiteralCount = countRegexMatches(html, /https?:\/\/[^\s"'<>\\]+/gi);

  if (html.includes("/_nuxt/")) {
    signals.push("nuxt_assets");
  }
  if (html.includes("__NUXT_DATA__")) {
    signals.push("nuxt_data");
  }
  if (html.includes("window.__NUXT__")) {
    signals.push("nuxt_window_state");
  }
  if (html.includes("__NEXT_DATA__")) {
    signals.push("next_data");
  }
  if (htmlLength > 100000 && anchorCount < 10) {
    signals.push("large_html_low_anchor_count");
  }
  if (urlLiteralCount >= 10 && urlLiteralCount > Math.max(1, anchorCount) * 3) {
    signals.push("url_literals_exceed_anchors");
  }

  return {
    detected: signals.length > 0,
    framework: inferSpaFramework(signals),
    signals,
    stats: {
      htmlLength,
      anchorCount,
      urlLiteralCount,
    },
  };
}

function inferSpaFramework(signals) {
  if (signals.some((signal) => signal.startsWith("nuxt"))) {
    return "nuxt";
  }
  if (signals.some((signal) => signal.startsWith("next"))) {
    return "next";
  }
  return "unknown";
}

function countRegexMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function extractFrameworkLinks(html, pageUrl) {
  return dedupeExtractedLinks([
    ...extractUrlLiteralsFromScripts(html),
    ...extractPathLiteralsFromScripts(html, pageUrl),
  ]);
}

function extractUrlLiteralsFromScripts(html) {
  const links = [];
  const urlRegex = /https?:\/\/[^\s"'<>\\]+/g;

  for (const scriptText of extractInlineScriptTexts(html)) {
    for (const match of scriptText.matchAll(urlRegex)) {
      const value = cleanupPayloadUrl(match[0]);
      if (!value) {
        continue;
      }
      links.push({
        tag: "payload",
        attribute: "payload:url",
        value,
        sourceType: "script_literal",
      });
    }
  }

  return links;
}

function extractPathLiteralsFromScripts(html, pageUrl) {
  const links = [];
  const pathRegex = /["'](\/[a-zA-Z0-9][^"'<>\\\s]*)["']/g;

  for (const scriptText of extractInlineScriptTexts(html)) {
    for (const match of scriptText.matchAll(pathRegex)) {
      const rawPath = cleanupPayloadPath(match[1]);
      if (!rawPath || shouldIgnorePayloadPath(rawPath)) {
        continue;
      }
      links.push({
        tag: "payload",
        attribute: "payload:path",
        value: new URL(rawPath, pageUrl).toString(),
        sourceType: "spa_payload",
      });
    }
  }

  return links;
}

function extractInlineScriptTexts(html) {
  const scripts = [];
  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const attributes = match[1] || "";
    const body = match[2] || "";
    if (/\ssrc\s*=/i.test(attributes) || !body.trim()) {
      continue;
    }
    scripts.push(body);
  }

  return scripts;
}

function cleanupPayloadUrl(value) {
  const cleaned = decodeHtmlEntities(String(value || ""))
    .replace(/[),.;\]}]+$/g, "")
    .trim();
  return safeUrl(cleaned) ? cleaned : null;
}

function cleanupPayloadPath(value) {
  return decodeHtmlEntities(String(value || ""))
    .replace(/[),.;\]}]+$/g, "")
    .trim();
}

function shouldIgnorePayloadPath(pathname) {
  return pathname.startsWith("//")
    || pathname.startsWith("/_nuxt/")
    || pathname.startsWith("/__")
    || pathname === "/";
}

function dedupeExtractedLinks(links) {
  const seen = new Set();
  const deduped = [];
  for (const link of links) {
    const key = `${link.sourceType}|${link.attribute}|${link.value}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(link);
  }
  return deduped;
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

function extractJavaScriptRedirects(html) {
  const redirects = [];
  const patterns = [
    {
      attribute: "window.location.href",
      regex: /\b(?:window\s*\.\s*)?location\s*\.\s*href\s*=\s*(["'])([^"']+)\1/gi,
    },
    {
      attribute: "window.location",
      regex: /\b(?:window\s*\.\s*)?location\s*=\s*(["'])([^"']+)\1/gi,
    },
    {
      attribute: "location.assign",
      regex: /\b(?:window\s*\.\s*)?location\s*\.\s*assign\s*\(\s*(["'])([^"']+)\1\s*\)/gi,
    },
    {
      attribute: "location.replace",
      regex: /\b(?:window\s*\.\s*)?location\s*\.\s*replace\s*\(\s*(["'])([^"']+)\1\s*\)/gi,
    },
  ];

  const seen = new Set();
  for (const { attribute, regex } of patterns) {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const value = decodeHtmlEntities(match[2] || "").trim();
      if (!value || seen.has(value)) {
        continue;
      }
      seen.add(value);
      redirects.push({ attribute, value });
    }
  }

  return redirects;
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
  return canonicalizeUrl(value, { strategy: "safe" });
}

function canonicalizeUrl(value, { strategy = DEFAULTS.canonicalStrategy } = {}) {
  const normalizedStrategy = normalizeCanonicalStrategy(strategy);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Only http and https URLs are supported: ${value}`);
  }

  url.hash = "";

  if (normalizedStrategy === "moderate" || normalizedStrategy === "aggressive") {
    sortQueryParameters(url);
    normalizePageTrailingSlash(url);
  }

  if (normalizedStrategy === "aggressive") {
    removeTrackingParameters(url);
    sortQueryParameters(url);
  }

  return url.toString();
}

function normalizeCanonicalStrategy(value) {
  const strategy = String(value || DEFAULTS.canonicalStrategy).toLowerCase();
  if (!CANONICAL_STRATEGIES.has(strategy)) {
    throw new Error(`Invalid canonical strategy "${value}". Use safe, moderate, or aggressive.`);
  }
  return strategy;
}

function normalizeSpaLinkMode(value) {
  const mode = String(value || DEFAULTS.spaLinks).toLowerCase();
  if (!SPA_LINK_MODES.has(mode)) {
    throw new Error(`Invalid SPA link mode "${value}". Use auto, off, or strict.`);
  }
  return mode;
}

function sortQueryParameters(url) {
  if (!url.search) {
    return;
  }

  const entries = [...url.searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => (
      leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)
    ));
  url.search = "";
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}

function removeTrackingParameters(url) {
  if (!url.search) {
    return;
  }

  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.toLowerCase();
    if (normalized.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalized)) {
      url.searchParams.delete(key);
    }
  }
}

function normalizePageTrailingSlash(url) {
  if (!url.pathname || url.pathname === "/" || url.pathname.endsWith("/") || url.search) {
    return;
  }

  const lastSegment = url.pathname.split("/").pop() || "";
  if (lastSegment.includes(".")) {
    return;
  }

  url.pathname = `${url.pathname}/`;
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

function isAssetUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return ASSET_EXTENSIONS.has(getPathExtension(parsed.pathname));
  } catch {
    return false;
  }
}

function isPayloadLink(link) {
  return link?.sourceType === "script_literal"
    || link?.sourceType === "spa_payload"
    || link?.sourceType === "site_rule_derived"
    || link?.tag === "payload";
}

function classifyExternalLink(urlValue, link, domainRules = EXTERNAL_CATEGORY_RULES) {
  const parsed = new URL(urlValue);
  const extension = getPathExtension(parsed.pathname);
  const categories = new Set();
  const categorySources = [];
  let type = classifyLinkType(link, extension);

  if (type !== "unknown") {
    categories.add(type);
    categorySources.push({ category: type, source: "link-structure" });
  }

  for (const rule of domainRules) {
    if (rule.domains.some((domain) => hostnameMatchesDomain(parsed.hostname, domain))) {
      categories.add(rule.category);
      categorySources.push({ category: rule.category, source: rule.source || "domain-rule" });
    }
  }

  if (type === "unknown" && categories.size > 0) {
    type = [...categories][0];
  }

  return {
    type,
    categories: [...categories],
    categorySources,
  };
}

function safeUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function evaluateExternalRisk(item, result, {
  sourceCount = item.sources?.length || 0,
  externalRiskRules = [],
} = {}) {
  const riskReasons = new Set();
  const matchedRules = [];
  let riskLevel = "info";
  let governanceStatus = "unknown";
  let needsReview = false;

  const addSignal = (reason, level, rule = {}) => {
    riskReasons.add(reason);
    if (EXTERNAL_RISK_RANK[level] > EXTERNAL_RISK_RANK[riskLevel]) {
      riskLevel = level;
    }
    matchedRules.push({
      id: rule.id || reason,
      source: rule.source || "builtin",
      riskReason: reason,
      riskLevel: level,
      ...rule.details,
    });
  };

  const governanceMatches = findExternalRiskRuleMatches(item, externalRiskRules);
  const blockedMatch = governanceMatches.find((rule) => rule.governanceStatus === "blocked");
  const allowedMatch = governanceMatches.find((rule) => rule.governanceStatus === "allowed");
  const watchlistedMatch = governanceMatches.find((rule) => rule.governanceStatus === "watchlisted");

  if (blockedMatch) {
    governanceStatus = "blocked";
    needsReview = true;
    addSignal("blocked_domain", "high", {
      id: blockedMatch.id,
      source: blockedMatch.source,
      details: {
        domain: blockedMatch.domain,
        label: blockedMatch.label,
      },
    });
  } else if (watchlistedMatch) {
    governanceStatus = "watchlisted";
    needsReview = true;
    addSignal("watchlisted_domain", "medium", {
      id: watchlistedMatch.id,
      source: watchlistedMatch.source,
      details: {
        domain: watchlistedMatch.domain,
        label: watchlistedMatch.label,
      },
    });
  } else if (allowedMatch) {
    governanceStatus = "allowed";
    addSignal("allowed_domain", "info", {
      id: allowedMatch.id,
      source: allowedMatch.source,
      details: {
        domain: allowedMatch.domain,
        label: allowedMatch.label,
      },
    });
  }

  if (!allowedMatch && !blockedMatch) {
    for (const category of item.categories || []) {
      const level = EXTERNAL_RISK_CATEGORY_LEVELS.get(category);
      if (!level) {
        continue;
      }
      addSignal(category, level, {
        id: `category:${category}`,
        source: "category",
      });
    }
  }

  const parsed = safeUrl(item.url);
  if (parsed && !allowedMatch && !blockedMatch) {
    for (const key of parsed.searchParams.keys()) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalized)) {
        addSignal("tracking_query", "medium", {
          id: `query:${normalized}`,
          source: "url-query",
          details: { queryKey: key },
        });
      }
    }
  }

  if (sourceCount > 1) {
    addSignal("repeated_reference", "info", {
      id: "source:repeated_reference",
      source: "inventory",
      details: { sourceCount },
    });
  }

  if (result) {
    if (result.redirectLabels?.includes("cross_host_redirect")) {
      addSignal("cross_host_redirect", "medium", { id: "redirect:cross_host_redirect", source: "http" });
    }
    if (result.redirectLabels?.includes("long_redirect_chain")) {
      addSignal("long_redirect_chain", "medium", { id: "redirect:long_redirect_chain", source: "http" });
    }
    if (result.redirectLabels?.includes("redirect_to_error") || result.issueType === "redirect_to_error") {
      addSignal("redirect_to_error", "high", { id: "redirect:redirect_to_error", source: "http" });
    }
    if (result.issueType === "too_many_redirects") {
      addSignal("too_many_redirects", "high", { id: "redirect:too_many_redirects", source: "http" });
    }
    if (result.issueType === "redirect_loop") {
      addSignal("redirect_loop", "high", { id: "redirect:redirect_loop", source: "http" });
    }
    if (result.classification === "protected") {
      addSignal(result.suspectedBot ? "blocked_bot" : "blocked_waf", "medium", {
        id: result.suspectedBot ? "protection:blocked_bot" : "protection:blocked_waf",
        source: "http",
        details: {
          provider: result.protection?.provider || null,
          blockedReason: result.blockedReason || null,
        },
      });
    }
    if (result.status === 429) {
      addSignal("rate_limited", "medium", { id: "http:rate_limited", source: "http" });
    }
    if (result.classification !== "protected"
        && (result.classification === "access_denied" || result.issueType === "access_denied" || result.status === 403)) {
      addSignal("access_denied", "medium", { id: "http:access_denied", source: "http" });
    }
    if (result.ok && (result.blockedReason || result.suspectedWaf || result.suspectedBot)) {
      addSignal("suspected_false_positive", "medium", {
        id: "body:suspected_false_positive",
        source: "body-signature",
        details: { blockedReason: result.blockedReason || null },
      });
    }
    if (!result.ok && result.status >= 400 && !["protected", "access_denied", "redirect_error"].includes(result.classification)) {
      addSignal("external_http_error", "medium", {
        id: `http:${result.status}`,
        source: "http",
        details: { status: result.status },
      });
    }
  }

  if (EXTERNAL_RISK_RANK[riskLevel] >= EXTERNAL_RISK_RANK.medium) {
    needsReview = true;
    if (governanceStatus === "unknown") {
      governanceStatus = "needs_review";
    }
  }

  return {
    riskLevel,
    riskReasons: [...riskReasons],
    governanceStatus,
    matchedRules,
    needsReview,
  };
}

function findExternalRiskRuleMatches(item, rules) {
  const matches = [];
  for (const rule of rules) {
    const domain = rule.domains.find((candidate) => (
      hostnameMatchesDomain(item.hostname || "", candidate)
      || hostnameMatchesDomain(item.registrableDomain || "", candidate)
    ));
    if (!domain) {
      continue;
    }
    matches.push({
      ...rule,
      domain,
    });
  }
  return matches;
}

function normalizeExternalRiskRules(value, source = "external-risk-rules") {
  const rawRules = collectExternalRiskRules(value);
  return rawRules
    .flatMap((rule, index) => normalizeExternalRiskRule(rule, index, source))
    .filter((rule) => rule.domains.length > 0);
}

function collectExternalRiskRules(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }

  const rules = [];
  for (const [key, governanceStatus] of [
    ["allowlist", "allowed"],
    ["allowed", "allowed"],
    ["blocklist", "blocked"],
    ["blocked", "blocked"],
    ["watchlist", "watchlisted"],
    ["watchlisted", "watchlisted"],
  ]) {
    if (Array.isArray(value[key])) {
      rules.push(...value[key].map((entry) => ({ governanceStatus, entry })));
    }
  }

  if (Array.isArray(value.rules)) {
    rules.push(...value.rules);
  }

  return rules;
}

function normalizeExternalRiskRule(rule, index, source) {
  if (typeof rule === "string") {
    return [{
      id: `${source}:rule-${index + 1}`,
      governanceStatus: "watchlisted",
      domains: [normalizeRuleDomain(rule)].filter(Boolean),
      source,
      label: "",
    }];
  }

  const entry = rule?.entry ?? rule;
  const rawStatus = rule?.governanceStatus || rule?.action || rule?.status || rule?.type || "";
  const governanceStatus = EXTERNAL_RISK_RULE_ACTIONS.get(String(rawStatus).trim().toLowerCase());
  if (!entry || !governanceStatus) {
    return [];
  }

  const domains = collectRuleDomains(entry).map(normalizeRuleDomain).filter(Boolean);
  return [{
    id: String(entry.id || rule.id || `${source}:${governanceStatus}:${index + 1}`).trim(),
    governanceStatus,
    domains,
    source: String(entry.source || rule.source || source).trim(),
    label: String(entry.label || entry.name || rule.label || rule.name || "").trim(),
  }];
}

function collectRuleDomains(rule) {
  if (typeof rule === "string") {
    return [rule];
  }
  if (Array.isArray(rule.domains)) {
    return rule.domains;
  }
  if (Array.isArray(rule.hostnames)) {
    return rule.hostnames;
  }
  return [rule.domain, rule.hostname, rule.host].filter(Boolean);
}

function normalizeRuleDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/^\.+/, "").replace(/\.$/, "");
}

function normalizeDomainCategoryRules(rules) {
  if (!Array.isArray(rules)) {
    return [];
  }

  return rules
    .map((rule) => ({
      category: String(rule.category || "").trim(),
      domains: Array.isArray(rule.domains)
        ? rule.domains.map((domain) => String(domain || "").trim().toLowerCase()).filter(Boolean)
        : [],
      source: String(rule.source || "custom-domain-rule").trim(),
    }))
    .filter((rule) => rule.category && rule.domains.length > 0);
}

function classifyLinkType(link, extension) {
  if (isPayloadLink(link)) {
    if (DOWNLOAD_EXTENSIONS.has(extension)) {
      return "download";
    }
    if (MEDIA_EXTENSIONS.has(extension)) {
      return "media";
    }
    return "anchor";
  }
  if (link.tag === "form") {
    return "form";
  }
  if (link.tag === "iframe" || link.tag === "embed" || link.tag === "object") {
    return "embedded_content";
  }
  if (link.tag === "script" || link.tag === "link") {
    return "asset";
  }
  if (["img", "audio", "source", "track", "video"].includes(link.tag)) {
    return "asset";
  }
  if (DOWNLOAD_EXTENSIONS.has(extension)) {
    return "download";
  }
  if (MEDIA_EXTENSIONS.has(extension)) {
    return "media";
  }
  if (link.tag === "a" || link.tag === "area") {
    return "anchor";
  }
  if (link.tag === "meta") {
    return "redirect";
  }
  return "unknown";
}

function getPathExtension(pathname) {
  const lastSegment = pathname.split("/").pop() || "";
  const dot = lastSegment.lastIndexOf(".");
  return dot === -1 ? "" : lastSegment.slice(dot).toLowerCase();
}

function hostnameMatchesDomain(hostname, domain) {
  const normalizedHost = hostname.toLowerCase();
  const normalizedDomain = domain.toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

function getRegistrableDomain(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || isIpAddress(normalized) || normalized === "localhost") {
    return normalized;
  }

  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return normalized;
  }

  const suffix2 = labels.slice(-2).join(".");
  if (COMMON_MULTI_PART_PUBLIC_SUFFIXES.has(suffix2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }

  return labels.slice(-2).join(".");
}

function isIpAddress(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
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
  if (result.status === 404 || result.status === 410) {
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

function getConfirmationOutcome(result) {
  if (result.ok) {
    return "recovered";
  }
  if (result.status === 404 || result.status === 410) {
    return "confirmed_missing";
  }
  return "needs_review";
}

function getConfirmationReason(result) {
  if (result.ok) {
    return "ok";
  }
  if (result.status === 404 || result.status === 410) {
    return "still_not_found";
  }
  if (result.classification === "protected" || result.suspectedWaf || result.suspectedBot) {
    return result.suspectedBot ? "blocked_bot" : "blocked_waf";
  }
  if (result.status === 429) {
    return "rate_limited";
  }
  if (result.status === 403 || result.issueType === "access_denied") {
    return "access_denied";
  }
  if (result.issueType === "timeout") {
    return "timeout";
  }
  if (result.classification === "network_error" || result.issueType === "network_error") {
    return "network_error";
  }
  return result.status ? `http_${result.status}` : "unknown";
}

function isTransientConfirmationResult(result) {
  return result.status === 429
    || result.issueType === "timeout"
    || result.issueType === "network_error"
    || result.classification === "network_error";
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

function countConfirmationByOutcome(items) {
  const counts = {
    enabled: false,
    candidates: 0,
    checked: 0,
    confirmed_missing: 0,
    recovered: 0,
    needs_review: 0,
    skipped: 0,
  };

  for (const item of items) {
    const confirmation = item.confirmation;
    if (!confirmation?.enabled) {
      continue;
    }
    counts.enabled = true;
    if (!confirmation.candidate) {
      continue;
    }
    counts.candidates += 1;
    if (!confirmation.checked) {
      counts.skipped += 1;
      continue;
    }
    counts.checked += 1;
    if (Object.prototype.hasOwnProperty.call(counts, confirmation.outcome)) {
      counts[confirmation.outcome] += 1;
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

function countExternalByType(items) {
  const counts = {};
  for (const item of items) {
    const type = item.type || "unknown";
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function countExternalByCategory(items) {
  const counts = {};
  for (const item of items) {
    const categories = item.categories?.length ? item.categories : ["uncategorized"];
    for (const category of categories) {
      counts[category] = (counts[category] || 0) + 1;
    }
  }
  return counts;
}

function countExternalRiskByLevel(items) {
  const counts = {
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const item of items) {
    const level = item.externalRisk?.riskLevel || "info";
    if (Object.prototype.hasOwnProperty.call(counts, level)) {
      counts[level] += 1;
    } else {
      counts.info += 1;
    }
  }

  return counts;
}

function countExternalRiskByGovernanceStatus(items) {
  const counts = {
    allowed: 0,
    blocked: 0,
    watchlisted: 0,
    unknown: 0,
    needs_review: 0,
  };

  for (const item of items) {
    const status = item.externalRisk?.governanceStatus || "unknown";
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    } else {
      counts.unknown += 1;
    }
  }

  return counts;
}

function summarizeExternalRiskDomains(items) {
  const domains = new Map();
  for (const item of items) {
    const domain = item.registrableDomain || item.hostname || "";
    if (!domain) {
      continue;
    }
    if (!domains.has(domain)) {
      domains.set(domain, {
        domain,
        linkCount: 0,
        sourceCount: 0,
        riskLevels: new Set(),
        governanceStatuses: new Set(),
        riskReasons: new Set(),
        highestRiskLevel: "info",
        needsReview: false,
      });
    }
    const summary = domains.get(domain);
    const risk = item.externalRisk || {};
    const riskLevel = risk.riskLevel || "info";
    summary.linkCount += 1;
    summary.sourceCount += item.sourceCount || item.sources?.length || 0;
    summary.riskLevels.add(riskLevel);
    summary.governanceStatuses.add(risk.governanceStatus || "unknown");
    summary.needsReview = summary.needsReview || Boolean(risk.needsReview);
    for (const reason of risk.riskReasons || []) {
      summary.riskReasons.add(reason);
    }
    if (EXTERNAL_RISK_RANK[riskLevel] > EXTERNAL_RISK_RANK[summary.highestRiskLevel]) {
      summary.highestRiskLevel = riskLevel;
    }
  }

  return [...domains.values()]
    .map((item) => ({
      domain: item.domain,
      linkCount: item.linkCount,
      sourceCount: item.sourceCount,
      highestRiskLevel: item.highestRiskLevel,
      riskLevels: [...item.riskLevels].sort((a, b) => EXTERNAL_RISK_RANK[b] - EXTERNAL_RISK_RANK[a]),
      governanceStatuses: [...item.governanceStatuses].sort(),
      riskReasons: [...item.riskReasons].sort(),
      needsReview: item.needsReview,
    }))
    .sort((a, b) => (
      EXTERNAL_RISK_RANK[b.highestRiskLevel] - EXTERNAL_RISK_RANK[a.highestRiskLevel]
      || b.linkCount - a.linkCount
      || a.domain.localeCompare(b.domain)
    ));
}

function countUnique(items) {
  return new Set(items.filter(Boolean)).size;
}

function addUnique(items, value) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function getIssueTypeLabel(issueType) {
  const labels = {
    not_found: "404/410 not found",
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
  if (isCertificateChainError(result.cause)) {
    return "TLS certificate chain verification failed";
  }
  if (isWeakDiffieHellmanError(result.cause)) {
    return "TLS weak Diffie-Hellman handshake failed";
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

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
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
  let domainRulesSource = null;
  let externalRiskRulesSource = null;
  let conservativeMode = false;
  const explicitOptions = new Set();

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--external") {
      options.checkExternal = true;
      explicitOptions.add("checkExternal");
      continue;
    }
    if (arg === "--conservative") {
      conservativeMode = true;
      continue;
    }
    if (arg === "--prefer-get") {
      options.preferGet = true;
      explicitOptions.add("preferGet");
      continue;
    }
    if (arg === "--external-referer") {
      options.externalReferer = true;
      explicitOptions.add("externalReferer");
      continue;
    }
    if (arg === "--legacy-tls") {
      options.legacyTls = true;
      explicitOptions.add("legacyTls");
      continue;
    }
    if (arg === "--system-ca") {
      options.systemCa = true;
      explicitOptions.add("systemCa");
      continue;
    }
    if (arg === "--confirm-404") {
      options.confirm404 = true;
      explicitOptions.add("confirm404");
      continue;
    }
    if (arg === "--no-confirm-404") {
      options.confirm404 = false;
      explicitOptions.add("confirm404");
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
      explicitOptions.add("concurrency");
      continue;
    }
    if (arg === "--global-concurrency") {
      options.concurrency = readPositiveInteger(args.shift(), "--global-concurrency");
      explicitOptions.add("concurrency");
      continue;
    }
    if (arg === "--per-host-concurrency") {
      options.perHostConcurrency = readPositiveInteger(args.shift(), "--per-host-concurrency");
      explicitOptions.add("perHostConcurrency");
      continue;
    }
    if (arg === "--request-delay-ms") {
      options.requestDelayMs = readNonNegativeInteger(args.shift(), "--request-delay-ms");
      explicitOptions.add("requestDelayMs");
      explicitOptions.add("requestDelayMinMs");
      explicitOptions.add("requestDelayMaxMs");
      continue;
    }
    if (arg === "--request-delay") {
      options.requestDelayMs = Math.round(readNonNegativeNumber(args.shift(), "--request-delay") * 1000);
      explicitOptions.add("requestDelayMs");
      explicitOptions.add("requestDelayMinMs");
      explicitOptions.add("requestDelayMaxMs");
      continue;
    }
    if (arg === "--request-delay-min-ms") {
      options.requestDelayMinMs = readNonNegativeInteger(args.shift(), "--request-delay-min-ms");
      explicitOptions.add("requestDelayMinMs");
      continue;
    }
    if (arg === "--request-delay-max-ms") {
      options.requestDelayMaxMs = readNonNegativeInteger(args.shift(), "--request-delay-max-ms");
      explicitOptions.add("requestDelayMaxMs");
      continue;
    }
    if (arg === "--request-delay-min") {
      options.requestDelayMinMs = Math.round(readNonNegativeNumber(args.shift(), "--request-delay-min") * 1000);
      explicitOptions.add("requestDelayMinMs");
      continue;
    }
    if (arg === "--request-delay-max") {
      options.requestDelayMaxMs = Math.round(readNonNegativeNumber(args.shift(), "--request-delay-max") * 1000);
      explicitOptions.add("requestDelayMaxMs");
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
      explicitOptions.add("retryCount");
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
      explicitOptions.add("userAgent");
      continue;
    }
    if (arg === "--domain-rules") {
      domainRulesSource = args.shift();
      if (!domainRulesSource) {
        throw new Error("--domain-rules requires a file path or URL");
      }
      continue;
    }
    if (arg === "--external-risk-rules") {
      externalRiskRulesSource = args.shift();
      if (!externalRiskRulesSource) {
        throw new Error("--external-risk-rules requires a file path or URL");
      }
      continue;
    }
    if (arg === "--spa-links") {
      const value = args.shift();
      if (!value || value.startsWith("-")) {
        throw new Error("--spa-links requires auto, off, or strict");
      }
      options.spaLinks = normalizeSpaLinkMode(value);
      continue;
    }
    if (arg === "--canonical-strategy") {
      const value = args.shift();
      if (!value || value.startsWith("-")) {
        throw new Error("--canonical-strategy requires safe, moderate, or aggressive");
      }
      options.canonicalStrategy = normalizeCanonicalStrategy(value);
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

  if (conservativeMode) {
    applyConservativeDefaults(options, explicitOptions);
  }

  options.concurrency = Math.max(1, Math.min(options.concurrency, 100));
  options.perHostConcurrency = Math.max(1, Math.min(options.perHostConcurrency, 50));
  options.requestDelayMs = Math.max(0, Math.min(options.requestDelayMs, 60000));
  options.requestDelayMinMs = normalizeOptionalDelay(options.requestDelayMinMs);
  options.requestDelayMaxMs = normalizeOptionalDelay(options.requestDelayMaxMs);
  if (Number.isFinite(options.requestDelayMinMs) !== Number.isFinite(options.requestDelayMaxMs)) {
    throw new Error("Random request delay requires both --request-delay-min-ms and --request-delay-max-ms");
  }
  if (Number.isFinite(options.requestDelayMinMs) && options.requestDelayMinMs > options.requestDelayMaxMs) {
    throw new Error("--request-delay-min-ms must be less than or equal to --request-delay-max-ms");
  }
  options.retryCount = Math.max(0, Math.min(options.retryCount, 5));
  options.maxRedirects = Math.max(0, Math.min(options.maxRedirects, 20));
  options.longRedirectThreshold = Math.max(0, Math.min(options.longRedirectThreshold, options.maxRedirects));
  options.confirmationMaxUrls = Math.max(0, Math.min(options.confirmationMaxUrls, 1000));
  options.confirmationMaxPerHost = Math.max(0, Math.min(options.confirmationMaxPerHost, 1000));
  options.confirmationConcurrency = Math.max(1, Math.min(options.confirmationConcurrency, 10));
  options.confirmationPerHostConcurrency = Math.max(1, Math.min(options.confirmationPerHostConcurrency, 5));
  options.confirmationDelayMinMs = Math.max(0, Math.min(options.confirmationDelayMinMs, 60000));
  options.confirmationDelayMaxMs = Math.max(0, Math.min(options.confirmationDelayMaxMs, 60000));
  options.canonicalStrategy = normalizeCanonicalStrategy(options.canonicalStrategy);
  options.spaLinks = normalizeSpaLinkMode(options.spaLinks);
  return { startUrl, options, output, json, progress, verbose, domainRulesSource, externalRiskRulesSource };
}

async function loadDomainCategoryRules(source) {
  if (!source) {
    return [];
  }

  const text = await readRulesText(source, "--domain-rules");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("--domain-rules must point to JSON");
  }

  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  const normalized = normalizeDomainCategoryRules(rules);
  if (normalized.length === 0) {
    throw new Error("--domain-rules did not contain any valid rules");
  }
  return normalized.map((rule) => ({
    ...rule,
    source,
  }));
}

async function loadExternalRiskRules(source) {
  if (!source) {
    return [];
  }

  const text = await readRulesText(source, "--external-risk-rules");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("--external-risk-rules must point to JSON");
  }

  const normalized = normalizeExternalRiskRules(parsed, source);
  if (normalized.length === 0) {
    throw new Error("--external-risk-rules did not contain any valid rules");
  }
  return normalized;
}

async function readRulesText(source, optionName) {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: {
        "user-agent": DEFAULTS.userAgent,
        "accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
      },
    });
    if (!response.ok) {
      throw new Error(`Unable to load ${optionName} URL: HTTP ${response.status}`);
    }
    return response.text();
  }

  return readFile(source, "utf8");
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

function normalizeOptionalDelay(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(value, 60000));
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
  --request-delay-min-ms <n>
                       Enable random pre-request delay with this minimum in milliseconds.
  --request-delay-max-ms <n>
                       Enable random pre-request delay with this maximum in milliseconds.
  --request-delay-min <s>
                       Random pre-request delay minimum in seconds, for example 0.3.
  --request-delay-max <s>
                       Random pre-request delay maximum in seconds, for example 1.
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
  --domain-rules <file-or-url>
                       JSON domain category rules: [{ "category": "...", "domains": ["example.com"] }].
  --external-risk-rules <file-or-url>
                       JSON external governance rules with allowlist, blocklist, and watchlist domains.
  --canonical-strategy <safe|moderate|aggressive>
                       Canonical URL strategy for report keys. Default: ${DEFAULTS.canonicalStrategy}
  --spa-links <auto|off|strict>
                       Extract explicit URL/path literals from SPA payloads. Default: ${DEFAULTS.spaLinks}
  --external          Also check links that point to other domains.
                      External links are always inventoried in the JSON report.
  --conservative      Lower request rate and use browser-like checks to reduce blocking.
  --prefer-get        Use lightweight GET checks instead of trying HEAD first.
  --external-referer  Send the source page as Referer for external link checks.
  --legacy-tls        Allow legacy TLS ciphers for sites with weak DH parameters.
  --system-ca         Restart Node with --use-system-ca for OS/browser-trusted roots.
  --confirm-404       Re-check same-site 404/410 results after the main scan. Default: on.
  --no-confirm-404    Disable the post-scan 404/410 confirmation stage.
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
  console.log(`External links found: ${summary.externalLinks || 0}`);
  console.log(`External domains found: ${summary.externalDomains || 0}`);
  if (summary.spaDetection?.detected) {
    console.log(`SPA/framework signals: ${summary.spaDetection.framework} (${summary.spaDetection.signals.join(", ")})`);
  }
  if (summary.scanQuality?.warnings?.length > 0) {
    console.log(`Scan quality warnings: ${summary.scanQuality.warnings.join(", ")}`);
  }
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
  if (summary.externalLinks > 0) {
    console.log("External links by type:");
    for (const [type, count] of Object.entries(summary.externalByType || {})) {
      if (count > 0) {
        console.log(`  ${type}: ${count}`);
      }
    }
  }
  if (summary.redirects > 0) {
    console.log(`Redirected URLs: ${summary.redirects}`);
    for (const [redirectType, count] of Object.entries(summary.redirectByType || {})) {
      if (count > 0) {
        console.log(`  ${getRedirectTypeLabel(redirectType)}: ${count}`);
      }
    }
  }
  if (summary.confirmation?.enabled) {
    console.log(`404/410 confirmation: ${summary.confirmation.checked}/${summary.confirmation.candidates} checked`);
    console.log(`  recovered: ${summary.confirmation.recovered || 0}`);
    console.log(`  needs review: ${summary.confirmation.needs_review || 0}`);
    console.log(`  confirmed missing: ${summary.confirmation.confirmed_missing || 0}`);
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
    } else if (item.diagnosis) {
      console.log(`  diagnosis: ${item.diagnosis}`);
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

  if (parsed.options.systemCa && !isSystemCaEnabled() && !canEnableSystemCaAtRuntime()) {
    process.exitCode = await restartWithSystemCa(process.argv.slice(2));
    return;
  }

  const domainCategoryRules = await loadDomainCategoryRules(parsed.domainRulesSource);
  const externalRiskRules = await loadExternalRiskRules(parsed.externalRiskRulesSource);

  const reporter = parsed.json
    ? null
    : new ProgressReporter({
        progress: parsed.progress,
        verbose: parsed.verbose,
        intervalMs: parsed.options.progressIntervalMs,
      });
  const checker = new LinkChecker(parsed.startUrl, {
    ...parsed.options,
    domainCategoryRules,
    domainCategoryRulesSource: parsed.domainRulesSource,
    externalRiskRules,
    externalRiskRulesSource: parsed.externalRiskRulesSource,
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

function restartWithSystemCa(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--use-system-ca", process.argv[1], ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => {
      console.error(`Error: unable to restart with system CA: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        console.error(`Error: system CA child process exited with signal ${signal}`);
        resolve(1);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export { BROWSER_USER_AGENT, DEFAULTS, LinkChecker, applyConservativeDefaults, canonicalizeUrl, isSystemCaEnabled };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
