#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import {
  DEFAULTS,
  REPORT_SCHEMA_VERSION,
  LinkChecker,
  applyConservativeDefaults,
  isSystemCaEnabled,
  redactSensitiveQueryValue,
} from "./link-checker.mjs";

const ROOT_DIR = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, "public");
const LOGS_DIR = join(ROOT_DIR, "logs");
const DEFAULT_PORT = 8787;
const HOST = "127.0.0.1";
const SESSION_HEADER = "x-link-checker-session";
const SESSION_TOKEN = randomUUID();
const MAX_PORT_FALLBACK_ATTEMPTS = 20;
const MAX_STORED_EVENTS = 10000;
const DEFAULT_IDLE_CHECK_INTERVAL_MS = 30000;
const SHUTDOWN_FORCE_EXIT_MS = 3000;
const RESTART_FORCE_CLOSE_CONNECTIONS_MS = 200;
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
let restartStarted = false;

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".ndjson", "application/x-ndjson; charset=utf-8"],
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
    this.currentUrl = this.redact(url);
    this.emitLog("page", `Depth ${depth}: ${this.redact(url)}`);
  }

  pageLinksFound(url, count) {
    this.emitLog("links", `${count} links found on ${this.redact(url)}`);
  }

  pageQueued(url, depth) {
    this.emitLog("queue", `Depth ${depth}: ${this.redact(url)}`);
  }

  externalSkipped(url, sourcePage) {
    this.emitLog("skip", `External link skipped: ${this.redact(url)}`, this.redact(sourcePage));
  }

  requestQueued(url, method) {
    this.currentUrl = this.redact(url);
    this.emitLog("request", `${method} ${this.redact(url)}`);
  }

  requestFinished(result) {
    this.currentUrl = this.redact(result.url);
    const reason = formatIssueReason(result);
    this.emitLog(result.ok ? "ok" : "broken", `${reason}: ${this.redact(result.url)}`);
    this.emit("status", this.snapshot());
  }

  redact(value) {
    return redactSensitiveQueryValue(value, this.job.options);
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
      pendingValidations: checker?.validationQueue.length || 0,
      activeValidationTasks: checker?.activeValidationTasks || 0,
      pendingUrls: checker
        ? checker.validationQueue.length + checker.activeValidationTasks
        : 0,
      activeRequests: checker?.fetchLimiter.active || 0,
      brokenLinks: brokenItems.length,
      brokenByType: countBrokenByType(brokenItems),
      redirects: countRedirected(results),
      redirectByType: countRedirectByType(results),
      skippedExternal: checker?.skippedExternal || 0,
      urlPatternSummary: buildUrlPatternSummary(checker, this.job.startUrl),
      currentUrl: this.currentUrl,
    };
  }

  emitLog(type, message, detail = null) {
    const item = {
      type,
      message: this.redact(message),
      detail: detail === null ? null : this.redact(detail),
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
    artifactSummary: null,
    artifactManifest: null,
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
      if (report.runStatus?.status === "failed") {
        job.state = "failed";
        job.error = report.runStatus.failureReason || "Scan failed";
      } else {
        job.state = report.runStatus?.status === "partial" || checker.stopped ? "stopped" : "finished";
      }
      return saveJobArtifacts(job);
    })
    .then(() => {
      sendJobEvent(job, "status", reporter.snapshot());
      if (job.state === "failed") {
        sendJobEvent(job, "error", {
          message: job.error,
          logDir: job.logDir,
          logRelativePath: job.logRelativePath,
          logError: job.logError,
        });
      } else {
        sendJobEvent(job, "complete", buildCompletePayload(job));
      }
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

function buildUrlPatternSummary(checker, startUrl) {
  if (!checker?.inventory || checker.inventory.size === 0) {
    return {
      totalKnownUrls: 0,
      warning: false,
      topPatterns: [],
      dominantPattern: null,
    };
  }

  const startHost = getUrlHost(startUrl);
  const counts = new Map();
  for (const item of checker.inventory.values()) {
    const label = getUrlPatternLabel(item.representativeUrl || item.canonicalUrl, startHost);
    if (!label) {
      continue;
    }
    counts.set(label, (counts.get(label) || 0) + 1);
  }

  const totalKnownUrls = [...counts.values()].reduce((total, count) => total + count, 0);
  const topPatterns = [...counts.entries()]
    .map(([pattern, count]) => ({
      pattern,
      count,
      ratio: totalKnownUrls > 0 ? Number((count / totalKnownUrls).toFixed(4)) : 0,
    }))
    .sort((left, right) => right.count - left.count || left.pattern.localeCompare(right.pattern))
    .slice(0, 3);

  const dominantPattern = topPatterns[0] || null;
  const warning = Boolean(
    dominantPattern
      && totalKnownUrls >= 100
      && dominantPattern.count >= 50
      && dominantPattern.ratio >= 0.4
  );

  return {
    totalKnownUrls,
    warning,
    topPatterns,
    dominantPattern,
  };
}

function getUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function getUrlPatternLabel(value, startHost = "") {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname || "/";
    if (!startHost || parsed.host === startHost) {
      return pathname;
    }
    return `${parsed.host}${pathname}`;
  } catch {
    return "";
  }
}

function buildCompletePayload(job) {
  const summary = job.artifactSummary || buildLogSummary(job);
  const manifest = job.artifactManifest || null;
  return {
    state: job.state,
    schemaVersion: job.report?.schemaVersion || summary.schemaVersion || REPORT_SCHEMA_VERSION,
    generator: job.report?.generator || summary.generator || null,
    startUrl: job.report?.startUrl || summary.startUrl || redactSensitiveQueryValue(job.startUrl, job.options),
    options: job.report?.options || summary.options || job.options,
    runStatus: job.report?.runStatus || null,
    summary: job.report?.summary || summary.summary || null,
    reportFiles: summary.reportFiles || null,
    manifest,
    reportUrl: `/api/jobs/${job.id}/report`,
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

    const artifactPlan = getJobArtifactPlan(job);
    const summary = buildLogSummary(job, artifactPlan);
    job.artifactSummary = summary;
    job.artifactManifest = null;
    const writes = [writeJsonFile(join(logDir, "report.json"), job.report || summary)];
    if (artifactPlan.some((artifact) => artifact.path === "broken.csv")) {
      writes.push(writeFile(join(logDir, "broken.csv"), makeBrokenCsv(job.report?.broken || [], job.options), "utf8"));
    } else {
      writes.push(writeFile(join(logDir, "events.log"), makeEventsLog(job.events, job.options), "utf8"));
    }
    await Promise.all(writes);
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

function getJobArtifactPlan(job) {
  const reportSchemaVersion = job.report?.schemaVersion || REPORT_SCHEMA_VERSION;
  if (job.state === "finished" && job.report?.runStatus?.status === "complete") {
    return [
      { path: "broken.csv", summaryKey: "brokenCsv", kind: "csv", schemaVersion: null },
      { path: "report.json", summaryKey: "report", kind: "report", schemaVersion: reportSchemaVersion },
    ];
  }

  return [
    { path: "report.json", summaryKey: "report", kind: "report", schemaVersion: reportSchemaVersion },
    { path: "events.log", summaryKey: "events", kind: "log", schemaVersion: null },
  ];
}

function buildLogSummary(job, artifactPlan = getJobArtifactPlan(job)) {
  return {
    schemaVersion: job.report?.schemaVersion || REPORT_SCHEMA_VERSION,
    generator: job.report?.generator || null,
    jobId: job.id,
    state: job.state,
    startUrl: redactSensitiveQueryValue(job.startUrl, job.options),
    createdAt: job.createdAt,
    finishedAt: new Date().toISOString(),
    options: job.options,
    error: job.error,
    summary: job.report?.summary || null,
    reportFiles: Object.fromEntries(artifactPlan.map((artifact) => [artifact.summaryKey, artifact.path])),
  };
}

async function writeJsonFile(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function makeBrokenCsv(items, options = DEFAULTS) {
  const rows = [[
    "判讀分類",
    "建議處理",
    "是否需人工確認",
    "問題網址",
    "來源頁",
    "連結文字",
    "HTTP 狀態",
    "檢查結果",
    "最終網址",
  ]];

  for (const item of items) {
    const sources = item.sources?.length ? item.sources : [{}];
    const interpretation = getCsvInterpretation(item);
    for (const source of sources) {
      const displayUrl = redactSensitiveQueryValue(item.url, options);
      const sourcePage = redactSensitiveQueryValue(source.page || "", options);
      const sourceText = redactSensitiveQueryValue(source.text || "", options);
      const finalUrl = redactSensitiveQueryValue(item.finalUrl || "", options);
      rows.push([
        interpretation.label,
        redactSensitiveQueryValue(interpretation.action, options),
        interpretation.needsManualReview ? "是" : "否",
        displayUrl,
        sourcePage,
        sourceText,
        item.status ?? "",
        redactSensitiveQueryValue(formatCsvCheckResult(item), options),
        finalUrl,
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function getCsvInterpretation(item) {
  if (item?.interpretation?.category) {
    return {
      category: item.interpretation.category,
      label: item.interpretation.label || item.interpretation.category,
      severity: item.interpretation.severity || "review",
      action: item.interpretation.action || "請用瀏覽器人工確認是否可正常開啟，再決定是否交辦修正。",
      needsManualReview: Boolean(item.interpretation.needsManualReview),
    };
  }

  if (item?.needsReview || item?.classification === "protected" || item?.status === 403 || item?.status === 429) {
    return {
      category: "needs_review",
      label: "需人工確認",
      severity: "review",
      action: "請用瀏覽器人工確認是否可正常開啟，再決定是否交辦修正。",
      needsManualReview: true,
    };
  }

  return {
    category: "likely_problem",
    label: "可能失效",
    severity: "medium",
    action: "請確認網址、伺服器狀態或頁面是否仍存在。",
    needsManualReview: true,
  };
}

function formatCsvCheckResult(item) {
  const labels = {
    recovered: "二次確認時已恢復",
    confirmed_missing: "二次確認後仍不存在",
    needs_review: "二次確認時無法確認",
  };
  if (labels[item.confirmation?.outcome]) {
    return labels[item.confirmation.outcome];
  }
  if (item.suspectedWaf || item.suspectedBot || item.classification === "protected" || item.issueType === "protected") {
    return "網站防護可能阻擋自動檢查";
  }
  if (item.issueType === "timeout") {
    return "連線逾時";
  }
  if (item.issueType === "network_error" || item.classification === "network_error") {
    return "網路連線失敗";
  }
  if (item.issueType === "redirect_to_error") {
    return item.status === 404 || item.status === 410 ? "轉址後頁面不存在" : "轉址後發生錯誤";
  }
  if (item.issueType === "redirect_loop") {
    return "轉址循環";
  }
  if (item.issueType === "too_many_redirects") {
    return "轉址次數過多";
  }
  if (item.issueType === "access_denied" || item.status === 403) {
    return `外部網站拒絕存取${item.status ? `（HTTP ${item.status}）` : ""}`;
  }
  if (item.status) {
    return `HTTP ${item.status}`;
  }
  return "無法完成自動檢查";
}

function makeExternalLinksCsv(items, options = DEFAULTS) {
  const rows = [[
    "url",
    "hostname",
    "registrableDomain",
    "type",
    "categories",
    "riskLevel",
    "riskReasons",
    "governanceStatus",
    "matchedRules",
    "needsReview",
    "sourceCount",
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
        redactSensitiveQueryValue(item.url, options),
        item.hostname || "",
        item.registrableDomain || "",
        item.type || "",
        (item.categories || []).join(";"),
        item.externalRisk?.riskLevel || "",
        (item.externalRisk?.riskReasons || []).join(";"),
        item.externalRisk?.governanceStatus || "",
        formatMatchedRules(item.externalRisk?.matchedRules || []),
        item.externalRisk?.needsReview ? "yes" : "no",
        item.sourceCount ?? item.sources?.length ?? "",
        item.checked ? "yes" : "no",
        item.ok === null || item.ok === undefined ? "" : item.ok ? "yes" : "no",
        item.status ?? "",
        item.method || "",
        redactSensitiveQueryValue(item.finalUrl || "", options),
        item.checkedAt || "",
        redactSensitiveQueryValue(item.canonicalUrl || "", options),
        item.contentLength ?? "",
        item.cacheHeaders?.cacheControl || "",
        item.issueType || "",
        item.classification || "",
        item.blockedReason || "",
        redactSensitiveQueryValue(source.page || "", options),
        source.tag || "",
        source.attribute || "",
        redactSensitiveQueryValue(source.text || "", options),
      ]);
    }
  }

  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function formatMatchedRules(rules) {
  return rules
    .map((rule) => {
      if (typeof rule === "string") {
        return rule;
      }
      return [rule.id, rule.riskReason, rule.riskLevel].filter(Boolean).join(":");
    })
    .filter(Boolean)
    .join(";");
}

function makeEventsLog(events, options = DEFAULTS) {
  return events
    .map((event) => {
      const message = redactSensitiveQueryValue(event.message, options);
      const detail = event.detail ? ` | ${redactSensitiveQueryValue(event.detail, options)}` : "";
      return `[${event.at}] ${event.type}: ${message}${detail}`;
    })
    .join("\r\n")
    + (events.length ? "\r\n" : "");
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
    retryAfterMaxMs: clampInteger(input.retryAfterMaxMs, baseOptions.retryAfterMaxMs, 0, 300000),
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
    systemCa: isSystemCaEnabled(),
    blockPrivateIp: input.blockPrivateIp !== false,
    allowLocalhost: Boolean(input.allowLocalhost ?? baseOptions.allowLocalhost),
    allowPrivateIp: Boolean(input.allowPrivateIp ?? baseOptions.allowPrivateIp),
    robotsTxt: input.robotsTxt !== false,
    authorizedScan: Boolean(input.authorizedScan ?? baseOptions.authorizedScan),
    authorizationNote: typeof input.authorizationNote === "string" && input.authorizationNote.trim()
      ? input.authorizationNote.trim().slice(0, 500)
      : baseOptions.authorizationNote,
    protectionBodyHash: Boolean(input.protectionBodyHash ?? baseOptions.protectionBodyHash),
    keepAlive: input.keepAlive !== false,
    redactSensitiveQuery: input.redactSensitiveQuery !== false,
    redactQueryKeys: Array.isArray(input.redactQueryKeys) ? input.redactQueryKeys : baseOptions.redactQueryKeys,
    maxHtmlBytes: clampInteger(input.maxHtmlBytes, baseOptions.maxHtmlBytes, 0, 512 * 1024 * 1024),
    maxBodyPreviewBytes: clampInteger(input.maxBodyPreviewBytes, baseOptions.maxBodyPreviewBytes, 0, 512 * 1024 * 1024),
    maxDownloadProbeBytes: clampInteger(input.maxDownloadProbeBytes, baseOptions.maxDownloadProbeBytes, 0, 512 * 1024 * 1024),
    maxSourcesPerUrl: clampInteger(input.maxSourcesPerUrl, baseOptions.maxSourcesPerUrl, 0, 100000),
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

function isLocalHostHeader(request) {
  const rawHost = String(request.headers.host || "").trim().toLowerCase();
  if (!rawHost) {
    return false;
  }

  const hostname = rawHost.startsWith("[")
    ? rawHost.slice(1, rawHost.indexOf("]"))
    : rawHost.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isSameOriginRequest(request) {
  const origin = request.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === String(request.headers.host || "").toLowerCase();
  } catch {
    return false;
  }
}

function isCrossSiteRequest(request) {
  return String(request.headers["sec-fetch-site"] || "").toLowerCase() === "cross-site";
}

function requireLocalSession(request, { requireJson = false } = {}) {
  if (!isLocalRequest(request) || !isLocalHostHeader(request)) {
    throw httpError(403, "Local GUI API is only available from localhost");
  }
  if (!isSameOriginRequest(request) || isCrossSiteRequest(request)) {
    throw httpError(403, "Cross-site GUI API requests are not allowed");
  }
  if (request.headers[SESSION_HEADER] !== SESSION_TOKEN) {
    throw httpError(403, "Missing or invalid GUI session token");
  }
  if (requireJson) {
    const contentType = String(request.headers["content-type"] || "").toLowerCase();
    if (!contentType.split(";").map((part) => part.trim()).includes("application/json")) {
      throw httpError(415, "Mutation request body must use application/json");
    }
  }
}

function requireLocalSessionEndpoint(request) {
  if (!isLocalRequest(request) || !isLocalHostHeader(request)) {
    throw httpError(403, "Local GUI session is only available from localhost");
  }
  if (!isSameOriginRequest(request) || isCrossSiteRequest(request)) {
    throw httpError(403, "Cross-site GUI session requests are not allowed");
  }
}

function recordClientHeartbeat() {
  lastClientSeenAt = Date.now();
  return {
    ok: true,
    lastClientSeenAt: new Date(lastClientSeenAt).toISOString(),
    idleShutdownMs,
  };
}

function hasRestartBlockingWork({
  currentQueue = queue,
  currentJobs = jobs,
} = {}) {
  if (
    currentQueue.running
    || currentQueue.stopRequested
    || currentQueue.currentItemIds?.size > 0
  ) {
    return true;
  }

  if ((currentQueue.items || []).some((item) => (
    item.state === "queued" || item.state === "running" || item.state === "stopping"
  ))) {
    return true;
  }

  for (const job of currentJobs.values()) {
    if (job.state === "running" || job.state === "stopping") {
      return true;
    }
  }

  return false;
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

function getActiveServerPort() {
  const address = activeServer?.address?.();
  return address && typeof address === "object" ? address.port : null;
}

function buildSystemCaRestartPlan({
  execPath = process.execPath,
  serverScript = fileURLToPath(import.meta.url),
  port = getActiveServerPort(),
  currentIdleShutdownMs = idleShutdownMs,
  env = process.env,
} = {}) {
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
    throw httpError(500, "Cannot restart Link Checker because the current GUI port is unknown.");
  }

  const args = [
    "--use-system-ca",
    serverScript,
    "--port",
    String(parsedPort),
  ];

  if (Number.isFinite(currentIdleShutdownMs) && currentIdleShutdownMs > 0) {
    args.push("--idle-shutdown-ms", String(Math.floor(currentIdleShutdownMs)));
  } else {
    args.push("--no-idle-shutdown");
  }

  return {
    command: execPath,
    args,
    options: {
      cwd: ROOT_DIR,
      detached: true,
      env: { ...env },
      stdio: "ignore",
      windowsHide: true,
    },
  };
}

function resolveSystemCaRestartRequest({
  systemCaEnabled = isSystemCaEnabled(),
  runningWork = hasRestartBlockingWork(),
  restartPlanOptions = {},
} = {}) {
  if (systemCaEnabled) {
    return {
      status: "already_enabled",
      accepted: false,
      systemCaEnabled: true,
    };
  }

  if (runningWork) {
    return {
      status: "busy",
      accepted: false,
      systemCaEnabled: false,
      error: "目前有掃描工作進行中，請先停止或等待完成後再重新啟動。",
    };
  }

  return {
    status: "accepted",
    accepted: true,
    systemCaEnabled: false,
    restartPlan: buildSystemCaRestartPlan(restartPlanOptions),
  };
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

  console.log(`Link Checker 正在停止：${formatShutdownReason(reason)}`);
  const forceExitTimer = setTimeout(() => process.exit(0), SHUTDOWN_FORCE_EXIT_MS);
  forceExitTimer.unref?.();

  if (!activeServer) {
    process.exit(0);
    return;
  }

  activeServer.close(() => process.exit(0));
}

function beginSystemCaRestart(plan) {
  if (shutdownStarted || restartStarted) {
    return;
  }

  restartStarted = true;
  shutdownStarted = true;
  if (idleShutdownTimer) {
    clearInterval(idleShutdownTimer);
    idleShutdownTimer = null;
  }

  console.log("Link Checker 正在重新啟動並使用 Windows 系統憑證。");

  let relaunched = false;
  const relaunch = () => {
    if (relaunched) {
      return;
    }
    relaunched = true;
    try {
      const child = spawn(plan.command, plan.args, plan.options);
      child.unref?.();
      process.exit(0);
    } catch (error) {
      console.error(`Link Checker 無法重新啟動：${error.message}`);
      process.exit(1);
    }
  };

  if (!activeServer) {
    relaunch();
    return;
  }

  activeServer.close(relaunch);
  activeServer.closeIdleConnections?.();
  setTimeout(() => activeServer?.closeAllConnections?.(), RESTART_FORCE_CLOSE_CONNECTIONS_MS).unref?.();
  setTimeout(relaunch, SHUTDOWN_FORCE_EXIT_MS).unref?.();
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

  if (request.method === "GET" && url.pathname === "/api/session") {
    requireLocalSessionEndpoint(request);
    sendJson(response, 200, {
      sessionHeader: "X-Link-Checker-Session",
      sessionToken: SESSION_TOKEN,
      systemCaEnabled: isSystemCaEnabled(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/session/heartbeat") {
    requireLocalSession(request);
    sendJson(response, 200, recordClientHeartbeat());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/shutdown") {
    requireLocalSession(request);
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

  if (request.method === "POST" && url.pathname === "/api/restart-system-ca") {
    requireLocalSession(request);
    const decision = resolveSystemCaRestartRequest();
    if (decision.status === "busy") {
      throw httpError(409, decision.error);
    }
    if (decision.status === "already_enabled") {
      sendJson(response, 200, {
        ok: true,
        status: decision.status,
        systemCaEnabled: true,
      });
      return;
    }

    sendJson(response, 202, {
      ok: true,
      status: decision.status,
      restarting: true,
      systemCaEnabled: false,
    });
    setTimeout(() => beginSystemCaRestart(decision.restartPlan), 25).unref?.();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/queue") {
    sendJson(response, 200, serializeQueue());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/items") {
    requireLocalSession(request, { requireJson: true });
    const input = await readJsonBody(request);
    const items = addQueueItems(input);
    sendJson(response, 201, {
      items: items.map(serializeQueueItem),
      queue: serializeQueue(),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/start") {
    requireLocalSession(request, { requireJson: true });
    const input = await readJsonBody(request);
    startQueue(input);
    sendJson(response, 200, serializeQueue());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/queue/stop") {
    requireLocalSession(request);
    stopQueue();
    sendJson(response, 200, serializeQueue());
    return;
  }

  const queueItemMatch = /^\/api\/queue\/items\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
  if (queueItemMatch) {
    const action = queueItemMatch[2];
    if (request.method === "POST" && action === "remove") {
      requireLocalSession(request);
    }

    const item = queue.items.find((candidate) => candidate.id === queueItemMatch[1]);
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
    requireLocalSession(request, { requireJson: true });
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
    const action = jobMatch[2];
    if (request.method === "POST" && action === "stop") {
      requireLocalSession(request);
    }

    const job = jobs.get(jobMatch[1]);
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
    console.log(`預設連接埠 ${DEFAULT_PORT} 已被使用，已改用：http://${HOST}:${port}`);
  }
  console.log(`Link Checker GUI is running at http://127.0.0.1:${port}`);
  console.log("Link Checker 已啟動，請在瀏覽器開啟下列頁面：");
  console.log("");
  console.log(`連結檢查主頁：http://127.0.0.1:${port}`);
  console.log(`外部連結分析頁：http://127.0.0.1:${port}/analyzer.html`);
  console.log(`報告分析頁：http://127.0.0.1:${port}/report-analyzer.html`);
  console.log("");
  console.log("提醒：此命令視窗需保持開啟；關閉後 Link Checker 會停止。");
  console.log(`系統憑證模式：${isSystemCaEnabled() ? "已啟用" : "未啟用"}。使用 --system-ca 啟動可載入 Windows 系統信任憑證。`);
  if (idleShutdownMs) {
    console.log(`閒置自動關閉：已啟用；沒有開啟 GUI 頁面且沒有執行工作時，會在 ${idleShutdownMs}ms 後停止。`);
  }
}

function formatShutdownReason(reason) {
  const idleMatch = /^idle for (\d+)ms$/.exec(reason || "");
  if (idleMatch) {
    return `閒置 ${idleMatch[1]}ms`;
  }
  if (reason === "manual shutdown requested") {
    return "使用者手動關閉";
  }
  return reason || "未指定原因";
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

export {
  buildCompletePayload,
  buildLogSummary,
  buildSystemCaRestartPlan,
  buildUrlPatternSummary,
  getJobArtifactPlan,
  hasRestartBlockingWork,
  makeBrokenCsv,
  makeEventsLog,
  makeExternalLinksCsv,
  resolveSystemCaRestartRequest,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
