const reportFileInput = document.querySelector("#report-file");
const searchInput = document.querySelector("#search");
const issueFilterInput = document.querySelector("#issue-filter");
const statusFilterInput = document.querySelector("#status-filter");
const exportCsvButton = document.querySelector("#export-csv-button");
const clearButton = document.querySelector("#clear-button");
const loadState = document.querySelector("#load-state");
const reportEmptyState = document.querySelector("#report-empty-state");
const fileStatus = document.querySelector("#file-status");
const flowSelect = document.querySelector("#flow-select");
const flowLoad = document.querySelector("#flow-load");
const flowExport = document.querySelector("#flow-export");
const metricPages = document.querySelector("#metric-pages");
const metricChecked = document.querySelector("#metric-checked");
const metricBroken = document.querySelector("#metric-broken");
const metricBrokenRate = document.querySelector("#metric-broken-rate");
const brokenRateCard = document.querySelector("#broken-rate-card");
const metricRedirects = document.querySelector("#metric-redirects");
const metricSkipped = document.querySelector("#metric-skipped");
const runStatusBanner = document.querySelector("#run-status-banner");
const incrementalSummaryPanel = document.querySelector("#incremental-summary-panel");
const incrementalSummaryState = document.querySelector("#incremental-summary-state");
const incrementalMode = document.querySelector("#incremental-mode");
const incrementalNew = document.querySelector("#incremental-new");
const incrementalKnown = document.querySelector("#incremental-known");
const incrementalReused = document.querySelector("#incremental-reused");
const incrementalDisappeared = document.querySelector("#incremental-disappeared");
const incrementalPriority = document.querySelector("#incremental-priority");
const issueSummaryCount = document.querySelector("#issue-summary-count");
const sourceSummaryCount = document.querySelector("#source-summary-count");
const domainSummaryCount = document.querySelector("#domain-summary-count");
const linksSummary = document.querySelector("#links-summary");
const issueList = document.querySelector("#issue-list");
const sourceList = document.querySelector("#source-list");
const domainList = document.querySelector("#domain-list");
const linksTable = document.querySelector("#links-table");

startSessionHeartbeat();

const ISSUE_LABELS = {
  not_found: "頁面不存在",
  protected: "網站防護阻擋",
  access_denied: "網站拒絕檢查",
  http_error: "其他 HTTP 錯誤",
  redirect_to_error: "轉址到錯誤頁",
  too_many_redirects: "轉址過多",
  redirect_loop: "轉址迴圈",
  timeout: "連線逾時",
  network_error: "連線失敗",
  unknown_error: "未知錯誤",
};

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

const FILE_SIZE_WARN_BYTES = 15 * 1024 * 1024;
const FILE_SIZE_LARGE_BYTES = 50 * 1024 * 1024;
const BROKEN_LIST_INITIAL_COUNT = 200;
const BROKEN_LIST_INCREMENT = 200;

let currentAnalysis = null;
let brokenListState = {
  key: "",
  visibleCount: BROKEN_LIST_INITIAL_COUNT,
};

function startSessionHeartbeat() {
  const send = () => fetch("/api/session/heartbeat", {
    method: "POST",
    cache: "no-store",
    keepalive: true,
  }).catch(() => {});

  send();
  setInterval(send, 30000);
  window.addEventListener("pagehide", send);
}

reportFileInput.addEventListener("change", loadReportFile);

for (const input of [searchInput, issueFilterInput, statusFilterInput]) {
  input.addEventListener("input", () => {
    if (currentAnalysis) {
      renderAnalysis(applyFilters(currentAnalysis));
    }
  });
}

exportCsvButton.addEventListener("click", () => {
  if (!currentAnalysis) {
    return;
  }
  const filtered = applyFilters(currentAnalysis);
  downloadText("report-broken-links.csv", makeBrokenCsv(filtered.filteredBroken), "text/csv");
});

clearButton.addEventListener("click", () => {
  currentAnalysis = null;
  resetBrokenListState();
  reportFileInput.value = "";
  searchInput.value = "";
  resetSelect(issueFilterInput, "全部");
  resetSelect(statusFilterInput, "全部");
  exportCsvButton.disabled = true;
  clearButton.disabled = true;
  setFileStatus(null);
  setReportFlow("select", "尚未載入 report.json");
  renderEmpty();
});

async function loadReportFile() {
  const file = reportFileInput.files?.[0];
  if (!file) {
    setReportFlow("select", "尚未載入 report.json");
    setFileStatus(null);
    return;
  }

  try {
    const profile = getFileSizeProfile(file);
    setFileStatus(profile.message, profile.level);
    setReportFlow("load", `正在載入 ${file.name}（${formatBytes(file.size)}）`);
    reportFileInput.disabled = true;
    clearButton.disabled = true;
    exportCsvButton.disabled = true;
    await yieldToBrowser();
    const text = await file.text();
    const report = loadReportContent(text, file);
    currentAnalysis = analyzeReport(report);
    resetBrokenListState();
    populateFilters(currentAnalysis);
    renderAnalysis(applyFilters(currentAnalysis));
    exportCsvButton.disabled = false;
    clearButton.disabled = false;
    setFileStatus(`${file.name} 已載入，大小 ${formatBytes(file.size)}。`, "ok");
    setReportFlow("export", `${file.name} 已載入，${currentAnalysis.broken.length} 筆待判讀結果${currentAnalysis.runStatus.status === "complete" ? "" : "，報告未完整完成"}；可篩選或匯出`);
  } catch (error) {
    currentAnalysis = null;
    exportCsvButton.disabled = true;
    clearButton.disabled = false;
    setFileStatus(error.message, "error");
    setReportFlow("load", "讀取失敗");
    renderEmpty("無法解析匯入檔案。");
  } finally {
    reportFileInput.disabled = false;
  }
}

