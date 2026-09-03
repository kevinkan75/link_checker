#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { gunzipSync, inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL_VERSION = "1.4.0";
const REPORT_SCHEMA_VERSION = "1.3.0";
const DEFAULT_MAX_HTML_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_BODY_PREVIEW_BYTES = 4096;
const DEFAULT_MAX_DOWNLOAD_PROBE_BYTES = 64 * 1024;
const DEFAULT_MAX_SOURCES_PER_URL = 50;
const DEFAULT_MAX_RULES_BYTES = 5 * 1024 * 1024;
const DEFAULT_KEEP_ALIVE_MSECS = 1000;
const DEFAULT_RETRY_AFTER_MAX_MS = 30000;
const DEFAULT_CACHE_FILE = ".cache/link-check-cache.json";
const DEFAULT_CACHE_TTL_HOURS = 24;
const CACHE_SCHEMA_VERSION = "1.0.0";
const CACHE_POLICY_VERSION = "p7-cache-policy-v1";
const DEFAULT_INCREMENTAL_STATE_FILE = ".cache/link-check-state.json";
const INCREMENTAL_STATE_SCHEMA_VERSION = "1.0.0";
const INCREMENTAL_POLICY_VERSION = "p8-incremental-policy-v1";
const RULES_TRACE_SCHEMA_VERSION = "rules-trace.p9c2";
const DEFAULT_SITEMAP_MAX_URLS = 50000;
const DEFAULT_SITEMAP_INDEX_MAX_CHILDREN = 20;
const DEFAULT_SITEMAP_SAMPLE_URLS = 5;
const XML_SITEMAP_FALLBACK_CANDIDATE_LIMIT = 1;
const HTML_SITEMAP_FALLBACK_CANDIDATE_LIMIT = 6;
const HTML_SITEMAP_FALLBACK_PATHS = [
  "siteinformation/sitemap",
  "sitemap",
  "site-map",
];
const REDACTED_QUERY_VALUE = "REDACTED";
const DEFAULT_REDACT_QUERY_KEYS = [
  "access_token",
  "apikey",
  "api_key",
  "auth",
  "authorization",
  "email",
  "id_token",
  "jwt",
  "password",
  "passwd",
  "pwd",
  "refresh_token",
  "secret",
  "session",
  "sessionid",
  "signature",
  "sig",
  "token",
];
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DOCUMENT_ACCEPT_HEADER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
const GENERIC_ACCEPT_HEADER = "*/*";
const ACCEPT_ENCODING_HEADER = "gzip, deflate";
const RESPONSE_ABORT_CLEANUP = Symbol("linkCheckerResponseAbortCleanup");
const CANONICAL_STRATEGIES = new Set(["safe", "moderate", "aggressive"]);
const SPA_LINK_MODES = new Set(["auto", "off", "strict"]);
const TRACKING_QUERY_KEYS = new Set(["fbclid", "gclid", "msclkid", "yclid"]);
const ALLOWED_REQUEST_PROTOCOLS = new Set(["http:", "https:"]);
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
  { id: "captcha", text: "captcha", matchMode: "token", provider: null, reason: "captcha_or_challenge", suspectedWaf: false, suspectedBot: true, evidence: "CAPTCHA wording" },
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
  retryAfterMaxMs: DEFAULT_RETRY_AFTER_MAX_MS,
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
  blockPrivateIp: true,
  allowLocalhost: false,
  allowPrivateIp: false,
  robotsTxt: true,
  authorizedScan: false,
  authorizationNote: null,
  protectionBodyHash: false,
  redactSensitiveQuery: true,
  redactQueryKeys: DEFAULT_REDACT_QUERY_KEYS,
  maxHtmlBytes: DEFAULT_MAX_HTML_BYTES,
  maxBodyPreviewBytes: DEFAULT_MAX_BODY_PREVIEW_BYTES,
  maxDownloadProbeBytes: DEFAULT_MAX_DOWNLOAD_PROBE_BYTES,
  maxSourcesPerUrl: DEFAULT_MAX_SOURCES_PER_URL,
  maxRulesBytes: DEFAULT_MAX_RULES_BYTES,
  keepAlive: true,
  keepAliveMsecs: DEFAULT_KEEP_ALIVE_MSECS,
  cache: false,
  cacheFile: DEFAULT_CACHE_FILE,
  cacheTtlHours: DEFAULT_CACHE_TTL_HOURS,
  refreshCache: false,
  incremental: false,
  baselineReport: null,
  stateFile: DEFAULT_INCREMENTAL_STATE_FILE,
  incrementalStateWrite: true,
  changedOnly: false,
  sitemap: null,
  sitemapMaxUrls: DEFAULT_SITEMAP_MAX_URLS,
  sitemapIndexMaxChildren: DEFAULT_SITEMAP_INDEX_MAX_CHILDREN,
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
  ["form", "medium"],
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

