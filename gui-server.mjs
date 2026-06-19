#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { DEFAULTS, LinkChecker, applyConservativeDefaults, isSystemCaEnabled } from "./link-checker.mjs";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, "public");
const LOGS_DIR = join(ROOT_DIR, "logs");
const DEFAULT_PORT = 8787;
const HOST = "127.0.0.1";
const MAX_PORT_FALLBACK_ATTEMPTS = 20;
const MAX_STORED_EVENTS = 10000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 30000;
const SHUTDOWN_FORCE_EXIT_MS = 3000;
const jobs = new Map();
const queue = {
  items: [],
  running: false,
  stopRequested: false,
  currentItemIds: new Set(),
  maxConcurrentSites: 1,
  startedAt: null,
  finishedAt: null,
};
let activeServer = null;
let idleShutdownTimer = null;
let idleShutdownMs = null;
let lastClientSeenAt = Date.now();
let shutdownStarted = false;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

class GuiReporter {
  constructor(job) {
    this.job = job;
    this.checker = null;
    this.timer = null;
    this.started = performance.now();
    this.currentUrl = null;
  }

  start(checker) {
    this.checker = checker;
    this.job.checker = checker;
    this.emit("status", this.snapshot());
    this.timer = setInterval(() => this.emit("status", this.snapshot()), 500);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit("status", this.snapshot());
  }

  pageStarted(url, depth) {
    this.currentUrl = url;
    this.emitLog("page", `Depth ${depth}: ${url}`);
  }

  pageLinksFound(url, count) {
    this.emitLog("links", `${count} links found on ${url}`);
  }

  pageQueued(url, depth) {
    this.emitLog("queue", `Depth ${depth}: ${url}`);
  }

  externalSkipped(url, sourcePage) {
    this.emitLog("skip", `External link skipped: ${url}`, sourcePage);
  }

  requestQueued(url, method) {
    this.currentUrl = url;
    this.emitLog("request", `${method} ${url}`);
  }

  requestFinished(result) {
    this.currentUrl = result.url;
    const reason = formatIssueReason(result);
    this.emitLog(result.ok ? "ok" : "broken", `${reason}: ${result.url}`);
    this.emit("status", this.snapshot());
  }

  snapshot() {
    const checker = this.checker;
    const results = checker ? [...checker.results.values()] : [];
    const brokenItems = results.filter((result) => !result.ok);
    return {
      id: this.job.id,
      state: this.job.state,
      elapsedSeconds: Math.max(0, Math.round((performance.now() - this.started) / 1000)),
      maxPages: this.job.options.maxPages,
      pagesCrawled: checker?.crawledPages.size || 0,
      queuedPages: checker?.pageQueue.length || 0,
      urlsChecked: results.length,
      activeRequests: checker?.fetchLimiter.active || 0,
      brokenLinks: brokenItems.length,
      brokenByType: countBrokenByType(brokenItems),
      redirects: countRedirected(results),
      redirectByType: countRedirectByType(results),
      skippedExternal: checker?.skippedExternal || 0,
      currentUrl: this.currentUrl,
    };
  }

  emitLog(type, message, detail = null) {
    const item = {
      type,
      message,
      detail,
      at: new Date().toISOString(),
    };
    this.job.events.push(item);
    if (this.job.events.length > MAX_STORED_EVENTS) {
      this.job.events.shift();
    }
    this.emit("log", item);
  }

  emit(event, data) {
    sendJobEvent(this.job, event, data);
  }
}

function sendJobEvent(job, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of job.clients) {
    client.write(payload);
  }
}