function loadReportContent(text, file) {
  if (isNdjsonFile(file)) {
    try {
      if (!isBrokenNdjsonFile(file)) {
        throw new Error("Report Analyzer 第一版只支援 broken.ndjson，不支援 checked.ndjson 或 external-links.ndjson。");
      }
      return makeBrokenSidecarReport(parseNdjsonContent(text), file.name);
    } catch (error) {
      throw makeImportError("ndjson", error, file);
    }
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw makeImportError("json", error, file);
  }
}

function makeBrokenSidecarReport(items, fileName) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${fileName} 沒有可匯入的待判讀資料列。`);
  }
  return {
    schemaVersion: "sidecar.ndjson",
    sourceFile: fileName,
    runStatus: {
      status: "partial",
      failureReason: "目前載入的是 broken.ndjson sidecar，只包含待判讀明細，沒有完整 checked / summary 資訊",
    },
    summary: {
      pagesCrawled: 0,
      urlsChecked: 0,
      brokenLinks: items.length,
      redirects: 0,
      skippedExternal: 0,
    },
    checked: [],
    broken: items,
  };
}

function parseNdjsonContent(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      rows.push(JSON.parse(trimmed));
    } catch (error) {
      throw new Error(`第 ${index + 1} 行不是有效 JSON：${error.message}`);
    }
  });
  return rows;
}

function isNdjsonFile(file) {
  return file.name.toLowerCase().endsWith(".ndjson");
}

function isBrokenNdjsonFile(file) {
  return file.name.toLowerCase() === "broken.ndjson";
}

function getFileSizeProfile(file) {
  if (file.size >= FILE_SIZE_LARGE_BYTES) {
    return {
      level: "warn",
      message: `${file.name} 大小 ${formatBytes(file.size)}，瀏覽器載入完整 report 可能會停頓。若只是要處理明細，建議優先使用 GUI log 目錄中的 broken.csv 或 broken.ndjson。`,
    };
  }
  if (file.size >= FILE_SIZE_WARN_BYTES) {
    return {
      level: "warn",
      message: `${file.name} 大小 ${formatBytes(file.size)}，載入與篩選可能需要一點時間。`,
    };
  }
  return {
    level: "ok",
    message: `${file.name} 大小 ${formatBytes(file.size)}，可直接載入。`,
  };
}

function makeImportError(kind, error, file) {
  if (kind === "ndjson") {
    return new Error(`${file.name} 不是可解析的 broken.ndjson；請確認檔案是一行一筆 JSON object，且來源為 GUI log 目錄的 broken.ndjson。${error.message}`);
  }
  if (kind === "json" && error instanceof SyntaxError) {
    return new Error(`${file.name} 不是可解析的 report.json；請確認檔案是完整 JSON，或改用 broken.csv / broken.ndjson。`);
  }
  if (error instanceof RangeError || /allocation|memory|out of memory|maximum/i.test(error.message || "")) {
    return new Error(`${file.name} 太大，瀏覽器可能無法一次處理。請改用 broken.csv / broken.ndjson，或先縮小報告範圍。`);
  }
  return new Error(`讀取 ${file.name} 失敗：${error.message}`);
}

function setFileStatus(message, level = "ok") {
  if (!fileStatus) {
    return;
  }
  if (!message) {
    fileStatus.hidden = true;
    fileStatus.textContent = "";
    fileStatus.className = "file-status";
    return;
  }
  fileStatus.hidden = false;
  fileStatus.textContent = message;
  fileStatus.className = level === "warn" || level === "error"
    ? `file-status ${level}`
    : "file-status";
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "未知大小";
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function analyzeReport(report) {
  if (!report || typeof report !== "object") {
    throw new Error("檔案內容不是有效的 JSON 物件");
  }

  const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
  const runStatus = normalizeRunStatus(report.runStatus);
  const broken = normalizeBrokenItems(report.broken || []);
  const checked = Array.isArray(report.checked) ? report.checked : [];
  const enrichedBroken = broken.map((item) => ({
    ...item,
    issueType: inferIssueType(item),
    statusKey: normalizeStatus(item.status),
    domain: extractHostname(item.finalUrl || item.url),
  })).map((item) => ({
    ...item,
    interpretation: normalizeInterpretation(item),
  })).map((item) => ({
    ...item,
    interpretationCategory: item.interpretation.category,
  }));

  const checkedCount = toNumber(summary.urlsChecked, checked.length || enrichedBroken.length);
  const brokenCount = toNumber(summary.brokenLinks, enrichedBroken.length);
  const metrics = {
    pagesCrawled: toNumber(summary.pagesCrawled, 0),
    urlsChecked: checkedCount,
    brokenLinks: brokenCount,
    brokenRate: checkedCount > 0 ? brokenCount / checkedCount : 0,
    redirects: toNumber(summary.redirects, countRedirected(checked)),
    skippedExternal: toNumber(summary.skippedExternal, 0),
  };

  return {
    report,
    runStatus,
    incremental: normalizeIncrementalSummary(summary.incremental),
    metrics,
    broken: enrichedBroken,
    interpretationCounts: countBy(enrichedBroken, "interpretationCategory"),
    statusCounts: countBy(enrichedBroken, "statusKey"),
    sourceCounts: countSources(enrichedBroken),
    domainCounts: countBy(enrichedBroken.filter((item) => item.domain), "domain"),
  };
}

function normalizeBrokenItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("report.json 缺少 broken 陣列");
  }

  return items.map((item) => {
    const sources = Array.isArray(item.sources) ? item.sources : [];
    return {
      url: String(item.url || ""),
      status: item.status ?? "",
      issueType: item.issueType || "",
      classification: item.classification || "",
      checkedAt: item.checkedAt || "",
      canonicalUrl: item.canonicalUrl || "",
      method: item.method || "",
      finalUrl: item.finalUrl || "",
      contentType: item.contentType || "",
      contentLength: item.contentLength ?? "",
      cacheHeaders: item.cacheHeaders && typeof item.cacheHeaders === "object" ? item.cacheHeaders : {},
      wafHeaders: item.wafHeaders && typeof item.wafHeaders === "object" ? item.wafHeaders : {},
      blockedReason: item.blockedReason || "",
      blockedRuleId: item.blockedRuleId || "",
      bodySignature: item.bodySignature && typeof item.bodySignature === "object" ? item.bodySignature : null,
      interpretation: item.interpretation && typeof item.interpretation === "object" ? item.interpretation : null,
      suspectedWaf: Boolean(item.suspectedWaf),
      suspectedBot: Boolean(item.suspectedBot),
      confirmation: normalizeConfirmation(item.confirmation),
      incremental: normalizeIncrementalResult(item.incremental),
      needsReview: Boolean(item.needsReview),
      transientFailure: Boolean(item.transientFailure),
      elapsedMs: item.elapsedMs ?? "",
      error: item.error || "",
      diagnosis: item.diagnosis || "",
      redirectIssues: Array.isArray(item.redirectIssues) ? item.redirectIssues : [],
      sources,
    };
  }).filter((item) => item.url);
}

function normalizeRunStatus(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      status: "complete",
      legacyDefault: true,
    };
  }

  return {
    status: ["complete", "partial", "failed"].includes(value.status) ? value.status : "complete",
    stoppedByUser: value.stoppedByUser === true,
    failureReason: typeof value.failureReason === "string" ? value.failureReason : "",
    stopReason: typeof value.stopReason === "string" ? value.stopReason : "",
    completedAt: typeof value.completedAt === "string" ? value.completedAt : "",
  };
}

function normalizeConfirmation(value) {
  if (!value || typeof value !== "object") {
    return {
      enabled: false,
      candidate: false,
      checked: false,
      outcome: "",
      status: "",
      finalUrl: "",
      checkedAt: "",
      referer: "",
      reason: "",
    };
  }

  return {
    enabled: Boolean(value.enabled),
    candidate: Boolean(value.candidate),
    checked: Boolean(value.checked),
    outcome: value.outcome || "",
    status: value.status ?? "",
    finalUrl: value.finalUrl || "",
    checkedAt: value.checkedAt || "",
    referer: value.referer || "",
    reason: value.reason || "",
  };
}

function normalizeIncrementalSummary(value) {
  if (!value || typeof value !== "object" || value.enabled !== true) {
    return {
      enabled: false,
    };
  }
  const priority = value.priority && typeof value.priority === "object" ? value.priority : {};
  return {
    enabled: true,
    mode: value.mode || "",
    new: toNumber(value.new, 0),
    known: toNumber(value.known, 0),
    reused: toNumber(value.reused, 0),
    disappeared: toNumber(value.disappeared, 0),
    priority: {
      boosted: toNumber(priority.boosted, 0),
      deferred: toNumber(priority.deferred, 0),
    },
  };
}

function normalizeIncrementalResult(value) {
  if (!value || typeof value !== "object") {
    return {
      reused: false,
      classification: "",
      reuseSource: "",
      baselineCheckedAt: "",
      reason: "",
    };
  }
  return {
    reused: value.reused === true,
    classification: value.classification || "",
    reuseSource: value.reuseSource || "",
    baselineCheckedAt: value.baselineCheckedAt || "",
    reason: value.reason || "",
  };
}

function inferIssueType(item) {
  if (item.issueType) {
    return item.issueType;
  }
  if (item.redirectIssues.length > 0) {
    return item.redirectIssues[0];
  }
  if (item.classification && item.classification !== "http_error") {
    return item.classification;
  }

  const status = Number.parseInt(item.status, 10);
  const text = `${item.error} ${item.diagnosis}`.toLowerCase();
  if (status === 404 || status === 410) {
    return "not_found";
  }
  if (status === 401 || status === 403) {
    return "access_denied";
  }
  if ([408, 504].includes(status) || text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (status >= 300 && status < 400) {
    return "redirect_to_error";
  }
  if (status >= 400) {
    return "http_error";
  }
  if (text.includes("network") || text.includes("dns") || text.includes("econn") || text.includes("fetch failed")) {
    return "network_error";
  }
  return "unknown_error";
}

function applyFilters(analysis) {
  const query = searchInput.value.trim().toLowerCase();
  const issue = issueFilterInput.value;
  const status = statusFilterInput.value;
  const filteredBroken = analysis.broken.filter((item) => {
    if (issue !== "all" && item.interpretationCategory !== issue) {
      return false;
    }
    if (status !== "all" && item.statusKey !== status) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      item.url,
      item.finalUrl,
      item.canonicalUrl,
      item.domain,
      item.interpretation.category,
      item.interpretation.label,
      item.interpretation.action,
      item.interpretation.needsManualReview ? "需人工確認" : "",
      item.issueType,
      ISSUE_LABELS[item.issueType],
      item.status,
      item.error,
      item.diagnosis,
      item.blockedReason,
      item.incremental.reused ? "reused" : "",
      item.incremental.reuseSource,
      item.incremental.reason,
      item.bodySignature?.title,
      item.bodySignature?.matchedPatterns?.join(" "),
      ...item.sources.flatMap((source) => [source.page, source.tag, source.attribute, source.text]),
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });

  return {
    ...analysis,
    filteredBroken,
    filteredInterpretationCounts: countBy(filteredBroken, "interpretationCategory"),
    filteredSourceCounts: countSources(filteredBroken),
    filteredDomainCounts: countBy(filteredBroken.filter((item) => item.domain), "domain"),
  };
}

function populateFilters(analysis) {
  populateSelect(
    issueFilterInput,
    Object.entries(analysis.interpretationCounts)
      .sort((a, b) => interpretationRank(a[0]) - interpretationRank(b[0]) || b[1] - a[1] || getInterpretationLabel(a[0]).localeCompare(getInterpretationLabel(b[0]))),
    (issue, count) => `${getInterpretationLabel(issue)} (${count})`,
  );
  populateSelect(
    statusFilterInput,
    Object.entries(analysis.statusCounts)
      .sort((a, b) => sortStatus(a[0], b[0])),
    (status, count) => `${status} (${count})`,
  );
}

function populateSelect(select, entries, labelFactory) {
  select.replaceChildren(new Option("全部", "all"));
  for (const [value, count] of entries) {
    select.append(new Option(labelFactory(value, count), value));
  }
}

function resetSelect(select, label) {
  select.replaceChildren(new Option(label, "all"));
}

function renderAnalysis(analysis) {
  setReportEmptyStateVisible(false);
  renderRunStatus(analysis.runStatus);
  renderIncrementalSummary(analysis.incremental);
  metricPages.textContent = formatNumber(analysis.metrics.pagesCrawled);
  metricChecked.textContent = formatNumber(analysis.metrics.urlsChecked);
  metricBroken.textContent = formatNumber(analysis.metrics.brokenLinks);
  metricBrokenRate.textContent = `${(analysis.metrics.brokenRate * 100).toFixed(1)}%`;
  updateBrokenRateCard(analysis.metrics.brokenRate);
  metricRedirects.textContent = formatNumber(analysis.metrics.redirects);
  metricSkipped.textContent = formatNumber(analysis.metrics.skippedExternal);

  renderInterpretationRankList(issueList, analysis.filteredInterpretationCounts, 20);
  renderRankList(sourceList, analysis.filteredSourceCounts, (value) => value, 20);
  renderRankList(domainList, analysis.filteredDomainCounts, (value) => value, 20);

  issueSummaryCount.textContent = `${Object.keys(analysis.filteredInterpretationCounts).length} 種`;
  sourceSummaryCount.textContent = `${Object.keys(analysis.filteredSourceCounts).length} 頁`;
  domainSummaryCount.textContent = `${Object.keys(analysis.filteredDomainCounts).length} 個`;
  linksSummary.textContent = `${formatNumber(analysis.filteredBroken.length)} / ${formatNumber(analysis.broken.length)} 筆`;

  renderBrokenTable(analysis.filteredBroken);
}

function renderRankList(container, counts, labelFactory, limit) {
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || labelFactory(a[0]).localeCompare(labelFactory(b[0])))
    .slice(0, limit);

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-note">沒有符合篩選條件的資料。</p>';
    return;
  }

  container.replaceChildren(...entries.map(([value, count]) => {
    const row = document.createElement("div");
    row.className = "rank-item";
    const label = document.createElement("strong");
    label.textContent = labelFactory(value);
    const amount = document.createElement("span");
    amount.textContent = `${formatNumber(count)} 筆`;
    row.append(label, amount);
    return row;
  }));
}

function renderInterpretationRankList(container, counts, limit) {
  const entries = Object.entries(counts)
    .sort((a, b) => interpretationRank(a[0]) - interpretationRank(b[0]) || b[1] - a[1] || getInterpretationLabel(a[0]).localeCompare(getInterpretationLabel(b[0])))
    .slice(0, limit);

  if (entries.length === 0) {
    container.innerHTML = '<p class="empty-note">沒有符合篩選條件的資料。</p>';
    return;
  }

  container.replaceChildren(...entries.map(([value, count]) => {
    const row = document.createElement("div");
    row.className = "rank-item has-badge";
    const label = document.createElement("strong");
    label.textContent = getInterpretationLabel(value);
    const amount = document.createElement("span");
    amount.textContent = `${formatNumber(count)} 筆`;
    row.append(interpretationBadge(value), label, amount);
    return row;
  }));
}

function renderBrokenTable(items) {
  if (items.length === 0) {
    linksTable.innerHTML = '<p class="empty-note issue-empty">沒有符合篩選條件的待判讀結果。</p>';
    return;
  }

  const sortedItems = sortBrokenItemsForDisplay(items);
  const key = getBrokenListKey(items);
  if (brokenListState.key !== key) {
    brokenListState = {
      key,
      visibleCount: BROKEN_LIST_INITIAL_COUNT,
    };
  }
  const visibleCount = Math.min(brokenListState.visibleCount, sortedItems.length);
  const visibleItems = sortedItems.slice(0, visibleCount);
  linksTable.replaceChildren(...visibleItems.map(renderIssueItem));
  if (sortedItems.length > visibleItems.length) {
    linksTable.append(renderLoadMoreControl({
      shown: visibleItems.length,
      total: sortedItems.length,
      onLoadMore: () => {
        brokenListState.visibleCount += BROKEN_LIST_INCREMENT;
        renderBrokenTable(items);
      },
    }));
  }
}

function resetBrokenListState() {
  brokenListState = {
    key: "",
    visibleCount: BROKEN_LIST_INITIAL_COUNT,
  };
}

function getBrokenListKey(items) {
  return [
    searchInput.value.trim().toLowerCase(),
    issueFilterInput.value,
    statusFilterInput.value,
    items.length,
  ].join("\u0001");
}

function renderLoadMoreControl({ shown, total, onLoadMore }) {
  const wrapper = document.createElement("div");
  wrapper.className = "list-pagination";

  const note = document.createElement("p");
  note.className = "list-limit-note";
  note.textContent = `目前顯示 ${formatNumber(shown)} / ${formatNumber(total)} 筆。`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "load-more-button";
  button.textContent = "載入更多";
  button.addEventListener("click", onLoadMore);

  wrapper.append(note, button);
  return wrapper;
}

function renderEmpty(message = "請先上傳 report.json。") {
  setReportEmptyStateVisible(true);
  renderRunStatus(null);
  renderIncrementalSummary(null);
  metricPages.textContent = "0";
  metricChecked.textContent = "0";
  metricBroken.textContent = "0";
  metricBrokenRate.textContent = "0%";
  updateBrokenRateCard(0);
  metricRedirects.textContent = "0";
  metricSkipped.textContent = "0";
  issueSummaryCount.textContent = "0 種";
  sourceSummaryCount.textContent = "0 頁";
  domainSummaryCount.textContent = "0 個";
  linksSummary.textContent = "0 筆";
  issueList.innerHTML = '<p class="empty-note">載入報告後顯示判讀分類。</p>';
  sourceList.innerHTML = '<p class="empty-note">載入報告後顯示來源頁。</p>';
  domainList.innerHTML = '<p class="empty-note">載入報告後顯示網域排行。</p>';
  linksTable.innerHTML = `<p class="empty-note issue-empty">${escapeHtml(message)}</p>`;
}

function setReportEmptyStateVisible(isVisible) {
  document.body.classList.toggle("is-empty", isVisible);
  if (!reportEmptyState) {
    return;
  }
  reportEmptyState.hidden = !isVisible;
}

function setReportFlow(stage, message) {
  loadState.textContent = message;
  const states = {
    select: ["active", "", ""],
    load: ["done", "active", ""],
    export: ["done", "done", "active"],
  }[stage] || ["active", "", ""];
  [flowSelect, flowLoad, flowExport].forEach((item, index) => {
    if (!item) {
      return;
    }
    item.classList.remove("active", "done");
    if (states[index]) {
      item.classList.add(states[index]);
    }
  });
}

function renderRunStatus(runStatus) {
  if (!runStatus || runStatus.status === "complete") {
    runStatusBanner.hidden = true;
    runStatusBanner.textContent = "";
    return;
  }

  const label = runStatus.status === "failed" ? "執行失敗" : "部分報告";
  const details = [];
  if (runStatus.stoppedByUser) {
    details.push("使用者停止");
  }
  if (runStatus.failureReason) {
    details.push(runStatus.failureReason);
  } else if (runStatus.stopReason) {
    details.push(runStatus.stopReason);
  }
  if (runStatus.completedAt) {
    details.push(`完成時間 ${runStatus.completedAt}`);
  }

  runStatusBanner.textContent = details.length > 0
    ? `${label}：${details.join("；")}。統計可能未涵蓋完整網站。`
    : `${label}：統計可能未涵蓋完整網站。`;
  runStatusBanner.hidden = false;
}

function renderIncrementalSummary(incremental) {
  if (!incrementalSummaryPanel) {
    return;
  }
  if (!incremental?.enabled) {
    incrementalSummaryPanel.hidden = true;
    incrementalSummaryState.textContent = "未啟用";
    incrementalMode.textContent = "-";
    incrementalNew.textContent = "0";
    incrementalKnown.textContent = "0";
    incrementalReused.textContent = "0";
    incrementalDisappeared.textContent = "0";
    incrementalPriority.textContent = "0 / 0";
    return;
  }

  incrementalSummaryPanel.hidden = false;
  incrementalSummaryState.textContent = "已啟用";
  incrementalMode.textContent = incremental.mode === "changed_only" ? "復用穩定結果" : "優先重查";
  incrementalNew.textContent = formatNumber(incremental.new);
  incrementalKnown.textContent = formatNumber(incremental.known);
  incrementalReused.textContent = formatNumber(incremental.reused);
  incrementalDisappeared.textContent = formatNumber(incremental.disappeared);
  incrementalPriority.textContent = `${formatNumber(incremental.priority.boosted)} / ${formatNumber(incremental.priority.deferred)}`;
}

function renderIssueItem(item) {
  const source = item.sources[0] || {};
  const sourceCount = item.sources.length;
  const row = document.createElement("article");
  row.className = "issue-item";

  const header = document.createElement("div");
  header.className = "issue-item-header";
  header.append(
    interpretationBadge(item.interpretation.category, formatInterpretationBadgeText(item)),
    metaBadge(formatSourceElement(source) || "無元素"),
    metaBadge(formatIssueBadgeText(item)),
  );
  if (hasIssueStatusMismatch(item)) {
    header.append(metaBadge("分類與狀態需確認", "impact"));
  }
  if (item.confirmation.enabled && item.confirmation.candidate) {
    header.append(metaBadge(getConfirmationLabel(item.confirmation), "impact"));
  }
  const incrementalBadge = getIncrementalResultBadge(item);
  if (incrementalBadge) {
    header.append(metaBadge(incrementalBadge.text, incrementalBadge.modifier));
  }
  if (sourceCount > 1) {
    header.append(metaBadge(`${formatNumber(sourceCount)} 個來源`, "impact"));
  }

  row.append(
    header,
    detailLine("URL", item.url),
    detailLine("檢查時間", item.checkedAt || "未記錄"),
    detailLine("Canonical URL", item.canonicalUrl || item.url),
    detailLine("來源頁", formatSources(item.sources)),
    detailLine("建議處理", item.interpretation.action),
    detailLine("技術原因", `${getIssueLabel(item.issueType)}${item.status ? ` / HTTP ${item.status}` : ""}`),
    detailLine("診斷", item.diagnosis || item.error || "無診斷資訊"),
  );
  if (item.contentLength !== "") {
    row.append(detailLine("Content-Length", item.contentLength));
  }
  if (item.cacheHeaders?.cacheControl) {
    row.append(detailLine("Cache-Control", item.cacheHeaders.cacheControl));
  }
  if (item.blockedReason || item.suspectedWaf || item.suspectedBot) {
    row.append(detailLine("防護診斷", formatProtectionDiagnostics(item)));
  }
  if (item.confirmation.enabled) {
    row.append(detailLine("二次確認", formatConfirmationStatus(item.confirmation)));
  }
  if (item.incremental.reused) {
    row.append(detailLine("增量來源", formatIncrementalProvenance(item.incremental)));
  }
  return row;
}

function sortBrokenItemsForDisplay(items) {
  return [...items].sort((a, b) => (
    interpretationRank(a.interpretationCategory) - interpretationRank(b.interpretationCategory)
    || issueRank(a.issueType) - issueRank(b.issueType)
    || (b.sources?.length || 0) - (a.sources?.length || 0)
    || String(a.statusKey || "").localeCompare(String(b.statusKey || ""))
    || String(a.domain || "").localeCompare(String(b.domain || ""))
    || String(a.url || "").localeCompare(String(b.url || ""))
  ));
}

function formatSources(sources) {
  if (!sources.length) {
    return "無來源頁";
  }
  const visible = sources
    .slice(0, 3)
    .map((source) => source.page || "無來源頁");
  const remaining = sources.length - visible.length;
  return remaining > 0
    ? `${visible.join("；")}；另有 ${formatNumber(remaining)} 個來源`
    : visible.join("；");
}

function formatProtectionDiagnostics(item) {
  const parts = [];
  if (item.blockedReason) {
    parts.push(item.blockedReason);
  }
  if (item.suspectedWaf) {
    parts.push("suspected WAF");
  }
  if (item.suspectedBot) {
    parts.push("suspected bot challenge");
  }
  if (item.bodySignature?.matchedPatterns?.length) {
    parts.push(`patterns: ${item.bodySignature.matchedPatterns.join(", ")}`);
  }
  return parts.join("；") || "無";
}

function getConfirmationLabel(confirmation) {
  const labels = {
    recovered: "二次確認已恢復",
    needs_review: "二次確認需複查",
    confirmed_missing: "二次確認不存在",
  };
  if (!confirmation.checked) {
    return "二次確認未複查";
  }
  return labels[confirmation.outcome] || "二次確認";
}

function formatConfirmationStatus(confirmation) {
  if (!confirmation.enabled) {
    return "未啟用";
  }
  if (!confirmation.candidate) {
    return "非二次確認候選";
  }
  if (!confirmation.checked) {
    return `未複查${confirmation.reason ? `（${formatConfirmationReason(confirmation.reason)}）` : ""}`;
  }

  const status = confirmation.status ? `HTTP ${confirmation.status}` : "未取得 HTTP 狀態";
  const checkedAt = confirmation.checkedAt ? `，${confirmation.checkedAt}` : "";
  return `${getConfirmationLabel(confirmation)}（${status}${checkedAt}）`;
}

function formatConfirmationReason(reason) {
  const labels = {
    disabled: "未啟用",
    not_candidate: "非候選",
    queued: "已排入複查",
    per_host_limit: "超過每 host 上限",
    global_limit: "超過全域上限",
    stopped: "已停止",
    ok: "可正常開啟",
    still_not_found: "仍為 404 / 410",
    blocked_waf: "疑似 WAF 阻擋",
    blocked_bot: "疑似 Bot challenge",
    rate_limited: "被限流",
    access_denied: "存取被拒",
    timeout: "逾時",
    network_error: "網路錯誤",
    unknown: "結果不明",
  };
  return labels[reason] || reason;
}

function formatIncrementalProvenance(incremental) {
  const parts = [];
  if (incremental.baselineCheckedAt) {
    parts.push(`基準檢查時間 ${incremental.baselineCheckedAt}`);
  }
  if (incremental.reuseSource) {
    parts.push(`來源 ${formatIncrementalReuseSource(incremental.reuseSource)}`);
  }
  if (incremental.reason) {
    parts.push(formatIncrementalReason(incremental.reason));
  }
  return parts.length ? parts.join("；") : "復用上次穩定結果";
}

function formatIncrementalReuseSource(source) {
  const labels = {
    state: "scan state",
    baseline_report: "baseline report",
  };
  return labels[source] || source;
}

function formatIncrementalReason(reason) {
  const labels = {
    stable_known_policy_match_ttl_valid: "設定相同且 TTL 未過期",
    listed_in_sitemap: "列於 sitemap",
    sitemap_lastmod_newer: "sitemap lastmod 較新",
    sitemap_lastmod_unchanged: "sitemap lastmod 未變",
    sitemap_lastmod_not_newer: "sitemap lastmod 未更新",
  };
  return labels[reason] || reason;
}

function getIncrementalResultBadge(item) {
  if (item.incremental.reused) {
    return { text: "復用", modifier: "impact" };
  }
  if (currentAnalysis?.incremental?.enabled) {
    return {
      text: item.incremental.classification === "new" ? "新增" : "已重查",
      modifier: "",
    };
  }
  return null;
}

function detailLine(label, value) {
  const row = document.createElement("div");
  row.className = "issue-detail-line";
  const labelElement = document.createElement("span");
  labelElement.className = "detail-label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "detail-value";
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function metaBadge(value, modifier = "") {
  const span = document.createElement("span");
  span.className = modifier ? `meta-badge ${modifier}` : "meta-badge";
  span.textContent = value;
  return span;
}

function interpretationBadge(category, text = getInterpretationLabel(category)) {
  const span = document.createElement("span");
  span.className = `badge interpretation-${category || "needs_review"}`;
  span.textContent = text;
  return span;
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function countSources(items) {
  const counts = {};
  for (const item of items) {
    const sources = item.sources.length ? item.sources : [{ page: "" }];
    for (const source of sources) {
      const page = source.page || "(無來源頁)";
      counts[page] = (counts[page] || 0) + 1;
    }
  }
  return counts;
}

function countRedirected(items) {
  return items.filter((item) => item.redirected || Number(item.redirectCount) > 0).length;
}

function normalizeStatus(value) {
  if (value === null || value === undefined || value === "") {
    return "(無狀態)";
  }
  return String(value);
}

function formatIssueBadgeText(item) {
  const status = item.status ? `HTTP ${item.status}` : "無狀態";
  return `${getIssueLabel(item.issueType)} · ${status}`;
}

function formatInterpretationBadgeText(item) {
  const status = item.status ? `HTTP ${item.status}` : "無狀態";
  return `${item.interpretation.label} · ${status}`;
}

function hasIssueStatusMismatch(item) {
  const status = Number.parseInt(item.status, 10);
  if (!Number.isFinite(status)) {
    return ["not_found", "access_denied", "http_error", "redirect_to_error"].includes(item.issueType);
  }
  if (item.issueType === "not_found") {
    return status !== 404 && status !== 410;
  }
  if (item.issueType === "access_denied") {
    return status !== 401 && status !== 403;
  }
  if (item.issueType === "http_error") {
    return status < 400;
  }
  if (item.issueType === "network_error") {
    return true;
  }
  return false;
}

function normalizeInterpretation(item) {
  const existing = item.interpretation;
  if (existing?.category) {
    return {
      ...buildInterpretation(existing.category),
      ...existing,
    };
  }

  const issueType = item.issueType || inferIssueType(item);
  const confirmationOutcome = item.confirmation?.outcome;
  if (issueType === "redirect_to_error" || issueType === "too_many_redirects" || issueType === "redirect_loop") {
    return buildInterpretation("action_required");
  }
  if (issueType === "not_found") {
    if (confirmationOutcome === "confirmed_missing") {
      return buildInterpretation("action_required");
    }
    if (confirmationOutcome === "needs_review") {
      return buildInterpretation("needs_review");
    }
    return buildInterpretation("likely_problem");
  }
  if (
    issueType === "protected"
    || issueType === "access_denied"
    || issueType === "timeout"
    || issueType === "network_error"
    || item.status === 429
    || item.suspectedWaf
    || item.suspectedBot
  ) {
    return buildInterpretation("needs_review");
  }
  if (item.status >= 400 || issueType === "http_error" || issueType === "unknown_error") {
    return buildInterpretation("likely_problem");
  }
  return buildInterpretation("needs_review");
}

function buildInterpretation(category) {
  return {
    category,
    label: getInterpretationLabel(category),
    severity: INTERPRETATION_SEVERITY[category] || "review",
    action: INTERPRETATION_ACTIONS[category] || INTERPRETATION_ACTIONS.needs_review,
    needsManualReview: ["needs_review", "external_limited", "likely_problem"].includes(category),
  };
}

function sortStatus(a, b) {
  const numberA = Number.parseInt(a, 10);
  const numberB = Number.parseInt(b, 10);
  if (Number.isFinite(numberA) && Number.isFinite(numberB)) {
    return numberA - numberB;
  }
  return a.localeCompare(b);
}

function extractHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function formatSourceElement(source) {
  return [source.tag, source.attribute].filter(Boolean).join("[") + (source.attribute ? "]" : "");
}

function getIssueLabel(issueType) {
  return ISSUE_LABELS[issueType] || issueType || "未知錯誤";
}

function getInterpretationLabel(category) {
  return INTERPRETATION_LABELS[category] || category || "需人工確認";
}

function issueRank(issueType) {
  return {
    not_found: 0,
    access_denied: 1,
    protected: 2,
    timeout: 3,
    network_error: 4,
    redirect_to_error: 5,
    too_many_redirects: 6,
    redirect_loop: 7,
    http_error: 8,
    unknown_error: 9,
  }[issueType] ?? 10;
}

function interpretationRank(category) {
  return {
    action_required: 0,
    needs_review: 1,
    external_limited: 2,
    likely_problem: 3,
    redirect_ok: 4,
    page_quality_notice: 5,
    ok: 6,
  }[category] ?? 7;
}

function updateBrokenRateCard(rate) {
  brokenRateCard.classList.toggle("metric-card-danger", rate > 0.05);
  brokenRateCard.classList.toggle("metric-card-warn", rate > 0.01 && rate <= 0.05);
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-Hant").format(value);
}

function makeBrokenCsv(items) {
  const rows = [[
    "判讀分類",
    "建議處理",
    "是否需人工確認",
    "優先度",
    "問題網址",
    "來源頁",
    "連結文字",
    "HTTP 狀態",
    "技術原因",
    "最終網址",
    "確認結果",
    "檢查時間",
    "issueType",
    "issueLabel",
    "status",
    "url",
    "canonicalUrl",
    "checkedAt",
    "finalUrl",
    "domain",
    "method",
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
    "incrementalReused",
    "incrementalReuseSource",
    "incrementalBaselineCheckedAt",
    "incrementalReason",
    "needsReview",
    "transientFailure",
    "sourcePage",
    "tag",
    "attribute",
    "text",
    "diagnosis",
  ]];

  for (const item of items) {
    const sources = item.sources.length ? item.sources : [{}];
    for (const source of sources) {
      rows.push([
        item.interpretation.label,
        item.interpretation.action,
        item.interpretation.needsManualReview ? "是" : "否",
        formatInterpretationPriority(item.interpretation.severity),
        item.url,
        source.page || "",
        source.text || "",
        item.status,
        `${getIssueLabel(item.issueType)}${item.diagnosis || item.error ? ` / ${item.diagnosis || item.error}` : ""}`,
        item.finalUrl,
        formatConfirmationOutcome(item.confirmation.outcome),
        item.checkedAt,
        item.issueType,
        getIssueLabel(item.issueType),
        item.status,
        item.url,
        item.canonicalUrl,
        item.checkedAt,
        item.finalUrl,
        item.domain,
        item.method,
        item.contentLength,
        item.cacheHeaders?.cacheControl || "",
        item.suspectedWaf ? "yes" : "no",
        item.suspectedBot ? "yes" : "no",
        item.blockedReason,
        item.confirmation.enabled ? "yes" : "no",
        item.confirmation.candidate ? "yes" : "no",
        item.confirmation.checked ? "yes" : "no",
        item.confirmation.outcome,
        item.confirmation.status,
        item.confirmation.finalUrl,
        item.confirmation.checkedAt,
        item.confirmation.referer,
        item.confirmation.reason,
        item.incremental.reused ? "yes" : "no",
        item.incremental.reuseSource,
        item.incremental.baselineCheckedAt,
        item.incremental.reason,
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

function formatInterpretationPriority(severity) {
  const labels = {
    high: "高",
    medium: "中",
    review: "需確認",
    info: "資訊",
    ok: "低",
    notice: "提醒",
  };
  return labels[severity] || "需確認";
}

function formatConfirmationOutcome(outcome) {
  const labels = {
    skipped: "未確認",
    recovered: "二次確認後正常",
    confirmed_missing: "二次確認仍不存在",
    needs_review: "需人工確認",
  };
  return labels[outcome] || outcome || "";
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

renderEmpty();