const VALIDATION_PRIORITIES = {
  external: 120,
  content: 100,
  page: 90,
  document: 70,
  unknown: 50,
  media: 30,
  asset: 10,
  immutableAsset: 0,
};

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

  applyCooldown(url, cooldownMs) {
    const delay = Math.max(0, Number.isFinite(cooldownMs) ? Math.floor(cooldownMs) : 0);
    if (delay <= 0) {
      return false;
    }

    const host = new URL(url).host;
    const state = this.getState(host);
    state.nextAllowedAt = Math.max(state.nextAllowedAt, Date.now() + delay);
    this.pump(host);
    return true;
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
    this.currentUrl = this.redact(url);
    this.logVerbose(`[page] depth ${depth} ${this.redact(url)}`);
  }

  pageLinksFound(url, count) {
    this.logVerbose(`[links] ${count} found on ${this.redact(url)}`);
  }

  pageQueued(url, depth) {
    this.logVerbose(`[queue] depth ${depth} ${this.redact(url)}`);
  }

  externalSkipped(url, sourcePage) {
    this.logVerbose(`[skip] external ${this.redact(url)} found on ${this.redact(sourcePage)}`);
  }

  requestQueued(url, method) {
    this.pendingRequests += 1;
    this.currentUrl = this.redact(url);
    this.logVerbose(`[request] ${method} ${this.redact(url)}`);
  }

  requestFinished(result) {
    this.finishedRequests += 1;
    this.currentUrl = this.redact(result.url);
    const status = formatIssueReason(result);
    const marker = result.ok ? "ok" : "broken";
    this.logVerbose(`[${marker}] ${status} ${this.redact(result.url)}`);
  }

  redact(value) {
    return redactSensitiveQueryValue(value, this.checker?.options || DEFAULTS);
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
      `Crawled ${this.checker.crawledPageKeys.size}/${this.checker.options.maxPages} pages`,
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
    this.options.redactSensitiveQuery = this.options.redactSensitiveQuery !== false;
    this.options.redactQueryKeys = normalizeRedactQueryKeys(this.options.redactQueryKeys);
    this.options.maxHtmlBytes = normalizeByteLimit(this.options.maxHtmlBytes, DEFAULTS.maxHtmlBytes);
    this.options.maxBodyPreviewBytes = normalizeByteLimit(this.options.maxBodyPreviewBytes, DEFAULTS.maxBodyPreviewBytes);
    this.options.maxDownloadProbeBytes = normalizeByteLimit(this.options.maxDownloadProbeBytes, DEFAULTS.maxDownloadProbeBytes);
    this.options.maxSourcesPerUrl = normalizeIntegerLimit(this.options.maxSourcesPerUrl, DEFAULTS.maxSourcesPerUrl);
    this.options.maxRulesBytes = normalizeByteLimit(this.options.maxRulesBytes, DEFAULTS.maxRulesBytes);
    this.options.cache = this.options.cache === true;
    this.options.cacheFile = normalizeCacheFile(this.options.cacheFile);
    this.options.cacheTtlHours = normalizeCacheTtlHours(this.options.cacheTtlHours);
    this.options.refreshCache = this.options.refreshCache === true;
    this.options.baselineReport = normalizeOptionalPath(this.options.baselineReport);
    this.options.stateFile = normalizeOptionalPath(this.options.stateFile) || DEFAULT_INCREMENTAL_STATE_FILE;
    this.options.sitemap = normalizeOptionalPath(this.options.sitemap);
    this.options.sitemapMaxUrls = normalizeSitemapMaxUrls(this.options.sitemapMaxUrls);
    this.options.sitemapIndexMaxChildren = normalizeSitemapIndexMaxChildren(this.options.sitemapIndexMaxChildren);
    this.options.incremental = this.options.incremental === true || Boolean(this.options.baselineReport) || Boolean(this.options.sitemap);
    this.options.incrementalStateWrite = this.options.incrementalStateWrite !== false;
    this.options.changedOnly = this.options.changedOnly === true;
    if (this.options.changedOnly) {
      this.options.incremental = true;
    }
    this.options.retryAfterMaxMs = normalizeRetryAfterMaxMs(this.options.retryAfterMaxMs);
    this.options.protectionBodyHash = this.options.protectionBodyHash === true;
    this.securityPolicy = normalizeSecurityPolicy(this.options);
    Object.assign(this.options, this.securityPolicy);
    this.complianceOptions = normalizeComplianceOptions(this.options);
    Object.assign(this.options, this.complianceOptions);
    this.connectionOptions = normalizeConnectionOptions(this.options);
    Object.assign(this.options, this.connectionOptions);
    this.agents = createConnectionAgents(this.connectionOptions);
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
    this.queuedPageKeys = new Set([this.getPageKey(this.startUrl)]);
    this.crawledPages = new Set();
    this.crawledPageKeys = new Set();
    this.pageBudgetStopEvidence = false;
    this.validationQueue = [];
    this.activeValidationTasks = 0;
    this.validationError = null;
    this.statusCache = new Map();
    this.bodyCache = new Map();
    this.persistentCache = null;
    this.persistentCacheLoadPromise = null;
    this.persistentCacheWritePromise = Promise.resolve();
    this.persistentCacheStats = {
      enabled: this.options.cache,
      file: this.options.cacheFile,
      hits: 0,
      misses: 0,
      expired: 0,
      refreshed: 0,
      written: 0,
      bypassed: 0,
      errors: 0,
    };
    this.incrementalState = null;
    this.incrementalInputsLoaded = false;
    this.incremental = {
      enabled: this.options.incremental,
      stateFile: this.options.stateFile,
      baselineReport: this.options.baselineReport,
      stateWriteEnabled: this.options.incrementalStateWrite,
      stateRead: false,
      baselineRead: false,
      stateWritten: false,
      reuse: {
        enabled: this.options.changedOnly,
        reused: 0,
        bypassed: 0,
        bySource: {},
      },
      previous: new Map(),
      warnings: [],
      policyFingerprint: null,
      statePolicyFingerprint: null,
      baselinePolicyFingerprint: null,
    };
    this.sitemap = buildInitialSitemapSummary(this.options);
    this.sitemapEntries = [];
    this.sitemapByHash = new Map();
    this.sitemapSeed = createEmptySitemapSeedSummary(this.options);
    this.effectiveSitemap = null;
    this.discoveryFallback = createInitialDiscoveryFallbackSummary();
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
    this.retryAfterEvents = [];
    const customDomainCategoryRules = normalizeDomainCategoryRules(options.domainCategoryRules || []);
    const customExternalRiskRules = normalizeExternalRiskRules(options.externalRiskRules || []);
    const customSiteLinkRules = normalizeSiteLinkRules(options.siteLinkRules || {});
    this.domainCategoryRules = [
      ...EXTERNAL_CATEGORY_RULES,
      ...customDomainCategoryRules,
    ];
    this.externalRiskRules = customExternalRiskRules;
    this.siteLinkRules = customSiteLinkRules;
    this.rulesTrace = normalizeRulesTrace(options.rulesTrace, {
      domainCategoryRules: buildInlineRulesTraceEntry({
        source: this.options.domainCategoryRulesSource,
        ruleCount: customDomainCategoryRules.length,
      }),
      externalRiskRules: buildInlineRulesTraceEntry({
        source: this.options.externalRiskRulesSource,
        ruleCount: customExternalRiskRules.length,
      }),
      siteLinkRules: buildInlineRulesTraceEntry({
        source: this.options.siteLinkRulesSource,
        ruleCount: countSiteLinkRules(customSiteLinkRules),
      }),
    });
    this.skippedExternal = 0;
    this.reporter = options.reporter || null;
    this.currentPages = new Map();
    this.stopped = false;
    this.stoppedByUser = false;
    this.stopReason = null;
    this.activeRequestControllers = new Set();
    this.runStartedAt = null;
    this.robotsTxt = buildInitialRobotsTxtSummary(this.startOrigin, this.options);
    this.scanPolicy = buildScanPolicy(this.robotsTxt, this.options);
    this.compliance = buildComplianceRecord(this.scanPolicy, this.options);
  }

  async run() {
    this.runStartedAt = new Date().toISOString();
    this.reporter?.start(this);
    try {
      await this.inspectRobotsTxt();
      await this.loadIncrementalInputs();
      await this.loadSitemapInput();
      this.seedSitemapPages();
      const workers = Array.from(
        { length: this.options.concurrency },
        () => this.pageWorker(),
      );
      await Promise.all(workers);
      await this.confirmNotFoundResults();
      const report = this.buildReport();
      await this.saveIncrementalState(report);
      return report;
    } catch (error) {
      this.validationError = this.validationError || error;
      this.stopped = true;
      const report = this.buildReport();
      await this.saveIncrementalState(report);
      return report;
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

  stop(reason = "stopped_by_user") {
    this.stopped = true;
    this.stopReason = reason;
    this.stoppedByUser = reason === "stopped_by_user";
    const stopError = createStopAbortError(reason);
    for (const controller of this.activeRequestControllers) {
      if (!controller.signal.aborted) {
        controller.abort(stopError);
      }
    }
  }

  createRequestController() {
    const controller = new AbortController();
    this.activeRequestControllers.add(controller);
    if (this.stopped && !controller.signal.aborted) {
      controller.abort(createStopAbortError(this.stopReason || "stopped_by_user"));
    }
    return {
      controller,
      cleanup: () => {
        this.activeRequestControllers.delete(controller);
      },
    };
  }

  makeFetchOptions(overrides = {}, scheduler = this.hostScheduler) {
    return {
      timeoutMs: this.options.timeoutMs,
      retryCount: this.options.retryCount,
      maxRedirects: this.options.maxRedirects,
      longRedirectThreshold: this.options.longRedirectThreshold,
      userAgent: this.options.userAgent,
      acceptLanguage: this.options.acceptLanguage,
      preferGet: this.options.preferGet,
      canonicalStrategy: this.options.canonicalStrategy,
      legacyTls: this.options.legacyTls,
      systemCa: this.options.systemCa,
      maxHtmlBytes: this.options.maxHtmlBytes,
      maxBodyPreviewBytes: this.options.maxBodyPreviewBytes,
      maxDownloadProbeBytes: this.options.maxDownloadProbeBytes,
      connectionOptions: this.connectionOptions,
      agents: this.agents,
      securityPolicy: this.securityPolicy,
      retryAfterMaxMs: this.options.retryAfterMaxMs,
      protectionBodyHash: this.options.protectionBodyHash,
      scheduleRequest: (requestUrl, task) => scheduler.run(requestUrl, task),
      onRetryAfter: (requestUrl, cooldownMs, result) => this.applyRetryAfterCooldown(requestUrl, cooldownMs, result, scheduler),
      createAbortController: () => this.createRequestController(),
      isStopped: () => this.stopped,
      ...overrides,
    };
  }

  async inspectRobotsTxt() {
    if (!this.options.robotsTxt) {
      this.robotsTxt = buildInitialRobotsTxtSummary(this.startOrigin, this.options);
      this.updatePolicyRecords();
      return;
    }

    const robotsUrl = new URL("/robots.txt", this.startOrigin).toString();
    try {
      const result = await fetchUrl(robotsUrl, this.makeFetchOptions({
        requireBody: true,
        forceGet: true,
        retryCount: 0,
        referer: this.startUrl,
        preferGet: true,
        maxHtmlBytes: Math.min(this.options.maxHtmlBytes, 256 * 1024),
      }));
      this.robotsTxt = buildRobotsTxtSummary(robotsUrl, result, this.options);
    } catch (error) {
      this.robotsTxt = buildRobotsTxtFetchErrorSummary(robotsUrl, error, this.options);
    }
    this.updatePolicyRecords();
  }

  updatePolicyRecords() {
    this.scanPolicy = buildScanPolicy(this.robotsTxt, this.options);
    this.compliance = buildComplianceRecord(this.scanPolicy, this.options);
  }

  async loadSitemapInput() {
    if (!this.options.sitemap) {
      return;
    }

    const effectiveSitemap = this.createEffectiveSitemap(this.options.sitemap, "explicit");
    try {
      const loaded = await this.loadEffectiveSitemap(effectiveSitemap);
      this.commitLoadedSitemap(effectiveSitemap, loaded, { recordIncrementalWarnings: true });
    } catch (error) {
      this.sitemapEntries = [];
      this.sitemapByHash = new Map();
      this.sitemap = buildSitemapErrorSummary(this.options.sitemap, error, this.options);
      this.sitemapSeed = createEmptySitemapSeedSummary(this.options);
      this.incremental.warnings.push({
        code: "sitemap_read_failed",
        message: error.message || String(error),
      });
    }
  }

  createEffectiveSitemap(source, provenance) {
    return { source, provenance };
  }

  async loadEffectiveSitemap(effectiveSitemap) {
    if (effectiveSitemap.provenance === "auto_conventional") {
      const sourceValidator = (source) => this.isCrawlOrigin(source.finalUrl || source.source);
      return loadSitemapTree(effectiveSitemap.source, this, {
        rootSourceValidator: sourceValidator,
        childSourceValidator: sourceValidator,
      });
    }
    return loadSitemapTree(effectiveSitemap.source, this);
  }

  commitLoadedSitemap(effectiveSitemap, loaded, { recordIncrementalWarnings = false } = {}) {
    this.effectiveSitemap = effectiveSitemap;
    this.sitemapEntries = loaded.entries;
    this.sitemapByHash = buildSitemapEntryHashMap(loaded.entries, this);
    this.sitemap = buildLoadedSitemapSummary(loaded, this.options);
    this.sitemapSeed = createEmptySitemapSeedSummary({
      ...this.options,
      sitemap: effectiveSitemap.source,
    });
    if (recordIncrementalWarnings) {
      for (const warning of loaded.warnings) {
        this.incremental.warnings.push({
          code: "sitemap_warning",
          message: warning.message,
          detail: warning.code,
        });
      }
    }
  }

  seedSitemapPages(effectiveSitemap = this.effectiveSitemap, entries = this.sitemapEntries) {
    if (!effectiveSitemap || entries.length === 0) {
      return this.sitemapSeed;
    }

    const plan = this.planSitemapSeeds(effectiveSitemap, entries);
    this.applySitemapSeedPlan(effectiveSitemap, plan);
    return this.sitemapSeed;
  }

  planSitemapSeeds(effectiveSitemap, entries) {
    const summary = createEmptySitemapSeedSummary({
      ...this.options,
      sitemap: effectiveSitemap.source,
    });
    summary.enabled = true;
    summary.depth = 1;
    const queuedPageKeys = new Set(this.queuedPageKeys);
    const seeds = [];
    for (const entry of entries) {
      summary.attempted += 1;
      const decision = this.getSitemapSeedDecision(entry, { queuedPageKeys });
      if (!decision.ok) {
        recordSitemapSeedIgnored(summary, decision.reason);
        continue;
      }

      seeds.push({ entry, url: decision.url });
      queuedPageKeys.add(decision.pageKey);
      summary.seeded += 1;
    }
    return { summary, seeds };
  }

  applySitemapSeedPlan(effectiveSitemap, plan) {
    this.sitemapSeed = plan.summary;
    for (const { entry, url } of plan.seeds) {
      const source = {
        page: this.startUrl,
        tag: "sitemap",
        attribute: "loc",
        text: entry.url,
        sourceType: "sitemap",
        sitemapSource: effectiveSitemap.source,
      };
      const link = {
        value: entry.url,
        tag: "sitemap",
        attribute: "loc",
        sourceType: "sitemap",
      };
      this.addSource(url, source);
      this.addInventoryItem(url, source, link, {
        isExternal: false,
        shouldCheck: true,
        shouldCrawl: true,
        needsStatusCheck: true,
        needsBodyFetch: true,
      });
      this.enqueuePage(url, 1);
    }
  }

  getSitemapSeedDecision(entry, { queuedPageKeys = this.queuedPageKeys } = {}) {
    if (this.options.maxDepth < 1) {
      return { ok: false, reason: "max_depth" };
    }
    if (queuedPageKeys.size >= this.options.maxPages) {
      return { ok: false, reason: "max_pages" };
    }
    let url;
    try {
      url = normalizeUrl(entry.url);
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    if (!sameOrigin(url, this.startUrl)) {
      return { ok: false, reason: "cross_origin" };
    }
    if (!looksLikePage(url)) {
      return { ok: false, reason: "non_page_like" };
    }
    const pageKey = this.getPageKey(url);
    if (queuedPageKeys.has(pageKey) || this.crawledPageKeys.has(pageKey)) {
      return { ok: false, reason: "already_queued_or_crawled" };
    }
    return { ok: true, url, pageKey };
  }

  async loadIncrementalInputs() {
    if (!this.options.incremental || this.incrementalInputsLoaded) {
      return;
    }
    this.incrementalInputsLoaded = true;
    this.incremental.policyFingerprint = buildIncrementalPolicyFingerprint({
      options: this.options,
      scanPolicy: this.scanPolicy,
    });

    if (this.options.stateFile) {
      await this.loadIncrementalState();
    }
    if (this.options.baselineReport) {
      await this.loadBaselineReport();
    }
  }

  async loadIncrementalState() {
    try {
      const text = await readFile(this.options.stateFile, "utf8");
      const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
      this.incrementalState = normalizeIncrementalState(parsed);
      this.incremental.stateRead = true;
      this.incremental.statePolicyFingerprint = this.incrementalState.policyFingerprint || null;
      for (const [key, entry] of Object.entries(this.incrementalState.urls || {})) {
        const canonicalUrlHash = entry?.canonicalUrlHash || key;
        if (!canonicalUrlHash) {
          continue;
        }
        this.mergeIncrementalPreviousRecord(canonicalUrlHash, {
          source: "state",
          policyFingerprint: entry?.policyFingerprint || this.incrementalState.policyFingerprint || null,
          firstSeenAt: entry?.firstSeenAt || null,
          lastSeenAt: entry?.lastSeenAt || null,
          lastCheckedAt: entry?.lastCheckedAt || null,
          lastStatus: entry?.lastStatus ?? null,
          lastOk: entry?.lastOk ?? null,
          lastIssueType: entry?.lastIssueType || null,
          lastClassification: entry?.lastClassification || null,
          lastFinalUrlHash: entry?.lastFinalUrlHash || null,
          lastSitemapLastmod: entry?.lastSitemapLastmod || null,
          ttlExpiresAt: entry?.ttlExpiresAt || null,
          previousError: entry?.previousError === true,
          resultSummary: entry?.resultSummary || null,
          reusableResult: entry?.reusableResult || null,
        });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.incremental.warnings.push({
          code: "state_read_failed",
          message: error.message,
        });
      }
      this.incrementalState = createEmptyIncrementalState(this);
    }
  }

  async loadBaselineReport() {
    try {
      const text = await readFile(this.options.baselineReport, "utf8");
      const report = JSON.parse(text.replace(/^\uFEFF/, ""));
      const normalized = normalizeBaselineReportForIncremental(report);
      this.incremental.baselineRead = true;
      this.incremental.baselinePolicyFingerprint = normalized.policyFingerprint;
      for (const warning of normalized.warnings) {
        this.incremental.warnings.push(warning);
      }
      for (const record of normalized.records) {
        this.mergeIncrementalPreviousRecord(record.canonicalUrlHash, {
          ...record,
          source: "baseline_report",
          policyFingerprint: record.policyFingerprint || normalized.policyFingerprint,
        });
      }
    } catch (error) {
      this.incremental.warnings.push({
        code: "baseline_report_read_failed",
        message: error.message,
      });
    }
  }

  mergeIncrementalPreviousRecord(canonicalUrlHash, record) {
    const existing = this.incremental.previous.get(canonicalUrlHash);
    if (!existing) {
      this.incremental.previous.set(canonicalUrlHash, {
        ...record,
        sources: [record.source],
      });
      return;
    }

    if (!existing.sources.includes(record.source)) {
      existing.sources.push(record.source);
    }
    existing.previousError = existing.previousError || record.previousError === true;
    existing.resultSummary = existing.resultSummary || record.resultSummary || null;
    existing.policyFingerprint = existing.policyFingerprint || record.policyFingerprint || null;
    existing.lastCheckedAt = existing.lastCheckedAt || record.lastCheckedAt || null;
    existing.lastStatus = existing.lastStatus ?? record.lastStatus ?? null;
    existing.lastOk = existing.lastOk ?? record.lastOk ?? null;
    existing.lastIssueType = existing.lastIssueType || record.lastIssueType || null;
    existing.lastClassification = existing.lastClassification || record.lastClassification || null;
    existing.lastFinalUrlHash = existing.lastFinalUrlHash || record.lastFinalUrlHash || null;
    existing.lastSitemapLastmod = existing.lastSitemapLastmod || record.lastSitemapLastmod || null;
    existing.ttlExpiresAt = existing.ttlExpiresAt || record.ttlExpiresAt || null;
    existing.reusableResult = existing.reusableResult || record.reusableResult || null;
  }

  classifyIncrementalInventoryItem(canonicalUrl) {
    if (!this.options.incremental) {
      return null;
    }

    const canonicalUrlHash = hashLabel(canonicalUrl);
    const hashCandidates = getIncrementalCanonicalHashCandidates(canonicalUrl, this.options);
    const previous = findIncrementalPreviousRecord(this.incremental.previous, hashCandidates);
    let classification = "new";
    let reason = "not_seen_before";
    let priorityBoost = 50;

    if (previous) {
      const policyMismatch = Boolean(previous.policyFingerprint && this.incremental.policyFingerprint && previous.policyFingerprint !== this.incremental.policyFingerprint);
      if (policyMismatch) {
        classification = "policy_mismatch";
        reason = "policy_fingerprint_changed";
        priorityBoost = 45;
      } else if (previous.previousError || isPreviousIncrementalError(previous.resultSummary)) {
        classification = "previous_error";
        reason = "previous_result_needs_recheck";
        priorityBoost = 40;
      } else if (isPreviousIncrementalRedirectUnstable(previous.resultSummary)) {
        classification = "unstable_redirect";
        reason = "previous_redirect_needs_recheck";
        priorityBoost = 35;
      } else if (isIncrementalTtlExpired(previous.ttlExpiresAt)) {
        classification = "ttl_expired";
        reason = "state_ttl_expired";
        priorityBoost = 30;
      } else {
        classification = "known";
        reason = "seen_before";
        priorityBoost = -5;
      }
    }
    const sitemap = this.getSitemapPrioritySignal(canonicalUrl, previous);
    priorityBoost += sitemap?.priorityBoost || 0;

    return {
      classification,
      reason,
      priorityBoost,
      canonicalUrlHash,
      canonicalUrlHashCandidates: hashCandidates,
      previousSources: previous?.sources || [],
      previousCheckedAt: previous?.lastCheckedAt || previous?.resultSummary?.checkedAt || null,
      ttlExpiresAt: previous?.ttlExpiresAt || null,
      sitemap,
    };
  }

  getIncrementalPriorityBoost(item) {
    return this.options.incremental ? (item.incremental?.priorityBoost || 0) : 0;
  }

  getSitemapPrioritySignal(canonicalUrl, previous = null) {
    if (!this.options.sitemap || this.sitemapByHash.size === 0) {
      return null;
    }

    const hashCandidates = getIncrementalCanonicalHashCandidates(canonicalUrl, this.options);
    const entry = findSitemapEntry(this.sitemapByHash, hashCandidates);
    if (!entry) {
      return null;
    }

    const previousLastmod = previous?.lastSitemapLastmod || null;
    const currentLastmod = entry.lastmod || null;
    let classification = "sitemap_listed";
    let reason = "listed_in_sitemap";
    let priorityBoost = currentLastmod ? 5 : 0;

    if (currentLastmod && previousLastmod) {
      const comparison = compareSitemapLastmod(currentLastmod, previousLastmod);
      if (comparison > 0) {
        classification = "sitemap_changed";
        reason = "sitemap_lastmod_newer";
        priorityBoost = 20;
      } else {
        classification = "sitemap_known";
        reason = comparison === 0 ? "sitemap_lastmod_unchanged" : "sitemap_lastmod_not_newer";
        priorityBoost = -10;
      }
    }

    return {
      classification,
      reason,
      priorityBoost,
      lastmod: currentLastmod,
      previousLastmod,
    };
  }

  readIncrementalReusableResult(url) {
    if (!this.options.changedOnly || !this.options.incremental) {
      return null;
    }

    const hashCandidates = getIncrementalCanonicalHashCandidates(this.getCanonicalKey(url), this.options);
    const previous = findIncrementalPreviousRecord(this.incremental.previous, hashCandidates);
    const reuseDecision = getIncrementalReuseDecision(previous, this.incremental.policyFingerprint);
    if (!reuseDecision.reusable) {
      this.incremental.reuse.bypassed += 1;
      return null;
    }

    const result = buildIncrementalReusedResult(url, previous, {
      canonicalStrategy: this.options.canonicalStrategy,
      reason: reuseDecision.reason,
    });
    this.incremental.reuse.reused += 1;
    for (const source of previous.sources || ["state"]) {
      this.incremental.reuse.bySource[source] = (this.incremental.reuse.bySource[source] || 0) + 1;
    }
    return result;
  }

  buildIncrementalSummary() {
    if (!this.options.incremental) {
      return {
        enabled: false,
        policyVersion: INCREMENTAL_POLICY_VERSION,
        stateSchemaVersion: INCREMENTAL_STATE_SCHEMA_VERSION,
      };
    }

    const counts = {
      new: 0,
      known: 0,
      previous_error: 0,
      policy_mismatch: 0,
      ttl_expired: 0,
      unstable_redirect: 0,
    };
    const priority = {
      boosted: 0,
      deferred: 0,
      neutral: 0,
      totalBoost: 0,
      byClassification: {},
    };
    const sitemapPriority = {
      matchedCurrentUrls: 0,
      changed: 0,
      known: 0,
      listed: 0,
      boosted: 0,
      deferred: 0,
      neutral: 0,
      totalBoost: 0,
      byClassification: {},
    };
    const currentHashes = new Set();
    for (const key of getIncrementalCanonicalHashCandidates(this.startUrl, this.options)) {
      currentHashes.add(key);
    }
    for (const item of this.inventory.values()) {
      const incremental = item.incremental || this.classifyIncrementalInventoryItem(item.canonicalUrl);
      if (incremental?.canonicalUrlHash) {
        currentHashes.add(incremental.canonicalUrlHash);
      }
      for (const key of incremental?.canonicalUrlHashCandidates || []) {
        currentHashes.add(key);
      }
      if (Object.prototype.hasOwnProperty.call(counts, incremental?.classification)) {
        counts[incremental.classification] += 1;
      }
      const boost = incremental?.priorityBoost || 0;
      if (boost > 0) {
        priority.boosted += 1;
      } else if (boost < 0) {
        priority.deferred += 1;
      } else {
        priority.neutral += 1;
      }
      priority.totalBoost += boost;
      if (incremental?.classification) {
        priority.byClassification[incremental.classification] = boost;
      }
      const sitemapSignal = incremental?.sitemap;
      if (sitemapSignal?.classification) {
        sitemapPriority.matchedCurrentUrls += 1;
        if (sitemapSignal.classification === "sitemap_changed") {
          sitemapPriority.changed += 1;
        } else if (sitemapSignal.classification === "sitemap_known") {
          sitemapPriority.known += 1;
        } else if (sitemapSignal.classification === "sitemap_listed") {
          sitemapPriority.listed += 1;
        }
        const sitemapBoost = sitemapSignal.priorityBoost || 0;
        if (sitemapBoost > 0) {
          sitemapPriority.boosted += 1;
        } else if (sitemapBoost < 0) {
          sitemapPriority.deferred += 1;
        } else {
          sitemapPriority.neutral += 1;
        }
        sitemapPriority.totalBoost += sitemapBoost;
        sitemapPriority.byClassification[sitemapSignal.classification] = sitemapBoost;
      }
    }

    let disappeared = 0;
    for (const key of this.incremental.previous.keys()) {
      if (!currentHashes.has(key)) {
        disappeared += 1;
      }
    }

    return {
      enabled: true,
      mode: this.options.changedOnly ? "changed_only" : "classify_only",
      policyVersion: INCREMENTAL_POLICY_VERSION,
      stateSchemaVersion: INCREMENTAL_STATE_SCHEMA_VERSION,
      stateFile: this.options.stateFile,
      baselineReport: this.options.baselineReport || null,
      stateWriteEnabled: this.options.incrementalStateWrite,
      stateRead: this.incremental.stateRead,
      baselineRead: this.incremental.baselineRead,
      previousUrls: this.incremental.previous.size,
      currentUrls: this.inventory.size,
      new: counts.new,
      known: counts.known,
      previousError: counts.previous_error,
      policyMismatch: counts.policy_mismatch,
      ttlExpired: counts.ttl_expired,
      unstableRedirect: counts.unstable_redirect,
      disappeared,
      reused: this.incremental.reuse.reused,
      reuse: {
        enabled: this.options.changedOnly,
        reused: this.incremental.reuse.reused,
        bypassed: this.incremental.reuse.bypassed,
        bySource: this.incremental.reuse.bySource,
      },
      sitemap: {
        ...(this.sitemap || buildInitialSitemapSummary(this.options)),
        seed: this.sitemapSeed || createEmptySitemapSeedSummary(this.options),
        priority: sitemapPriority,
      },
      priority,
      policyFingerprint: this.incremental.policyFingerprint,
      warnings: this.incremental.warnings,
    };
  }

  async saveIncrementalState(report) {
    if (!this.options.incremental || !this.options.incrementalStateWrite || !this.options.stateFile) {
      return;
    }

    const state = buildIncrementalStateFromReport(this);
    try {
      await mkdir(dirname(this.options.stateFile), { recursive: true });
      await writeFile(this.options.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      this.incremental.stateWritten = true;
    } catch (error) {
      this.incremental.warnings.push({
        code: "state_write_failed",
        message: error.message,
      });
    }
  }

  applyRetryAfterCooldown(requestUrl, cooldownMs, result, scheduler = this.hostScheduler) {
    const applied = scheduler.applyCooldown(requestUrl, cooldownMs);
    this.retryAfterEvents.push({
      host: new URL(requestUrl).host,
      url: requestUrl,
      status: result.status ?? null,
      header: result.retryAfter?.header || null,
      waitMs: result.retryAfter?.waitMs ?? null,
      cappedWaitMs: result.retryAfter?.cappedWaitMs ?? null,
      cooldownMs,
      capped: result.retryAfter?.capped === true,
      applied,
      recordedAt: new Date().toISOString(),
    });
    return applied;
  }

  async processPage({ url, depth }) {
    const pageKey = this.getPageKey(url);
    if (this.stopped || this.crawledPageKeys.has(pageKey) || this.crawledPageKeys.size >= this.options.maxPages) {
      return;
    }

    this.crawledPages.add(url);
    this.crawledPageKeys.add(pageKey);
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

      const { pageBaseUrl, spaDetection, links } = this.extractPageLinks(pageResult.body, pageResult.finalUrl || url);
      this.recordSpaDetection(url, pageResult.finalUrl || url, spaDetection);
      this.reporter?.pageLinksFound(url, links.length);
      let crawlEnqueuedFromPage = 0;

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
        const validationSkippedByLinkIntent = isConnectionOnlyResourceHint(link);
        const shouldCheck = !validationSkippedByLinkIntent && this.shouldCheck(resolved);
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
          this.enqueueValidation(inventoryEntry, resolved, { requireBody: false }, { deferPump: true });
        } else if (shouldCheck) {
          this.inventoryMetrics.validationSkippedByInventory += 1;
        } else if (!validationSkippedByLinkIntent) {
          this.skippedExternal += 1;
          this.reporter?.externalSkipped(resolved, url);
        }

        if (shouldCrawl && this.enqueuePage(resolved, depth + 1)) {
          crawlEnqueuedFromPage += 1;
        }
      }
      this.pumpValidationQueue();
      if (url === this.startUrl && depth === 0) {
        if (crawlEnqueuedFromPage === 0) {
          const xmlSitemapAccepted = await this.tryXmlSitemapFallback();
          if (!xmlSitemapAccepted) {
            await this.tryHtmlSitemapFallback(pageResult.finalUrl || url);
          }
        } else {
          this.updateXmlSitemapFallback({
            status: "not_needed",
            reason: "normal_frontier_present",
          });
          this.discoveryFallback.htmlSitemap = {
            ...this.discoveryFallback.htmlSitemap,
            status: "not_needed",
            reason: "normal_frontier_present",
          };
        }
      }
    } finally {
      this.currentPages.delete(url);
    }
  }

  extractPageLinks(body, pageUrl) {
    const pageBaseUrl = getDocumentBaseUrl(body, pageUrl);
    const spaDetection = detectSpaFramework(body);
    const htmlLinks = extractLinks(body, pageBaseUrl);
    const frameworkLinks = this.shouldExtractFrameworkLinks(spaDetection)
      ? extractFrameworkLinks(body, pageBaseUrl, {
          siteLinkRules: this.options.spaLinks === "strict" ? {} : this.siteLinkRules,
        })
      : [];
    return {
      pageBaseUrl,
      spaDetection,
      links: [...htmlLinks, ...frameworkLinks],
    };
  }

  updateXmlSitemapFallback(update) {
    this.discoveryFallback.xmlSitemap = {
      ...this.discoveryFallback.xmlSitemap,
      ...update,
    };
  }

  async tryXmlSitemapFallback() {
    if (this.options.sitemap) {
      this.updateXmlSitemapFallback({
        status: "not_needed",
        reason: "explicit_sitemap",
      });
      return false;
    }
    if (this.options.maxDepth < 1) {
      this.updateXmlSitemapFallback({
        status: "skipped",
        reason: "max_depth",
      });
      return false;
    }
    if (this.queuedPageKeys.size >= this.options.maxPages) {
      this.updateXmlSitemapFallback({
        status: "skipped",
        reason: "max_pages",
      });
      return false;
    }

    const candidate = new URL("/sitemap.xml", this.startOrigin).toString();
    const effectiveSitemap = this.createEffectiveSitemap(candidate, "auto_conventional");
    this.updateXmlSitemapFallback({
      status: "attempted",
      reason: "empty_initial_frontier",
      attempted: true,
      candidateLimit: XML_SITEMAP_FALLBACK_CANDIDATE_LIMIT,
      candidatesTried: 1,
      accepted: false,
    });
    let loaded;
    try {
      loaded = await this.loadEffectiveSitemap(effectiveSitemap);
    } catch {
      this.updateXmlSitemapFallback({
        status: "not_found",
        reason: "fetch_failed",
      });
      return false;
    }

    const finalUrl = loaded.finalUrl || candidate;
    if (!this.isCrawlOrigin(finalUrl)) {
      this.updateXmlSitemapFallback({
        status: "not_found",
        reason: "fetch_failed",
      });
      return false;
    }
    if (loaded.type !== "urlset" && loaded.type !== "sitemapindex") {
      this.updateXmlSitemapFallback({
        status: "not_found",
        reason: "unsupported_sitemap",
        sitemapType: loaded.type || null,
        urlsDiscovered: loaded.entries.length,
        urlsSeeded: 0,
      });
      return false;
    }

    const plan = this.planSitemapSeeds(effectiveSitemap, loaded.entries);
    if (plan.summary.seeded === 0) {
      this.updateXmlSitemapFallback({
        status: "not_found",
        reason: "no_usable_seed",
        sitemapType: loaded.type,
        urlsDiscovered: loaded.entries.length,
        urlsSeeded: 0,
      });
      return false;
    }

    this.commitLoadedSitemap(effectiveSitemap, loaded);
    this.applySitemapSeedPlan(effectiveSitemap, plan);
    this.updateXmlSitemapFallback({
      status: "accepted",
      reason: "empty_initial_frontier",
      accepted: true,
      acceptedUrl: redactSensitiveQueryValue(finalUrl, { ...this.options, redactSensitiveQuery: true }),
      sitemapType: loaded.type,
      urlsDiscovered: loaded.entries.length,
      urlsSeeded: plan.summary.seeded,
    });
    this.discoveryFallback.htmlSitemap = {
      ...this.discoveryFallback.htmlSitemap,
      status: "not_needed",
      reason: "xml_sitemap_accepted",
      attempted: false,
    };
    return true;
  }

  async tryHtmlSitemapFallback(pageUrl) {
    if (this.discoveryFallback.htmlSitemap.status !== "not_evaluated") {
      return;
    }

    if (this.options.maxDepth < 1) {
      this.discoveryFallback.htmlSitemap = {
        ...this.discoveryFallback.htmlSitemap,
        status: "skipped",
        reason: "max_depth",
      };
      return;
    }

    if (this.queuedPageKeys.size >= this.options.maxPages) {
      this.discoveryFallback.htmlSitemap = {
        ...this.discoveryFallback.htmlSitemap,
        status: "skipped",
        reason: "max_pages",
      };
      return;
    }

    const candidates = buildHtmlSitemapFallbackCandidates(pageUrl, this.startOrigin);
    this.discoveryFallback.htmlSitemap = {
      ...this.discoveryFallback.htmlSitemap,
      status: "attempted",
      reason: "empty_initial_frontier",
      attempted: true,
      candidateLimit: HTML_SITEMAP_FALLBACK_CANDIDATE_LIMIT,
    };

    for (const candidate of candidates) {
      if (this.discoveryFallback.htmlSitemap.candidatesTried >= HTML_SITEMAP_FALLBACK_CANDIDATE_LIMIT) {
        break;
      }

      this.discoveryFallback.htmlSitemap.candidatesTried += 1;
      const result = await this.checkUrl(candidate, { requireBody: true });
      if (!result.ok || !isHtml(result.contentType) || !result.body) {
        this.discardHtmlSitemapProbe(candidate);
        continue;
      }
      if (result.finalUrl && !this.isCrawlOrigin(result.finalUrl)) {
        this.discardHtmlSitemapProbe(candidate);
        continue;
      }

      const usefulLinks = this.findUsefulHtmlSitemapLinks(result.body, result.finalUrl || candidate);
      if (usefulLinks.length === 0) {
        this.discardHtmlSitemapProbe(candidate);
        continue;
      }

      const source = {
        page: this.startUrl,
        tag: "html-sitemap-fallback",
        attribute: "candidate",
        text: candidate,
        sourceType: "html_sitemap_fallback",
      };
      const link = {
        value: candidate,
        tag: "html-sitemap-fallback",
        attribute: "candidate",
        sourceType: "html_sitemap_fallback",
      };
      this.addSource(candidate, source);
      this.addInventoryItem(candidate, source, link, {
        isExternal: false,
        shouldCheck: true,
        shouldCrawl: true,
        needsStatusCheck: true,
        needsBodyFetch: true,
      });
      if (this.enqueuePage(candidate, 1)) {
        this.discoveryFallback.htmlSitemap = {
          ...this.discoveryFallback.htmlSitemap,
          status: "accepted",
          accepted: true,
          acceptedUrl: candidate,
          linksDiscovered: usefulLinks.length,
        };
        return;
      }
    }

    this.discoveryFallback.htmlSitemap = {
      ...this.discoveryFallback.htmlSitemap,
      status: "not_found",
      reason: "no_useful_candidate",
    };
  }

  discardHtmlSitemapProbe(url) {
    const key = this.getCanonicalKey(url);
    this.results.delete(key);
    this.bodyCache.delete(key);
    this.statusCache.delete(key);
  }

  findUsefulHtmlSitemapLinks(body, pageUrl) {
    const { pageBaseUrl, links } = this.extractPageLinks(body, pageUrl);
    const useful = new Set();
    for (const link of links) {
      const resolved = resolveHttpUrl(link.value, pageBaseUrl);
      if (!resolved || !this.isCrawlOrigin(resolved)) {
        continue;
      }
      if (!PAGE_NAVIGATION_TAGS.has(link.tag) && !isPayloadLink(link)) {
        continue;
      }
      if (!looksLikePage(resolved)) {
        continue;
      }
      const canonical = this.getCanonicalKey(resolved);
      const pageKey = this.getPageKey(resolved);
      if (this.inventory.has(canonical) || this.queuedPageKeys.has(pageKey) || this.crawledPageKeys.has(pageKey)) {
        continue;
      }
      useful.add(canonical);
    }
    return [...useful];
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
    const pageKey = this.getPageKey(url);
    if (this.queuedPageKeys.has(pageKey) || this.crawledPageKeys.has(pageKey)) {
      return false;
    }
    if (!looksLikePage(url)) {
      return false;
    }

    if (this.queuedPageKeys.size >= this.options.maxPages) {
      this.pageBudgetStopEvidence = true;
      return false;
    }

    return true;
  }

  shouldExtractFrameworkLinks(spaDetection) {
    if (this.options.spaLinks === "off") {
      return false;
    }
    if (this.options.spaLinks === "strict") {
      return true;
    }
    return Boolean(spaDetection?.detected || hasSiteLinkRules(this.siteLinkRules));
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
    const pageKey = this.getPageKey(url);
    if (this.queuedPageKeys.has(pageKey) || this.crawledPageKeys.has(pageKey)) {
      return false;
    }
    if (this.queuedPageKeys.size >= this.options.maxPages) {
      this.pageBudgetStopEvidence = true;
      return false;
    }

    this.queuedPages.add(url);
    this.queuedPageKeys.add(pageKey);
    this.pageQueue.push({ url, depth });
    this.reporter?.pageQueued(url, depth);
    return true;
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

  getPageKey(url) {
    return this.getCanonicalKey(url);
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
      const linkType = classification?.type || classifyLinkType(link, getPathExtension(new URL(resolvedUrl).pathname));
      this.inventory.set(canonicalUrl, {
        canonicalUrl,
        originalUrls: [],
        resolvedUrls: [],
        representativeUrl: resolvedUrl,
        sources: [],
        isExternal: intent.isExternal,
        linkType,
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
        incremental: this.classifyIncrementalInventoryItem(canonicalUrl),
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

  enqueueValidation(inventoryEntry, url, options, { deferPump = false } = {}) {
    const priority = getValidationPriority(inventoryEntry.item, url) + this.getIncrementalPriorityBoost(inventoryEntry.item);
    this.validationQueue.push({ inventoryEntry, url, options, priority });
    this.validationQueue.sort((left, right) => right.priority - left.priority);
    if (!deferPump) {
      this.pumpValidationQueue();
    }
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
      const incrementalReused = this.readIncrementalReusableResult(url);
      const cached = incrementalReused || await this.readPersistentCachedResult(url);
      if (cached) {
        this.setResultForUrl(url, cached);
        this.statusCache.set(key, Promise.resolve(cached));
      } else {
        this.statusCache.set(key, this.fetchStatusWithPersistentCache(url));
      }
    }
    return this.statusCache.get(key);
  }

  async fetchStatusWithPersistentCache(url) {
    const result = await this.fetchWithCache(url, false);
    await this.writePersistentCachedResult(url, result);
    return result;
  }

  async ensurePersistentCacheLoaded() {
    if (!this.options.cache) {
      return null;
    }
    if (this.persistentCache) {
      return this.persistentCache;
    }
    if (this.persistentCacheLoadPromise) {
      return this.persistentCacheLoadPromise;
    }

    this.persistentCacheLoadPromise = (async () => {
      try {
        const text = await readFile(this.options.cacheFile, "utf8");
        const parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
        this.persistentCache = normalizePersistentCache(parsed);
      } catch (error) {
        if (error.code !== "ENOENT") {
          this.persistentCacheStats.errors += 1;
        }
        this.persistentCache = createEmptyPersistentCache();
      }
      return this.persistentCache;
    })();
    return this.persistentCacheLoadPromise;
  }

  async readPersistentCachedResult(url) {
    if (!this.options.cache) {
      return null;
    }
    if (this.options.refreshCache) {
      this.persistentCacheStats.refreshed += 1;
      return null;
    }

    const cache = await this.ensurePersistentCacheLoaded();
    const cacheKey = this.buildPersistentCacheKey(url).key;
    const entry = cache.entries[cacheKey];
    if (!entry) {
      this.persistentCacheStats.misses += 1;
      return null;
    }
    if (isPersistentCacheEntryExpired(entry)) {
      delete cache.entries[cacheKey];
      this.persistentCacheStats.expired += 1;
      return null;
    }

    this.persistentCacheStats.hits += 1;
    const result = {
      ...entry.result,
      url,
      canonicalUrl: this.getCanonicalKey(url),
      checkedAt: entry.checkedAt || entry.result?.checkedAt || new Date().toISOString(),
      cache: {
        hit: true,
        key: entry.key,
        checkedAt: entry.checkedAt || null,
        expiresAt: entry.expiresAt || null,
        ttlCategory: entry.ttlCategory || null,
      },
    };
    return stripBody(result);
  }

  async writePersistentCachedResult(url, result) {
    if (!this.options.cache) {
      return;
    }
    const ttl = getPersistentCacheTtlMs(result, this.options);
    if (!Number.isFinite(ttl) || ttl <= 0) {
      this.persistentCacheStats.bypassed += 1;
      return;
    }

    const cache = await this.ensurePersistentCacheLoaded();
    const cacheEntry = this.buildPersistentCacheEntry(url, result, ttl);
    cache.entries[cacheEntry.key] = cacheEntry;
    pruneExpiredPersistentCacheEntries(cache);
    this.persistentCacheStats.written += 1;
    this.persistentCacheWritePromise = this.persistentCacheWritePromise
      .catch(() => {})
      .then(() => this.savePersistentCache());
    await this.persistentCacheWritePromise;
  }

  async savePersistentCache() {
    if (!this.options.cache || !this.persistentCache) {
      return;
    }
    this.persistentCache.updatedAt = new Date().toISOString();
    try {
      await mkdir(dirname(this.options.cacheFile), { recursive: true });
      await writeFile(this.options.cacheFile, `${JSON.stringify(this.persistentCache, null, 2)}\n`, "utf8");
    } catch {
      this.persistentCacheStats.errors += 1;
    }
  }

  buildPersistentCacheEntry(url, result, ttlMs) {
    const checkedAt = result.checkedAt || new Date().toISOString();
    const keyData = this.buildPersistentCacheKey(url);
    const stripped = stripBody(result);
    const storedResult = redactCacheStoredResult(stripped, this.options);
    const finalUrl = result.finalUrl || url;
    return {
      key: keyData.key,
      canonicalUrlHash: keyData.keyParts.canonicalUrlHash,
      displayUrl: redactSensitiveQueryValue(url, { ...this.options, redactSensitiveQuery: true }),
      keyParts: keyData.keyParts,
      checkedAt,
      expiresAt: new Date(Date.parse(checkedAt) + ttlMs).toISOString(),
      ttlCategory: getPersistentCacheTtlCategory(result),
      lastStatus: result.status ?? null,
      lastFinalUrlHash: hashLabel(finalUrl),
      result: storedResult,
    };
  }

  buildPersistentCacheKey(url) {
    const referer = this.getRequestReferer(url);
    const keyParts = {
      canonicalUrlHash: hashLabel(this.getCanonicalKey(url)),
      canonicalStrategy: this.options.canonicalStrategy,
      methodPolicy: this.getStatusMethodPolicy(url),
      userAgentHash: hashLabel(this.options.userAgent),
      acceptLanguage: this.options.acceptLanguage,
      refererMode: getRefererMode(url, referer),
      refererHash: referer ? hashLabel(referer) : null,
      checkExternal: this.options.checkExternal,
      robotsPolicy: {
        mode: this.scanPolicy?.robotsTxt?.mode || "unknown",
        status: this.scanPolicy?.robotsTxt?.status || "unknown",
      },
      securityPolicy: {
        blockPrivateIp: this.options.blockPrivateIp,
        allowLocalhost: this.options.allowLocalhost,
        allowPrivateIp: this.options.allowPrivateIp,
      },
      requestPolicy: {
        maxRedirects: this.options.maxRedirects,
        longRedirectThreshold: this.options.longRedirectThreshold,
        legacyTls: this.options.legacyTls,
        systemCa: this.options.systemCa,
      },
    };
    return {
      key: hashLabel(stableStringify(keyParts)),
      keyParts,
    };
  }

  async fetchWithCache(url, requireBody) {
    this.reporter?.requestQueued(url, requireBody || this.options.preferGet ? "GET" : "HEAD");
    const referer = this.getRequestReferer(url);
    const result = await fetchUrl(url, this.makeFetchOptions({
      requireBody,
      referer,
      adaptiveHeadGetEligible: this.isAdaptiveHeadGetEligible(url, {
        requireBody,
        forceGet: false,
        preferGet: this.options.preferGet,
      }),
    }));

    if (isStopCancelledResult(result)) {
      return result;
    }

    if (this.shouldConfirmWithHomepageFallback(url, result, requireBody)) {
      const homepageFallback = await this.confirmWithHomepageFallback(url);
      if (isStopCancelledResult(homepageFallback)) {
        return homepageFallback;
      }
      if (homepageFallback.ok) {
        this.setResultForUrl(url, homepageFallback);
        this.reporter?.requestFinished(homepageFallback);
        return homepageFallback;
      }
    }

    if (this.shouldConfirmWithSourceGet(url, result)) {
      const confirmed = await this.confirmWithSourceGet(url);
      if (isStopCancelledResult(confirmed)) {
        return confirmed;
      }
      if (confirmed.ok) {
        this.setResultForUrl(url, confirmed);
        this.reporter?.requestFinished(confirmed);
        return confirmed;
      }
    }

    if (!result.ok && result.status === 404) {
      const fallbackResult = await this.confirmWithFallbackUrls(url, result);
      if (isStopCancelledResult(fallbackResult)) {
        return fallbackResult;
      }
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
      const fallbackResult = await fetchUrl(fallbackUrl, this.makeFetchOptions({
        requireBody: true,
        forceGet: true,
        referer: url,
      }));

      if (isStopCancelledResult(fallbackResult)) {
        return fallbackResult;
      }

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
      && !hasEquivalentAdaptiveSourceGet(result, sources, url)
      && sources.some((source) => sameOrigin(source.page, url));
  }

  getStatusMethodPolicy(url) {
    if (this.options.preferGet) {
      return "GET";
    }
    if (this.isAdaptiveHeadGetEligible(url, {
      requireBody: false,
      forceGet: false,
      preferGet: false,
    })) {
      return "HEAD_ADAPTIVE_GET_V1";
    }
    return "HEAD";
  }

  isAdaptiveHeadGetEligible(url, { requireBody = false, forceGet = false, preferGet = false } = {}) {
    if (requireBody || forceGet || preferGet) {
      return false;
    }
    if (!this.isCrawlOrigin(url)) {
      return false;
    }
    const kind = classifyUrlKind(url, { isExternal: false });
    return kind.page === true && kind.content === true;
  }

  async confirmWithSourceGet(url) {
    for (const source of this.getSourcesForUrl(url)) {
      if (!sameOrigin(source.page, url)) {
        continue;
      }

      const result = await fetchUrl(url, this.makeFetchOptions({
        requireBody: false,
        forceGet: true,
        retryCount: 0,
        referer: source.page,
      }));
      if (isStopCancelledResult(result)) {
        return result;
      }
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
        const fallbackResult = await fetchUrl(fallbackUrl, this.makeFetchOptions({
          requireBody: false,
          forceGet: true,
          retryCount: 0,
          referer,
        }));
        if (isStopCancelledResult(fallbackResult)) {
          return fallbackResult;
        }
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
        clientRedirectEvidence: createClientRedirectEvidence(enabled ? "not_candidate" : "disabled"),
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
          clientRedirectEvidence: createClientRedirectEvidence("not_checked"),
          reason: "per_host_limit",
        };
        result.needsReview = true;
        continue;
      }
      if (candidates.length >= this.options.confirmationMaxUrls) {
        result.confirmation = {
          ...result.confirmation,
          candidate: true,
          clientRedirectEvidence: createClientRedirectEvidence("not_checked"),
          reason: "global_limit",
        };
        result.needsReview = true;
        continue;
      }

      hostCounts.set(host, hostCount + 1);
      result.confirmation = {
        ...result.confirmation,
        candidate: true,
        clientRedirectEvidence: createClientRedirectEvidence("not_checked"),
        reason: "queued",
      };
      candidates.push(result);
    }

    return candidates;
  }

  isNotFoundConfirmationCandidate(result) {
    return !this.stopped
      && isConfirmableMissingResult(result)
      && this.isCrawlOrigin(result.url)
      && !hasMeaningfulProtectionEvidence(result);
  }

  async confirmNotFoundResult(result) {
    if (this.stopped) {
      result.confirmation = {
        ...result.confirmation,
        checked: false,
        outcome: "needs_review",
        clientRedirectEvidence: createClientRedirectEvidence("stopped"),
        reason: "stopped",
      };
      result.needsReview = true;
      return;
    }

    const referer = this.getConfirmationReferer(result.url);
    const confirmed = await fetchUrl(result.url, this.makeFetchOptions({
      requireBody: false,
      forceGet: true,
      retryCount: 0,
      userAgent: BROWSER_USER_AGENT,
      referer,
      preferGet: true,
    }, this.confirmationScheduler));

    if (isStopCancelledResult(confirmed)) {
      result.confirmation = {
        ...result.confirmation,
        checked: false,
        outcome: "needs_review",
        clientRedirectEvidence: createClientRedirectEvidence("stopped"),
        reason: "stopped",
      };
      result.needsReview = true;
      return;
    }

    const outcome = getConfirmationOutcome(confirmed);
    const clientRedirectEvidence = await this.buildClientRedirectEvidence(result, confirmed, referer);
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
      clientRedirectEvidence,
      reason: getConfirmationReason(confirmed),
    };
    result.transientFailure = outcome === "needs_review" && isTransientConfirmationResult(confirmed);
    result.needsReview = outcome === "needs_review";
  }

  async buildClientRedirectEvidence(result, confirmed, referer) {
    const evidence = detectClientRedirectEvidence(confirmed, confirmed.finalUrl || result.url);
    if (!evidence.detected || !evidence.targetUrl) {
      return evidence;
    }
    if (!this.isCrawlOrigin(evidence.targetUrl)) {
      return {
        ...evidence,
        targetChecked: false,
        reason: "target_not_checked_external",
      };
    }

    const target = await fetchUrl(evidence.targetUrl, this.makeFetchOptions({
      requireBody: false,
      forceGet: true,
      retryCount: 0,
      userAgent: BROWSER_USER_AGENT,
      referer: confirmed.finalUrl || result.url || referer,
      preferGet: true,
    }, this.confirmationScheduler));

    if (isStopCancelledResult(target)) {
      return {
        ...evidence,
        targetChecked: false,
        reason: "stopped",
      };
    }

    return {
      ...evidence,
      targetChecked: true,
      targetStatus: target.status ?? null,
      targetOk: target.ok ?? null,
      targetFinalUrl: target.finalUrl || null,
      targetIssueType: target.issueType || null,
      targetCheckedAt: target.checkedAt || null,
      targetElapsedMs: target.elapsedMs ?? null,
      reason: getClientRedirectEvidenceReason(target),
    };
  }

  getConfirmationReferer(url) {
    const source = this.getSourcesForUrl(url).find((item) => sameOrigin(item.page, url));
    return source?.page || null;
  }

  buildReport() {
    const checked = [...this.results.values()]
      .map((result) => ({
        ...result,
        interpretation: buildResultInterpretation(result, { startUrl: this.startUrl }),
      }));
    const externalLinks = this.buildExternalLinks(checked);
    const inventorySummary = this.buildInventorySummary();
    const checkedByKind = this.buildCheckedByKind(checked);
    const spaDetection = this.buildSpaDetectionSummary();
    const startPageFetchFailed = this.hasStartPageDiscoveryInputFailure();
    const scanQuality = this.buildScanQuality(checked, spaDetection, checkedByKind, { startPageFetchFailed });
    const runStatus = this.buildRunStatus();
    const broken = checked
      .filter((result) => !result.ok)
      .map((result) => {
        const sourceProjection = projectSourcesForOutput(this.getSourcesForResult(result), this.options.maxSourcesPerUrl);
        return {
          ...result,
          sourceCount: sourceProjection.sourceCount,
          sourcesTruncated: sourceProjection.sourcesTruncated,
          sources: sourceProjection.sources,
        };
      })
      .sort((a, b) => a.url.localeCompare(b.url));
    const reportOptions = {
      maxPages: this.options.maxPages,
      maxDepth: this.options.maxDepth,
      concurrency: this.options.concurrency,
      perHostConcurrency: this.options.perHostConcurrency,
      requestDelayMs: this.options.requestDelayMs,
      requestDelayMinMs: this.options.requestDelayMinMs,
      requestDelayMaxMs: this.options.requestDelayMaxMs,
      retryAfterMaxMs: this.options.retryAfterMaxMs,
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
      redactSensitiveQuery: this.options.redactSensitiveQuery,
      redactQueryKeys: this.options.redactQueryKeys,
      maxHtmlBytes: this.options.maxHtmlBytes,
      maxBodyPreviewBytes: this.options.maxBodyPreviewBytes,
      maxDownloadProbeBytes: this.options.maxDownloadProbeBytes,
      maxSourcesPerUrl: this.options.maxSourcesPerUrl,
      maxRulesBytes: this.options.maxRulesBytes,
      blockPrivateIp: this.options.blockPrivateIp,
      allowLocalhost: this.options.allowLocalhost,
      allowPrivateIp: this.options.allowPrivateIp,
      cache: this.options.cache,
      cacheFile: this.options.cacheFile,
      cacheTtlHours: this.options.cacheTtlHours,
      refreshCache: this.options.refreshCache,
      incremental: this.options.incremental,
      baselineReport: this.options.baselineReport,
      stateFile: this.options.stateFile,
      incrementalStateWrite: this.options.incrementalStateWrite,
      changedOnly: this.options.changedOnly,
      sitemap: this.options.sitemap,
      sitemapMaxUrls: this.options.sitemapMaxUrls,
      robotsTxt: this.options.robotsTxt,
      authorizedScan: this.options.authorizedScan,
      authorizationNote: this.options.authorizationNote,
      protectionBodyHash: this.options.protectionBodyHash,
      keepAlive: this.options.keepAlive,
      maxSockets: this.options.maxSockets,
      maxFreeSockets: this.options.maxFreeSockets,
      keepAliveMsecs: this.options.keepAliveMsecs,
      domainCategoryRulesSource: this.options.domainCategoryRulesSource || null,
      externalRiskRulesSource: this.options.externalRiskRulesSource || null,
      siteLinkRulesSource: this.options.siteLinkRulesSource || null,
    };
    const summary = {
      pagesCrawled: this.crawledPageKeys.size,
      urlsChecked: checked.length,
      brokenLinks: broken.length,
      brokenByType: countBrokenByType(broken),
      interpretationByCategory: countInterpretationByCategory(checked),
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
      pagesChecked: checkedByKind.pages,
      contentLinksChecked: checkedByKind.content,
      externalLinksChecked: checkedByKind.external,
      documentsChecked: checkedByKind.documents,
      mediaLinksChecked: checkedByKind.media,
      assetsChecked: checkedByKind.assets,
      nuxtAssetsChecked: checkedByKind.nuxtAssets,
      checkedByKind,
      inventorySummary,
      discoveryFallback: this.discoveryFallback,
      cache: this.buildCacheSummary(),
      incremental: this.buildIncrementalSummary(),
      spaDetection,
      scanQuality,
      robotsTxt: this.robotsTxt,
      hostDiagnostics: this.buildHostDiagnostics(checked),
    };
    summary.coverage = deriveCoverageStatus({
      runStatus,
      summary,
      options: reportOptions,
      startPageFetchFailed,
      pageBudgetStopEvidence: this.pageBudgetStopEvidence,
    });

    const report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      generator: buildReportGenerator(),
      startedAt: runStatus.startedAt,
      completedAt: runStatus.completedAt,
      runStatus,
      startUrl: this.startUrl,
      rulesTrace: this.rulesTrace,
      options: reportOptions,
      securityPolicy: this.securityPolicy,
      scanPolicy: this.scanPolicy,
      compliance: this.compliance,
      summary,
      broken,
      checked,
      externalLinks,
    };
    return redactReportForOutput(report, this.options);
  }

  buildRunStatus() {
    const completedAt = new Date().toISOString();
    const startedAt = this.runStartedAt || completedAt;
    const status = this.validationError ? "failed" : (this.stopped ? "partial" : "complete");
    const runStatus = {
      status,
      startedAt,
      completedAt,
      stoppedByUser: status === "partial" && this.stoppedByUser,
      pendingPages: this.pageQueue.length,
      pendingValidations: this.validationQueue.length,
      activeValidationTasks: this.activeValidationTasks,
    };

    if (this.stopReason) {
      runStatus.stopReason = this.stopReason;
    }
    if (this.validationError) {
      runStatus.failureReason = this.validationError.message || String(this.validationError);
    }

    return runStatus;
  }

  buildCacheSummary() {
    return {
      ...this.persistentCacheStats,
      policyVersion: CACHE_POLICY_VERSION,
      cacheSchemaVersion: CACHE_SCHEMA_VERSION,
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

  buildCheckedByKind(checked) {
    const counts = createCheckedKindCounts();
    for (const result of checked) {
      const kind = classifyCheckedResultKind(result, this.getSourcesForResult(result));
      incrementCheckedKindCounts(counts, kind);
    }
    return counts;
  }

  hasStartPageDiscoveryInputFailure() {
    return isStartPageDiscoveryInputFailure(this.results.get(this.getCanonicalKey(this.startUrl)));
  }

  buildScanQuality(checked, spaDetection, checkedByKind = this.buildCheckedByKind(checked), {
    startPageFetchFailed = this.hasStartPageDiscoveryInputFailure(),
  } = {}) {
    const checkedUrls = checked.map((result) => result.url || "");
    const assetUrls = checkedByKind.assets;
    const nuxtAssetUrls = checkedByKind.nuxtAssets;
    const assetRatio = checkedUrls.length > 0 ? assetUrls / checkedUrls.length : 0;
    const nuxtAssetRatio = checkedUrls.length > 0 ? nuxtAssetUrls / checkedUrls.length : 0;
    const warnings = [];

    if (nuxtAssetRatio > 0.7) {
      warnings.push("nuxt_asset_dominant_scan");
    } else if (assetRatio > 0.7) {
      warnings.push("asset_dominant_scan");
    }
    if (this.crawledPageKeys.size <= 1 && (spaDetection?.stats?.urlLiteralCount || 0) >= 10) {
      warnings.push("low_page_count_with_many_url_literals");
    }
    if (spaDetection?.detected && this.options.spaLinks === "off") {
      warnings.push("spa_links_disabled");
    }
    if (startPageFetchFailed) {
      warnings.push("start_page_fetch_failed");
    }

    return {
      status: warnings.length > 0 ? "suspicious" : "ok",
      warnings,
      checkedUrls: checkedUrls.length,
      assetUrls,
      assetRatio: Number(assetRatio.toFixed(4)),
      nuxtAssetUrls,
      nuxtAssetRatio: Number(nuxtAssetRatio.toFixed(4)),
    };
  }

  buildHostDiagnostics(checked) {
    const hosts = new Map();
    const ensureHost = (host) => {
      const key = host || "unknown";
      if (!hosts.has(key)) {
        hosts.set(key, {
          host: key,
          urlsChecked: 0,
          ok: 0,
          httpErrors: 0,
          accessDenied: 0,
          rateLimited: 0,
          protected: 0,
          suspectedWaf: 0,
          suspectedBot: 0,
          retryAfterResponses: 0,
          retryAfterCooldowns: 0,
          retryAfterCooldownMs: 0,
          maxRetryAfterWaitMs: 0,
          warningCodes: new Set(),
        });
      }
      return hosts.get(key);
    };

    for (const result of checked) {
      const host = getResultHost(result);
      const item = ensureHost(host);
      item.urlsChecked += 1;
      if (result.ok) {
        item.ok += 1;
      }
      if (!result.ok && result.status >= 400) {
        item.httpErrors += 1;
      }
      if (result.status === 403 || result.classification === "access_denied" || result.issueType === "access_denied") {
        item.accessDenied += 1;
      }
      if (result.status === 429) {
        item.rateLimited += 1;
      }
      if (result.classification === "protected") {
        item.protected += 1;
      }
      if (result.suspectedWaf) {
        item.suspectedWaf += 1;
      }
      if (result.suspectedBot) {
        item.suspectedBot += 1;
      }
      if (result.retryAfter) {
        item.retryAfterResponses += 1;
        item.maxRetryAfterWaitMs = Math.max(item.maxRetryAfterWaitMs, result.retryAfter.waitMs || 0);
      }
    }

    for (const event of this.retryAfterEvents) {
      const item = ensureHost(event.host);
      item.retryAfterCooldowns += 1;
      item.retryAfterCooldownMs += event.cooldownMs || 0;
      item.maxRetryAfterWaitMs = Math.max(item.maxRetryAfterWaitMs, event.waitMs || 0);
    }

    const hostItems = [...hosts.values()].map((item) => {
      const blockCount = item.accessDenied + item.rateLimited + item.protected + item.suspectedWaf + item.suspectedBot;
      const blockRate = item.urlsChecked > 0 ? blockCount / item.urlsChecked : 0;
      if (item.rateLimited > 0 || item.retryAfterCooldowns > 0) {
        item.warningCodes.add("rate_limited_host");
      }
      if (item.urlsChecked >= 3 && blockRate >= 0.5) {
        item.warningCodes.add("high_block_rate");
      }
      if (item.suspectedWaf > 0 || item.protected > 0) {
        item.warningCodes.add("suspected_waf_or_bot");
      }

      return {
        host: item.host,
        urlsChecked: item.urlsChecked,
        ok: item.ok,
        httpErrors: item.httpErrors,
        accessDenied: item.accessDenied,
        rateLimited: item.rateLimited,
        protected: item.protected,
        suspectedWaf: item.suspectedWaf,
        suspectedBot: item.suspectedBot,
        blockRate: Number(blockRate.toFixed(4)),
        retryAfterResponses: item.retryAfterResponses,
        retryAfterCooldowns: item.retryAfterCooldowns,
        retryAfterCooldownMs: item.retryAfterCooldownMs,
        maxRetryAfterWaitMs: item.maxRetryAfterWaitMs,
        warnings: [...item.warningCodes].sort(),
      };
    }).sort((a, b) => (
      b.warnings.length - a.warnings.length
      || b.blockRate - a.blockRate
      || b.urlsChecked - a.urlsChecked
      || a.host.localeCompare(b.host)
    ));

    const warnings = [...new Set(hostItems.flatMap((item) => item.warnings))].sort();
    return {
      status: warnings.length > 0 ? "warning" : "ok",
      warnings,
      retryAfterMaxMs: this.options.retryAfterMaxMs,
      hosts: hostItems,
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
        const sourceProjection = projectSourcesForOutput(item.sources, this.options.maxSourcesPerUrl);
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
          sourcesTruncated: sourceProjection.sourcesTruncated,
          sources: sourceProjection.sources,
        };
      })
      .sort((a, b) => a.url.localeCompare(b.url));
  }
}