function createJob(input) {
  const options = parseJobOptions(input);
  const job = {
    id: randomUUID(),
    state: "running",
    startUrl: input.url,
    options,
    clients: new Set(),
    checker: null,
    reporter: null,
    report: null,
    error: null,
    events: [],
    logDir: null,
    logRelativePath: null,
    logError: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);

  const reporter = new GuiReporter(job);
  job.reporter = reporter;
  const checker = new LinkChecker(input.url, {
    ...options,
    reporter,
  });

  job.done = checker.run()
    .then((report) => {
      job.report = report;
      job.state = checker.stopped ? "stopped" : "finished";
      return saveJobArtifacts(job);
    })
    .then(() => {
      sendJobEvent(job, "status", reporter.snapshot());
      sendJobEvent(job, "complete", buildCompletePayload(job));
      return job;
    })
    .catch(async (error) => {
      job.state = "failed";
      job.error = error.message;
      await saveJobArtifacts(job);
      sendJobEvent(job, "error", {
        message: error.message,
        logDir: job.logDir,
        logRelativePath: job.logRelativePath,
        logError: job.logError,
      });
      return job;
    });

  return job;
}

function addQueueItems(input) {
  const urls = parseQueueUrls(input.urls ?? input.url);
  const options = parseJobOptions(input);
  const created = [];

  for (const url of urls) {
    const item = {
      id: randomUUID(),
      url,
      state: "queued",
      jobId: null,
      options,
      report: null,
      summary: null,
      error: null,
      logRelativePath: null,
      logError: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
    };
    queue.items.push(item);
    created.push(item);
  }

  return created;
}

function parseQueueUrls(value) {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "").split(/\r?\n/);
  const urls = [];
  const seen = new Set();

  for (const rawItem of rawItems) {
    const raw = String(rawItem || "").trim();
    if (!raw) {
      continue;
    }
    validateStartUrl(raw);
    const normalized = new URL(raw).href;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }

  if (urls.length === 0) {
    throw httpError(400, "At least one URL is required");
  }
  if (urls.length > 200) {
    throw httpError(400, "Queue can contain at most 200 URLs at once");
  }

  return urls;
}

function startQueue(input = {}) {
  if (queue.running) {
    return;
  }

  queue.running = true;
  queue.stopRequested = false;
  queue.maxConcurrentSites = clampInteger(input.maxConcurrentSites, queue.maxConcurrentSites || 1, 1, 5);
  queue.startedAt = queue.startedAt || new Date().toISOString();
  queue.finishedAt = null;
  void runQueue();
}

async function runQueue() {
  try {
    while (!queue.stopRequested) {
      const active = queue.items.filter((item) => item.state === "running");
      const availableSlots = queue.maxConcurrentSites - active.length;
      const nextItems = queue.items
        .filter((candidate) => candidate.state === "queued")
        .slice(0, Math.max(0, availableSlots));

      for (const item of nextItems) {
        startQueueItem(item);
      }

      const running = queue.items.filter((item) => item.state === "running");
      if (running.length === 0) {
        break;
      }

      await Promise.race(running.map((item) => item.done));
    }
  } finally {
    await Promise.allSettled(
      queue.items
        .filter((item) => item.state === "running")
        .map((item) => item.done),
    );
    if (queue.stopRequested) {
      for (const item of queue.items) {
        if (item.state === "queued") {
          item.state = "stopped";
          item.finishedAt = new Date().toISOString();
        }
      }
    }
    queue.running = false;
    queue.currentItemIds.clear();
    queue.finishedAt = new Date().toISOString();
  }
}

function startQueueItem(item) {
  queue.currentItemIds.add(item.id);
  item.state = "running";
  item.startedAt = new Date().toISOString();
  const job = createJob({
    url: item.url,
    ...item.options,
  });
  item.jobId = job.id;
  item.done = job.done.then((finishedJob) => {
    item.state = finishedJob.state;
    item.report = finishedJob.report;
    item.summary = finishedJob.report?.summary || null;
    item.error = finishedJob.error;
    item.logRelativePath = finishedJob.logRelativePath;
    item.logError = finishedJob.logError;
    item.finishedAt = new Date().toISOString();
    queue.currentItemIds.delete(item.id);
    return item;
  });
}

function stopQueue() {
  queue.stopRequested = true;
  const runningItems = queue.items.filter((item) => item.state === "running" && item.jobId);
  for (const current of runningItems) {
    const job = jobs.get(current.jobId);
    if (job?.checker && job.state === "running") {
      job.state = "stopping";
      job.checker.stop();
      sendJobEvent(job, "status", {
        id: job.id,
        state: job.state,
      });
    }
  }
}