function buildReportGenerator() {
  return {
    name: "link-checker.mjs",
    version: TOOL_VERSION,
  };
}

function getOptionsProfile(options = {}) {
  return options.conservativeMode ? "conservative" : "normal";
}

function getRuntimeVersion() {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function buildOutputManifest({
  generatedAt = new Date().toISOString(),
  startUrl,
  options = {},
  generatedFiles,
} = {}) {
  const connectionOptions = normalizeConnectionOptions(options);
  return {
    toolVersion: TOOL_VERSION,
    schemaVersions: {
      report: REPORT_SCHEMA_VERSION,
    },
    generatedAt,
    startUrl: redactSensitiveQueryValue(startUrl || null, options),
    optionsProfile: getOptionsProfile(options),
    runtimeVersion: getRuntimeVersion(),
    connection: connectionOptions,
    generatedFiles: (generatedFiles || []).map((file) => ({
      path: file.path,
      kind: file.kind,
      schemaVersion: file.schemaVersion || null,
    })),
  };
}

function normalizeRedactQueryKeys(value) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return [...new Set(values
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean))]
    .sort();
}

function normalizeByteLimit(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.min(number, 512 * 1024 * 1024);
}

function normalizeIntegerLimit(value, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }
  return Math.min(number, 100000);
}

function normalizeCacheFile(value) {
  const text = String(value || DEFAULT_CACHE_FILE).trim();
  return text || DEFAULT_CACHE_FILE;
}

function normalizeOptionalPath(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeCacheTtlHours(value) {
  const number = Number(value ?? DEFAULT_CACHE_TTL_HOURS);
  if (!Number.isFinite(number) || number <= 0) {
    return DEFAULT_CACHE_TTL_HOURS;
  }
  return Math.min(number, 24 * 365);
}

function normalizeRetryAfterMaxMs(value) {
  const number = Number.parseInt(value ?? DEFAULTS.retryAfterMaxMs, 10);
  if (!Number.isFinite(number) || number < 0) {
    return DEFAULTS.retryAfterMaxMs;
  }
  return Math.min(number, 300000);
}

function normalizeSitemapMaxUrls(value) {
  const number = Number.parseInt(value ?? DEFAULT_SITEMAP_MAX_URLS, 10);
  if (!Number.isFinite(number) || number < 1) {
    return DEFAULT_SITEMAP_MAX_URLS;
  }
  return Math.min(number, DEFAULT_SITEMAP_MAX_URLS);
}

function normalizeSitemapIndexMaxChildren(value) {
  const number = Number.parseInt(value ?? DEFAULT_SITEMAP_INDEX_MAX_CHILDREN, 10);
  if (!Number.isFinite(number) || number < 1) {
    return DEFAULT_SITEMAP_INDEX_MAX_CHILDREN;
  }
  return Math.min(number, DEFAULT_SITEMAP_INDEX_MAX_CHILDREN);
}

function buildInitialSitemapSummary(options = DEFAULTS) {
  return {
    enabled: Boolean(options.sitemap),
    source: options.sitemap ? redactSensitiveQueryValue(options.sitemap, options) : null,
    sourceType: options.sitemap ? getSitemapSourceType(options.sitemap) : null,
    status: options.sitemap ? "not_loaded" : "not_configured",
    type: null,
    urlCount: 0,
    lastmodCount: 0,
    indexChildCount: 0,
    fetchedChildCount: 0,
    maxUrls: normalizeSitemapMaxUrls(options.sitemapMaxUrls),
    truncated: false,
    bodyTruncated: false,
    sampleUrls: [],
    warnings: [],
    error: null,
  };
}

function createEmptySitemapSeedSummary(options = DEFAULTS) {
  return {
    enabled: Boolean(options.sitemap),
    depth: 1,
    attempted: 0,
    seeded: 0,
    ignored: 0,
    ignoredByReason: {},
  };
}

function createInitialDiscoveryFallbackSummary() {
  return {
    xmlSitemap: {
      status: "not_evaluated",
      reason: null,
      attempted: false,
      candidateLimit: XML_SITEMAP_FALLBACK_CANDIDATE_LIMIT,
      candidatesTried: 0,
      accepted: false,
      acceptedUrl: null,
      sitemapType: null,
      urlsDiscovered: 0,
      urlsSeeded: 0,
    },
    htmlSitemap: {
      status: "not_evaluated",
      reason: null,
      attempted: false,
      candidateLimit: HTML_SITEMAP_FALLBACK_CANDIDATE_LIMIT,
      candidatesTried: 0,
      accepted: false,
      acceptedUrl: null,
      linksDiscovered: 0,
    },
  };
}

function recordSitemapSeedIgnored(summary, reason) {
  summary.ignored += 1;
  summary.ignoredByReason[reason] = (summary.ignoredByReason[reason] || 0) + 1;
}

function buildLoadedSitemapSummary(loaded, options = DEFAULTS) {
  const redactionOptions = { ...options, redactSensitiveQuery: true };
  return {
    enabled: true,
    source: redactSensitiveQueryValue(loaded.source, redactionOptions),
    sourceType: loaded.sourceType,
    status: "ok",
    type: loaded.type,
    urlCount: loaded.entries.length,
    lastmodCount: loaded.entries.filter((entry) => entry.lastmod).length,
    indexChildCount: loaded.indexChildCount,
    fetchedChildCount: loaded.fetchedChildCount,
    maxUrls: normalizeSitemapMaxUrls(options.sitemapMaxUrls),
    truncated: loaded.truncated,
    bodyTruncated: loaded.bodyTruncated,
    sampleUrls: loaded.entries.slice(0, DEFAULT_SITEMAP_SAMPLE_URLS).map((entry) => ({
      url: redactSensitiveQueryValue(entry.url, redactionOptions),
      lastmod: entry.lastmod || null,
    })),
    warnings: loaded.warnings,
    error: null,
  };
}

function buildSitemapErrorSummary(source, error, options = DEFAULTS) {
  return {
    ...buildInitialSitemapSummary({ ...options, sitemap: source }),
    status: "error",
    error: error.message || String(error),
  };
}

function getSitemapSourceType(source) {
  if (/^https?:\/\//i.test(source)) {
    return "url";
  }
  if (/^file:\/\//i.test(source)) {
    return "file_url";
  }
  return "file";
}

function buildSitemapEntryHashMap(entries = [], checker) {
  const map = new Map();
  for (const entry of entries) {
    if (!entry?.url) {
      continue;
    }
    let canonicalUrl;
    try {
      canonicalUrl = checker.getCanonicalKey(entry.url);
    } catch {
      continue;
    }
    for (const key of getIncrementalCanonicalHashCandidates(canonicalUrl, checker.options)) {
      if (!map.has(key)) {
        map.set(key, {
          ...entry,
          canonicalUrlHash: key,
        });
      }
    }
  }
  return map;
}

function findSitemapEntry(map, hashCandidates = []) {
  for (const key of hashCandidates) {
    const entry = map.get(key);
    if (entry) {
      return entry;
    }
  }
  return null;
}

function compareSitemapLastmod(current, previous) {
  const currentMs = Date.parse(current || "");
  const previousMs = Date.parse(previous || "");
  if (Number.isFinite(currentMs) && Number.isFinite(previousMs)) {
    return Math.sign(currentMs - previousMs);
  }
  return String(current || "").localeCompare(String(previous || ""));
}

async function loadSitemapTree(source, checker, {
  rootSourceValidator = null,
  childSourceValidator = null,
} = {}) {
  const options = checker.options;
  const maxUrls = normalizeSitemapMaxUrls(options.sitemapMaxUrls);
  const maxIndexChildren = normalizeSitemapIndexMaxChildren(options.sitemapIndexMaxChildren);
  const root = await readSitemapSource(source, checker);
  if (rootSourceValidator && !rootSourceValidator(root)) {
    const error = new Error("Sitemap redirect left the crawl-origin boundary");
    error.code = "sitemap_redirect_outside_crawl_origin";
    throw error;
  }
  const parsed = parseSitemapXml(root.text, {
    maxUrls,
    maxIndexChildren,
  });
  const warnings = [...root.warnings, ...parsed.warnings];
  const entries = [];
  let fetchedChildCount = 0;
  let bodyTruncated = root.bodyTruncated;

  if (parsed.type !== "sitemapindex") {
    entries.push(...parsed.entries.slice(0, maxUrls));
    return {
      source,
      sourceType: root.sourceType,
      finalUrl: root.finalUrl,
      type: parsed.type,
      entries,
      indexChildCount: 0,
      fetchedChildCount,
      truncated: parsed.truncated,
      bodyTruncated,
      warnings,
    };
  }

  for (const child of parsed.indexEntries.slice(0, maxIndexChildren)) {
    if (entries.length >= maxUrls) {
      break;
    }
    const childIgnoreReason = getSitemapChildIgnoreReason(child.url, root.sourceType, checker.startOrigin);
    if (childIgnoreReason) {
      warnings.push({
        code: childIgnoreReason.code,
        message: `${childIgnoreReason.message}: ${redactSensitiveQueryValue(child.url, options)}.`,
      });
      continue;
    }
    try {
      const childSource = await readSitemapSource(child.url, checker);
      if (childSourceValidator && !childSourceValidator(childSource)) {
        warnings.push({
          code: "sitemap_child_redirect_outside_crawl_origin",
          message: `Ignored sitemap child redirected outside the crawl-origin boundary: ${redactSensitiveQueryValue(childSource.finalUrl || child.url, options)}.`,
        });
        continue;
      }
      bodyTruncated = bodyTruncated || childSource.bodyTruncated;
      const childParsed = parseSitemapXml(childSource.text, {
        maxUrls: maxUrls - entries.length,
        maxIndexChildren,
      });
      warnings.push(...childSource.warnings, ...childParsed.warnings.map((warning) => ({
        ...warning,
        message: `Child sitemap ${redactSensitiveQueryValue(child.url, options)}: ${warning.message}`,
      })));
      if (childParsed.type === "urlset") {
        entries.push(...childParsed.entries);
        fetchedChildCount += 1;
      } else {
        warnings.push({
          code: "nested_sitemap_index_ignored",
          message: `Nested sitemap index ignored: ${redactSensitiveQueryValue(child.url, options)}.`,
        });
      }
    } catch (error) {
      warnings.push({
        code: "sitemap_child_read_failed",
        message: `Unable to read sitemap child ${redactSensitiveQueryValue(child.url, options)}: ${error.message || String(error)}`,
      });
    }
  }

  return {
    source,
    sourceType: root.sourceType,
    finalUrl: root.finalUrl,
    type: parsed.type,
    entries,
    indexChildCount: parsed.indexEntries.length,
    fetchedChildCount,
    truncated: parsed.truncated || entries.length >= maxUrls,
    bodyTruncated,
    warnings,
  };
}

async function readSitemapSource(source, checker) {
  const sourceType = getSitemapSourceType(source);
  const warnings = [];
  const maxBytes = checker.options.maxHtmlBytes;
  if (sourceType === "url") {
    const result = await fetchUrl(source, checker.makeFetchOptions({
      requireBody: true,
      forceGet: true,
      retryCount: 0,
      referer: checker.startUrl,
      preferGet: true,
      maxHtmlBytes: maxBytes,
    }));
    if (isStopCancelledResult(result)) {
      throw createStopAbortError(checker.stopReason || "stopped_by_user");
    }
    if (!result.ok) {
      throw new Error(`Sitemap URL returned ${result.status || result.issueType || "error"}`);
    }
    return {
      source,
      sourceType,
      finalUrl: result.finalUrl || source,
      text: result.body || "",
      bodyTruncated: result.bodyTruncated === true,
      warnings,
    };
  }

  const filePath = sourceType === "file_url" ? fileURLToPath(source) : source;
  const buffer = await readFile(filePath);
  const bodyTruncated = buffer.length > maxBytes;
  if (bodyTruncated) {
    warnings.push({
      code: "sitemap_body_truncated",
      message: `Sitemap file exceeded ${maxBytes} bytes and was truncated.`,
    });
  }
  return {
    source,
    sourceType,
    finalUrl: null,
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    bodyTruncated,
    warnings,
  };
}

function parseSitemapXml(text, { maxUrls, maxIndexChildren }) {
  const xml = String(text || "").replace(/^\uFEFF/, "");
  const warnings = [];
  if (/<(?:[A-Za-z0-9_-]+:)?sitemapindex\b/i.test(xml)) {
    const indexEntries = extractSitemapBlocks(xml, "sitemap")
      .map((block) => ({
        url: extractXmlTag(block, "loc"),
        lastmod: extractXmlTag(block, "lastmod"),
      }))
      .filter((entry) => entry.url);
    const truncated = indexEntries.length > maxIndexChildren;
    if (truncated) {
      warnings.push({
        code: "sitemap_index_children_truncated",
        message: `Sitemap index has ${indexEntries.length} children; only ${maxIndexChildren} will be read.`,
      });
    }
    return {
      type: "sitemapindex",
      entries: [],
      indexEntries,
      truncated,
      warnings,
    };
  }

  if (/<(?:[A-Za-z0-9_-]+:)?urlset\b/i.test(xml)) {
    const allEntries = extractSitemapBlocks(xml, "url")
      .map((block) => ({
        url: extractXmlTag(block, "loc"),
        lastmod: extractXmlTag(block, "lastmod"),
      }))
      .filter((entry) => entry.url);
    const truncated = allEntries.length > maxUrls;
    if (truncated) {
      warnings.push({
        code: "sitemap_urls_truncated",
        message: `Sitemap has ${allEntries.length} URLs; only ${maxUrls} will be recorded.`,
      });
    }
    return {
      type: "urlset",
      entries: allEntries.slice(0, maxUrls),
      indexEntries: [],
      truncated,
      warnings,
    };
  }

  warnings.push({
    code: "sitemap_type_unknown",
    message: "Sitemap XML did not contain a urlset or sitemapindex root.",
  });
  return {
    type: "unknown",
    entries: [],
    indexEntries: [],
    truncated: false,
    warnings,
  };
}

function extractSitemapBlocks(xml, tagName) {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tagName}\\b[\\s\\S]*?<\\/(?:[A-Za-z0-9_-]+:)?${tagName}>`, "gi");
  return xml.match(pattern) || [];
}

function extractXmlTag(xml, tagName) {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${tagName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tagName}>`, "i");
  const match = pattern.exec(xml);
  return match ? decodeXmlText(match[1].trim()) : null;
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function getSitemapChildIgnoreReason(url, rootSourceType, startOrigin) {
  const isHttpUrl = /^https?:\/\//i.test(url);
  if (rootSourceType === "url" && !isHttpUrl) {
    return {
      code: "unsupported_remote_sitemap_child_ignored",
      message: "Ignored unsupported remote sitemap child",
    };
  }
  if (!isHttpUrl) {
    return null;
  }
  try {
    if (new URL(url).origin !== startOrigin) {
      return {
        code: "cross_origin_sitemap_child_ignored",
        message: "Ignored cross-origin sitemap child",
      };
    }
  } catch {
    return {
      code: "invalid_sitemap_child_ignored",
      message: "Ignored invalid sitemap child",
    };
  }
  return null;
}

function createEmptyIncrementalState(checker) {
  return {
    stateSchemaVersion: INCREMENTAL_STATE_SCHEMA_VERSION,
    policyVersion: INCREMENTAL_POLICY_VERSION,
    generator: buildReportGenerator(),
    startUrl: checker?.startUrl || null,
    startOrigin: checker?.startOrigin || null,
    policyFingerprint: checker?.incremental?.policyFingerprint || null,
    updatedAt: new Date().toISOString(),
    urls: {},
  };
}

function normalizeIncrementalState(value) {
  if (!value || typeof value !== "object") {
    return {
      stateSchemaVersion: INCREMENTAL_STATE_SCHEMA_VERSION,
      policyVersion: INCREMENTAL_POLICY_VERSION,
      policyFingerprint: null,
      urls: {},
    };
  }
  return {
    stateSchemaVersion: value.stateSchemaVersion || INCREMENTAL_STATE_SCHEMA_VERSION,
    policyVersion: value.policyVersion || INCREMENTAL_POLICY_VERSION,
    generator: value.generator || null,
    startUrl: value.startUrl || null,
    startOrigin: value.startOrigin || null,
    policyFingerprint: value.policyFingerprint || null,
    updatedAt: value.updatedAt || null,
    urls: value.urls && typeof value.urls === "object" ? value.urls : {},
  };
}

function normalizeBaselineReportForIncremental(report) {
  const warnings = [];
  if (!report?.schemaVersion) {
    warnings.push({ code: "legacy_report", message: "Baseline report has no schemaVersion." });
  }
  if (report?.runStatus?.status && report.runStatus.status !== "complete") {
    warnings.push({ code: "partial_report", message: `Baseline report status is ${report.runStatus.status}.` });
  }

  const recordsByKey = new Map();
  const policyFingerprint = buildIncrementalPolicyFingerprintFromReport(report);
  const addRecord = (item, source) => {
    const key = item?.canonicalUrl || item?.url;
    if (!key) {
      warnings.push({ code: "missing_canonical_key", message: `Baseline ${source} item has no canonicalUrl or url.` });
      return;
    }
    const canonicalUrlHash = hashLabel(key);
    if (recordsByKey.has(canonicalUrlHash)) {
      return;
    }
    const resultSummary = buildIncrementalResultSummary(item);
    recordsByKey.set(canonicalUrlHash, {
      canonicalUrlHash,
      source,
      policyFingerprint,
      lastCheckedAt: item?.checkedAt || null,
      lastStatus: item?.status ?? null,
      lastOk: item?.ok ?? null,
      lastIssueType: item?.issueType || null,
      lastClassification: item?.classification || null,
      lastFinalUrlHash: item?.finalUrl ? hashLabel(item.finalUrl) : null,
      ttlExpiresAt: getIncrementalResultTtlExpiresAt(item),
      previousError: isPreviousIncrementalError(resultSummary),
      resultSummary,
      reusableResult: stripBody(item),
    });
  };

  if (Array.isArray(report?.checked)) {
    for (const item of report.checked) {
      addRecord(item, "checked");
    }
  } else if (Array.isArray(report?.broken)) {
    warnings.push({ code: "fallback_to_broken", message: "Baseline report has no checked[]; using broken[] fallback." });
    for (const item of report.broken) {
      addRecord({ ...item, ok: item.ok ?? false }, "broken");
    }
  } else {
    warnings.push({ code: "missing_checked", message: "Baseline report has no checked[] or broken[] items." });
  }

  if (Array.isArray(report?.externalLinks)) {
    for (const item of report.externalLinks) {
      addRecord(item, "externalLinks");
    }
  }

  return {
    policyFingerprint,
    warnings,
    records: [...recordsByKey.values()],
  };
}

function buildIncrementalPolicyFingerprint({ options = {}, scanPolicy = null } = {}) {
  const keyParts = {
    canonicalStrategy: options.canonicalStrategy || DEFAULTS.canonicalStrategy,
    userAgentHash: options.userAgent ? hashLabel(options.userAgent) : null,
    acceptLanguage: options.acceptLanguage || null,
    checkExternal: options.checkExternal === true,
    preferGet: options.preferGet === true,
    externalReferer: options.externalReferer === true,
    spaLinks: options.spaLinks || DEFAULTS.spaLinks,
    robotsPolicy: {
      mode: scanPolicy?.robotsTxt?.mode || "unknown",
      status: scanPolicy?.robotsTxt?.status || "unknown",
      pathEnforcement: scanPolicy?.robotsTxt?.pathEnforcement === true,
    },
    securityPolicy: {
      blockPrivateIp: options.blockPrivateIp !== false,
      allowLocalhost: options.allowLocalhost === true,
      allowPrivateIp: options.allowPrivateIp === true,
    },
    rules: {
      domainCategoryRulesSource: options.domainCategoryRulesSource || null,
      externalRiskRulesSource: options.externalRiskRulesSource || null,
      siteLinkRulesSource: options.siteLinkRulesSource || null,
    },
  };
  return hashLabel(stableStringify(keyParts));
}

function buildIncrementalPolicyFingerprintFromReport(report) {
  if (!report?.options) {
    return null;
  }
  return buildIncrementalPolicyFingerprint({
    options: report.options,
    scanPolicy: report.scanPolicy || null,
  });
}

function buildIncrementalResultSummary(result = {}) {
  return {
    checkedAt: result.checkedAt || null,
    status: result.status ?? null,
    ok: result.ok ?? null,
    issueType: result.issueType || null,
    classification: result.classification || null,
    finalUrlHash: result.finalUrl ? hashLabel(result.finalUrl) : null,
    redirected: result.redirected === true,
    redirectCount: result.redirectCount || 0,
    confirmationOutcome: result.confirmation?.outcome || null,
    transientFailure: result.transientFailure === true,
    needsReview: result.needsReview === true || result.confirmation?.outcome === "needs_review",
    suspectedWaf: result.suspectedWaf === true || result.protection?.suspectedWaf === true,
    suspectedBot: result.suspectedBot === true || result.protection?.suspectedBot === true,
  };
}

function getIncrementalCanonicalHashCandidates(canonicalUrl, options = DEFAULTS) {
  const values = [canonicalUrl];
  const redacted = redactSensitiveQueryValue(canonicalUrl, { ...options, redactSensitiveQuery: true });
  if (redacted && redacted !== canonicalUrl) {
    values.push(redacted);
  }
  return [...new Set(values.filter(Boolean).map((value) => hashLabel(value)))];
}

function findIncrementalPreviousRecord(records, hashCandidates = []) {
  for (const key of hashCandidates) {
    const record = records.get(key);
    if (record) {
      return record;
    }
  }
  return null;
}

function isPreviousIncrementalError(summary = {}) {
  if (!summary) {
    return false;
  }
  if (summary.needsReview || summary.transientFailure || summary.suspectedWaf || summary.suspectedBot) {
    return true;
  }
  if (summary.ok === false) {
    return true;
  }
  if (summary.status === 404 || summary.status === 410 || summary.status === 429) {
    return true;
  }
  if (summary.status >= 500) {
    return true;
  }
  return ["protected", "security_blocked", "network_error", "timeout", "not_found", "access_denied"].includes(summary.classification)
    || ["protected", "security_blocked", "network_error", "timeout", "not_found", "access_denied"].includes(summary.issueType);
}

function isPreviousIncrementalRedirectUnstable(summary = {}) {
  if (!summary) {
    return false;
  }
  return summary.redirected === true
    || (summary.redirectCount || 0) > 0
    || summary.confirmationOutcome === "needs_review";
}

function isIncrementalTtlExpired(value, nowMs = Date.now()) {
  if (!value) {
    return false;
  }
  const expiresAt = Date.parse(value);
  return Number.isFinite(expiresAt) && expiresAt <= nowMs;
}

function getIncrementalResultTtlExpiresAt(result = {}, options = DEFAULTS) {
  if (result.cache?.expiresAt) {
    return result.cache.expiresAt;
  }
  const checkedAt = Date.parse(result.checkedAt || "");
  if (!Number.isFinite(checkedAt)) {
    return null;
  }
  const ttlMs = getPersistentCacheTtlMs(result, options);
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return null;
  }
  return new Date(checkedAt + ttlMs).toISOString();
}

function getIncrementalReuseDecision(previous, policyFingerprint) {
  if (!previous?.reusableResult) {
    return { reusable: false, reason: "missing_reusable_result" };
  }
  if (previous.policyFingerprint && policyFingerprint && previous.policyFingerprint !== policyFingerprint) {
    return { reusable: false, reason: "policy_mismatch" };
  }
  if (previous.previousError || isPreviousIncrementalError(previous.resultSummary)) {
    return { reusable: false, reason: "previous_error" };
  }
  if (isPreviousIncrementalRedirectUnstable(previous.resultSummary)) {
    return { reusable: false, reason: "unstable_redirect" };
  }
  if (!previous.ttlExpiresAt) {
    return { reusable: false, reason: "missing_ttl" };
  }
  if (isIncrementalTtlExpired(previous.ttlExpiresAt)) {
    return { reusable: false, reason: "ttl_expired" };
  }
  return { reusable: true, reason: "stable_known_policy_match_ttl_valid" };
}

function buildIncrementalReusedResult(url, previous, { canonicalStrategy = DEFAULTS.canonicalStrategy, reason } = {}) {
  const result = stripBody(previous.reusableResult || {});
  return stripBody({
    ...result,
    url,
    canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
    normalizedFrom: result.normalizedFrom || url,
    incremental: {
      mode: "changed_only",
      classification: "known",
      reused: true,
      reuseSource: previous.sources?.[0] || "state",
      reuseSources: previous.sources || [],
      baselineCheckedAt: previous.lastCheckedAt || result.checkedAt || null,
      reason,
    },
  });
}

function buildIncrementalStateFromReport(checker) {
  const now = new Date().toISOString();
  const previousState = checker.incrementalState || { urls: {} };
  const urls = {};

  for (const item of checker.inventory.values()) {
    const canonicalUrlHash = hashLabel(item.canonicalUrl);
    const previous = previousState.urls?.[canonicalUrlHash] || {};
    const result = checker.results.get(item.canonicalUrl) || null;
    const resultSummary = result ? buildIncrementalResultSummary(result) : previous.resultSummary || null;
    urls[canonicalUrlHash] = {
      canonicalUrlHash,
      displayUrl: redactSensitiveQueryValue(item.representativeUrl || item.canonicalUrl, { ...checker.options, redactSensitiveQuery: true }),
      firstSeenAt: previous.firstSeenAt || now,
      lastSeenAt: now,
      lastCheckedAt: result?.checkedAt || previous.lastCheckedAt || null,
      lastStatus: result?.status ?? previous.lastStatus ?? null,
      lastOk: result?.ok ?? previous.lastOk ?? null,
      lastIssueType: result?.issueType || previous.lastIssueType || null,
      lastClassification: result?.classification || previous.lastClassification || item.incremental?.classification || null,
      lastFinalUrlHash: result?.finalUrl ? hashLabel(result.finalUrl) : previous.lastFinalUrlHash || null,
      lastSitemapLastmod: item.incremental?.sitemap?.lastmod || previous.lastSitemapLastmod || null,
      lastSourceCount: item.sources.length,
      previousError: isPreviousIncrementalError(resultSummary),
      policyFingerprint: checker.incremental.policyFingerprint,
      resultSummary,
      ttlExpiresAt: result ? getIncrementalResultTtlExpiresAt(result, checker.options) : previous.ttlExpiresAt || null,
      reusableResult: result ? redactCacheStoredResult(stripBody(result), checker.options) : previous.reusableResult || null,
    };
  }

  return {
    stateSchemaVersion: INCREMENTAL_STATE_SCHEMA_VERSION,
    policyVersion: INCREMENTAL_POLICY_VERSION,
    generator: buildReportGenerator(),
    startUrl: redactSensitiveQueryValue(checker.startUrl, { ...checker.options, redactSensitiveQuery: true }),
    startOrigin: checker.startOrigin,
    policyFingerprint: checker.incremental.policyFingerprint,
    updatedAt: now,
    urls,
  };
}

function normalizeConnectionOptions(options = {}) {
  const perHostConcurrency = Math.max(
    1,
    Number.parseInt(options.perHostConcurrency ?? DEFAULTS.perHostConcurrency, 10) || DEFAULTS.perHostConcurrency,
  );
  const maxSockets = Math.max(
    1,
    Number.parseInt(options.maxSockets ?? perHostConcurrency, 10) || perHostConcurrency,
  );
  const maxFreeSockets = Math.max(
    1,
    Number.parseInt(options.maxFreeSockets ?? perHostConcurrency, 10) || perHostConcurrency,
  );
  const keepAliveMsecs = Math.max(
    1,
    Number.parseInt(options.keepAliveMsecs ?? DEFAULTS.keepAliveMsecs, 10) || DEFAULTS.keepAliveMsecs,
  );
  return {
    keepAlive: options.keepAlive !== false,
    maxSockets,
    maxFreeSockets,
    keepAliveMsecs,
  };
}

function normalizeSecurityPolicy(options = {}) {
  return {
    blockPrivateIp: options.blockPrivateIp !== false,
    allowLocalhost: options.allowLocalhost === true,
    allowPrivateIp: options.allowPrivateIp === true,
    metadataIpBlocked: true,
    allowedProtocols: [...ALLOWED_REQUEST_PROTOCOLS].map((protocol) => protocol.replace(":", "")),
  };
}

function normalizeComplianceOptions(options = {}) {
  const authorizationNote = typeof options.authorizationNote === "string"
    ? options.authorizationNote.trim().slice(0, 500)
    : null;
  return {
    robotsTxt: options.robotsTxt !== false,
    authorizedScan: options.authorizedScan === true,
    authorizationNote: authorizationNote || null,
  };
}

function buildInitialRobotsTxtSummary(startOrigin, options = DEFAULTS) {
  const enabled = options.robotsTxt !== false;
  return {
    enabled,
    url: new URL("/robots.txt", startOrigin).toString(),
    status: enabled ? "not_attempted" : "disabled",
    httpStatus: null,
    fetchedAt: null,
    appliesTo: "start_origin",
    pathEnforcement: false,
    userAgent: options.userAgent || DEFAULTS.userAgent,
    matchedUserAgent: null,
    crawlDelaySeconds: null,
    disallowRules: 0,
    allowRules: 0,
    sitemapUrls: [],
    fullDisallow: false,
    bodyBytesRead: 0,
    bodyTruncated: false,
    error: null,
  };
}

function buildRobotsTxtSummary(robotsUrl, result, options = DEFAULTS) {
  const summary = {
    ...buildInitialRobotsTxtSummary(new URL(robotsUrl).origin, options),
    url: robotsUrl,
    fetchedAt: new Date().toISOString(),
    httpStatus: result.status ?? null,
    bodyBytesRead: result.bodyBytesRead ?? 0,
    bodyTruncated: result.bodyTruncated === true,
  };

  if (result.classification === "security_blocked") {
    return {
      ...summary,
      status: "blocked_by_security_policy",
      error: result.issueType || result.securityPolicy?.reason || "security_blocked",
    };
  }

  if (result.status === 404 || result.status === 410) {
    return {
      ...summary,
      status: "not_found",
    };
  }

  if (!result.ok) {
    return {
      ...summary,
      status: result.status ? "http_error" : "fetch_error",
      error: result.error || result.diagnosis || null,
    };
  }

  const parsed = parseRobotsTxt(result.body || "", options.userAgent || DEFAULTS.userAgent);
  return {
    ...summary,
    status: "ok",
    matchedUserAgent: parsed.matchedUserAgent,
    crawlDelaySeconds: parsed.crawlDelaySeconds,
    disallowRules: parsed.disallowRules,
    allowRules: parsed.allowRules,
    sitemapUrls: parsed.sitemapUrls,
    fullDisallow: parsed.fullDisallow,
  };
}

function buildRobotsTxtFetchErrorSummary(robotsUrl, error, options = DEFAULTS) {
  return {
    ...buildInitialRobotsTxtSummary(new URL(robotsUrl).origin, options),
    url: robotsUrl,
    status: "fetch_error",
    fetchedAt: new Date().toISOString(),
    error: error.message || String(error),
  };
}

function parseRobotsTxt(text, userAgent) {
  const userAgentText = String(userAgent || "").toLowerCase();
  const groups = [];
  let currentGroup = null;
  const sitemapUrls = [];

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "sitemap") {
      if (value) {
        sitemapUrls.push(value);
      }
      continue;
    }
    if (key === "user-agent") {
      currentGroup = { userAgents: [value.toLowerCase()], rules: [], crawlDelaySeconds: null };
      groups.push(currentGroup);
      continue;
    }
    if (!currentGroup) {
      continue;
    }
    if (key === "allow" || key === "disallow") {
      currentGroup.rules.push({ type: key, path: value });
      continue;
    }
    if (key === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        currentGroup.crawlDelaySeconds = seconds;
      }
    }
  }

  const matchedGroups = groups.filter((group) => (
    group.userAgents.some((agent) => agent === "*" || (agent && userAgentText.includes(agent)))
  ));
  const selectedGroups = matchedGroups.length > 0 ? matchedGroups : groups.filter((group) => group.userAgents.includes("*"));
  const rules = selectedGroups.flatMap((group) => group.rules);
  const crawlDelaySeconds = selectedGroups
    .map((group) => group.crawlDelaySeconds)
    .find((value) => Number.isFinite(value)) ?? null;
  const matchedUserAgent = selectedGroups
    .flatMap((group) => group.userAgents)
    .sort((left, right) => (left === "*" ? 1 : 0) - (right === "*" ? 1 : 0))[0] || null;

  return {
    matchedUserAgent,
    crawlDelaySeconds,
    disallowRules: rules.filter((rule) => rule.type === "disallow" && rule.path !== "").length,
    allowRules: rules.filter((rule) => rule.type === "allow" && rule.path !== "").length,
    sitemapUrls: [...new Set(sitemapUrls)].slice(0, 20),
    fullDisallow: rules.some((rule) => rule.type === "disallow" && rule.path === "/"),
  };
}