function removeQueueItem(id) {
  const index = queue.items.findIndex((item) => item.id === id);
  if (index === -1) {
    throw httpError(404, "Queue item not found");
  }
  if (queue.items[index].state === "running") {
    throw httpError(409, "Running queue item cannot be removed");
  }
  const [removed] = queue.items.splice(index, 1);
  return removed;
}

function serializeQueue() {
  return {
    running: queue.running,
    stopRequested: queue.stopRequested,
    currentItemIds: [...queue.currentItemIds],
    maxConcurrentSites: queue.maxConcurrentSites,
    activeSites: queue.currentItemIds.size,
    startedAt: queue.startedAt,
    finishedAt: queue.finishedAt,
    totals: countQueueItems(),
    items: queue.items.map(serializeQueueItem),
  };
}

function serializeQueueItem(item) {
  return {
    id: item.id,
    url: item.url,
    state: item.state,
    jobId: item.jobId,
    createdAt: item.createdAt,
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    summary: item.summary,
    error: item.error,
    logRelativePath: item.logRelativePath,
    logError: item.logError,
  };
}

function countQueueItems() {
  const totals = {
    queued: 0,
    running: 0,
    finished: 0,
    stopped: 0,
    failed: 0,
  };
  for (const item of queue.items) {
    if (Object.prototype.hasOwnProperty.call(totals, item.state)) {
      totals[item.state] += 1;
    }
  }
  totals.total = queue.items.length;
  return totals;
}

function buildCompletePayload(job) {
  return {
    state: job.state,
    report: job.report,
    logDir: job.logDir,
    logRelativePath: job.logRelativePath,
    logError: job.logError,
  };
}

async function saveJobArtifacts(job) {
  try {
    const logDir = await createLogDirectory(job);
    job.logDir = logDir;
    job.logRelativePath = relative(ROOT_DIR, logDir);

    const summary = buildLogSummary(job);
    await Promise.all([
      writeJsonFile(join(logDir, "summary.json"), summary),
      writeJsonFile(join(logDir, "report.json"), job.report || summary),
      writeFile(join(logDir, "broken.csv"), makeBrokenCsv(job.report?.broken || []), "utf8"),
      writeFile(join(logDir, "external-links.csv"), makeExternalLinksCsv(job.report?.externalLinks || []), "utf8"),
      writeJsonFile(join(logDir, "external-summary.json"), buildExternalSummary(job.report)),
      writeFile(join(logDir, "events.log"), makeEventsLog(job.events), "utf8"),
      writeFile(join(logDir, "README.txt"), makeLogReadme(job, summary), "utf8"),
    ]);
  } catch (error) {
    job.logError = error.message;
  }
}