function buildScanPolicy(robotsTxt, options = DEFAULTS) {
  const robotsStatus = getRobotsPolicyStatus(robotsTxt, options);
  return {
    robotsTxt: {
      status: robotsStatus,
      mode: options.robotsTxt === false ? "disabled" : "record_only",
      pathEnforcement: false,
      fetched: Boolean(robotsTxt?.fetchedAt),
      robotsTxtStatus: robotsTxt?.status || "not_attempted",
      robotsTxtUrl: robotsTxt?.url || null,
      fullDisallow: robotsTxt?.fullDisallow === true,
      crawlDelaySeconds: robotsTxt?.crawlDelaySeconds ?? null,
    },
    effectiveRateLimit: {
      perHostConcurrency: options.perHostConcurrency,
      requestDelayMs: options.requestDelayMs,
      requestDelayMinMs: options.requestDelayMinMs,
      requestDelayMaxMs: options.requestDelayMaxMs,
      retryAfterMaxMs: options.retryAfterMaxMs,
      crawlDelayApplied: false,
    },
    notes: [
      options.robotsTxt === false
        ? "robots.txt fetch disabled by user option."
        : "robots.txt is recorded for audit context; path enforcement is not enabled in P6.5b-3.",
    ],
  };
}

function getRobotsPolicyStatus(robotsTxt, options = DEFAULTS) {
  if (options.robotsTxt === false || robotsTxt?.status === "disabled") {
    return "robots_disabled";
  }
  if (robotsTxt?.status === "not_found") {
    return "robots_not_found";
  }
  if (robotsTxt?.status && robotsTxt.status !== "ok") {
    return "robots_fetch_error";
  }
  if (robotsTxt?.fullDisallow) {
    return options.authorizedScan
      ? "robots_override_authorized"
      : "robots_disallow_override_without_declaration";
  }
  return "robots_compliant";
}

function buildComplianceRecord(scanPolicy, options = DEFAULTS) {
  return {
    purpose: "link_integrity_check",
    scope: options.checkExternal ? "same_origin_with_external_validation" : "same_origin",
    authorizedScanDeclared: options.authorizedScan === true,
    authorizationNote: options.authorizationNote || null,
    robotsTxtPolicy: scanPolicy?.robotsTxt?.status || "robots_fetch_error",
    robotsTxtEnforced: false,
    responseBodyStored: false,
    bodyHashEnabled: options.protectionBodyHash === true,
    disclaimer: "This record stores user declarations and tool behavior only; it does not verify scan authorization.",
  };
}

function createConnectionAgents(connectionOptions) {
  const agentOptions = {
    keepAlive: connectionOptions.keepAlive,
    maxSockets: connectionOptions.maxSockets,
    maxFreeSockets: connectionOptions.maxFreeSockets,
    keepAliveMsecs: connectionOptions.keepAliveMsecs,
  };
  return {
    http: new http.Agent(agentOptions),
    https: new https.Agent(agentOptions),
  };
}

function isSensitiveQueryKey(key, queryKeys = DEFAULT_REDACT_QUERY_KEYS) {
  const normalized = String(key || "").trim().toLowerCase();
  return queryKeys.includes(normalized)
    || /(?:^|[_-])(token|session|auth|password|passwd|pwd|email|jwt|signature|secret|sig)(?:$|[_-])/i.test(normalized)
    || /api[_-]?key/i.test(normalized);
}

function redactSensitiveQueryValue(value, options = DEFAULTS) {
  if (typeof value !== "string" || options?.redactSensitiveQuery === false) {
    return value;
  }

  const queryKeys = normalizeRedactQueryKeys(options.redactQueryKeys || DEFAULT_REDACT_QUERY_KEYS);
  const exact = redactUrlLikeValue(value, queryKeys);
  if (exact !== value) {
    return exact;
  }

  const withAbsoluteUrlsRedacted = value.replace(/https?:\/\/[^\s"'<>]+/gi, (match) => {
    const suffixMatch = /[),.;!?]+$/.exec(match);
    const suffix = suffixMatch ? suffixMatch[0] : "";
    const core = suffix ? match.slice(0, -suffix.length) : match;
    return `${redactUrlLikeValue(core, queryKeys)}${suffix}`;
  });
  return withAbsoluteUrlsRedacted.replace(/(^|[\s(])([/?][^\s"'<>]+)/g, (match, prefix, urlLike) => {
    const suffixMatch = /[),.;!?]+$/.exec(urlLike);
    const suffix = suffixMatch ? suffixMatch[0] : "";
    const core = suffix ? urlLike.slice(0, -suffix.length) : urlLike;
    return `${prefix}${redactUrlLikeValue(core, queryKeys)}${suffix}`;
  });
}

function redactUrlLikeValue(value, queryKeys) {
  const text = String(value);
  const isAbsolute = /^https?:\/\//i.test(text);
  const isQueryOnly = text.startsWith("?");
  const isRootRelative = text.startsWith("/");
  const isRelativeWithQuery = text.includes("?") && !/\s/.test(text);

  if (!isAbsolute && !isQueryOnly && !isRootRelative && !isRelativeWithQuery) {
    return text;
  }

  let parsed;
  try {
    parsed = new URL(text, "http://redaction.local");
  } catch {
    return text;
  }
  if (!parsed.search) {
    return text;
  }

  const params = new URLSearchParams();
  let changed = false;
  for (const [key, paramValue] of parsed.searchParams.entries()) {
    if (isSensitiveQueryKey(key, queryKeys)) {
      params.append(key, REDACTED_QUERY_VALUE);
      changed = true;
    } else {
      params.append(key, paramValue);
    }
  }
  if (!changed) {
    return text;
  }

  parsed.search = params.toString();
  if (isAbsolute) {
    return parsed.toString();
  }
  if (isQueryOnly) {
    return `${parsed.search}${parsed.hash}`;
  }
  if (isRootRelative) {
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return `${parsed.pathname.replace(/^\//, "")}${parsed.search}${parsed.hash}`;
}

function redactReportForOutput(report, options) {
  return redactOutputValue(report, options);
}

function redactOutputValue(value, options) {
  if (typeof value === "string") {
    return redactSensitiveQueryValue(value, options);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactOutputValue(item, options));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactOutputValue(item, options)]),
    );
  }
  return value;
}

function projectSourcesForOutput(sources = [], maxSourcesPerUrl = DEFAULT_MAX_SOURCES_PER_URL) {
  const limit = Math.max(0, Number.isFinite(maxSourcesPerUrl) ? Math.floor(maxSourcesPerUrl) : DEFAULT_MAX_SOURCES_PER_URL);
  const projected = sources
    .slice(0, limit)
    .map(({ key, fallbackUrls, ...source }) => source);
  return {
    sourceCount: sources.length,
    sourcesTruncated: sources.length > projected.length,
    sources: projected,
  };
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
  systemCa = false,
  maxHtmlBytes = DEFAULTS.maxHtmlBytes,
  maxBodyPreviewBytes = DEFAULTS.maxBodyPreviewBytes,
  maxDownloadProbeBytes = DEFAULTS.maxDownloadProbeBytes,
  connectionOptions = normalizeConnectionOptions(DEFAULTS),
  agents = createConnectionAgents(connectionOptions),
  securityPolicy = normalizeSecurityPolicy(DEFAULTS),
  retryAfterMaxMs = DEFAULTS.retryAfterMaxMs,
  protectionBodyHash = DEFAULTS.protectionBodyHash,
  scheduleRequest,
  onRetryAfter,
  createAbortController,
  isStopped,
  adaptiveHeadGetEligible = false,
}) {
  const started = performance.now();
  let result = null;
  let useAdaptiveGet = false;
  let transportFallback = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    result = await fetchUrlOnce(url, {
      requireBody,
      forceGet: forceGet || useAdaptiveGet,
      timeoutMs,
      maxRedirects,
      longRedirectThreshold,
      userAgent,
      acceptLanguage,
      referer,
      preferGet,
      canonicalStrategy,
      legacyTls,
      systemCa,
      maxHtmlBytes,
      maxBodyPreviewBytes,
      maxDownloadProbeBytes,
      connectionOptions,
      agents,
      securityPolicy,
      protectionBodyHash,
      scheduleRequest,
      started,
      createAbortController,
      isStopped,
    });
    result.attempts = attempt + 1;
    attachTransportFallbackMetadata(result, transportFallback);
    if (isStopCancelledResult(result)) {
      return result;
    }
    const canRetry = !isStopped?.() && attempt < retryCount && shouldRetryResult(result);
    const retryAfterCooldownMs = applyRetryAfterCooldown(result, {
      retryAfterMaxMs,
      onRetryAfter,
    });

    if (!canRetry) {
      return result;
    }

    if (!useAdaptiveGet && shouldSwitchHeadTransportToGet(result, {
      adaptiveHeadGetEligible,
    })) {
      useAdaptiveGet = true;
      transportFallback = buildTransportFallbackMetadata(result);
    }

    if (retryAfterCooldownMs === null) {
      await sleep(getRetryDelayMs(attempt));
    }
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
  systemCa,
  maxHtmlBytes,
  maxBodyPreviewBytes,
  maxDownloadProbeBytes,
  connectionOptions,
  agents,
  securityPolicy,
  protectionBodyHash,
  scheduleRequest,
  started,
  createAbortController,
  isStopped,
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
        systemCa,
        maxHtmlBytes,
        maxBodyPreviewBytes,
        maxDownloadProbeBytes,
        connectionOptions,
        agents,
        securityPolicy,
        protectionBodyHash,
        readBody: true,
        scheduleRequest,
        started,
        createAbortController,
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
        systemCa,
        maxHtmlBytes,
        maxBodyPreviewBytes,
        maxDownloadProbeBytes,
        connectionOptions,
        agents,
        securityPolicy,
        protectionBodyHash,
        readBody: false,
        scheduleRequest,
        started,
        createAbortController,
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
      systemCa,
      maxHtmlBytes,
      maxBodyPreviewBytes,
      maxDownloadProbeBytes,
      connectionOptions,
      agents,
      securityPolicy,
      protectionBodyHash,
      readBody: false,
      scheduleRequest,
      started,
      createAbortController,
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
      systemCa,
      maxHtmlBytes,
      maxBodyPreviewBytes,
      maxDownloadProbeBytes,
      connectionOptions,
      agents,
      securityPolicy,
      protectionBodyHash,
      readBody: false,
      scheduleRequest,
      started,
      createAbortController,
    });
  } catch (error) {
    if (isStopAbortError(error) || isStopped?.()) {
      return buildStopCancelledResult(url, {
        method: requireBody || forceGet || preferGet ? "GET" : "HEAD",
        canonicalStrategy,
        started,
        reason: error.stopReason || "stopped_by_user",
      });
    }
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
        : getNetworkDiagnosis(cause, { systemCa }),
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

function getNetworkDiagnosis(cause, { systemCa = false } = {}) {
  if (isWeakDiffieHellmanError(cause)) {
    return "TLS handshake failed because the server uses a weak Diffie-Hellman key. Enable legacy TLS compatibility only when this site must be checked.";
  }
  if (isCertificateChainError(cause)) {
    if (systemCa) {
      return "TLS certificate verification still failed while system CA mode was enabled. Confirm the site in a browser or curl and review the certificate chain or local network trust environment.";
    }
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
    || /(?:^|\s)--use-system-ca(?:\s|$)/.test(process.env.NODE_OPTIONS || "");
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

function shouldRestartWithSystemCa(options, systemCaEnabled = isSystemCaEnabled()) {
  return options?.systemCa === true && !systemCaEnabled;
}

async function evaluateUrlSecurity(url, policy = normalizeSecurityPolicy(DEFAULTS), resolveHostname = dnsLookup) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return buildSecurityDecision(false, {
      url,
      reason: "blocked_invalid_url",
      diagnosis: "URL is invalid and was not requested.",
    });
  }

  if (!ALLOWED_REQUEST_PROTOCOLS.has(parsed.protocol)) {
    return buildSecurityDecision(false, {
      url,
      reason: "blocked_scheme",
      protocol: parsed.protocol,
      diagnosis: `URL scheme ${parsed.protocol} is not allowed for HTTP scanning.`,
    });
  }

  const hostname = normalizeSecurityHostname(parsed.hostname);
  const hostnameClass = classifyHostname(hostname);
  if (hostnameClass) {
    return securityDecisionForAddress({
      url,
      hostname,
      address: hostname,
      family: hostnameClass.family,
      classification: hostnameClass,
      policy,
    });
  }

  if (isLocalhostName(hostname)) {
    if (policy.allowLocalhost) {
      return buildSecurityDecision(true, { url, hostname, reason: null });
    }
    return buildSecurityDecision(false, {
      url,
      hostname,
      reason: "blocked_localhost",
      diagnosis: "Localhost hostnames are blocked by default. Use --allow-localhost only for trusted local scans.",
    });
  }

  let resolved;
  try {
    resolved = await resolveHostname(hostname, { all: true, verbatim: true });
  } catch {
    return buildSecurityDecision(true, { url, hostname, reason: null });
  }

  for (const entry of resolved) {
    const classification = classifyIpAddress(entry.address);
    const decision = securityDecisionForAddress({
      url,
      hostname,
      address: entry.address,
      family: entry.family,
      classification,
      policy,
    });
    if (!decision.allowed) {
      return decision;
    }
  }

  return buildSecurityDecision(true, {
    url,
    hostname,
    resolvedAddresses: resolved.map((entry) => entry.address),
    reason: null,
  });
}

function securityDecisionForAddress({ url, hostname, address, family, classification, policy }) {
  if (!classification) {
    return buildSecurityDecision(true, { url, hostname, address, family, reason: null });
  }

  const detail = {
    url,
    hostname,
    address,
    family,
    addressType: classification.type,
  };

  if (classification.metadata) {
    return buildSecurityDecision(false, {
      ...detail,
      reason: "blocked_metadata_ip",
      diagnosis: "Metadata service IP addresses are always blocked.",
    });
  }

  if (classification.loopback) {
    if (policy.allowLocalhost || policy.blockPrivateIp === false) {
      return buildSecurityDecision(true, { ...detail, reason: null });
    }
    return buildSecurityDecision(false, {
      ...detail,
      reason: "blocked_localhost",
      diagnosis: "Loopback addresses are blocked by default. Use --allow-localhost only for trusted local scans.",
    });
  }

  if (classification.privateLike) {
    if (policy.allowPrivateIp || policy.blockPrivateIp === false) {
      return buildSecurityDecision(true, { ...detail, reason: null });
    }
    return buildSecurityDecision(false, {
      ...detail,
      reason: `blocked_${classification.type}`,
      diagnosis: "Private, link-local, reserved, and internal network addresses are blocked by default.",
    });
  }

  return buildSecurityDecision(true, { ...detail, reason: null });
}

function buildSecurityDecision(allowed, detail = {}) {
  return {
    allowed,
    ...detail,
  };
}

function normalizeSecurityHostname(hostname) {
  return String(hostname || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "")
    .toLowerCase();
}

function isLocalhostName(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function classifyHostname(hostname) {
  if (net.isIP(hostname)) {
    return classifyIpAddress(hostname);
  }
  return null;
}

function classifyIpAddress(address) {
  const normalized = normalizeSecurityHostname(address);
  if (net.isIP(normalized) === 4) {
    return classifyIpv4Address(normalized);
  }
  if (net.isIP(normalized) === 6) {
    return classifyIpv6Address(normalized);
  }
  return null;
}

function classifyIpv4Address(address) {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  const [a, b, c, d] = parts;
  const base = { family: 4, type: "public", privateLike: false, loopback: false, metadata: false };

  if (a === 169 && b === 254 && c === 169 && d === 254) {
    return { ...base, type: "metadata_ip", privateLike: true, metadata: true };
  }
  if (a === 127) {
    return { ...base, type: "localhost", privateLike: true, loopback: true };
  }
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
    return { ...base, type: "private_ip", privateLike: true };
  }
  if (a === 169 && b === 254) {
    return { ...base, type: "link_local_ip", privateLike: true };
  }
  if (a === 0 || (a === 100 && b >= 64 && b <= 127) || a >= 224 || address === "255.255.255.255") {
    return { ...base, type: "reserved_ip", privateLike: true };
  }
  if ((a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)) {
    return { ...base, type: "reserved_ip", privateLike: true };
  }

  return base;
}

function classifyIpv6Address(address) {
  const normalized = normalizeSecurityHostname(address);
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) {
    const mapped = classifyIpv4Address(mappedIpv4);
    return {
      ...mapped,
      family: 6,
      type: mapped.metadata ? "metadata_ip" : mapped.loopback ? "localhost" : mapped.privateLike ? mapped.type : "public",
      ipv4MappedAddress: mappedIpv4,
    };
  }
  const mappedHexIpv4 = parseHexMappedIpv4(normalized);
  if (mappedHexIpv4) {
    const mapped = classifyIpv4Address(mappedHexIpv4);
    return {
      ...mapped,
      family: 6,
      type: mapped.metadata ? "metadata_ip" : mapped.loopback ? "localhost" : mapped.privateLike ? mapped.type : "public",
      ipv4MappedAddress: mappedHexIpv4,
    };
  }

  const firstHextet = Number.parseInt(normalized.split(":").find(Boolean) || "0", 16);
  const base = { family: 6, type: "public", privateLike: false, loopback: false, metadata: false };

  if (normalized === "::1") {
    return { ...base, type: "localhost", privateLike: true, loopback: true };
  }
  if (normalized === "::") {
    return { ...base, type: "reserved_ip", privateLike: true };
  }
  if ((firstHextet & 0xffc0) === 0xfe80) {
    return { ...base, type: "link_local_ip", privateLike: true };
  }
  if ((firstHextet & 0xfe00) === 0xfc00) {
    return { ...base, type: "private_ip", privateLike: true };
  }
  if ((firstHextet & 0xff00) === 0xff00 || normalized.startsWith("2001:db8:")) {
    return { ...base, type: "reserved_ip", privateLike: true };
  }

  return base;
}

function parseHexMappedIpv4(address) {
  if (!address.startsWith("::ffff:")) {
    return null;
  }
  const parts = address.slice("::ffff:".length).split(":");
  if (parts.length !== 2) {
    return null;
  }
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (![high, low].every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)) {
    return null;
  }
  return [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ].join(".");
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
  systemCa,
  maxHtmlBytes,
  maxBodyPreviewBytes,
  maxDownloadProbeBytes,
  connectionOptions,
  agents,
  securityPolicy,
  protectionBodyHash,
  readBody,
  scheduleRequest,
  started,
  createAbortController,
}) {
  let currentUrl = url;
  let currentMethod = method;
  const redirectChain = [];
  const seenUrls = new Set([normalizeRedirectVisitUrl(currentUrl)]);

  while (true) {
    const securityCheck = await evaluateUrlSecurity(currentUrl, securityPolicy);
    if (!securityCheck.allowed) {
      return buildSecurityBlockedResult({
        url,
        blockedUrl: currentUrl,
        method,
        currentMethod,
        referer,
        securityCheck,
        redirectChain,
        maxRedirects,
        longRedirectThreshold,
        canonicalStrategy,
        started,
      });
    }

    const response = await scheduleRequest(currentUrl, () => rawRequest(currentUrl, currentMethod, {
      timeoutMs,
      userAgent,
      acceptLanguage,
      referer,
      legacyTls,
      connectionOptions,
      agents,
      createAbortController,
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
          maxHtmlBytes,
          maxBodyPreviewBytes,
          maxDownloadProbeBytes,
          protectionBodyHash,
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

      const redirectSecurityCheck = await evaluateUrlSecurity(nextUrl, securityPolicy);
      if (!redirectSecurityCheck.allowed) {
        await releaseResponseBody(response, { maxDrainBytes: maxDownloadProbeBytes });
        return buildSecurityBlockedResult({
          url,
          blockedUrl: nextUrl,
          method,
          currentMethod: getRedirectMethod(currentMethod, response.status),
          referer,
          securityCheck: redirectSecurityCheck,
          redirectChain,
          maxRedirects,
          longRedirectThreshold,
          canonicalStrategy,
          started,
          redirectStatus: response.status,
        });
      }

      if (redirectChain.length > maxRedirects) {
        await releaseResponseBody(response, { maxDrainBytes: maxDownloadProbeBytes });
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
        await releaseResponseBody(response, { maxDrainBytes: maxDownloadProbeBytes });
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

      await releaseResponseBody(response, { maxDrainBytes: maxDownloadProbeBytes });
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
      maxHtmlBytes,
      maxBodyPreviewBytes,
      maxDownloadProbeBytes,
      protectionBodyHash,
      redirectChain,
      maxRedirects,
      longRedirectThreshold,
    });
  }
}

async function rawRequest(url, method, {
  timeoutMs,
  userAgent,
  acceptLanguage,
  referer,
  legacyTls,
  connectionOptions,
  agents,
  createAbortController,
}) {
  const requestController = createAbortController?.() || createStandaloneRequestController();
  const { controller, cleanup } = requestController;
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(createAbortError());
    }
  }, timeoutMs);
  const headers = buildRequestHeaders(url, {
    userAgent,
    acceptLanguage,
    referer,
    connectionOptions,
  });

  let response = null;
  try {
    if (legacyTls) {
      response = await legacyTlsRequest(url, method, { timeoutMs, headers, agents, signal: controller.signal });
      return attachResponseAbortCleanup(response, cleanup);
    }

    response = await fetch(url, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers,
    });
    return attachResponseAbortCleanup(response, cleanup);
  } catch (error) {
    if (isStopAbortError(controller.signal.reason)) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (!response) {
      cleanup();
    }
  }
}

function buildRequestHeaders(url, { userAgent, acceptLanguage, referer, connectionOptions }) {
  const headers = {
    "user-agent": userAgent,
    "accept": getAcceptHeaderForUrl(url),
    "accept-language": acceptLanguage,
    "accept-encoding": ACCEPT_ENCODING_HEADER,
  };
  if (referer) {
    headers.referer = referer;
  }
  if (connectionOptions?.keepAlive === false) {
    headers.connection = "close";
  }
  return headers;
}

function getAcceptHeaderForUrl(url) {
  const kind = classifyUrlKind(url);
  return kind.page ? DOCUMENT_ACCEPT_HEADER : GENERIC_ACCEPT_HEADER;
}

function legacyTlsRequest(url, method, { timeoutMs, headers, agents, signal }) {
  const parsed = new URL(url);
  const client = parsed.protocol === "http:" ? http : https;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortSignalReason(signal));
      return;
    }

    const requestOptions = {
      method,
      headers,
      timeout: timeoutMs,
      agent: parsed.protocol === "http:" ? agents?.http : agents?.https,
    };

    if (parsed.protocol === "https:") {
      requestOptions.ciphers = "DEFAULT@SECLEVEL=0";
    }

    let settled = false;
    let request = null;
    let responseStream = null;
    const cleanup = () => {
      signal?.removeEventListener?.("abort", onAbort);
    };
    const settle = (fn, value, { keepAbortListener = false } = {}) => {
      if (settled) {
        return;
      }
      settled = true;
      if (!keepAbortListener) {
        cleanup();
      }
      fn(value);
    };
    const onAbort = () => {
      const reason = getAbortSignalReason(signal);
      responseStream?.destroy(reason);
      request?.destroy(reason);
    };

    request = client.request(url, requestOptions, (response) => {
      responseStream = response;
      settle(resolve, attachResponseAbortCleanup(new LegacyResponse(url, response), cleanup), {
        keepAbortListener: true,
      });
    });

    signal?.addEventListener?.("abort", onAbort, { once: true });
    request.on("timeout", () => {
      request.destroy(createAbortError());
    });
    request.on("error", (error) => settle(reject, error));
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
    return decodeResponseBuffer(await this.buffer(), this.headers).toString("utf8");
  }

  async readText(maxBytes) {
    const { buffer, bytesRead, truncated } = await this.readBuffer(maxBytes);
    return {
      text: decodeResponseBuffer(buffer, this.headers).toString("utf8"),
      bytesRead,
      truncated,
    };
  }

  async arrayBuffer() {
    const buffer = await this.buffer();
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }

  readBuffer(maxBytes) {
    const limit = Math.max(0, Number.isFinite(maxBytes) ? Math.floor(maxBytes) : Number.MAX_SAFE_INTEGER);
    return new Promise((resolve, reject) => {
      const chunks = [];
      let bytesRead = 0;
      let truncated = false;
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ buffer: Buffer.concat(chunks), bytesRead, truncated });
      };

      this.response.on("data", (chunk) => {
        if (settled) {
          return;
        }
        const buffer = Buffer.from(chunk);
        if (bytesRead + buffer.length <= limit) {
          chunks.push(buffer);
          bytesRead += buffer.length;
          return;
        }

        const remaining = Math.max(0, limit - bytesRead);
        if (remaining > 0) {
          chunks.push(buffer.subarray(0, remaining));
          bytesRead += remaining;
        }
        truncated = true;
        this.response.destroy();
        finish();
      });
      this.response.on("end", finish);
      this.response.on("error", (error) => {
        if (truncated || settled) {
          return;
        }
        settled = true;
        reject(error);
      });
    });
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

function decodeResponseBuffer(buffer, headers) {
  const encoding = String(headers.get("content-encoding") || "").toLowerCase().trim();
  try {
    if (encoding === "gzip" || encoding === "x-gzip") {
      return gunzipSync(buffer);
    }
    if (encoding === "deflate") {
      return inflateSync(buffer);
    }
  } catch {
    return buffer;
  }
  return buffer;
}

function createAbortError() {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function createStopAbortError(reason = "stopped_by_user") {
  const error = new Error("Request cancelled because the scan was stopped");
  error.name = "LinkCheckerStopError";
  error.code = "ERR_LINK_CHECKER_STOPPED";
  error.stopReason = reason;
  return error;
}

function isStopAbortError(error) {
  return error?.code === "ERR_LINK_CHECKER_STOPPED";
}

function createStandaloneRequestController() {
  const controller = new AbortController();
  return {
    controller,
    cleanup: () => {},
  };
}

function getAbortSignalReason(signal) {
  return signal?.reason instanceof Error ? signal.reason : createAbortError();
}

function attachResponseAbortCleanup(response, cleanup) {
  const existing = response?.[RESPONSE_ABORT_CLEANUP];
  Object.defineProperty(response, RESPONSE_ABORT_CLEANUP, {
    value: () => {
      if (typeof existing === "function") {
        existing();
      }
      cleanup();
    },
    configurable: true,
  });
  return response;
}

function cleanupResponseAbort(response) {
  const cleanup = response?.[RESPONSE_ABORT_CLEANUP];
  if (typeof cleanup === "function") {
    cleanup();
    delete response[RESPONSE_ABORT_CLEANUP];
  }
}

function buildStopCancelledResult(url, { method, canonicalStrategy, started, reason }) {
  return {
    url,
    canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
    checkedAt: new Date().toISOString(),
    ok: false,
    status: null,
    method,
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
    cancelledByStop: true,
    stopReason: reason,
  };
}

function isStopCancelledResult(result) {
  return result?.cancelledByStop === true;
}

async function buildResponseResult(response, {
  url,
  method,
  currentMethod,
  readBody,
  referer,
  started,
  canonicalStrategy,
  maxHtmlBytes,
  maxBodyPreviewBytes,
  maxDownloadProbeBytes,
  protectionBodyHash = DEFAULTS.protectionBodyHash,
  redirectChain,
  maxRedirects,
  longRedirectThreshold,
}) {
  try {
    const contentType = response.headers.get("content-type");
    const retryAfter = parseRetryAfterHeader(response.headers.get("retry-after"));
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
      retryAfter,
      server: response.headers.get("server"),
      wafHeaders: extractWafHeaders(response.headers),
      blockedReason: null,
      blockedRuleId: extractBlockedRuleId(response.headers),
      bodySignature: null,
      suspectedWaf: false,
      suspectedBot: false,
      requestReferer: referer || null,
      bodyBytesRead: 0,
      bodyTruncated: false,
      elapsedMs: Math.round(performance.now() - started),
      error: null,
    };

    if (readBody) {
      const body = await readResponseText(response, maxHtmlBytes);
      result.body = body.text;
      result.bodyBytesRead = body.bytesRead;
      result.bodyTruncated = body.truncated;
    } else if (!result.ok && isHtml(contentType)) {
      const body = await readResponseText(response, maxBodyPreviewBytes);
      result.diagnosticBody = body.text;
      result.bodyBytesRead = body.bytesRead;
      result.bodyTruncated = body.truncated;
    } else {
      const release = await releaseResponseBody(response, { maxDrainBytes: maxDownloadProbeBytes });
      result.bodyBytesRead = release.bytesRead;
      result.bodyTruncated = release.truncated;
    }

    const signature = buildBodySignature(result.body || result.diagnosticBody || "", {
      includeBodyHash: protectionBodyHash,
    });
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
  } finally {
    cleanupResponseAbort(response);
  }
}

async function readResponseText(response, maxBytes) {
  if (typeof response.readText === "function") {
    return response.readText(maxBytes);
  }
  if (!response.body) {
    return { text: "", bytesRead: 0, truncated: false };
  }

  const limit = Math.max(0, Number.isFinite(maxBytes) ? Math.floor(maxBytes) : Number.MAX_SAFE_INTEGER);
  const reader = response.body.getReader();
  const chunks = [];
  let bytesRead = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      if (bytesRead + chunk.length <= limit) {
        chunks.push(chunk);
        bytesRead += chunk.length;
        continue;
      }

      const remaining = Math.max(0, limit - bytesRead);
      if (remaining > 0) {
        chunks.push(chunk.subarray(0, remaining));
        bytesRead += remaining;
      }
      truncated = true;
      await reader.cancel();
      break;
    }
  } finally {
    reader.releaseLock();
  }

  return {
    text: Buffer.concat(chunks).toString("utf8"),
    bytesRead,
    truncated,
  };
}