async function createLogDirectory(job) {
  const baseName = `${formatTimestampForFolder(job.createdAt)}--${getHostSlug(job.startUrl)}--${job.state}`;
  await mkdir(LOGS_DIR, { recursive: true });

  for (let index = 0; index < 100; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const dir = join(LOGS_DIR, `${baseName}${suffix}`);
    try {
      await mkdir(dir, { recursive: false });
      return dir;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }

  throw new Error("Unable to create a unique log directory.");
}

function buildLogSummary(job) {
  return {
    jobId: job.id,
    state: job.state,
    startUrl: job.startUrl,
    createdAt: job.createdAt,
    finishedAt: new Date().toISOString(),
    options: job.options,
    error: job.error,
    summary: job.report?.summary || null,
    reportFiles: {
      summary: "summary.json",
      report: "report.json",
      brokenCsv: "broken.csv",
      externalLinksCsv: "external-links.csv",
      externalSummary: "external-summary.json",
      events: "events.log",
    },
  };
}

async function writeJsonFile(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function makeBrokenCsv(items) {
  const rows = [[
    "url",
    "status",
    "issueType",
    "classification",
    "checkedAt",
    "canonicalUrl",
    "method",
    "finalUrl",
    "contentLength",
    "cacheControl",
    "suspectedWaf",
    "suspectedBot",
    "blockedReason",
    "confirmationEnabled",
    "confirmationCandidate",
    "confirmationChecked",
    "confirmationOutcome",
    "confirmationStatus",
    "confirmationFinalUrl",
    "confirmationCheckedAt",
    "confirmationReferer",
    "confirmationReason",
    "needsReview",
    "transientFailure",
    "sourcePage",
    "tag",
    "attribute",
    "text",
    "diagnosis",
  ]];

  for (const item of items) {
    const sources = item.sources?.length ? item.sources : [{}];
    for (const source of sources) {
      rows.push([
        item.url,
        item.status ?? "",
        item.issueType || "",
        item.classification || "",
        item.checkedAt || "",
        item.canonicalUrl || "",
        item.method || "",
        item.finalUrl || "",
        item.contentLength ?? "",
        item.cacheHeaders?.cacheControl || "",
        item.suspectedWaf ? "yes" : "no",
        item.suspectedBot ? "yes" : "no",
        item.blockedReason || "",
        item.confirmation?.enabled ? "yes" : "no",
        item.confirmation?.candidate ? "yes" : "no",
        item.confirmation?.checked ? "yes" : "no",
        item.confirmation?.outcome || "",
        item.confirmation?.status ?? "",
        item.confirmation?.finalUrl || "",
        item.confirmation?.checkedAt || "",
        item.confirmation?.referer || "",
        item.confirmation?.reason || "",
        item.needsReview ? "yes" : "no",
        item.transientFailure ? "yes" : "no",
        source.page || "",
        source.tag || "",
        source.attribute || "",
        source.text || "",
        item.diagnosis || item.error || "",
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function makeExternalLinksCsv(items) {
  const rows = [[
    "url",
    "hostname",
    "registrableDomain",
    "type",
    "categories",
    "checked",
    "ok",
    "status",
    "method",
    "finalUrl",
    "checkedAt",
    "canonicalUrl",
    "contentLength",
    "cacheControl",
    "issueType",
    "classification",
    "blockedReason",
    "sourcePage",
    "tag",
    "attribute",
    "text",
  ]];

  for (const item of items) {
    const sources = item.sources?.length ? item.sources : [{}];
    for (const source of sources) {
      rows.push([
        item.url,
        item.hostname || "",
        item.registrableDomain || "",
        item.type || "",
        (item.categories || []).join(";"),
        item.checked ? "yes" : "no",
        item.ok === null || item.ok === undefined ? "" : item.ok ? "yes" : "no",
        item.status ?? "",
        item.method || "",
        item.finalUrl || "",
        item.checkedAt || "",
        item.canonicalUrl || "",
        item.contentLength ?? "",
        item.cacheHeaders?.cacheControl || "",
        item.issueType || "",
        item.classification || "",
        item.blockedReason || "",
        source.page || "",
        source.tag || "",
        source.attribute || "",
        source.text || "",
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function buildExternalSummary(report) {
  const externalLinks = report?.externalLinks || [];
  return {
    totalLinks: externalLinks.length,
    totalDomains: countUnique(externalLinks.map((item) => item.registrableDomain || item.hostname)),
    byType: countByValue(externalLinks.map((item) => item.type || "unknown")),
    byCategory: countCategories(externalLinks),
    domains: summarizeExternalDomains(externalLinks),
  };
}

function summarizeExternalDomains(items) {
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
        categories: new Set(),
        types: new Set(),
      });
    }
    const summary = domains.get(domain);
    summary.linkCount += 1;
    summary.types.add(item.type || "unknown");
    for (const category of item.categories || []) {
      summary.categories.add(category);
    }
  }

  return [...domains.values()]
    .map((item) => ({
      domain: item.domain,
      linkCount: item.linkCount,
      types: [...item.types].sort(),
      categories: [...item.categories].sort(),
    }))
    .sort((a, b) => b.linkCount - a.linkCount || a.domain.localeCompare(b.domain));
}

function countByValue(values) {
  const counts = {};
  for (const value of values) {
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function countCategories(items) {
  const counts = {};
  for (const item of items) {
    const categories = item.categories?.length ? item.categories : ["uncategorized"];
    for (const category of categories) {
      counts[category] = (counts[category] || 0) + 1;
    }
  }
  return counts;
}

function countUnique(items) {
  return new Set(items.filter(Boolean)).size;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function makeEventsLog(events) {
  return events
    .map((event) => {
      const detail = event.detail ? ` | ${event.detail}` : "";
      return `[${event.at}] ${event.type}: ${event.message}${detail}`;
    })
    .join("\r\n")
    + (events.length ? "\r\n" : "");
}

function makeLogReadme(job, summary) {
  const lines = [
    "Link Checker log files",
    "",
    `Job ID: ${job.id}`,
    `Start URL: ${job.startUrl}`,
    `State: ${job.state}`,
    `Created at: ${job.createdAt}`,
    `Finished at: ${summary.finishedAt}`,
    "",
    "Files:",
    "- summary.json: 檢查摘要與執行參數",
    "- report.json: 完整 JSON 報告",
    "- broken.csv: 問題連結清單，可用 Excel 開啟",
    "- external-links.csv: External link inventory, usable in Excel",
    "- external-summary.json: External link summary by domain, type, and category",
    "- events.log: 檢查過程事件紀錄",
  ];

  if (job.error) {
    lines.push("", `Error: ${job.error}`);
  }

  return `${lines.join("\r\n")}\r\n`;
}

function formatTimestampForFolder(value) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getHostSlug(url) {
  try {
    const host = new URL(url).hostname || "unknown-site";
    return sanitizeFolderSegment(host.replace(/\./g, "-"));
  } catch {
    return "unknown-site";
  }
}

function sanitizeFolderSegment(value) {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return (sanitized || "unknown-site").slice(0, 80);
}

function parseJobOptions(input) {
  const baseOptions = input.conservativeMode
    ? applyConservativeDefaults({ ...DEFAULTS })
    : { ...DEFAULTS };
  const randomDelay = parseRandomDelayOptions(input, baseOptions);
  return {
    maxPages: clampInteger(input.maxPages, baseOptions.maxPages, 1, 5000),
    maxDepth: clampInteger(input.maxDepth, baseOptions.maxDepth, 0, 50),
    concurrency: clampInteger(input.concurrency, baseOptions.concurrency, 1, 100),
    perHostConcurrency: clampInteger(input.perHostConcurrency, baseOptions.perHostConcurrency, 1, 50),
    requestDelayMs: clampInteger(input.requestDelayMs, baseOptions.requestDelayMs, 0, 60000),
    requestDelayMinMs: randomDelay.min,
    requestDelayMaxMs: randomDelay.max,
    timeoutMs: clampInteger(input.timeoutMs, baseOptions.timeoutMs, 1000, 120000),
    retryCount: clampInteger(input.retryCount, baseOptions.retryCount, 0, 5),
    maxRedirects: clampInteger(input.maxRedirects, baseOptions.maxRedirects, 0, 20),
    longRedirectThreshold: clampInteger(
      input.longRedirectThreshold,
      baseOptions.longRedirectThreshold,
      0,
      20,
    ),
    checkExternal: Boolean(input.checkExternal),
    preferGet: Boolean(input.preferGet ?? baseOptions.preferGet),
    externalReferer: Boolean(input.externalReferer ?? baseOptions.externalReferer),
    legacyTls: Boolean(input.legacyTls ?? baseOptions.legacyTls),
    systemCa: Boolean(input.systemCa ?? baseOptions.systemCa),
    confirm404: Boolean(input.confirm404 ?? baseOptions.confirm404),
    confirmationMaxUrls: baseOptions.confirmationMaxUrls,
    confirmationMaxPerHost: baseOptions.confirmationMaxPerHost,
    confirmationConcurrency: baseOptions.confirmationConcurrency,
    confirmationPerHostConcurrency: baseOptions.confirmationPerHostConcurrency,
    confirmationDelayMinMs: baseOptions.confirmationDelayMinMs,
    confirmationDelayMaxMs: baseOptions.confirmationDelayMaxMs,
    conservativeMode: Boolean(input.conservativeMode),
    canonicalStrategy: parseCanonicalStrategy(input.canonicalStrategy, baseOptions.canonicalStrategy),
    progressIntervalMs: DEFAULTS.progressIntervalMs,
    userAgent: typeof input.userAgent === "string" && input.userAgent.trim()
      ? input.userAgent.trim()
      : baseOptions.userAgent,
    acceptLanguage: typeof input.acceptLanguage === "string" && input.acceptLanguage.trim()
      ? input.acceptLanguage.trim()
      : baseOptions.acceptLanguage,
  };
}

function parseCanonicalStrategy(value, fallback = DEFAULTS.canonicalStrategy) {
  const strategy = String(value || fallback || "safe").toLowerCase();
  if (["safe", "moderate", "aggressive"].includes(strategy)) {
    return strategy;
  }
  throw httpError(400, "canonicalStrategy must be safe, moderate, or aggressive");
}

function parseRandomDelayOptions(input, defaults = DEFAULTS) {
  const min = parseOptionalInteger(input.requestDelayMinMs, 0, 60000, defaults.requestDelayMinMs);
  const max = parseOptionalInteger(input.requestDelayMaxMs, 0, 60000, defaults.requestDelayMaxMs);
  if (Number.isFinite(min) !== Number.isFinite(max)) {
    throw httpError(400, "Random request delay requires both minimum and maximum values");
  }
  if (Number.isFinite(min) && min > max) {
    throw httpError(400, "Random request delay minimum cannot be greater than maximum");
  }
  return { min, max };
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.max(min, Math.min(number, max));
}

function parseOptionalInteger(value, min, max, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.max(min, Math.min(number, max));
}

function formatIssueReason(result) {
  if (result.ok) {
    return result.status ? `HTTP ${result.status}` : "OK";
  }
  if (result.classification === "protected") {
    const provider = result.protection?.provider ? `: ${result.protection.provider}` : "";
    const status = result.status ? `HTTP ${result.status}` : "blocked";
    return `Blocked by protection layer${provider} (${status})`;
  }
  if (result.classification === "access_denied" || result.issueType === "access_denied" || result.status === 403) {
    return "Access denied / needs review (HTTP 403)";
  }
  if (result.status) {
    return `HTTP ${result.status}`;
  }
  return result.error || "Request failed";
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

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1024 * 1024) {
      throw httpError(413, "Request body is too large");
    }
  }

  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    throw httpError(400, "Invalid JSON request body");
  }
}

function validateStartUrl(value) {
  if (!value || typeof value !== "string") {
    throw httpError(400, "URL is required");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw httpError(400, "URL is invalid");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw httpError(400, "Only http and https URLs are supported");
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function isLocalRequest(request) {
  const address = request.socket?.remoteAddress;
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function recordClientHeartbeat() {
  lastClientSeenAt = Date.now();
  return {
    ok: true,
    lastClientSeenAt: new Date(lastClientSeenAt).toISOString(),
    idleShutdownMs,
  };
}

function hasRunningWork() {
  if (queue.running || queue.stopRequested || queue.currentItemIds.size > 0) {
    return true;
  }

  for (const job of jobs.values()) {
    if (job.state === "running" || job.state === "stopping") {
      return true;
    }
  }

  return false;
}

function beginShutdown(reason) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  if (idleShutdownTimer) {
    clearInterval(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  console.log(`Link Checker GUI is shutting down: ${reason}`);
  const forceExitTimer = setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS);
  forceExitTimer.unref?.();

  if (!activeServer) {
    process.exit(0);
    return;
  }

  activeServer.close(() => process.exit(0));
}

function configureIdleShutdown(server, timeoutMs) {
  activeServer = server;
  idleShutdownMs = timeoutMs;
  lastClientSeenAt = Date.now();

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return;
  }

  const intervalMs = Math.min(DEFAULT_IDLE_CHECK_INTERVAL_MS, Math.max(1000, Math.floor(timeoutMs / 4)));
  idleShutdownTimer = setInterval(() => {
    const idleForMs = Date.now() - lastClientSeenAt;
    if (!hasRunningWork() && idleForMs >= timeoutMs) {
      beginShutdown(`idle for ${idleForMs}ms`);
    }
  }, intervalMs);
  idleShutdownTimer.unref?.();
}

function sendError(response, error) {
  sendJson(response, error.status || 500, {
    error: error.message || "Unexpected server error",
  });
}

async function serveStatic(request, response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const resolved = normalize(join(PUBLIC_DIR, decodeURIComponent(requested)));
  const rel = relative(PUBLIC_DIR, resolved);

  if (rel.startsWith("..") || rel === "") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  try {
    await readFile(resolved);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "content-type": MIME_TYPES.get(extname(resolved)) || "application/octet-stream",
    "cache-control": "no-store",
  });
  createReadStream(resolved).pipe(response);
}

async function route(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");

  if (request.method === "POST" && url.pathname === "/api/session/heartbeat") {
    if (!isLocalRequest(request)) {
      throw httpError(403, "Heartbeat is only available from localhost");
    }
    sendJson(response, 200, recordClientHeartbeat());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shutdown") {
    if (!isLocalRequest(request)) {
      throw httpError(403, "Shutdown is only available from localhost");
    }
    if (hasRunningWork()) {
      throw httpError(409, "Cannot shut down while a scan or queue is still running.");
    }
    sendJson(response, 200, {
      ok: true,
      shuttingDown: true,
    });
    setTimeout(() => beginShutdown("manual shutdown requested"), 25).unref?.();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/queue") {
    sendJson(response, 200, serializeQueue());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/items") {
    const input = await readJsonBody(request);
    const items = addQueueItems(input);
    sendJson(response, 201, {
      items: items.map(serializeQueueItem),
      queue: serializeQueue(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/start") {
    const input = await readJsonBody(request);
    startQueue(input);
    sendJson(response, 200, serializeQueue());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/stop") {
    stopQueue();
    sendJson(response, 200, serializeQueue());
    return;
  }

  const queueItemMatch = /^\/api\/queue\/items\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (queueItemMatch) {
    const item = queue.items.find((candidate) => candidate.id === queueItemMatch[1]);
    const action = queueItemMatch[2];
    if (!item) {
      throw httpError(404, "Queue item not found");
    }

    if (request.method === "POST" && action === "remove") {
      removeQueueItem(item.id);
      sendJson(response, 200, serializeQueue());
      return;
    }

    if (request.method === "GET" && action === "report") {
      if (!item.report) {
        sendJson(response, 202, serializeQueueItem(item));
        return;
      }
      sendJson(response, 200, item.report, {
        "content-disposition": `attachment; filename="link-check-queue-${item.id}.json"`,
      });
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/jobs") {
    const input = await readJsonBody(request);
    validateStartUrl(input.url);
    const job = createJob(input);
    sendJson(response, 201, {
      id: job.id,
      state: job.state,
      eventsUrl: `/api/jobs/${job.id}/events`,
      reportUrl: `/api/jobs/${job.id}/report`,
    });
    return;
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    const action = jobMatch[2];
    if (!job) {
      throw httpError(404, "Job not found");
    }

    if (request.method === "GET" && action === "events") {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        "connection": "keep-alive",
      });
      response.write(": connected\n\n");
      job.clients.add(response);
      if (job.reporter) {
        sendJobEvent(job, "status", job.reporter.snapshot());
      }
      if (job.report) {
        sendJobEvent(job, "complete", buildCompletePayload(job));
      }
      request.on("close", () => job.clients.delete(response));
      return;
    }

    if (request.method === "GET" && action === "report") {
      if (!job.report) {
        sendJson(response, 202, {
          state: job.state,
          error: job.error,
        });
        return;
      }
      sendJson(response, 200, job.report, {
        "content-disposition": `attachment; filename="link-check-report-${job.id}.json"`,
      });
      return;
    }

    if (request.method === "POST" && action === "stop") {
      if (job.checker && job.state === "running") {
        job.state = "stopping";
        job.checker.stop();
        sendJobEvent(job, "status", {
          id: job.id,
          state: job.state,
        });
      }
      sendJson(response, 200, {
        id: job.id,
        state: job.state,
      });
      return;
    }
  }

  if (request.method === "GET") {
    await serveStatic(request, response, url.pathname);
    return;
  }

  throw httpError(404, "Not found");
}

function createAppServer() {
  return createServer((request, response) => {
    route(request, response).catch((error) => sendError(response, error));
  });
}

function parseStartupOptions(argv) {
  const portIndex = argv.indexOf("--port");
  const idleShutdown = parseIdleShutdownOption(argv);

  if (portIndex === -1) {
    return {
      port: DEFAULT_PORT,
      explicitPort: false,
      idleShutdownMs: idleShutdown,
    };
  }

  const value = argv[portIndex + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--port requires a number between 1024 and 65535.");
  }

  const port = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid --port value "${value}". Use a number between 1024 and 65535.`);
  }

  return {
    port,
    explicitPort: true,
    idleShutdownMs: idleShutdown,
  };
}

function parseIdleShutdownOption(argv) {
  if (argv.includes("--no-idle-shutdown")) {
    return null;
  }

  const index = argv.indexOf("--idle-shutdown-ms");
  if (index === -1) {
    return null;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--idle-shutdown-ms requires a number of milliseconds, or use --no-idle-shutdown.");
  }

  const timeoutMs = Number.parseInt(value, 10);
  if (!/^\d+$/.test(value) || !Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 86400000) {
    throw new Error(`Invalid --idle-shutdown-ms value "${value}". Use 0 to disable, or a value up to 86400000.`);
  }

  return timeoutMs > 0 ? timeoutMs : null;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

async function startServer(options) {
  for (let attempt = 0; attempt < MAX_PORT_FALLBACK_ATTEMPTS; attempt += 1) {
    const port = options.port + attempt;
    if (port > 65535) {
      break;
    }

    const server = createAppServer();
    try {
      await listen(server, port);
      configureIdleShutdown(server, options.idleShutdownMs);
      return {
        server,
        port,
        fallbackUsed: port !== options.port,
      };
    } catch (error) {
      if (error.code === "EADDRINUSE" && !options.explicitPort) {
        console.warn(`Port ${port} is already in use; trying ${port + 1}.`);
        continue;
      }
      throw error;
    }
  }

  const lastPort = Math.min(65535, options.port + MAX_PORT_FALLBACK_ATTEMPTS - 1);
  throw new Error(`No available local port found from ${options.port} to ${lastPort}.`);
}

function formatStartupError(error, options) {
  if (error.code === "EADDRINUSE") {
    const suffix = options.explicitPort
      ? "Choose another port with --port <number>, or stop the program using that port."
      : "The fallback port search also failed. Stop the program using the port or try --port <number>.";
    return `Port ${options.port} is already in use. ${suffix}`;
  }

  if (error.code === "EACCES") {
    return `Cannot listen on port ${options.port}; permission was denied. Try a port between 1024 and 65535.`;
  }

  if (error.code === "EADDRNOTAVAIL") {
    return `Cannot bind to ${HOST}. Check the local network configuration.`;
  }

  return error.message || String(error);
}

function printStartupSuccess(port, fallbackUsed) {
  if (fallbackUsed) {
    console.log(`Default port ${DEFAULT_PORT} was busy; using http://${HOST}:${port} instead.`);
  }
  console.log(`Link Checker GUI is running at http://127.0.0.1:${port}`);
  console.log(`External Link Analyzer is running at http://127.0.0.1:${port}/analyzer.html`);
  console.log(`System CA startup mode: ${isSystemCaEnabled() ? "enabled" : "disabled"}; GUI checkbox can enable it per job.`);
  if (idleShutdownMs) {
    console.log(`Idle shutdown: enabled after ${idleShutdownMs}ms without an open GUI page or running work.`);
  }
}

async function main() {
  let options;
  try {
    options = parseStartupOptions(process.argv.slice(2));
    const { port, fallbackUsed } = await startServer(options);
    printStartupSuccess(port, fallbackUsed);
  } catch (error) {
    console.error(`Link Checker GUI failed to start: ${formatStartupError(error, options || { port: DEFAULT_PORT, explicitPort: false })}`);
    process.exitCode = 1;
  }
}

await main();