async function releaseResponseBody(response, { maxDrainBytes = 64 * 1024 } = {}) {
  try {
    if (!response.body) {
      return { bytesRead: 0, truncated: false };
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
    if (Number.isFinite(contentLength) && contentLength <= maxDrainBytes) {
      await response.arrayBuffer();
      return { bytesRead: contentLength, truncated: false };
    }

    await response.body.cancel();
    return {
      bytesRead: 0,
      truncated: true,
    };
  } catch {
    // Cleanup is best-effort; keep the original HTTP result intact.
    return { bytesRead: 0, truncated: false };
  } finally {
    cleanupResponseAbort(response);
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

function extractWafHeaderEvidence(headers) {
  const evidence = [];
  for (const name of WAF_HEADER_NAMES) {
    const value = headers.get(name);
    if (value) {
      if (name === "server" && !/(cloudflare|akamai|sucuri|incapsula|imperva)/i.test(value)) {
        continue;
      }
      evidence.push({ header: name, value });
    }
  }
  return evidence;
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

function buildBodySignature(body, { includeBodyHash = false } = {}) {
  if (!body) {
    return null;
  }

  const text = String(body);
  const normalized = text.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const matchedPatterns = PROTECTION_BODY_PATTERNS
    .filter((pattern) => matchesProtectionBodyPattern(lower, pattern))
    .map((pattern) => pattern.id);

  const signature = {
    signatureType: "html_text",
    matchedPatterns,
    title: extractTitle(text) || null,
    snippet: sanitizeSnippet(normalized),
  };

  if (includeBodyHash) {
    signature.bodyHash = createHash("sha256").update(text).digest("hex");
  }

  return signature;
}

function matchesProtectionBodyPattern(lowerBody, pattern) {
  if (pattern.matchMode !== "token") {
    return lowerBody.includes(pattern.text);
  }

  let index = lowerBody.indexOf(pattern.text);
  while (index !== -1) {
    const before = index === 0 ? "" : lowerBody[index - 1];
    const afterIndex = index + pattern.text.length;
    const after = afterIndex >= lowerBody.length ? "" : lowerBody[afterIndex];
    if (!isProtectionTokenJoiner(before) && !isProtectionTokenJoiner(after)) {
      return true;
    }
    index = lowerBody.indexOf(pattern.text, index + pattern.text.length);
  }
  return false;
}

function isProtectionTokenJoiner(value) {
  return /[a-z0-9_-]/.test(value || "");
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

function buildSecurityBlockedResult({
  url,
  blockedUrl,
  method,
  currentMethod,
  referer,
  securityCheck,
  redirectChain,
  maxRedirects,
  longRedirectThreshold,
  canonicalStrategy,
  started,
  redirectStatus = null,
}) {
  const redirectIssue = redirectChain.length > 0 ? `redirect_to_${securityCheck.reason}` : null;
  const issueType = redirectIssue || securityCheck.reason || "blocked_by_security_policy";
  const result = {
    url,
    canonicalUrl: canonicalizeCheckedUrl(url, canonicalStrategy),
    checkedAt: new Date().toISOString(),
    ok: false,
    status: redirectStatus,
    method,
    finalMethod: currentMethod,
    finalUrl: blockedUrl,
    contentType: null,
    contentLength: null,
    cacheHeaders: emptyCacheHeaders(),
    server: null,
    wafHeaders: {},
    blockedReason: securityCheck.reason || "blocked_by_security_policy",
    blockedRuleId: null,
    bodySignature: null,
    suspectedWaf: false,
    suspectedBot: false,
    requestReferer: referer || null,
    bodyBytesRead: 0,
    bodyTruncated: false,
    elapsedMs: Math.round(performance.now() - started),
    error: "Blocked by URL security policy.",
    classification: "security_blocked",
    issueType,
    diagnosis: securityCheck.diagnosis || "URL was blocked by the configured security policy before an HTTP request was made.",
    securityPolicy: {
      allowed: false,
      reason: securityCheck.reason || null,
      url: securityCheck.url || blockedUrl,
      hostname: securityCheck.hostname || null,
      address: securityCheck.address || null,
      addressFamily: securityCheck.family || null,
      addressType: securityCheck.addressType || null,
      protocol: securityCheck.protocol || null,
    },
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
    || result.classification === "security_blocked"
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
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(result.cause?.code);
  }

  return false;
}

function hasEquivalentAdaptiveSourceGet(result, sources = [], url) {
  if (
    result?.transportFallback?.activated !== true
    || result.transportFallback.fromMethod !== "HEAD"
    || result.transportFallback.toMethod !== "GET"
    || result.method !== "GET"
    || !result.requestReferer
  ) {
    return false;
  }

  return sources.some((source) => {
    try {
      return source.page === result.requestReferer
        && sameOrigin(source.page, url);
    } catch {
      return false;
    }
  });
}

function shouldSwitchHeadTransportToGet(result, { adaptiveHeadGetEligible = false } = {}) {
  return adaptiveHeadGetEligible === true
    && result?.method === "HEAD"
    && result.status === null
    && result.classification === "network_error"
    && isHeadTransportFallbackTrigger(result);
}

function isHeadTransportFallbackTrigger(result) {
  if (result?.issueType === "timeout") {
    return true;
  }

  return [
    "ECONNRESET",
    "ETIMEDOUT",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "UND_ERR_SOCKET",
  ].includes(result?.cause?.code);
}

function buildTransportFallbackMetadata(triggerResult) {
  return {
    activated: true,
    fromMethod: "HEAD",
    toMethod: "GET",
    triggerIssueType: triggerResult?.issueType || null,
    triggerCauseCode: triggerResult?.cause?.code || null,
  };
}

function attachTransportFallbackMetadata(result, metadata) {
  if (result && metadata) {
    result.transportFallback = { ...metadata };
  }
  return result;
}

function parseRetryAfterHeader(value, nowMs = Date.now()) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const header = value.trim();
  const seconds = Number.parseFloat(header);
  let waitMs = null;
  let type = "invalid";
  if (Number.isFinite(seconds) && seconds >= 0) {
    waitMs = Math.round(seconds * 1000);
    type = "seconds";
  } else {
    const dateMs = Date.parse(header);
    if (Number.isFinite(dateMs)) {
      waitMs = Math.max(0, dateMs - nowMs);
      type = "http_date";
    }
  }

  return {
    header,
    type,
    waitMs,
    cappedWaitMs: null,
    cooldownMs: null,
    capped: false,
    cooldownApplied: false,
  };
}

function applyRetryAfterCooldown(result, { retryAfterMaxMs, onRetryAfter } = {}) {
  if (!result.retryAfter || !Number.isFinite(result.retryAfter.waitMs)) {
    return null;
  }
  if (result.status !== 429 && result.status !== 503) {
    return null;
  }

  const maxWaitMs = Math.max(0, Number.isFinite(retryAfterMaxMs) ? Math.floor(retryAfterMaxMs) : DEFAULT_RETRY_AFTER_MAX_MS);
  const cappedWaitMs = Math.min(result.retryAfter.waitMs, maxWaitMs);
  const cooldownMs = cappedWaitMs;
  result.retryAfter.cappedWaitMs = cappedWaitMs;
  result.retryAfter.cooldownMs = cooldownMs;
  result.retryAfter.capped = result.retryAfter.waitMs > cappedWaitMs;
  result.retryAfter.maxWaitMs = maxWaitMs;

  if (typeof onRetryAfter === "function" && cooldownMs > 0) {
    result.retryAfter.cooldownApplied = onRetryAfter(result.finalUrl || result.url, cooldownMs, result) === true;
  }

  return cooldownMs;
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
    result.protection = buildProtectionMetadata(result, headers);
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
    result.protection = buildProtectionMetadata(result, headers, protection);
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

function buildProtectionMetadata(result, headers, detection = null) {
  const bodySignatureRuleIds = [...new Set([
    ...(detection?.matchedPatterns || []),
    ...(result.bodySignature?.matchedPatterns || []),
  ])].sort();
  const headerEvidence = extractWafHeaderEvidence(headers);
  const matchedPatternDetails = bodySignatureRuleIds
    .map((id) => PROTECTION_BODY_PATTERNS.find((item) => item.id === id))
    .filter(Boolean);
  const provider = detection?.provider
    || matchedPatternDetails.find((item) => item.provider)?.provider
    || inferProtectionProviderFromHeaders(headerEvidence);
  const blockedReason = detection?.blockedReason
    || result.blockedReason
    || matchedPatternDetails.find((item) => item.reason)?.reason
    || null;
  const suspectedWaf = Boolean(
    detection?.suspectedWaf
    || result.suspectedWaf
    || matchedPatternDetails.some((item) => item.suspectedWaf)
    || provider,
  );
  const suspectedBot = Boolean(
    detection?.suspectedBot
    || result.suspectedBot
    || matchedPatternDetails.some((item) => item.suspectedBot),
  );
  const evidence = new Set(detection?.evidence || []);
  for (const item of headerEvidence) {
    evidence.add(`${item.header} response header`);
  }
  for (const item of matchedPatternDetails) {
    evidence.add(item.evidence);
  }

  if (!provider && !blockedReason && !suspectedWaf && !suspectedBot && headerEvidence.length === 0 && bodySignatureRuleIds.length === 0) {
    return null;
  }

  return {
    provider: provider || null,
    status: result.status ?? null,
    title: detection?.title || result.bodySignature?.title || null,
    blockedReason,
    blockedRuleId: result.blockedRuleId || detection?.blockedRuleId || null,
    suspectedWaf,
    suspectedBot,
    headerEvidence,
    bodySignatureRuleIds,
    matchedPatterns: bodySignatureRuleIds,
    evidence: [...evidence].sort(),
  };
}

function inferProtectionProviderFromHeaders(headerEvidence) {
  for (const item of headerEvidence) {
    const header = item.header.toLowerCase();
    const value = String(item.value || "").toLowerCase();
    if (header.startsWith("cf-") || value.includes("cloudflare")) {
      return "Cloudflare";
    }
    if (header.includes("akamai") || value.includes("akamai")) {
      return "Akamai";
    }
    if (header.includes("sucuri") || value.includes("sucuri")) {
      return "Sucuri";
    }
    if (header === "x-iinfo" || value.includes("incapsula") || value.includes("imperva")) {
      return "Imperva";
    }
  }
  return null;
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
    if (!matchesProtectionBodyPattern(body, pattern)) {
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

  const bodyProtectionLooksBlocked = matchedPatterns.some((id) => {
    const pattern = PROTECTION_BODY_PATTERNS.find((item) => item.id === id);
    return pattern?.suspectedWaf || pattern?.suspectedBot;
  });
  if ((!statusLooksBlocked && !bodyProtectionLooksBlocked) || evidence.length === 0) {
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
  if (result.retryAfter && (result.status === 429 || result.status === 503)) {
    return false;
  }
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

      const relTokens = tag === "link" ? parseRelTokens(attributes.get("rel")) : [];
      const linkIntent = relTokens.length > 0 ? { rel: relTokens } : {};
      if (attribute === "srcset") {
        for (const src of parseSrcset(value)) {
          links.push({ tag, attribute, value: src, ...linkIntent });
        }
      } else {
        links.push({ tag, attribute, value, ...linkIntent });
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

function extractFrameworkLinks(html, pageUrl, { siteLinkRules = {} } = {}) {
  return dedupeExtractedLinks([
    ...extractUrlLiteralsFromScripts(html),
    ...extractPathLiteralsFromScripts(html, pageUrl),
    ...extractSiteRuleLinks(html, pageUrl, siteLinkRules),
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

function extractSiteRuleLinks(html, pageUrl, siteLinkRules = {}) {
  if (!hasSiteLinkRules(siteLinkRules)) {
    return [];
  }

  const links = [];
  for (const scriptText of extractInlineScriptTexts(html)) {
    const records = [
      ...extractPayloadRecords(scriptText),
      ...extractJsonObjectPayloadRecords(scriptText),
    ];
    for (const record of records) {
      links.push(...extractSiteRuleLinksFromRecord(record, pageUrl, siteLinkRules));
    }
    links.push(...extractSiteRuleLinksFromFieldPairs(scriptText, pageUrl, siteLinkRules));
    links.push(...extractSiteRuleRouteMappingsFromFieldPairs(scriptText, pageUrl, siteLinkRules));
  }

  return links;
}

function extractSiteRuleLinksFromRecord(record, pageUrl, siteLinkRules) {
  const links = [];

  for (const field of siteLinkRules.fields.externalUrl) {
    const value = getRecordString(record, field);
    if (!value || !safeUrl(value)) {
      continue;
    }
    links.push(makeSiteRuleLink(value, `site-rule:externalUrl:${field}`));
  }

  for (const field of siteLinkRules.fields.youtubeId) {
    const value = getRecordString(record, field);
    if (!isLikelyYoutubeId(value)) {
      continue;
    }
    links.push(makeSiteRuleLink(`https://www.youtube.com/watch?v=${value}`, `site-rule:youtubeId:${field}`));
  }

  for (const field of siteLinkRules.fields.routePath) {
    const value = getRecordString(record, field);
    if (!value || !value.startsWith("/") || shouldIgnorePayloadPath(value)) {
      continue;
    }
    links.push(makeSiteRuleLink(new URL(value, pageUrl).toString(), `site-rule:routePath:${field}`));
  }

  for (const mapping of siteLinkRules.routeMappings) {
    if (!recordMatchesWhen(record, mapping.when)) {
      continue;
    }
    const rendered = renderTemplate(mapping.template, record);
    if (!rendered) {
      continue;
    }
    const value = safeUrl(rendered) ? rendered : new URL(rendered, pageUrl).toString();
    links.push(makeSiteRuleLink(value, `site-rule:routeMapping:${mapping.name || mapping.template}`));
  }

  return links;
}

function extractSiteRuleLinksFromFieldPairs(scriptText, pageUrl, siteLinkRules) {
  const links = [];
  const stringFields = [
    ...siteLinkRules.fields.externalUrl.map((field) => ({ field, kind: "externalUrl" })),
    ...siteLinkRules.fields.youtubeId.map((field) => ({ field, kind: "youtubeId" })),
    ...siteLinkRules.fields.routePath.map((field) => ({ field, kind: "routePath" })),
  ];

  for (const { field, kind } of stringFields) {
    const regex = new RegExp(`["']${escapeRegExp(field)}["']\\s*:\\s*["']([^"']+)["']`, "g");
    for (const match of scriptText.matchAll(regex)) {
      const raw = decodeJavaScriptString(match[1]);
      if (kind === "externalUrl" && safeUrl(raw)) {
        links.push(makeSiteRuleLink(raw, `site-rule:${kind}:${field}`));
      } else if (kind === "youtubeId" && isLikelyYoutubeId(raw)) {
        links.push(makeSiteRuleLink(`https://www.youtube.com/watch?v=${raw}`, `site-rule:${kind}:${field}`));
      } else if (kind === "routePath" && raw.startsWith("/") && !shouldIgnorePayloadPath(raw)) {
        links.push(makeSiteRuleLink(new URL(raw, pageUrl).toString(), `site-rule:${kind}:${field}`));
      }
    }
  }

  return links;
}

function extractSiteRuleRouteMappingsFromFieldPairs(scriptText, pageUrl, siteLinkRules) {
  if (!siteLinkRules.routeMappings.length) {
    return [];
  }

  const fields = [...new Set(siteLinkRules.routeMappings.flatMap(getRouteMappingFields))];
  const record = extractUniqueFieldPairRecord(scriptText, fields);
  if (!record) {
    return [];
  }

  const links = [];
  for (const mapping of siteLinkRules.routeMappings) {
    if (!recordMatchesWhen(record, mapping.when)) {
      continue;
    }
    const rendered = renderTemplate(mapping.template, record);
    if (!rendered) {
      continue;
    }
    const value = safeUrl(rendered) ? rendered : new URL(rendered, pageUrl).toString();
    links.push(makeSiteRuleLink(value, `site-rule:routeMapping:${mapping.name || mapping.template}`));
  }
  return links;
}

function makeSiteRuleLink(value, attribute) {
  return {
    tag: "payload",
    attribute,
    value,
    sourceType: "site_rule_derived",
  };
}

function extractPayloadRecords(scriptText) {
  const records = [];
  const parsed = parseStructuredPayload(scriptText);
  if (!parsed) {
    return records;
  }

  const root = parsed.root;
  const table = parsed.table;
  const seen = new Set();

  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (!isPlainObject(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    const resolved = resolvePayloadValue(value, table);
    if (isPlainObject(resolved)) {
      Object.defineProperty(resolved, "__raw", {
        value,
        enumerable: false,
      });
      records.push(resolved);
    }
    for (const item of Object.values(value)) {
      visit(item);
    }
  };

  visit(root);
  return records;
}

function extractJsonObjectPayloadRecords(scriptText) {
  const records = [];
  const seen = new Set();

  for (const fragment of extractJsonObjectFragments(scriptText)) {
    if (seen.has(fragment)) {
      continue;
    }
    seen.add(fragment);
    try {
      const parsed = JSON.parse(fragment);
      collectPlainObjectRecords(parsed, records);
    } catch {
      // Ignore JavaScript object literals; site rules only derive from JSON-like records.
    }
  }

  return records;
}

function collectPlainObjectRecords(value, records, seen = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPlainObjectRecords(item, records, seen);
    }
    return;
  }
  if (!isPlainObject(value) || seen.has(value)) {
    return;
  }
  seen.add(value);
  records.push(value);
  for (const item of Object.values(value)) {
    collectPlainObjectRecords(item, records, seen);
  }
}

function extractJsonObjectFragments(text) {
  const fragments = [];
  const starts = [];
  let quote = null;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      starts.push(index);
    } else if (char === "}" && starts.length > 0) {
      const start = starts.pop();
      fragments.push(text.slice(start, index + 1));
    }
  }

  return fragments;
}

function parseStructuredPayload(scriptText) {
  const trimmed = scriptText.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return null;
  }

  try {
    const root = JSON.parse(trimmed);
    return {
      root,
      table: Array.isArray(root) ? root : null,
    };
  } catch {
    return null;
  }
}

function resolvePayloadValue(value, table, depth = 0) {
  if (depth > 5 || !table) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < table.length) {
    return resolvePayloadValue(table[value], table, depth + 1);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolvePayloadValue(item, table, depth + 1));
  }
  if (isPlainObject(value)) {
    const resolved = {};
    for (const [key, item] of Object.entries(value)) {
      resolved[key] = resolvePayloadValue(item, table, depth + 1);
    }
    return resolved;
  }
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecordString(record, field) {
  const value = record?.[field];
  if (value === null || value === undefined) {
    return null;
  }
  return String(value).trim();
}

function recordMatchesWhen(record, when = {}) {
  for (const [field, expected] of Object.entries(when)) {
    const actual = record?.[field];
    const raw = record?.__raw?.[field];
    if (expected === "*") {
      const hasActual = actual !== null && actual !== undefined && String(actual).trim() !== "";
      const hasRaw = raw !== null && raw !== undefined && String(raw).trim() !== "";
      if (!hasActual && !hasRaw) {
        return false;
      }
      continue;
    }
    if (String(actual) !== String(expected) && String(raw) !== String(expected)) {
      return false;
    }
  }
  return true;
}

function renderTemplate(template, record) {
  let missing = false;
  const rendered = String(template || "").replace(/\{([a-zA-Z0-9_.-]+)\}/g, (_, field) => {
    const value = getRecordString(record, field);
    if (!value) {
      missing = true;
      return "";
    }
    return encodePathTemplateValue(value);
  });

  return missing ? null : rendered;
}

function encodePathTemplateValue(value) {
  return String(value)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function getRouteMappingFields(mapping) {
  return [
    ...Object.keys(mapping.when || {}),
    ...getTemplateFields(mapping.template),
  ];
}

function getTemplateFields(template) {
  const fields = [];
  const regex = /\{([a-zA-Z0-9_.-]+)\}/g;
  for (const match of String(template || "").matchAll(regex)) {
    fields.push(match[1]);
  }
  return fields;
}

function extractUniqueFieldPairRecord(scriptText, fields) {
  const record = {};
  let found = false;

  for (const field of fields) {
    const regex = new RegExp(`["']${escapeRegExp(field)}["']\\s*:\\s*["']([^"']+)["']`, "g");
    const values = new Set();
    for (const match of scriptText.matchAll(regex)) {
      values.add(decodeJavaScriptString(match[1]));
    }
    if (values.size === 1) {
      [record[field]] = values;
      found = true;
    }
  }

  return found ? record : null;
}

function isLikelyYoutubeId(value) {
  return /^[a-zA-Z0-9_-]{8,32}$/.test(String(value || ""));
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

function parseRelTokens(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isConnectionOnlyResourceHint(link) {
  if (link?.tag !== "link" || link?.attribute !== "href") {
    return false;
  }
  const rel = Array.isArray(link.rel) ? link.rel : [];
  return rel.includes("preconnect") || rel.includes("dns-prefetch");
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

function buildHtmlSitemapFallbackCandidates(pageUrl, startOrigin) {
  const prefixes = getHtmlSitemapFallbackPrefixes(pageUrl);
  const candidates = [];

  for (const prefix of prefixes) {
    for (const path of HTML_SITEMAP_FALLBACK_PATHS) {
      candidates.push(new URL(`${prefix}/${path}`, startOrigin).toString());
    }
  }
  for (const path of HTML_SITEMAP_FALLBACK_PATHS) {
    candidates.push(new URL(`/${path}`, startOrigin).toString());
  }

  return [...new Set(candidates)].slice(0, HTML_SITEMAP_FALLBACK_CANDIDATE_LIMIT);
}

function getHtmlSitemapFallbackPrefixes(pageUrl) {
  const url = new URL(pageUrl);
  const firstSegment = url.pathname.split("/").filter(Boolean)[0];
  if (!firstSegment || firstSegment.includes(".")) {
    return [];
  }
  return [`/${firstSegment}`];
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

function getValidationPriority(item, urlValue) {
  const kind = classifyUrlKind(urlValue, {
    isExternal: item?.isExternal,
    linkType: item?.linkType,
  });
  if (kind.immutableAsset) {
    return VALIDATION_PRIORITIES.immutableAsset;
  }
  if (kind.external) {
    return VALIDATION_PRIORITIES.external;
  }
  if (kind.document) {
    return VALIDATION_PRIORITIES.document;
  }
  if (kind.media) {
    return VALIDATION_PRIORITIES.media;
  }
  if (kind.asset) {
    return VALIDATION_PRIORITIES.asset;
  }
  if (kind.content) {
    return VALIDATION_PRIORITIES.content;
  }
  if (kind.page) {
    return VALIDATION_PRIORITIES.page;
  }
  return VALIDATION_PRIORITIES.unknown;
}

function createCheckedKindCounts() {
  return {
    total: 0,
    pages: 0,
    content: 0,
    external: 0,
    documents: 0,
    media: 0,
    assets: 0,
    nuxtAssets: 0,
    immutableAssets: 0,
    unknown: 0,
  };
}

function incrementCheckedKindCounts(counts, kind) {
  counts.total += 1;
  if (kind.page) {
    counts.pages += 1;
  }
  if (kind.content) {
    counts.content += 1;
  }
  if (kind.external) {
    counts.external += 1;
  }
  if (kind.document) {
    counts.documents += 1;
  }
  if (kind.media) {
    counts.media += 1;
  }
  if (kind.asset) {
    counts.assets += 1;
  }
  if (kind.nuxtAsset) {
    counts.nuxtAssets += 1;
  }
  if (kind.immutableAsset) {
    counts.immutableAssets += 1;
  }
  if (kind.unknown) {
    counts.unknown += 1;
  }
}

function classifyCheckedResultKind(result, sources = []) {
  return classifyUrlKind(result?.url || "", {
    isExternal: isExternalCheckedResult(result, sources),
  });
}

function classifyUrlKind(urlValue, { isExternal = false, linkType = null } = {}) {
  try {
    const parsed = new URL(urlValue);
    const extension = getPathExtension(parsed.pathname);
    const document = linkType === "download" || DOWNLOAD_EXTENSIONS.has(extension);
    const media = linkType === "media" || MEDIA_EXTENSIONS.has(extension);
    const nuxtAsset = parsed.pathname.includes("/_nuxt/");
    const extensionAsset = ASSET_EXTENSIONS.has(extension);
    const asset = linkType === "asset" || nuxtAsset || (extensionAsset && !document && !media);
    const immutableAsset = asset && isLikelyImmutableAssetUrl(parsed);
    const page = !document && !media && !asset && looksLikePage(urlValue);
    const content = page && !isExternal;

    return {
      page,
      content,
      external: Boolean(isExternal),
      document,
      media,
      asset,
      nuxtAsset,
      immutableAsset,
      unknown: !page && !document && !media && !asset,
    };
  } catch {
    return {
      page: false,
      content: false,
      external: Boolean(isExternal),
      document: false,
      media: false,
      asset: false,
      nuxtAsset: false,
      immutableAsset: false,
      unknown: true,
    };
  }
}

function isExternalCheckedResult(result, sources = []) {
  if (!result?.url || sources.length === 0) {
    return false;
  }
  return sources.some((source) => {
    try {
      return source.page && !sameOrigin(result.url, source.page);
    } catch {
      return false;
    }
  });
}

function isLikelyImmutableAssetUrl(parsed) {
  if (parsed.pathname.includes("/_nuxt/")) {
    return true;
  }
  const lastSegment = parsed.pathname.split("/").pop() || "";
  return /(?:^|[-_.])[a-f0-9]{8,}(?:[-_.]|$)/i.test(lastSegment);
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

function normalizeSiteLinkRules(value = {}, source = "site-link-rules") {
  const fields = value.fields && typeof value.fields === "object" ? value.fields : {};
  const routeMappings = Array.isArray(value.routeMappings) ? value.routeMappings : [];

  return {
    source,
    fields: {
      externalUrl: normalizeStringList(fields.externalUrl),
      youtubeId: normalizeStringList(fields.youtubeId),
      routePath: normalizeStringList(fields.routePath),
    },
    routeMappings: routeMappings
      .map((mapping) => ({
        name: String(mapping.name || "").trim(),
        template: String(mapping.template || "").trim(),
        when: normalizeWhenClause(mapping.when),
      }))
      .filter((mapping) => mapping.template && Object.keys(mapping.when).length > 0),
  };
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeWhenClause(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized = {};
  for (const [key, item] of Object.entries(value)) {
    const field = String(key || "").trim();
    if (!field || item === null || item === undefined) {
      continue;
    }
    normalized[field] = String(item).trim();
  }
  return normalized;
}

function hasSiteLinkRules(value = {}) {
  return Boolean(
    value.fields?.externalUrl?.length
    || value.fields?.youtubeId?.length
    || value.fields?.routePath?.length
    || value.routeMappings?.length
  );
}

function countSiteLinkRules(value = {}) {
  return (value.fields?.externalUrl?.length || 0)
    + (value.fields?.youtubeId?.length || 0)
    + (value.fields?.routePath?.length || 0)
    + (value.routeMappings?.length || 0);
}

function normalizeRulesTrace(value, fallback = {}) {
  const trace = isPlainObject(value) ? value : {};
  return {
    schemaVersion: String(trace.schemaVersion || RULES_TRACE_SCHEMA_VERSION),
    domainCategoryRules: normalizeRulesTraceEntry(trace.domainCategoryRules || fallback.domainCategoryRules),
    externalRiskRules: normalizeRulesTraceEntry(trace.externalRiskRules || fallback.externalRiskRules),
    siteLinkRules: normalizeRulesTraceEntry(trace.siteLinkRules || fallback.siteLinkRules),
  };
}

function normalizeRulesTraceEntry(value = {}) {
  const entry = isPlainObject(value) ? value : {};
  return {
    enabled: entry.enabled === true,
    sourceType: entry.sourceType || null,
    source: entry.source || null,
    finalUrl: entry.finalUrl || null,
    loadedAt: entry.loadedAt || null,
    rulesVersion: entry.rulesVersion || null,
    fingerprint: entry.fingerprint || null,
    byteSize: Number.isInteger(entry.byteSize) ? entry.byteSize : null,
    ruleCount: Number.isInteger(entry.ruleCount) ? entry.ruleCount : 0,
    redirectCount: Number.isInteger(entry.redirectCount) ? entry.redirectCount : 0,
    warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : [],
  };
}

function buildInlineRulesTraceEntry({ source = null, ruleCount = 0 } = {}) {
  const enabled = Boolean(source) || ruleCount > 0;
  return normalizeRulesTraceEntry({
    enabled,
    sourceType: source ? getRulesSourceType(source) : (ruleCount > 0 ? "inline" : null),
    source: source || (ruleCount > 0 ? "inline" : null),
    ruleCount,
  });
}

function getRulesSourceType(source) {
  if (!source) {
    return null;
  }
  return /^https?:\/\//i.test(String(source)) ? "url" : "file";
}

function extractRulesVersion(parsed) {
  if (!isPlainObject(parsed)) {
    return null;
  }
  return parsed.schemaVersion || parsed.rulesVersion || parsed.version || null;
}

function buildLoadedRulesTraceEntry({
  source,
  loaded,
  parsed,
  ruleCount,
  warnings = [],
}) {
  return normalizeRulesTraceEntry({
    enabled: true,
    sourceType: loaded.sourceType,
    source,
    finalUrl: loaded.finalUrl || null,
    loadedAt: loaded.loadedAt,
    rulesVersion: extractRulesVersion(parsed),
    fingerprint: loaded.fingerprint,
    byteSize: loaded.byteSize,
    ruleCount,
    redirectCount: loaded.redirectCount || 0,
    warnings: [...(loaded.warnings || []), ...warnings],
  });
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

function getResultHost(result) {
  for (const value of [result?.finalUrl, result?.url]) {
    if (typeof value !== "string" || !value) {
      continue;
    }
    try {
      return new URL(value).host;
    } catch {
      // Ignore malformed diagnostic values.
    }
  }
  return "unknown";
}

function createEmptyPersistentCache() {
  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    policyVersion: CACHE_POLICY_VERSION,
    generatedBy: buildReportGenerator(),
    updatedAt: new Date().toISOString(),
    entries: {},
  };
}

function normalizePersistentCache(value) {
  if (
    !value
    || value.cacheSchemaVersion !== CACHE_SCHEMA_VERSION
    || value.policyVersion !== CACHE_POLICY_VERSION
    || !value.entries
    || typeof value.entries !== "object"
    || Array.isArray(value.entries)
  ) {
    return createEmptyPersistentCache();
  }

  return {
    cacheSchemaVersion: CACHE_SCHEMA_VERSION,
    policyVersion: CACHE_POLICY_VERSION,
    generatedBy: value.generatedBy || buildReportGenerator(),
    updatedAt: value.updatedAt || new Date().toISOString(),
    entries: value.entries,
  };
}

function pruneExpiredPersistentCacheEntries(cache, nowMs = Date.now()) {
  for (const [key, entry] of Object.entries(cache.entries || {})) {
    if (Date.parse(entry?.expiresAt || "") <= nowMs) {
      delete cache.entries[key];
    }
  }
}

function isPersistentCacheEntryExpired(entry, nowMs = Date.now()) {
  return Date.parse(entry?.expiresAt || "") <= nowMs;
}

function getPersistentCacheTtlCategory(result) {
  if (result.classification === "security_blocked") {
    return "security_blocked";
  }
  if (result.ok || (result.status >= 300 && result.status < 400)) {
    return "success";
  }
  if (result.status === 404 || result.status === 410) {
    return "missing";
  }
  if (
    result.status === 403
    || result.status === 429
    || result.status >= 500
    || result.classification === "protected"
    || result.suspectedWaf
    || result.suspectedBot
  ) {
    return "temporary_failure";
  }
  if (result.issueType === "timeout" || result.classification === "network_error") {
    return "network_error";
  }
  return "temporary_failure";
}

function getPersistentCacheTtlMs(result, options) {
  const hourMs = 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const successMs = normalizeCacheTtlHours(options.cacheTtlHours) * hourMs;
  const category = getPersistentCacheTtlCategory(result);
  if (category === "success" || category === "security_blocked") {
    return successMs;
  }
  if (category === "missing") {
    return Math.min(successMs, 4 * hourMs);
  }
  if (category === "temporary_failure") {
    return Math.min(successMs, 30 * minuteMs);
  }
  return null;
}

function redactCacheStoredResult(result, options) {
  const redactionOptions = {
    ...options,
    redactSensitiveQuery: true,
  };
  const redacted = redactOutputValue(stripBody(result), redactionOptions);
  delete redacted.cache;
  return redacted;
}

function hashLabel(value) {
  return `sha256:${createHash("sha256").update(String(value || "")).digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function getRefererMode(url, referer) {
  if (!referer) {
    return "none";
  }
  return sameOrigin(url, referer) ? "same_origin_source" : "external_source";
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
  if (hasMeaningfulProtectionEvidence(result)) {
    return "needs_review";
  }
  if (result.ok) {
    return "recovered";
  }
  if (result.status === 404 || result.status === 410) {
    return "confirmed_missing";
  }
  return "needs_review";
}

function getConfirmationReason(result) {
  if (hasMeaningfulProtectionEvidence(result)) {
    return result.suspectedBot || result.protection?.suspectedBot ? "blocked_bot" : "blocked_waf";
  }
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

function isConfirmableMissingResult(result) {
  return isDirectMissingResult(result) || isRedirectMissingResult(result);
}

function isDirectMissingResult(result) {
  return !result?.ok
    && result.issueType === "not_found"
    && (result.status === 404 || result.status === 410);
}

function isRedirectMissingResult(result) {
  return !result?.ok
    && result.issueType === "redirect_to_error"
    && result.redirected === true
    && (result.status === 404 || result.status === 410)
    && Array.isArray(result.redirectIssues)
    && result.redirectIssues.includes("redirect_to_error");
}

function hasMeaningfulProtectionEvidence(result) {
  return result?.classification === "protected"
    || result?.issueType === "protected"
    || result?.suspectedWaf === true
    || result?.suspectedBot === true
    || result?.protection?.suspectedWaf === true
    || result?.protection?.suspectedBot === true
    || Boolean(result?.blockedReason)
    || Boolean(result?.protection?.blockedReason);
}

function createClientRedirectEvidence(reason, overrides = {}) {
  return {
    detected: false,
    source: null,
    attribute: null,
    targetUrl: null,
    targetChecked: false,
    targetStatus: null,
    targetOk: null,
    targetFinalUrl: null,
    targetIssueType: null,
    targetCheckedAt: null,
    targetElapsedMs: null,
    reason,
    ...overrides,
  };
}

function detectClientRedirectEvidence(result, baseUrl) {
  if (!result || result.ok) {
    return createClientRedirectEvidence("not_applicable");
  }
  if (result.status !== 404 && result.status !== 410) {
    return createClientRedirectEvidence("not_not_found_response");
  }
  if (!isHtml(result.contentType)) {
    return createClientRedirectEvidence("non_html_response");
  }

  const html = result.diagnosticBody || result.body || "";
  if (!html) {
    return createClientRedirectEvidence("no_diagnostic_body");
  }

  const metaRefresh = extractMetaRefresh(html);
  if (metaRefresh) {
    return buildDetectedClientRedirectEvidence({
      source: "meta_refresh",
      attribute: "http-equiv=refresh",
      rawTarget: metaRefresh,
      baseUrl,
    });
  }

  const scriptRedirect = extractJavaScriptRedirects(html)[0];
  if (scriptRedirect) {
    return buildDetectedClientRedirectEvidence({
      source: "script_literal",
      attribute: scriptRedirect.attribute,
      rawTarget: scriptRedirect.value,
      baseUrl,
    });
  }

  return createClientRedirectEvidence("no_client_redirect");
}

function buildDetectedClientRedirectEvidence({ source, attribute, rawTarget, baseUrl }) {
  const targetUrl = resolveHttpUrl(rawTarget, baseUrl);
  if (!targetUrl) {
    return createClientRedirectEvidence("target_not_http_or_invalid", {
      detected: true,
      source,
      attribute,
    });
  }

  return createClientRedirectEvidence("target_queued", {
    detected: true,
    source,
    attribute,
    targetUrl,
  });
}

function getClientRedirectEvidenceReason(result) {
  if (result.ok) {
    return "target_reachable";
  }
  if (result.classification === "protected" || result.suspectedWaf || result.suspectedBot) {
    return result.suspectedBot ? "target_blocked_bot" : "target_blocked_waf";
  }
  if (result.issueType === "timeout") {
    return "target_timeout";
  }
  if (result.classification === "security_blocked" || result.issueType?.includes("blocked")) {
    return "target_blocked_by_security_policy";
  }
  if (result.classification === "network_error" || result.issueType === "network_error") {
    return "target_network_error";
  }
  if (result.status === 404 || result.status === 410) {
    return "target_still_not_found";
  }
  return result.status ? `target_http_${result.status}` : "target_unknown";
}

function isTransientConfirmationResult(result) {
  return result.status === 429
    || result.issueType === "timeout"
    || result.issueType === "network_error"
    || result.classification === "network_error";
}

const INTERPRETATION_CATEGORIES = [
  "action_required",
  "needs_review",
  "external_limited",
  "likely_problem",
  "redirect_ok",
  "ok",
  "page_quality_notice",
];

const INTERPRETATION_LABELS = {
  action_required: "需處理",
  needs_review: "需人工確認",
  external_limited: "外站限制",
  likely_problem: "可能失效",
  redirect_ok: "已轉址仍可用",
  ok: "可先忽略 / 正常",
  page_quality_notice: "頁內品質提醒",
};

const INTERPRETATION_ACTIONS = {
  action_required: "請優先確認來源頁，並修正或移除連結。",
  needs_review: "請用瀏覽器人工確認是否可正常開啟，再決定是否交辦修正。",
  external_limited: "外部網站可能拒絕或限制工具請求，建議人工確認或與對方網站窗口協調。",
  likely_problem: "請確認網址、伺服器狀態或頁面是否仍存在。",
  redirect_ok: "連結目前可到達；若 final URL 穩定，可視情況更新原連結。",
  ok: "目前不需處理。",
  page_quality_notice: "此項屬頁內品質提醒，請視內容維護需求處理。",
};

const INTERPRETATION_SEVERITY = {
  action_required: "high",
  likely_problem: "medium",
  needs_review: "review",
  external_limited: "review",
  redirect_ok: "info",
  ok: "ok",
  page_quality_notice: "notice",
};

function buildInterpretation(category) {
  return {
    category,
    label: INTERPRETATION_LABELS[category] || category,
    severity: INTERPRETATION_SEVERITY[category] || "review",
    action: INTERPRETATION_ACTIONS[category] || INTERPRETATION_ACTIONS.needs_review,
    needsManualReview: ["needs_review", "external_limited", "likely_problem"].includes(category),
  };
}

function buildResultInterpretation(result, { startUrl = "" } = {}) {
  if (result?.interpretation?.category) {
    return {
      ...buildInterpretation(result.interpretation.category),
      ...result.interpretation,
    };
  }

  const issueType = result.issueType || getIssueType(result);
  const confirmationOutcome = result.confirmation?.outcome;
  const externalLimited = isExternalLimitedResult(result, startUrl);

  if (result.ok) {
    return buildInterpretation(result.redirected ? "redirect_ok" : "ok");
  }
  if (issueType === "redirect_to_error") {
    if (result.confirmation?.candidate === true && result.confirmation?.checked === true) {
      return buildInterpretation(confirmationOutcome === "confirmed_missing" ? "action_required" : "needs_review");
    }
    if (hasMeaningfulProtectionEvidence(result)) {
      return buildInterpretation(externalLimited ? "external_limited" : "needs_review");
    }
    return buildInterpretation("action_required");
  }
  if (issueType === "too_many_redirects" || issueType === "redirect_loop") {
    return buildInterpretation("action_required");
  }
  if (issueType === "not_found") {
    if (confirmationOutcome === "confirmed_missing") {
      return buildInterpretation("action_required");
    }
    if (confirmationOutcome === "needs_review") {
      return buildInterpretation(externalLimited ? "external_limited" : "needs_review");
    }
    return buildInterpretation("likely_problem");
  }
  if (
    issueType === "protected"
    || issueType === "access_denied"
    || issueType === "timeout"
    || issueType === "network_error"
    || result.status === 429
    || result.suspectedWaf
    || result.suspectedBot
  ) {
    return buildInterpretation(externalLimited ? "external_limited" : "needs_review");
  }
  if (result.status >= 400 || issueType === "http_error" || issueType === "unknown_error") {
    return buildInterpretation("likely_problem");
  }
  if (result.redirected) {
    return buildInterpretation("redirect_ok");
  }
  return buildInterpretation("needs_review");
}

function isExternalLimitedResult(result, startUrl) {
  if (!result?.url || !startUrl) {
    return false;
  }
  const issueType = result.issueType || getIssueType(result);
  if (!["protected", "access_denied", "timeout", "network_error", "http_error", "unknown_error"].includes(issueType)
      && result.status !== 429
      && !result.suspectedWaf
      && !result.suspectedBot) {
    return false;
  }
  try {
    return new URL(result.url).origin !== new URL(startUrl).origin;
  } catch {
    return false;
  }
}

function createEmptyInterpretationCounts() {
  return INTERPRETATION_CATEGORIES.reduce((counts, category) => {
    counts[category] = 0;
    return counts;
  }, {});
}

function countInterpretationByCategory(items) {
  const counts = createEmptyInterpretationCounts();
  for (const item of items) {
    const category = item.interpretation?.category || "needs_review";
    if (Object.prototype.hasOwnProperty.call(counts, category)) {
      counts[category] += 1;
    } else {
      counts.needs_review += 1;
    }
  }
  return counts;
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

function deriveCoverageStatus(reportLike = {}) {
  const summary = reportLike.summary && typeof reportLike.summary === "object" ? reportLike.summary : {};
  const runStatus = reportLike.runStatus && typeof reportLike.runStatus === "object" ? reportLike.runStatus : {};
  const options = reportLike.options && typeof reportLike.options === "object" ? reportLike.options : {};
  const startPageFetchFailed = reportLike.startPageFetchFailed === true || hasStartPageFetchFailureEvidence(reportLike);
  const pageBudgetStopEvidence = reportLike.pageBudgetStopEvidence === true;
  const discoveryReasons = [];
  const validationReasons = [];
  const details = buildCoverageDetails({ summary, runStatus, options, pageBudgetStopEvidence });

  if (runStatus.stoppedByUser === true || runStatus.stopReason === "stopped_by_user") {
    validationReasons.push("stopped_by_user");
  }

  if (hasIncompleteValidationEvidence(runStatus)) {
    validationReasons.push("validation_incomplete");
  }

  if (hasSitemapSeedTruncationEvidence({ summary, details })) {
    discoveryReasons.push("sitemap_seed_truncated");
  }

  if (startPageFetchFailed) {
    discoveryReasons.push("start_page_fetch_failed");
  }

  if (hasMaxPagesReachedEvidence({ summary, runStatus, details, discoveryReasons })) {
    discoveryReasons.push("max_pages_reached");
  }

  const reasons = [...new Set([...discoveryReasons, ...validationReasons])];
  return {
    status: reasons.length > 0 ? "incomplete" : "complete",
    incomplete: reasons.length > 0,
    reasons,
    discovery: {
      status: discoveryReasons.length > 0 ? "incomplete" : "complete",
      incomplete: discoveryReasons.length > 0,
      reasons: [...new Set(discoveryReasons)],
    },
    validation: {
      status: validationReasons.length > 0 ? "incomplete" : "complete",
      incomplete: validationReasons.length > 0,
      reasons: [...new Set(validationReasons)],
    },
    details,
  };
}

function buildCoverageDetails({ summary, runStatus, options, pageBudgetStopEvidence = false }) {
  const sitemapPairs = getSitemapCoveragePairs(summary);
  const discoveredCounts = sitemapPairs
    .map((pair) => pair.discovered)
    .filter((value) => Number.isFinite(value));
  const seededCounts = sitemapPairs
    .map((pair) => pair.seeded)
    .filter((value) => Number.isFinite(value));

  return {
    pagesCrawled: toFiniteNumber(summary.pagesCrawled),
    maxPages: toFiniteNumber(options.maxPages),
    pendingPages: toFiniteNumber(runStatus.pendingPages),
    pendingValidations: toFiniteNumber(runStatus.pendingValidations),
    activeValidationTasks: toFiniteNumber(runStatus.activeValidationTasks),
    sitemapDiscoveredUrls: discoveredCounts.length > 0 ? Math.max(...discoveredCounts) : null,
    sitemapSeededUrls: seededCounts.length > 0 ? Math.max(...seededCounts) : null,
    sitemapIgnoredByMaxPages: sitemapPairs.some((pair) => pair.ignoredByMaxPages),
    pageBudgetStopEvidence: pageBudgetStopEvidence || hasPageBudgetStopEvidence(summary),
  };
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function hasStartPageFetchFailureEvidence(reportLike = {}) {
  const startUrl = typeof reportLike.startUrl === "string" ? reportLike.startUrl : "";
  const checked = Array.isArray(reportLike.checked) ? reportLike.checked : [];
  if (!startUrl || checked.length === 0) {
    return false;
  }

  const options = reportLike.options && typeof reportLike.options === "object" ? reportLike.options : {};
  const canonicalStrategy = options.canonicalStrategy || DEFAULTS.canonicalStrategy;
  const startCanonicalUrl = canonicalizeCheckedUrl(startUrl, canonicalStrategy);
  const startResult = checked.find((result) => (
    result?.url === startUrl
    || result?.normalizedFrom === startUrl
    || result?.canonicalUrl === startCanonicalUrl
  ));
  return isStartPageDiscoveryInputFailure(startResult);
}

function isStartPageDiscoveryInputFailure(result) {
  if (!result || result.cancelledByStop === true) {
    return false;
  }
  if (result.ok !== true) {
    return true;
  }
  if (!isHtml(result.contentType)) {
    return true;
  }
  if (Object.prototype.hasOwnProperty.call(result, "bodyBytesRead")) {
    return toFiniteNumber(result.bodyBytesRead) <= 0;
  }
  return false;
}

function hasIncompleteValidationEvidence(runStatus) {
  const pendingValidations = toFiniteNumber(runStatus.pendingValidations);
  const activeValidationTasks = toFiniteNumber(runStatus.activeValidationTasks);
  return runStatus.status !== "complete" && (pendingValidations + activeValidationTasks) > 0;
}

function getSitemapCoveragePairs(summary) {
  const pairs = [];
  const sitemap = summary.incremental?.sitemap;
  const sitemapSeed = sitemap?.seed;
  if (sitemap && typeof sitemap === "object" && sitemapSeed && typeof sitemapSeed === "object") {
    pairs.push({
      discovered: toFiniteNumber(sitemap.urlCount),
      seeded: toFiniteNumber(sitemapSeed.seeded),
      ignoredByMaxPages: toFiniteNumber(sitemapSeed.ignoredByReason?.max_pages) > 0,
    });
  }

  const xmlSitemap = summary.discoveryFallback?.xmlSitemap;
  if (xmlSitemap && typeof xmlSitemap === "object") {
    pairs.push({
      discovered: toFiniteNumber(xmlSitemap.urlsDiscovered),
      seeded: toFiniteNumber(xmlSitemap.urlsSeeded),
      ignoredByMaxPages: false,
    });
  }

  return pairs;
}

function hasSitemapSeedTruncationEvidence({ summary, details }) {
  return getSitemapCoveragePairs(summary).some((pair) => {
    if (pair.discovered <= pair.seeded) {
      return false;
    }
    return pair.ignoredByMaxPages
      || (details.maxPages > 0 && details.pagesCrawled >= details.maxPages && pair.seeded <= details.maxPages);
  });
}

function hasMaxPagesReachedEvidence({ summary, runStatus, details, discoveryReasons }) {
  if (details.maxPages <= 0 || details.pagesCrawled < details.maxPages) {
    return false;
  }

  return details.pendingPages > 0
    || details.sitemapIgnoredByMaxPages
    || discoveryReasons.includes("sitemap_seed_truncated")
    || details.pageBudgetStopEvidence
    || runStatus.stopReason === "max_pages";
}

function hasPageBudgetStopEvidence(summary) {
  const xmlSitemap = summary.discoveryFallback?.xmlSitemap;
  const htmlSitemap = summary.discoveryFallback?.htmlSitemap;
  return xmlSitemap?.reason === "max_pages"
    || htmlSitemap?.reason === "max_pages";
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
    blocked_scheme: "Blocked scheme",
    blocked_localhost: "Blocked localhost",
    blocked_private_ip: "Blocked private IP",
    blocked_link_local_ip: "Blocked link-local IP",
    blocked_metadata_ip: "Blocked metadata IP",
    blocked_reserved_ip: "Blocked reserved IP",
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
  if (result.classification === "security_blocked") {
    return `Blocked by security policy (${result.securityPolicy?.reason || result.issueType})`;
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

function decodeJavaScriptString(value) {
  const text = decodeHtmlEntities(String(value || ""));
  try {
    return JSON.parse(`"${text.replace(/"/g, '\\"')}"`);
  } catch {
    return text;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let siteLinkRulesSource = null;
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
    if (arg === "--block-private-ip") {
      options.blockPrivateIp = true;
      explicitOptions.add("blockPrivateIp");
      continue;
    }
    if (arg === "--allow-private-ip") {
      options.allowPrivateIp = true;
      explicitOptions.add("allowPrivateIp");
      continue;
    }
    if (arg === "--allow-localhost") {
      options.allowLocalhost = true;
      explicitOptions.add("allowLocalhost");
      continue;
    }
    if (arg === "--authorized-scan") {
      options.authorizedScan = true;
      explicitOptions.add("authorizedScan");
      continue;
    }
    if (arg === "--protection-body-hash") {
      options.protectionBodyHash = true;
      explicitOptions.add("protectionBodyHash");
      continue;
    }
    if (arg === "--authorization-note") {
      options.authorizationNote = args.shift();
      if (!options.authorizationNote || options.authorizationNote.startsWith("-")) {
        throw new Error("--authorization-note requires a value");
      }
      explicitOptions.add("authorizationNote");
      continue;
    }
    if (arg === "--no-robots") {
      options.robotsTxt = false;
      explicitOptions.add("robotsTxt");
      continue;
    }
    if (arg === "--keep-alive") {
      options.keepAlive = true;
      explicitOptions.add("keepAlive");
      continue;
    }
    if (arg === "--no-keep-alive") {
      options.keepAlive = false;
      explicitOptions.add("keepAlive");
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
    if (arg === "--redact-sensitive-query") {
      options.redactSensitiveQuery = true;
      explicitOptions.add("redactSensitiveQuery");
      continue;
    }
    if (arg === "--no-redact-sensitive-query") {
      options.redactSensitiveQuery = false;
      explicitOptions.add("redactSensitiveQuery");
      continue;
    }
    if (arg === "--cache") {
      options.cache = true;
      explicitOptions.add("cache");
      continue;
    }
    if (arg === "--no-cache") {
      options.cache = false;
      explicitOptions.add("cache");
      continue;
    }
    if (arg === "--refresh-cache") {
      options.cache = true;
      options.refreshCache = true;
      explicitOptions.add("cache");
      explicitOptions.add("refreshCache");
      continue;
    }
    if (arg === "--cache-file") {
      options.cacheFile = args.shift();
      if (!options.cacheFile || options.cacheFile.startsWith("-")) {
        throw new Error("--cache-file requires a file path");
      }
      explicitOptions.add("cacheFile");
      continue;
    }
    if (arg === "--cache-ttl-hours") {
      options.cacheTtlHours = readPositiveNumber(args.shift(), "--cache-ttl-hours");
      explicitOptions.add("cacheTtlHours");
      continue;
    }
    if (arg === "--incremental") {
      options.incremental = true;
      explicitOptions.add("incremental");
      continue;
    }
    if (arg === "--baseline-report") {
      options.baselineReport = args.shift();
      if (!options.baselineReport || options.baselineReport.startsWith("-")) {
        throw new Error("--baseline-report requires a file path");
      }
      options.incremental = true;
      explicitOptions.add("baselineReport");
      explicitOptions.add("incremental");
      continue;
    }
    if (arg === "--state-file") {
      options.stateFile = args.shift();
      if (!options.stateFile || options.stateFile.startsWith("-")) {
        throw new Error("--state-file requires a file path");
      }
      explicitOptions.add("stateFile");
      continue;
    }
    if (arg === "--no-incremental-state-write") {
      options.incrementalStateWrite = false;
      explicitOptions.add("incrementalStateWrite");
      continue;
    }
    if (arg === "--changed-only") {
      options.changedOnly = true;
      options.incremental = true;
      explicitOptions.add("changedOnly");
      explicitOptions.add("incremental");
      continue;
    }
    if (arg === "--sitemap") {
      options.sitemap = args.shift();
      if (!options.sitemap || options.sitemap.startsWith("-")) {
        throw new Error("--sitemap requires a URL or file path");
      }
      options.incremental = true;
      explicitOptions.add("sitemap");
      explicitOptions.add("incremental");
      continue;
    }
    if (arg === "--sitemap-max-urls") {
      options.sitemapMaxUrls = readPositiveInteger(args.shift(), "--sitemap-max-urls");
      explicitOptions.add("sitemapMaxUrls");
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
      options.maxDepth = readNonNegativeInteger(args.shift(), "--max-depth");
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
    if (arg === "--retry-after-max-ms") {
      options.retryAfterMaxMs = readNonNegativeInteger(args.shift(), "--retry-after-max-ms");
      explicitOptions.add("retryAfterMaxMs");
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
    if (arg === "--site-link-rules") {
      siteLinkRulesSource = args.shift();
      if (!siteLinkRulesSource) {
        throw new Error("--site-link-rules requires a file path or URL");
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
    if (arg === "--redact-query-keys") {
      const value = args.shift();
      if (!value || value.startsWith("-")) {
        throw new Error("--redact-query-keys requires a comma-separated list");
      }
      options.redactQueryKeys = [
        ...new Set([
          ...DEFAULT_REDACT_QUERY_KEYS,
          ...normalizeRedactQueryKeys(value),
        ]),
      ].sort();
      explicitOptions.add("redactQueryKeys");
      continue;
    }
    if (arg === "--max-html-bytes") {
      options.maxHtmlBytes = readNonNegativeInteger(args.shift(), "--max-html-bytes");
      continue;
    }
    if (arg === "--max-body-preview-bytes") {
      options.maxBodyPreviewBytes = readNonNegativeInteger(args.shift(), "--max-body-preview-bytes");
      continue;
    }
    if (arg === "--max-download-probe-bytes") {
      options.maxDownloadProbeBytes = readNonNegativeInteger(args.shift(), "--max-download-probe-bytes");
      continue;
    }
    if (arg === "--max-sources-per-url") {
      options.maxSourcesPerUrl = readNonNegativeInteger(args.shift(), "--max-sources-per-url");
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
  options.retryAfterMaxMs = normalizeRetryAfterMaxMs(options.retryAfterMaxMs);
  options.protectionBodyHash = options.protectionBodyHash === true;
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
  options.redactSensitiveQuery = options.redactSensitiveQuery !== false;
  options.redactQueryKeys = normalizeRedactQueryKeys(options.redactQueryKeys);
  options.cache = options.cache === true;
  options.cacheFile = normalizeCacheFile(options.cacheFile);
  options.cacheTtlHours = normalizeCacheTtlHours(options.cacheTtlHours);
  options.baselineReport = normalizeOptionalPath(options.baselineReport);
  options.stateFile = normalizeOptionalPath(options.stateFile) || DEFAULT_INCREMENTAL_STATE_FILE;
  options.sitemap = normalizeOptionalPath(options.sitemap);
  options.sitemapMaxUrls = normalizeSitemapMaxUrls(options.sitemapMaxUrls);
  options.sitemapIndexMaxChildren = normalizeSitemapIndexMaxChildren(options.sitemapIndexMaxChildren);
  options.incremental = options.incremental === true || Boolean(options.baselineReport) || Boolean(options.sitemap);
  options.incrementalStateWrite = options.incrementalStateWrite !== false;
  options.changedOnly = options.changedOnly === true;
  if (options.changedOnly) {
    options.incremental = true;
  }
  options.refreshCache = options.refreshCache === true;
  options.maxHtmlBytes = normalizeByteLimit(options.maxHtmlBytes, DEFAULTS.maxHtmlBytes);
  options.maxBodyPreviewBytes = normalizeByteLimit(options.maxBodyPreviewBytes, DEFAULTS.maxBodyPreviewBytes);
  options.maxDownloadProbeBytes = normalizeByteLimit(options.maxDownloadProbeBytes, DEFAULTS.maxDownloadProbeBytes);
  options.maxSourcesPerUrl = normalizeIntegerLimit(options.maxSourcesPerUrl, DEFAULTS.maxSourcesPerUrl);
  options.maxRulesBytes = normalizeByteLimit(options.maxRulesBytes, DEFAULTS.maxRulesBytes);
  Object.assign(options, normalizeSecurityPolicy(options));
  Object.assign(options, normalizeComplianceOptions(options));
  Object.assign(options, normalizeConnectionOptions(options));
  return { startUrl, options, output, json, progress, verbose, domainRulesSource, externalRiskRulesSource, siteLinkRulesSource };
}

async function loadDomainCategoryRules(source, options = DEFAULTS) {
  if (!source) {
    return {
      rules: [],
      trace: buildInlineRulesTraceEntry(),
    };
  }

  const loaded = await readRulesText(source, "--domain-rules", options);
  let parsed;
  try {
    parsed = JSON.parse(loaded.text);
  } catch {
    throw new Error("--domain-rules must point to JSON");
  }

  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  const normalized = normalizeDomainCategoryRules(rules);
  if (normalized.length === 0) {
    throw new Error("--domain-rules did not contain any valid rules");
  }
  const rulesWithSource = normalized.map((rule) => ({
    ...rule,
    source,
  }));
  return {
    rules: rulesWithSource,
    trace: buildLoadedRulesTraceEntry({
      source,
      loaded,
      parsed,
      ruleCount: rulesWithSource.length,
    }),
  };
}

async function loadExternalRiskRules(source, options = DEFAULTS) {
  if (!source) {
    return {
      rules: [],
      trace: buildInlineRulesTraceEntry(),
    };
  }

  const loaded = await readRulesText(source, "--external-risk-rules", options);
  let parsed;
  try {
    parsed = JSON.parse(loaded.text);
  } catch {
    throw new Error("--external-risk-rules must point to JSON");
  }

  const normalized = normalizeExternalRiskRules(parsed, source);
  if (normalized.length === 0) {
    throw new Error("--external-risk-rules did not contain any valid rules");
  }
  return {
    rules: normalized,
    trace: buildLoadedRulesTraceEntry({
      source,
      loaded,
      parsed,
      ruleCount: normalized.length,
    }),
  };
}

async function loadSiteLinkRules(source, options = DEFAULTS) {
  if (!source) {
    return {
      rules: normalizeSiteLinkRules({}),
      trace: buildInlineRulesTraceEntry(),
    };
  }

  const loaded = await readRulesText(source, "--site-link-rules", options);
  let parsed;
  try {
    parsed = JSON.parse(loaded.text);
  } catch {
    throw new Error("--site-link-rules must point to JSON");
  }

  const normalized = normalizeSiteLinkRules(parsed, source);
  if (!hasSiteLinkRules(normalized)) {
    throw new Error("--site-link-rules did not contain any valid rules");
  }
  return {
    rules: normalized,
    trace: buildLoadedRulesTraceEntry({
      source,
      loaded,
      parsed,
      ruleCount: countSiteLinkRules(normalized),
    }),
  };
}

async function readRulesText(source, optionName, options = DEFAULTS) {
  if (/^https?:\/\//i.test(source)) {
    return readRulesUrlText(source, optionName, options);
  }

  const text = await readFile(source, "utf8");
  return {
    text,
    sourceType: "file",
    finalUrl: null,
    loadedAt: new Date().toISOString(),
    fingerprint: hashLabel(text),
    byteSize: Buffer.byteLength(text, "utf8"),
    redirectCount: 0,
    warnings: [],
  };
}

async function readRulesUrlText(source, optionName, options = DEFAULTS) {
  const securityPolicy = normalizeSecurityPolicy(options);
  const timeoutMs = Number.parseInt(options.timeoutMs ?? DEFAULTS.timeoutMs, 10) || DEFAULTS.timeoutMs;
  const maxRedirects = normalizeIntegerLimit(options.maxRedirects, DEFAULTS.maxRedirects);
  const maxRulesBytes = normalizeByteLimit(options.maxRulesBytes, DEFAULTS.maxRulesBytes);
  let currentUrl = source;
  const redirectChain = [];
  const seenUrls = new Set([normalizeRedirectVisitUrl(currentUrl)]);

  while (true) {
    const securityCheck = await evaluateUrlSecurity(currentUrl, securityPolicy);
    if (!securityCheck.allowed) {
      throw new Error(`Unable to load ${optionName} URL: blocked by security policy (${securityCheck.reason || "blocked"})`);
    }

    const response = await fetchRulesUrl(currentUrl, { timeoutMs, userAgent: options.userAgent || DEFAULTS.userAgent });
    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        await cancelResponseBody(response);
        throw new Error(`Unable to load ${optionName} URL: redirect without Location`);
      }

      const nextUrl = new URL(location, currentUrl).toString();
      redirectChain.push({
        from: currentUrl,
        status: response.status,
        to: nextUrl,
      });
      await cancelResponseBody(response);

      const redirectSecurityCheck = await evaluateUrlSecurity(nextUrl, securityPolicy);
      if (!redirectSecurityCheck.allowed) {
        throw new Error(`Unable to load ${optionName} URL: redirect blocked by security policy (${redirectSecurityCheck.reason || "blocked"})`);
      }
      if (redirectChain.length > maxRedirects) {
        throw new Error(`Unable to load ${optionName} URL: too many redirects after ${maxRedirects} redirects`);
      }

      const visitUrl = normalizeRedirectVisitUrl(nextUrl);
      if (seenUrls.has(visitUrl)) {
        throw new Error(`Unable to load ${optionName} URL: redirect loop detected`);
      }
      seenUrls.add(visitUrl);
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Unable to load ${optionName} URL: HTTP ${response.status}`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") || "", 10);
    if (Number.isFinite(contentLength) && contentLength > maxRulesBytes) {
      await cancelResponseBody(response);
      throw new Error(`Unable to load ${optionName} URL: content length exceeds ${maxRulesBytes} bytes`);
    }

    let body;
    try {
      body = await readResponseTextWithinLimit(response, maxRulesBytes);
    } catch (error) {
      throw new Error(`Unable to load ${optionName} URL: ${error.message}`);
    }
    const { text, byteSize } = body;
    const warnings = [];
    if (redirectChain.length > 0) {
      warnings.push("rules_url_redirected");
    }
    return {
      text,
      sourceType: "url",
      finalUrl: currentUrl,
      loadedAt: new Date().toISOString(),
      fingerprint: hashLabel(text),
      byteSize,
      redirectCount: redirectChain.length,
      warnings,
    };
  }
}

async function fetchRulesUrl(url, { timeoutMs, userAgent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        "accept": "application/json,text/plain;q=0.9,*/*;q=0.1",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseTextWithinLimit(response, maxBytes) {
  const limit = Math.max(0, Number.isFinite(maxBytes) ? Math.floor(maxBytes) : DEFAULT_MAX_RULES_BYTES);
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    const byteSize = Buffer.byteLength(text, "utf8");
    if (byteSize > limit) {
      throw new Error(`Rules body exceeds ${limit} bytes`);
    }
    return { text, byteSize };
  }

  const chunks = [];
  let byteSize = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    const chunk = Buffer.from(value);
    byteSize += chunk.length;
    if (byteSize > limit) {
      await reader.cancel();
      throw new Error(`Rules body exceeds ${limit} bytes`);
    }
    chunks.push(chunk);
  }
  return {
    text: Buffer.concat(chunks).toString("utf8"),
    byteSize,
  };
}

async function cancelResponseBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {
    // Ignore body cancellation errors while preparing a clearer rules loading error.
  }
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

function readPositiveNumber(value, name) {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${name} must be a positive number`);
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
  --retry-after-max-ms <n>
                       Maximum per-host Retry-After cooldown in milliseconds. Default: ${DEFAULTS.retryAfterMaxMs}
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
  --no-keep-alive    Send Connection: close and disable legacy HTTP agent keep-alive.
  --domain-rules <file-or-url>
                       JSON domain category rules: [{ "category": "...", "domains": ["example.com"] }].
  --external-risk-rules <file-or-url>
                       JSON external governance rules with allowlist, blocklist, and watchlist domains.
  --site-link-rules <file-or-url>
                       JSON rules for deriving links from SPA/CMS payload fields.
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
  --block-private-ip  Block localhost, private, link-local, metadata, and reserved IPs. Default: on.
  --allow-localhost   Allow localhost and loopback targets for trusted local scans.
  --allow-private-ip  Allow private/internal IP targets except metadata service IPs.
  --authorized-scan   Record that the user declares they are authorized to scan this site.
  --authorization-note <text>
                      Optional authorization context saved in report compliance metadata.
  --protection-body-hash
                      Include SHA-256 bodyHash in protection body signatures. Default: off.
  --no-robots         Do not fetch robots.txt audit metadata.
  --confirm-404       Re-check same-site 404/410 results after the main scan. Default: on.
  --no-confirm-404    Disable the post-scan 404/410 confirmation stage.
  --redact-sensitive-query
                      Mask high-risk query values in report, CSV, and logs. Default: on.
  --no-redact-sensitive-query
                      Disable sensitive query masking in outputs.
  --redact-query-keys <list>
                      Additional comma-separated query keys to mask in outputs.
  --max-html-bytes <n>
                      Maximum bytes to read for HTML/body extraction. Default: ${DEFAULTS.maxHtmlBytes}
  --max-body-preview-bytes <n>
                      Maximum bytes to read for error diagnostic body preview. Default: ${DEFAULTS.maxBodyPreviewBytes}
  --max-download-probe-bytes <n>
                      Maximum bytes to drain for non-body download/media probes. Default: ${DEFAULTS.maxDownloadProbeBytes}
  --max-sources-per-url <n>
                      Maximum source records saved per URL in outputs. Default: ${DEFAULTS.maxSourcesPerUrl}
  --cache             Enable persistent TTL URL status-result cache. Default: off.
  --cache-file <file> Cache file path. Default: ${DEFAULTS.cacheFile}
  --cache-ttl-hours <n>
                      TTL for successful cached results. Default: ${DEFAULTS.cacheTtlHours}
  --refresh-cache     Ignore existing cache entries and write fresh results.
  --no-cache          Disable persistent cache.
  --incremental       Enable P8 incremental classification and scan state.
  --baseline-report <file>
                      Use an existing report.json as a one-time incremental baseline.
  --state-file <file> Incremental scan state path. Default: ${DEFAULTS.stateFile}
  --no-incremental-state-write
                      Read baseline/state but do not write updated incremental state.
  --changed-only      Reuse stable known status results when policy and TTL are valid.
                      Still crawls pages and builds the current inventory.
  --sitemap <url-or-file>
                      Load a sitemap urlset or sitemap index into summary.incremental.sitemap.
                      Conservatively seeds same-origin page-like URLs while preserving HTML discovery.
  --sitemap-max-urls <n>
                      Maximum sitemap URLs recorded in the P8d summary. Default: ${DEFAULTS.sitemapMaxUrls}
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
  if (report.runStatus?.status && report.runStatus.status !== "complete") {
    console.log(`Run status: ${report.runStatus.status}`);
    if (report.runStatus.failureReason) {
      console.log(`Failure reason: ${report.runStatus.failureReason}`);
    }
  }
  console.log(`Pages crawled: ${summary.pagesCrawled}`);
  console.log(`URLs checked: ${summary.urlsChecked}`);
  if (summary.checkedByKind) {
    console.log(
      `Checked by kind: content ${summary.contentLinksChecked || 0}, external ${summary.externalLinksChecked || 0}, documents ${summary.documentsChecked || 0}, media ${summary.mediaLinksChecked || 0}, assets ${summary.assetsChecked || 0}`,
    );
    if ((summary.nuxtAssetsChecked || 0) > 0) {
      console.log(`  Nuxt assets: ${summary.nuxtAssetsChecked}`);
    }
  }
  console.log(`Broken links: ${summary.brokenLinks}`);
  console.log(`External links found: ${summary.externalLinks || 0}`);
  console.log(`External domains found: ${summary.externalDomains || 0}`);
  if (summary.robotsTxt) {
    console.log(`robots.txt: ${summary.robotsTxt.status} (${report.scanPolicy?.robotsTxt?.status || "unknown"})`);
  }
  if (summary.spaDetection?.detected) {
    console.log(`SPA/framework signals: ${summary.spaDetection.framework} (${summary.spaDetection.signals.join(", ")})`);
  }
  if (summary.scanQuality?.warnings?.length > 0) {
    console.log(`Scan quality warnings: ${summary.scanQuality.warnings.join(", ")}`);
  }
  if (summary.coverage?.incomplete) {
    console.log(`Coverage notice: ${formatCoverageNotice(summary.coverage)}`);
    console.log(`  reasons: ${summary.coverage.reasons.join(", ")}`);
  }
  if (summary.hostDiagnostics?.warnings?.length > 0) {
    console.log(`Host diagnostics warnings: ${summary.hostDiagnostics.warnings.join(", ")}`);
  }
  if (summary.cache?.enabled) {
    console.log(`Cache: ${summary.cache.hits || 0} hit(s), ${summary.cache.misses || 0} miss(es), ${summary.cache.expired || 0} expired, ${summary.cache.written || 0} written`);
  }
  if (summary.incremental?.enabled) {
    console.log(`Incremental: ${summary.incremental.new || 0} new, ${summary.incremental.known || 0} known, ${summary.incremental.previousError || 0} previous error, ${summary.incremental.policyMismatch || 0} policy mismatch, ${summary.incremental.ttlExpired || 0} TTL expired, ${summary.incremental.unstableRedirect || 0} unstable redirect, ${summary.incremental.disappeared || 0} disappeared`);
    if (summary.incremental.reuse?.enabled) {
      console.log(`  reused status results: ${summary.incremental.reused || 0}`);
    }
    if (summary.incremental.sitemap?.enabled) {
      console.log(`  sitemap: ${summary.incremental.sitemap.status}, ${summary.incremental.sitemap.urlCount || 0} URL(s), type ${summary.incremental.sitemap.type || "unknown"}`);
    }
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
    const totalSources = item.sourceCount ?? item.sources.length;
    if (totalSources > 3) {
      console.log(`  and ${totalSources - 3} more source(s)`);
    }
  }
}

function formatCoverageNotice(coverage) {
  if (coverage?.validation?.incomplete) {
    return "This scan did not fully complete; results only represent URLs that finished validation.";
  }
  if (coverage?.discovery?.incomplete) {
    if (coverage.discovery.reasons?.includes("start_page_fetch_failed")) {
      return "Scheduled URL validation completed, but the start page could not be fetched as usable HTML for discovery.";
    }
    return "Scheduled URL validation completed, but site discovery was limited by page or sitemap seed budgets.";
  }
  return "Results only represent discovered and validated URLs.";
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  if (shouldRestartWithSystemCa(parsed.options)) {
    process.exitCode = await restartWithSystemCa(process.argv.slice(2));
    return;
  }

  const domainCategoryRulesLoaded = await loadDomainCategoryRules(parsed.domainRulesSource, parsed.options);
  const externalRiskRulesLoaded = await loadExternalRiskRules(parsed.externalRiskRulesSource, parsed.options);
  const siteLinkRulesLoaded = await loadSiteLinkRules(parsed.siteLinkRulesSource, parsed.options);

  const reporter = parsed.json
    ? null
    : new ProgressReporter({
        progress: parsed.progress,
        verbose: parsed.verbose,
        intervalMs: parsed.options.progressIntervalMs,
      });
  const checker = new LinkChecker(parsed.startUrl, {
    ...parsed.options,
    domainCategoryRules: domainCategoryRulesLoaded.rules,
    domainCategoryRulesSource: parsed.domainRulesSource,
    externalRiskRules: externalRiskRulesLoaded.rules,
    externalRiskRulesSource: parsed.externalRiskRulesSource,
    siteLinkRules: siteLinkRulesLoaded.rules,
    siteLinkRulesSource: parsed.siteLinkRulesSource,
    rulesTrace: {
      domainCategoryRules: domainCategoryRulesLoaded.trace,
      externalRiskRules: externalRiskRulesLoaded.trace,
      siteLinkRules: siteLinkRulesLoaded.trace,
    },
    reporter,
  });
  const report = await checker.run();

  if (parsed.output) {
    await writeFile(parsed.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const manifest = buildOutputManifest({
      generatedAt: new Date().toISOString(),
      startUrl: report.startUrl,
      options: report.options,
      generatedFiles: [
        {
          path: basename(parsed.output),
          kind: "report",
          schemaVersion: report.schemaVersion,
        },
      ],
    });
    await writeFile(join(dirname(parsed.output), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  if (parsed.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printSummary(report);
    if (parsed.output) {
      console.log(`Full report written to: ${parsed.output}`);
    }
  }

  process.exitCode = report.runStatus?.status === "failed" ? 1 : (report.summary.brokenLinks > 0 ? 2 : 0);
}

function restartWithSystemCa(args, { entrypoint = process.argv[1], spawnCommand = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnCommand(process.execPath, ["--use-system-ca", entrypoint, ...args], {
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

export {
  BROWSER_USER_AGENT,
  DEFAULTS,
  REPORT_SCHEMA_VERSION,
  TOOL_VERSION,
  LinkChecker,
  applyConservativeDefaults,
  buildOutputManifest,
  canonicalizeUrl,
  deriveCoverageStatus,
  evaluateUrlSecurity,
  isSystemCaEnabled,
  redactSensitiveQueryValue,
  restartWithSystemCa,
  shouldRestartWithSystemCa,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
