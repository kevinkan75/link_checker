const form = document.querySelector("#check-form");
const urlInput = document.querySelector("#url");
const maxPagesInput = document.querySelector("#max-pages");
const maxDepthInput = document.querySelector("#max-depth");
const concurrencyInput = document.querySelector("#concurrency");
const perHostConcurrencyInput = document.querySelector("#per-host-concurrency");
const requestDelayInput = document.querySelector("#request-delay");
const requestDelayMinInput = document.querySelector("#request-delay-min");
const requestDelayMaxInput = document.querySelector("#request-delay-max");
const timeoutInput = document.querySelector("#timeout");
const retryCountInput = document.querySelector("#retry-count");
const maxRedirectsInput = document.querySelector("#max-redirects");
const longRedirectThresholdInput = document.querySelector("#long-redirect-threshold");
const acceptLanguageInput = document.querySelector("#accept-language");
const userAgentInput = document.querySelector("#user-agent");
const externalInput = document.querySelector("#external");
const preferGetInput = document.querySelector("#prefer-get");
const externalRefererInput = document.querySelector("#external-referer");
const confirm404Input = document.querySelector("#confirm-404");
const legacyTlsInput = document.querySelector("#legacy-tls");
const systemCaInput = document.querySelector("#system-ca");
const authorizedScanInput = document.querySelector("#authorized-scan");
const noRobotsInput = document.querySelector("#no-robots");
const authorizationNoteInput = document.querySelector("#authorization-note");
const presetButtons = document.querySelectorAll("[data-preset]");
const helpTriggers = document.querySelectorAll("[data-help-trigger]");
const advancedSummary = document.querySelector("#advanced-summary");
const advancedValidation = document.querySelector("#advanced-validation");
const startButton = document.querySelector("#start-button");
const stopButton = document.querySelector("#stop-button");
const downloadButton = document.querySelector("#download-button");
const shutdownButton = document.querySelector("#shutdown-button");
const batchUrlsInput = document.querySelector("#batch-urls");
const maxConcurrentSitesInput = document.querySelector("#max-concurrent-sites");
const addQueueButton = document.querySelector("#add-queue-button");
const startQueueButton = document.querySelector("#start-queue-button");
const stopQueueButton = document.querySelector("#stop-queue-button");
const queueSummary = document.querySelector("#queue-summary");
const queueTable = document.querySelector("#queue-table");
const clearLogButton = document.querySelector("#clear-log");
const stateBadge = document.querySelector("#state-badge");
const statusTitle = document.querySelector("#status-title");
const watchingSite = document.querySelector("#watching-site");
const scanEmptyState = document.querySelector("#scan-empty-state");
const elapsed = document.querySelector("#elapsed");
const progressTrack = document.querySelector(".progress-track");
const progressBar = document.querySelector("#progress-bar");
const progressPercent = document.querySelector("#progress-percent");
const scanPhaseNote = document.querySelector("#scan-phase-note");
const pendingUrlNote = document.querySelector("#pending-url-note");
const pageDiscoveryNote = document.querySelector("#page-discovery-note");
const scanAdviceNote = document.querySelector("#scan-advice-note");
const pages = document.querySelector("#pages");
const checked = document.querySelector("#checked");
const pendingUrls = document.querySelector("#pending-urls");
const active = document.querySelector("#active");
const queue = document.querySelector("#queue");
const brokenCount = document.querySelector("#broken-count");
const skipped = document.querySelector("#skipped");
const currentUrl = document.querySelector("#current-url");
const logLocation = document.querySelector("#log-location");
const brokenTable = document.querySelector("#broken-table");
const resultSummary = document.querySelector("#result-summary");
const eventLog = document.querySelector("#event-log");
const issueNotFound = document.querySelector("#issue-not-found");
const issueProtected = document.querySelector("#issue-protected");
const issueAccessDenied = document.querySelector("#issue-access-denied");
const issueHttp = document.querySelector("#issue-http");
const issueTimeout = document.querySelector("#issue-timeout");
const issueNetwork = document.querySelector("#issue-network");
const issueUnknown = document.querySelector("#issue-unknown");
const redirectTotal = document.querySelector("#redirect-total");
const redirectPermanent = document.querySelector("#redirect-permanent");
const redirectTemporary = document.querySelector("#redirect-temporary");
const redirectCrossHost = document.querySelector("#redirect-cross-host");
const redirectLong = document.querySelector("#redirect-long");
const redirectUnresolved = document.querySelector("#redirect-unresolved");
const confirmationCandidates = document.querySelector("#confirmation-candidates");
const confirmationRecovered = document.querySelector("#confirmation-recovered");
const confirmationNeedsReview = document.querySelector("#confirmation-needs-review");
const confirmationMissing = document.querySelector("#confirmation-missing");
const incrementalPanel = document.querySelector("#incremental-panel");
const incrementalMode = document.querySelector("#incremental-mode");
const incrementalNew = document.querySelector("#incremental-new");
const incrementalKnown = document.querySelector("#incremental-known");
const incrementalReused = document.querySelector("#incremental-reused");
const incrementalDisappeared = document.querySelector("#incremental-disappeared");
const incrementalPriority = document.querySelector("#incremental-priority");
const filterBar = document.querySelector("#filter-bar");
const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const defaultUserAgent = `${browserUserAgent} LocalLinkChecker/1.0`;
const defaultSettings = {
  maxPages: "300",
  maxDepth: "3",
  concurrency: "6",
  perHostConcurrency: "2",
  requestDelayMs: "1000",
  requestDelayMinMs: "",
  requestDelayMaxMs: "",
  timeoutMs: "15000",
  retryCount: "1",
  maxRedirects: "10",
  longRedirectThreshold: "3",
  acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8",
  userAgent: defaultUserAgent,
  checkExternal: true,
  preferGet: false,
  externalReferer: false,
  confirm404: true,
  legacyTls: false,
  systemCa: false,
  authorizedScan: false,
  noRobots: false,
  authorizationNote: "",
};
const presets = {
  fast: {
    ...defaultSettings,
    maxPages: "100",
    maxDepth: "2",
    concurrency: "12",
    perHostConcurrency: "4",
    requestDelayMs: "500",
  },
  balanced: {
    ...defaultSettings,
  },
  conservative: {
    ...defaultSettings,
    concurrency: "3",
    perHostConcurrency: "1",
    requestDelayMs: "500",
    requestDelayMinMs: "2000",
    requestDelayMaxMs: "5000",
    retryCount: "1",
    userAgent: browserUserAgent,
    preferGet: true,
    externalReferer: false,
  },
  defaults: { ...defaultSettings },
};
const buttonLabels = {
  start: "開始檢查",
  checking: "檢查中...",
  stop: "停止",
  startQueue: "開始佇列",
  queueRunning: "佇列執行中...",
  stopQueue: "停止佇列",
};
const unfinishedScanWarning = "檢測尚未完成。切換功能頁面會中斷目前頁面的即時進度顯示，確定要離開嗎？";
const defaultInterpretationFilter = "action_required";
const interpretationCategories = [
  "action_required",
  "needs_review",
  "external_limited",
  "likely_problem",
  "redirect_ok",
  "ok",
  "page_quality_notice",
];
const interpretationLabels = {
  action_required: "需處理",
  needs_review: "需人工確認",
  external_limited: "外站限制",
  likely_problem: "可能失效",
  redirect_ok: "已轉址仍可用",
  ok: "可先忽略 / 正常",
  page_quality_notice: "頁內品質提醒",
};

let currentJobId = null;
let eventSource = null;
let currentReport = null;
let currentReportUrl = null;
let currentFilter = defaultInterpretationFilter;
let queuePollTimer = null;
let watchedQueueItemId = null;
let watchedQueueUrl = null;
let manualWatchSelected = false;
let activePreset = "balanced";
let scanInProgress = false;
let queueInProgress = false;
let suppressNextUnloadWarning = false;

startSessionHeartbeat();
installUnfinishedScanGuard();
installHelpTooltips();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await startCheck();
});

presetButtons.forEach((button) => {
  button.addEventListener("click", () => {
    applyPreset(button.dataset.preset);
  });
});

[
  maxPagesInput,
  maxDepthInput,
  concurrencyInput,
  perHostConcurrencyInput,
  requestDelayInput,
  requestDelayMinInput,
  requestDelayMaxInput,
  timeoutInput,
  retryCountInput,
  maxRedirectsInput,
  longRedirectThresholdInput,
  acceptLanguageInput,
  userAgentInput,
  externalInput,
  preferGetInput,
  externalRefererInput,
  legacyTlsInput,
  systemCaInput,
  authorizedScanInput,
  noRobotsInput,
  authorizationNoteInput,
].forEach((input) => {
  input.addEventListener("input", () => {
    setActivePreset(null);
    updateAdvancedSummary();
    validateAdvancedSettings({ showValid: false });
  });
  input.addEventListener("change", () => {
    setActivePreset(null);
    updateAdvancedSummary();
    validateAdvancedSettings({ showValid: false });
  });
});

stopButton.addEventListener("click", async () => {
  if (!currentJobId) {
    return;
  }
  await fetch(`/api/jobs/${currentJobId}/stop`, { method: "POST" });
  setState("stopping");
});

downloadButton.addEventListener("click", async () => {
  if (currentReportUrl) {
    await downloadReportFromUrl(currentReportUrl);
    return;
  }
  if (!currentReport) {
    return;
  }
  downloadJsonReport(currentReport);
});

async function downloadReportFromUrl(reportUrl) {
  try {
    const response = await fetch(reportUrl);
    if (!response.ok) {
      throw new Error("無法下載完整 report");
    }
    const report = await response.json();
    downloadJsonReport(report);
  } catch (error) {
    statusTitle.textContent = error.message;
  }
}

function downloadJsonReport(report) {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `link-check-report-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

shutdownButton.addEventListener("click", async () => {
  const confirmed = window.confirm("關閉本機服務？目前開啟的 GUI 頁面會停止連線。");
  if (!confirmed) {
    return;
  }

  shutdownButton.disabled = true;
  shutdownButton.textContent = "正在關閉";

  try {
    const response = await fetch("/api/shutdown", { method: "POST" });
    if (response.status === 409) {
      const data = await response.json().catch(() => ({}));
      window.alert(data.error || "仍有掃描或佇列正在執行，請先停止後再關閉本機服務。");
      shutdownButton.disabled = false;
      shutdownButton.textContent = "關閉本機服務";
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    statusTitle.textContent = "本機服務正在關閉";
  } catch (error) {
    window.alert(`關閉本機服務失敗：${error.message}`);
    shutdownButton.disabled = false;
    shutdownButton.textContent = "關閉本機服務";
  }
});

addQueueButton.addEventListener("click", async () => {
  await addQueueItems();
});

startQueueButton.addEventListener("click", async () => {
  await fetch("/api/queue/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      maxConcurrentSites: maxConcurrentSitesInput.value,
    }),
  });
  await refreshQueue();
  startQueuePolling();
});

stopQueueButton.addEventListener("click", async () => {
  await fetch("/api/queue/stop", { method: "POST" });
  await refreshQueue();
});

queueTable.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }

  const id = button.dataset.id;
  if (button.dataset.action === "view") {
    await viewQueueReport(id);
  }
  if (button.dataset.action === "watch") {
    await watchQueueItem(id);
  }
  if (button.dataset.action === "remove") {
    await removeQueueItem(id);
  }
});

clearLogButton.addEventListener("click", () => {
  eventLog.replaceChildren();
});

filterBar.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]");
  if (!button) {
    return;
  }

  currentFilter = button.dataset.filter;
  updateActiveFilter();
  if (currentReport) {
    renderBrokenTableForReport(currentReport);
  }
});

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

function installUnfinishedScanGuard() {
  document.querySelectorAll(".header-nav a[href]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      const target = new URL(link.href, window.location.href);
      if (
        target.pathname === window.location.pathname
        && target.search === window.location.search
        && target.hash === window.location.hash
      ) {
        return;
      }

      if (!hasUnfinishedWork()) {
        return;
      }

      if (!window.confirm(unfinishedScanWarning)) {
        event.preventDefault();
        return;
      }

      suppressNextUnloadWarning = true;
    });
  });

  window.addEventListener("beforeunload", (event) => {
    if (suppressNextUnloadWarning || !hasUnfinishedWork()) {
      suppressNextUnloadWarning = false;
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  });
}

function hasUnfinishedWork() {
  return scanInProgress || queueInProgress;
}

function installHelpTooltips() {
  const closeAll = () => {
    for (const trigger of helpTriggers) {
      trigger.parentElement?.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
    }
  };

  const setOpen = (trigger, isOpen) => {
    trigger.parentElement?.classList.toggle("is-open", isOpen);
    trigger.setAttribute("aria-expanded", String(isOpen));
  };

  for (const trigger of helpTriggers) {
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const shouldOpen = !trigger.parentElement?.classList.contains("is-open");
      closeAll();
      setOpen(trigger, shouldOpen);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const shouldOpen = !trigger.parentElement?.classList.contains("is-open");
        closeAll();
        setOpen(trigger, shouldOpen);
      }
      if (event.key === "Escape") {
        closeAll();
        trigger.blur();
      }
    });
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".help-wrap")) {
      closeAll();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAll();
      if (event.target.closest?.("[data-help-trigger]")) {
        event.target.blur();
      }
    }
  });
}

function applyPreset(name) {
  const preset = presets[name] || defaultSettings;
  applySettings(preset);
  setActivePreset(name === "defaults" ? "balanced" : name);
  updateAdvancedSummary();
  validateAdvancedSettings({ showValid: false });
}

function applySettings(settings) {
  maxPagesInput.value = settings.maxPages;
  maxDepthInput.value = settings.maxDepth;
  concurrencyInput.value = settings.concurrency;
  perHostConcurrencyInput.value = settings.perHostConcurrency;
  requestDelayInput.value = settings.requestDelayMs;
  requestDelayMinInput.value = settings.requestDelayMinMs;
  requestDelayMaxInput.value = settings.requestDelayMaxMs;
  timeoutInput.value = settings.timeoutMs;
  retryCountInput.value = settings.retryCount;
  maxRedirectsInput.value = settings.maxRedirects;
  longRedirectThresholdInput.value = settings.longRedirectThreshold;
  acceptLanguageInput.value = settings.acceptLanguage;
  userAgentInput.value = settings.userAgent;
  externalInput.checked = settings.checkExternal;
  preferGetInput.checked = settings.preferGet;
  externalRefererInput.checked = settings.externalReferer;
  confirm404Input.checked = settings.confirm404;
  legacyTlsInput.checked = settings.legacyTls;
  systemCaInput.checked = settings.systemCa;
  authorizedScanInput.checked = settings.authorizedScan;
  noRobotsInput.checked = settings.noRobots;
  authorizationNoteInput.value = settings.authorizationNote;
}

function setActivePreset(name) {
  activePreset = name;
  for (const button of presetButtons) {
    button.classList.toggle("active", button.dataset.preset === name);
  }
}

function updateAdvancedSummary() {
  const randomMin = requestDelayMinInput.value.trim();
  const randomMax = requestDelayMaxInput.value.trim();
  const delayText = randomMin && randomMax
    ? `隨機 ${randomMin}-${randomMax}ms`
    : `固定 ${requestDelayInput.value || 0}ms`;
  advancedSummary.textContent = `${maxPagesInput.value || 0} 頁 / 深度 ${maxDepthInput.value || 0} / 併發 ${concurrencyInput.value || 0} / 每 host ${perHostConcurrencyInput.value || 0} / ${delayText}`;
  longRedirectThresholdInput.max = maxRedirectsInput.value || "20";
}

function validateAdvancedSettings({ showValid } = { showValid: true }) {
  const randomMin = requestDelayMinInput.value.trim();
  const randomMax = requestDelayMaxInput.value.trim();
  const concurrency = Number(concurrencyInput.value);
  const perHostConcurrency = Number(perHostConcurrencyInput.value);
  const maxRedirects = Number(maxRedirectsInput.value);
  const longRedirectThreshold = Number(longRedirectThresholdInput.value);

  let message = "";
  if ((randomMin && !randomMax) || (!randomMin && randomMax)) {
    message = "隨機延遲最小值與最大值必須同時填寫。";
  } else if (randomMin && randomMax && Number(randomMin) > Number(randomMax)) {
    message = "隨機延遲最小值不得大於最大值。";
  } else if (Number.isFinite(concurrency) && Number.isFinite(perHostConcurrency) && perHostConcurrency > concurrency) {
    message = "單一 host 併發不應大於全站總併發。";
  } else if (Number.isFinite(maxRedirects) && Number.isFinite(longRedirectThreshold) && longRedirectThreshold > maxRedirects) {
    message = "轉址過長門檻不得大於最大轉址。";
  }

  advancedValidation.hidden = !message;
  advancedValidation.textContent = message;
  if (message) {
    return false;
  }
  if (showValid) {
    advancedValidation.hidden = true;
    advancedValidation.textContent = "";
  }
  return true;
}

async function startCheck() {
  if (!validateAdvancedSettings()) {
    statusTitle.textContent = advancedValidation.textContent;
    return;
  }
  closeEvents();
  currentReport = null;
  currentReportUrl = null;
  currentJobId = null;
  watchedQueueItemId = null;
  watchedQueueUrl = null;
  manualWatchSelected = false;
  currentFilter = defaultInterpretationFilter;
  updateActiveFilter();
  downloadButton.disabled = true;
  setScanEmptyStateVisible(false);
  renderBrokenEmptyState("正在檢查", "發現需要判讀的結果後會顯示在這裡。");
  resultSummary.textContent = "檢查中";
  updateIssueBreakdown(emptyInterpretationCounts(), 0);
  updateFilterCounts(emptyInterpretationCounts(), 0);
  updateRedirectBreakdown(emptyRedirectBreakdown(), 0);
  updateIncrementalSummary(null);
  pendingUrls.textContent = "0";
  updateScanPhaseDisplay({ state: "running" });
  updatePendingUrlDisplay(0, 0, 0);
  updatePageDiscoveryDisplay(0, maxPagesInput.value, 0);
  updateScanAdvice(null);
  updateActiveFilter();
  setProgressValue(0);
  showLogLocation(null);
  updateWatchingSite();
  eventLog.replaceChildren();
  eventLog.removeAttribute("aria-label");
  scanInProgress = true;
  setScanEmptyStateVisible(false);
  setState("running");
  setBusy(true);

  const payload = {
    url: urlInput.value.trim(),
    ...getCheckOptions(),
  };

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "無法開始檢查");
    }

    currentJobId = data.id;
    connectEvents(data.eventsUrl);
  } catch (error) {
    scanInProgress = false;
    setState("failed");
    statusTitle.textContent = error.message;
    setBusy(false);
  }
}

function getCheckOptions() {
  return {
    maxPages: maxPagesInput.value,
    maxDepth: maxDepthInput.value,
    concurrency: concurrencyInput.value,
    perHostConcurrency: perHostConcurrencyInput.value,
    requestDelayMs: requestDelayInput.value,
    requestDelayMinMs: requestDelayMinInput.value,
    requestDelayMaxMs: requestDelayMaxInput.value,
    timeoutMs: timeoutInput.value,
    retryCount: retryCountInput.value,
    maxRedirects: maxRedirectsInput.value,
    longRedirectThreshold: longRedirectThresholdInput.value,
    acceptLanguage: acceptLanguageInput.value.trim(),
    userAgent: userAgentInput.value.trim(),
    checkExternal: externalInput.checked,
    conservativeMode: activePreset === "conservative",
    preferGet: preferGetInput.checked,
    externalReferer: externalRefererInput.checked,
    confirm404: confirm404Input.checked,
    legacyTls: legacyTlsInput.checked,
    systemCa: systemCaInput.checked,
    robotsTxt: !noRobotsInput.checked,
    authorizedScan: authorizedScanInput.checked,
    authorizationNote: authorizationNoteInput.value.trim(),
  };
}

async function addQueueItems() {
  if (!validateAdvancedSettings()) {
    statusTitle.textContent = advancedValidation.textContent;
    return;
  }
  const urls = batchUrlsInput.value.trim();
  if (!urls) {
    statusTitle.textContent = "請先輸入批次網址";
    return;
  }

  const response = await fetch("/api/queue/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      urls,
      ...getCheckOptions(),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    statusTitle.textContent = data.error || "無法加入佇列";
    return;
  }

  batchUrlsInput.value = "";
  renderQueue(data.queue);
  startQueuePolling();
}

function startQueuePolling() {
  if (queuePollTimer) {
    return;
  }
  queuePollTimer = setInterval(refreshQueue, 1000);
}

function stopQueuePollingIfIdle(queueState) {
  if (!queuePollTimer || queueState?.running) {
    return;
  }
  clearInterval(queuePollTimer);
  queuePollTimer = null;
}

async function refreshQueue() {
  const response = await fetch("/api/queue");
  if (!response.ok) {
    return;
  }
  const queueState = await response.json();
  renderQueue(queueState);
  connectRunningQueueJob(queueState);
  stopQueuePollingIfIdle(queueState);
}

function renderQueue(queueState) {
  const totals = queueState?.totals || {};
  const total = totals.total || 0;
  const activeSites = queueState?.activeSites || totals.running || 0;
  const maxConcurrentSites = queueState?.maxConcurrentSites || maxConcurrentSitesInput.value || 1;
  const isRunning = Boolean(queueState?.running);
  queueInProgress = isRunning;
  queueSummary.textContent = total
    ? `共 ${total} 個，執行中 ${activeSites} / ${maxConcurrentSites}，等待 ${totals.queued || 0}，完成 ${totals.finished || 0}，失敗 ${totals.failed || 0}，停止 ${totals.stopped || 0}`
    : "尚未加入網站";
  startQueueButton.disabled = isRunning || !(totals.queued > 0);
  stopQueueButton.disabled = !isRunning;
  maxConcurrentSitesInput.disabled = isRunning;
  updateQueueButtonState(isRunning);

  const items = queueState?.items || [];
  if (items.length === 0) {
    queueTable.innerHTML = '<tr class="empty-row"><td colspan="6">尚未加入待檢核網站。</td></tr>';
    return;
  }

  queueTable.replaceChildren(...items.map((item) => {
    const row = document.createElement("tr");
    const state = document.createElement("td");
    state.append(makeQueueStateBadge(item.state));

    const url = document.createElement("td");
    url.className = "queue-url";
    url.textContent = item.url;

    const checkedCell = document.createElement("td");
    checkedCell.textContent = item.summary?.urlsChecked ?? "";

    const issueCell = document.createElement("td");
    issueCell.textContent = item.summary?.brokenLinks ?? "";

    const log = document.createElement("td");
    log.textContent = item.logRelativePath || item.logError || "";

    const actions = document.createElement("td");
    actions.className = "queue-actions-cell";
    if (item.state === "running" && item.jobId) {
      const watch = document.createElement("button");
      watch.type = "button";
      watch.dataset.action = "watch";
      watch.dataset.id = item.id;
      watch.disabled = item.id === watchedQueueItemId;
      watch.textContent = item.id === watchedQueueItemId ? "監看中" : "監看";
      actions.append(watch);
    }
    if (item.summary) {
      const view = document.createElement("button");
      view.type = "button";
      view.dataset.action = "view";
      view.dataset.id = item.id;
      view.textContent = "查看";
      actions.append(view);
    }
    if (item.state !== "running") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.dataset.action = "remove";
      remove.dataset.id = item.id;
      remove.textContent = "移除";
      actions.append(remove);
    }

    row.append(state, url, checkedCell, issueCell, log, actions);
    return row;
  }));
}

function makeQueueStateBadge(state) {
  const span = document.createElement("span");
  span.className = `badge ${state}`;
  const labels = {
    queued: "等待中",
    running: "執行中",
    finished: "完成",
    stopped: "已停止",
    failed: "失敗",
  };
  span.textContent = labels[state] || state;
  return span;
}

function connectRunningQueueJob(queueState) {
  const items = queueState.items || [];
  const watched = watchedQueueItemId
    ? items.find((item) => item.id === watchedQueueItemId)
    : null;
  if (watched) {
    watchedQueueUrl = watched.url;
    updateWatchingSite();
    if (!manualWatchSelected && watched.state !== "running") {
      watchedQueueItemId = null;
      watchedQueueUrl = null;
      updateWatchingSite();
    } else {
      return;
    }
  }

  if (manualWatchSelected) {
    return;
  }

  const running = items.find((item) => item.state === "running" && item.jobId);
  if (!running || running.jobId === currentJobId) {
    return;
  }

  watchQueueItemObject(running, { manual: false });
}

async function watchQueueItem(id) {
  const queueState = await fetch("/api/queue").then((item) => item.json());
  const item = (queueState.items || []).find((candidate) => candidate.id === id);
  if (!item || !item.jobId) {
    statusTitle.textContent = "該網站目前沒有可監看的執行工作";
    return;
  }

  watchQueueItemObject(item, { manual: true });
  renderQueue(queueState);
}

function watchQueueItemObject(item, { manual }) {
  currentJobId = item.jobId;
  watchedQueueItemId = item.id;
  watchedQueueUrl = item.url;
  manualWatchSelected = manual || manualWatchSelected;
  currentReport = null;
  currentReportUrl = item.jobId ? `/api/jobs/${item.jobId}/report` : null;
  currentFilter = defaultInterpretationFilter;
  updateActiveFilter();
  scanInProgress = true;
  downloadButton.disabled = true;
  eventLog.replaceChildren();
  eventLog.removeAttribute("aria-label");
  renderBrokenTable([]);
  resultSummary.textContent = "檢查中";
  updateIncrementalSummary(null);
  showLogLocation(null);
  updateWatchingSite();
  closeEvents();
  connectEvents(`/api/jobs/${item.jobId}/events`);
  setBusy(true);
}

function updateWatchingSite() {
  if (!watchingSite) {
    return;
  }
  if (!watchedQueueUrl) {
    watchingSite.hidden = true;
    watchingSite.textContent = "";
    return;
  }
  watchingSite.hidden = false;
  watchingSite.textContent = `目前監看：${watchedQueueUrl}`;
}

async function viewQueueReport(id) {
  const response = await fetch(`/api/queue/items/${id}/report`);
  const data = await response.json();
  if (!response.ok || response.status === 202) {
    statusTitle.textContent = data.error || "該項目尚未產生報告";
    return;
  }

  closeEvents();
  currentJobId = null;
  scanInProgress = false;
  watchedQueueItemId = id;
  watchedQueueUrl = null;
  manualWatchSelected = true;
  currentReport = data;
  currentReportUrl = `/api/queue/items/${id}/report`;
  currentFilter = defaultInterpretationFilter;
  renderReport(data);
  setState("finished");
  setBusy(false);
  downloadButton.disabled = false;
  const queueState = await fetch("/api/queue").then((item) => item.json());
  const queueItem = (queueState.items || []).find((item) => item.id === id);
  watchedQueueUrl = queueItem?.url || data.startUrl || null;
  updateWatchingSite();
  showLogLocation(queueItem || null);
}

async function removeQueueItem(id) {
  const response = await fetch(`/api/queue/items/${id}/remove`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    statusTitle.textContent = data.error || "無法移除佇列項目";
    return;
  }
  renderQueue(data);
}

function connectEvents(url) {
  eventSource = new EventSource(url);
  eventSource.addEventListener("status", (event) => {
    updateStatus(JSON.parse(event.data));
  });
  eventSource.addEventListener("log", (event) => {
    appendLog(JSON.parse(event.data));
  });
  eventSource.addEventListener("complete", (event) => {
    const data = JSON.parse(event.data);
    currentReportUrl = data.reportUrl || (currentJobId ? `/api/jobs/${currentJobId}/report` : null);
    currentReport = buildReportFromCompletePayload(data);
    renderReport(currentReport);
    showLogLocation(data);
    scanInProgress = false;
    setState(data.state);
    setBusy(false);
    downloadButton.disabled = false;
    closeEvents();
  });
  eventSource.addEventListener("error", (event) => {
    try {
      const data = JSON.parse(event.data);
      statusTitle.textContent = data.message;
      showLogLocation(data);
    } catch {
      statusTitle.textContent = "連線中斷";
    }
    scanInProgress = false;
    setState("failed");
    setBusy(false);
    closeEvents();
  });
}

function closeEvents() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function showLogLocation(data) {
  if (!logLocation) {
    return;
  }

  if (!data) {
    logLocation.hidden = true;
    logLocation.textContent = "";
    return;
  }

  if (data.logRelativePath) {
    logLocation.hidden = false;
    logLocation.textContent = `記錄已保存：${data.logRelativePath}`;
    return;
  }

  if (data.logError) {
    logLocation.hidden = false;
    logLocation.textContent = `記錄保存失敗：${data.logError}`;
  }
}

function updateStatus(status) {
  scanInProgress = ["running", "stopping"].includes(status.state || "running");
  setState(status.state || "running");
  elapsed.textContent = `${status.elapsedSeconds || 0}s`;
  const pagesCrawled = Number(status.pagesCrawled || 0);
  const maxPages = Number(status.maxPages || maxPagesInput.value || 0);
  const queuedPages = Number(status.queuedPages || 0);
  const urlsChecked = Number(status.urlsChecked || 0);
  const pendingUrlCount = getPendingUrlCount(status);
  const activeRequests = Number(status.activeRequests || 0);
  pages.textContent = `${pagesCrawled} / ${maxPages || maxPagesInput.value}`;
  checked.textContent = urlsChecked;
  updateScanPhaseDisplay(status);
  updatePendingUrlDisplay(pendingUrlCount, urlsChecked, activeRequests);
  updatePageDiscoveryDisplay(pagesCrawled, maxPages || maxPagesInput.value, queuedPages);
  updateScanAdvice(buildScanAdvice(status));
  active.textContent = activeRequests;
  queue.textContent = queuedPages;
  brokenCount.textContent = status.brokenLinks || 0;
  skipped.textContent = status.skippedExternal || 0;
  currentUrl.textContent = status.currentUrl || "目前沒有處理中的 URL";
  const interpretationCounts = buildInterpretationCountsFromSummary({
    urlsChecked: status.urlsChecked || 0,
    brokenLinks: status.brokenLinks || 0,
    brokenByType: status.brokenByType || emptyBreakdown(),
    redirectByType: status.redirectByType || emptyRedirectBreakdown(),
    redirects: status.redirects || 0,
  });
  const interpretationTotal = countDisplayInterpretations(interpretationCounts);
  brokenCount.textContent = interpretationTotal;
  updateIssueBreakdown(interpretationCounts, interpretationTotal);
  updateFilterCounts(interpretationCounts, interpretationTotal);
  updateRedirectBreakdown(status.redirectByType || emptyRedirectBreakdown(), status.redirects || 0);
  updateConfirmationBreakdown(emptyConfirmationBreakdown());
  updateIncrementalSummary(null);

  setProgressValue(getUrlValidationProgress(status));
}

function setProgressValue(value) {
  const normalized = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
  progressBar.style.width = `${normalized}%`;
  progressPercent.textContent = `${normalized}%`;
  progressTrack.setAttribute("aria-valuenow", String(normalized));
}

function capIncompleteProgress(value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return Math.min(99, normalized);
}

function isStatusComplete(status) {
  if (status?.state !== "finished") {
    return false;
  }
  return getPendingUrlCount(status) === 0
    && Number(status?.queuedPages || 0) === 0
    && Number(status?.activeRequests || 0) === 0;
}

function getUrlValidationProgress(status) {
  if (isStatusComplete(status)) {
    return 100;
  }
  const urlsChecked = Number(status?.urlsChecked || 0);
  const pending = getPendingUrlCount(status);
  const totalKnownUrls = urlsChecked + pending;
  if (totalKnownUrls <= 0) {
    return 0;
  }
  return capIncompleteProgress((urlsChecked / totalKnownUrls) * 100);
}

function getPendingUrlCount(status) {
  const pending = Number(status?.pendingUrls);
  if (Number.isFinite(pending)) {
    return pending;
  }
  return Number(status?.pendingValidations || 0) + Number(status?.activeValidationTasks || 0);
}

function updatePendingUrlDisplay(count, checkedCount = 0, activeCount = 0) {
  const normalized = Math.max(0, Number(count) || 0);
  const checkedTotal = Math.max(0, Number(checkedCount) || 0);
  const activeTotal = Math.max(0, Number(activeCount) || 0);
  pendingUrls.textContent = normalized;
  pendingUrlNote.textContent = `目前已知 URL：已檢測 ${checkedTotal} 個，尚有 ${normalized} 個待檢測，${activeTotal} 個請求中`;
}

function updateScanPhaseDisplay(status) {
  if (!scanPhaseNote) {
    return;
  }
  scanPhaseNote.textContent = `目前階段：${getScanPhaseText(status)}`;
}

function getScanPhaseText(status) {
  const state = status?.state || "idle";
  if (state === "idle") {
    return "尚未開始";
  }
  if (state === "stopping") {
    return "正在停止並整理已完成結果";
  }
  if (state === "stopped") {
    return "已停止，報告可能未完整完成";
  }
  if (state === "failed") {
    return "檢查失敗";
  }
  if (state === "finished") {
    return "檢查完成";
  }

  const queuedPages = Number(status?.queuedPages || 0);
  const pagesCrawled = Number(status?.pagesCrawled || 0);
  const pendingUrlCount = getPendingUrlCount(status);
  const activeRequests = Number(status?.activeRequests || 0);
  const urlsChecked = Number(status?.urlsChecked || 0);

  if (queuedPages > 0 && (activeRequests > 0 || pendingUrlCount === 0 || pagesCrawled === 0)) {
    return "頁面探索與連結蒐集中";
  }
  if (pendingUrlCount > 0 || activeRequests > 0) {
    return "URL 檢測中";
  }
  if (urlsChecked > 0) {
    return "等待收尾與產生報告";
  }
  return "準備連線";
}

function buildScanAdvice(status) {
  if (!status || status.state !== "running") {
    return null;
  }

  const pendingUrlCount = getPendingUrlCount(status);
  const urlsChecked = Number(status.urlsChecked || 0);
  const queuedPages = Number(status.queuedPages || 0);
  const maxPages = Number(status.maxPages || maxPagesInput.value || 0);
  const pagesCrawled = Number(status.pagesCrawled || 0);
  const knownUrls = urlsChecked + pendingUrlCount;

  if (pendingUrlCount >= 300 || knownUrls >= 600) {
    return "目前正在處理大量 URL，程式仍在工作；若只是初步盤點，可降低最多頁面或最大深度，並先關閉外部連結檢查。";
  }

  if (pendingUrlCount >= 100 || queuedPages >= 50) {
    return "此網站已展開較多待檢查項目，完成時間可能拉長；可觀察待檢查 URL 是否持續下降。";
  }

  if (maxPages >= 300 && pagesCrawled >= 25 && queuedPages > 0) {
    return "目前仍在探索站內頁面；大型清單網站使用 300 頁上限時，掃描時間可能明顯增加。";
  }

  return null;
}

function updateScanAdvice(message) {
  if (!scanAdviceNote) {
    return;
  }
  if (!message) {
    scanAdviceNote.hidden = true;
    scanAdviceNote.textContent = "";
    return;
  }
  scanAdviceNote.hidden = false;
  scanAdviceNote.textContent = message;
}

function updatePageDiscoveryDisplay(crawledCount, maxPagesCount, queuedCount) {
  if (!pageDiscoveryNote) {
    return;
  }
  const crawledTotal = Math.max(0, Number(crawledCount) || 0);
  const maxTotal = Number(maxPagesCount) || maxPagesInput.value || 0;
  const queuedTotal = Math.max(0, Number(queuedCount) || 0);
  pageDiscoveryNote.textContent = `頁面探索：${crawledTotal} / ${maxTotal}，待爬 ${queuedTotal}`;
}

function setState(state) {
  document.body.classList.toggle("scan-idle", state === "idle");
  stateBadge.className = `badge ${state}`;
  const labels = {
    idle: "待命",
    running: "執行中",
    stopping: "停止中",
    stopped: "已停止",
    finished: "完成",
    failed: "失敗",
  };
  stateBadge.textContent = labels[state] || state;

  const titles = {
    idle: "準備開始",
    running: "正在檢查網站連結",
    stopping: "正在停止檢查",
    stopped: "檢查已停止",
    finished: "檢查完成",
    failed: "檢查失敗",
  };
  statusTitle.textContent = titles[state] || "狀態更新";
  setScanEmptyStateVisible(state === "idle");
}

function setBusy(isBusy) {
  startButton.disabled = isBusy;
  stopButton.disabled = !isBusy;
  startButton.textContent = isBusy ? buttonLabels.checking : buttonLabels.start;
  stopButton.textContent = buttonLabels.stop;
  startButton.classList.toggle("is-running", isBusy);
  stopButton.classList.toggle("is-stop-ready", isBusy);
  startButton.setAttribute("aria-busy", String(isBusy));
}

function updateQueueButtonState(isRunning) {
  startQueueButton.textContent = isRunning ? buttonLabels.queueRunning : buttonLabels.startQueue;
  stopQueueButton.textContent = buttonLabels.stopQueue;
  startQueueButton.classList.toggle("is-running", isRunning);
  stopQueueButton.classList.toggle("is-stop-ready", isRunning);
  startQueueButton.setAttribute("aria-busy", String(isRunning));
}

function appendLog(item) {
  eventLog.removeAttribute("aria-label");
  const li = document.createElement("li");
  const type = document.createElement("span");
  type.className = "log-type";
  type.textContent = item.type;
  const text = document.createTextNode(item.message);
  li.append(type, text);
  eventLog.prepend(li);

  while (eventLog.children.length > 250) {
    eventLog.lastElementChild.remove();
  }
}

function renderReport(report) {
  const summary = report.summary || {};
  const options = report.options || {};
  const hasBrokenDetails = Array.isArray(report.broken);
  const broken = hasBrokenDetails ? report.broken : [];
  const interpretationView = buildInterpretationView(report);
  const interpretationTotal = interpretationView.displayTotal;
  resultSummary.textContent = `${interpretationTotal} 筆需判讀結果`;
  brokenCount.textContent = interpretationTotal;
  const reportPagesCrawled = Number(summary.pagesCrawled || 0);
  const reportMaxPages = Number(options.maxPages || 0);
  const reportUrlsChecked = Number(summary.urlsChecked || 0);
  const reportPendingUrls = getReportPendingUrlCount(report);
  const reportState = getReportPhaseState(report);
  pages.textContent = `${reportPagesCrawled} / ${reportMaxPages || options.maxPages || 0}`;
  checked.textContent = reportUrlsChecked;
  updatePendingUrlDisplay(reportPendingUrls, reportUrlsChecked, 0);
  updateScanPhaseDisplay({
    state: reportState,
    pendingUrls: reportPendingUrls,
    urlsChecked: reportUrlsChecked,
    queuedPages: report.runStatus?.pendingPages || 0,
    pagesCrawled: reportPagesCrawled,
    maxPages: reportMaxPages || options.maxPages || 0,
  });
  updatePageDiscoveryDisplay(reportPagesCrawled, reportMaxPages || options.maxPages || 0, report.runStatus?.pendingPages || 0);
  updateScanAdvice(null);
  skipped.textContent = summary.skippedExternal || 0;
  setProgressValue(getReportUrlValidationProgress(report));
  updateIssueBreakdown(interpretationView.counts, interpretationTotal);
  updateFilterCounts(interpretationView.counts, interpretationTotal);
  updateRedirectBreakdown(summary.redirectByType || emptyRedirectBreakdown(), summary.redirects || 0);
  updateConfirmationBreakdown(summary.confirmation || (Array.isArray(report.checked) ? buildConfirmationBreakdown(report.checked) : buildConfirmationBreakdown(broken)));
  updateIncrementalSummary(summary.incremental || null);
  updateActiveFilter();

  renderBrokenTableForReport(report);
}

function getReportPhaseState(report) {
  const status = report?.runStatus?.status;
  if (status === "partial" || status === "stopped") {
    return "stopped";
  }
  if (status === "failed") {
    return "failed";
  }
  return "finished";
}

function buildReportFromCompletePayload(data) {
  return {
    schemaVersion: data.schemaVersion || "",
    generator: data.generator || null,
    startUrl: data.startUrl || "",
    options: data.options || {},
    runStatus: data.runStatus || { status: data.state === "stopped" ? "partial" : "complete" },
    summary: data.summary || {},
    reportFiles: data.reportFiles || null,
    detailsDeferred: true,
  };
}

function getReportPendingUrlCount(report) {
  const runStatus = report?.runStatus || {};
  return Number(runStatus.pendingValidations || 0) + Number(runStatus.activeValidationTasks || 0);
}

function getReportUrlValidationProgress(report) {
  if (report?.runStatus?.status === "complete") {
    return 100;
  }
  const checkedTotal = Number(report?.summary?.urlsChecked || 0);
  const pendingTotal = getReportPendingUrlCount(report);
  const totalKnownUrls = checkedTotal + pendingTotal;
  if (totalKnownUrls <= 0) {
    return 0;
  }
  return capIncompleteProgress((checkedTotal / totalKnownUrls) * 100);
}

function renderBrokenTableForReport(report) {
  const hasBrokenDetails = Array.isArray(report.broken);
  const interpretationView = buildInterpretationView(report);
  renderBrokenTable(interpretationView.displayItems, {
    detailsDeferred: !hasBrokenDetails && interpretationView.displayTotal > 0,
    totalBroken: interpretationView.displayTotal,
  });
}

function renderBrokenTable(broken, { detailsDeferred = false, totalBroken = broken.length } = {}) {
  if (detailsDeferred) {
    renderBrokenEmptyState(
      "判讀清單已保存到完整報告",
      "為避免大型報告在完成瞬間卡住，這裡先顯示摘要；下載完整 report 或查看 log 目錄中的 broken.csv / broken.ndjson 可取得明細。",
    );
    return;
  }

  const visible = currentFilter === "all"
    ? broken
    : broken.filter((item) => getInterpretation(item).category === currentFilter);

  if (totalBroken === 0) {
    const hasReport = Boolean(currentReport);
    renderBrokenEmptyState(
      hasReport ? "沒有需要判讀的結果" : "正在等待結果",
      hasReport ? "這份報告目前沒有需要列出的判讀項目。" : "檢查進行中，發現需要判讀的結果時會立即出現在這裡。",
    );
    return;
  }

  if (visible.length === 0) {
    renderBrokenEmptyState("此分類沒有待判讀結果", "切回「全部待判讀」可查看其他分類。");
    return;
  }

  brokenTable.replaceChildren(...visible.map(renderBrokenItem));
}

function setScanEmptyStateVisible(isVisible) {
  if (!scanEmptyState) {
    return;
  }
  scanEmptyState.hidden = !isVisible;
}

function renderBrokenEmptyState(title, body) {
  brokenTable.replaceChildren(makeEmptyState(title, body, "compact-empty-state broken-empty"));
}

function makeEmptyState(title, body, modifier = "") {
  const wrapper = document.createElement("div");
  wrapper.className = modifier ? `empty-state ${modifier}` : "empty-state";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = body;
  wrapper.append(heading, text);
  return wrapper;
}

function renderBrokenItem(item) {
  const row = document.createElement("article");
  row.className = "broken-item";

  const header = document.createElement("div");
  header.className = "broken-item-header";
  const statusCode = document.createElement("span");
  const interpretation = getInterpretation(item);
  const issueType = item.issueType || getIssueType(item);
  const statusClass = `interpretation-${interpretation.category.replaceAll("_", "-")}`;
  statusCode.className = `status-code ${statusClass}`;
  statusCode.textContent = interpretation.label;
  header.append(statusCode, metaBadge(formatIssueLabel(item)), metaBadge(item.method || "HTTP"), metaBadge(item.status ? `Status ${item.status}` : "No status"));
  const incrementalBadge = getIncrementalResultBadge(item);
  if (incrementalBadge) {
    header.append(metaBadge(incrementalBadge.text, incrementalBadge.modifier));
  }
  if (shouldShowClientRedirectEvidence(item.confirmation?.clientRedirectEvidence)) {
    header.append(metaBadge("瀏覽器端導向", "impact"));
  }

  row.append(header, detailLine("URL", item.url));
  row.append(detailLine("建議處理", interpretation.action));
  row.append(detailLine("技術原因", formatIssueLabel(item)));
  if (item.checkedAt) {
    row.append(detailLine("檢查時間", item.checkedAt));
  }
  if (item.canonicalUrl && item.canonicalUrl !== item.url) {
    row.append(detailLine("Canonical URL", item.canonicalUrl));
  }
  if (item.contentLength !== null && item.contentLength !== undefined) {
    row.append(detailLine("Content-Length", item.contentLength));
  }

  if (item.redirected) {
    row.append(detailLine("轉址", `${item.redirectCount} 次轉址，最終 URL：${item.finalUrl}`));
  }
  if (item.classification === "protected" || issueType === "access_denied" || item.diagnosis || item.error) {
    row.append(detailLine("診斷", formatDiagnosis(item)));
  }
  if (item.confirmation?.enabled) {
    row.append(detailLine("二次確認", formatConfirmationStatus(item.confirmation)));
  }
  if (shouldShowClientRedirectEvidence(item.confirmation?.clientRedirectEvidence)) {
    row.append(detailLine("瀏覽器端導向", formatClientRedirectEvidence(item.confirmation.clientRedirectEvidence)));
  }
  if (item.incremental?.reused) {
    row.append(detailLine("增量來源", formatIncrementalProvenance(item.incremental)));
  }

  const sources = (item.sources || []).slice(0, 4);
  if (sources.length > 0) {
    const sourceText = sources
      .map((source) => `${source.page} (${source.tag}[${source.attribute}])`)
      .join("；");
    row.append(detailLine("發現位置", sourceText));
  } else {
    row.append(detailLine("發現位置", "無來源資料"));
  }
  if ((item.sources || []).length > 4) {
    row.append(detailLine("更多位置", `另有 ${(item.sources || []).length - 4} 個位置`));
  }

  return row;
}

function detailLine(label, value) {
  const row = document.createElement("div");
  row.className = "broken-detail-line";
  const labelElement = document.createElement("span");
  labelElement.className = "detail-label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "detail-value";
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function getIncrementalResultBadge(item) {
  if (item.incremental?.reused) {
    return { text: "復用", modifier: "impact" };
  }
  if (currentReport?.summary?.incremental?.enabled) {
    return {
      text: item.incremental?.classification === "new" ? "新增" : "已重查",
      modifier: "",
    };
  }
  return null;
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

function metaBadge(value, modifier = "") {
  const span = document.createElement("span");
  span.className = modifier ? `meta-badge ${modifier}` : "meta-badge";
  span.textContent = value;
  return span;
}

updateAdvancedSummary();
setState("idle");
refreshQueue();

function emptyBreakdown() {
  return {
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
}

function emptyRedirectBreakdown() {
  return {
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
}

function emptyConfirmationBreakdown() {
  return {
    enabled: false,
    candidates: 0,
    checked: 0,
    confirmed_missing: 0,
    recovered: 0,
    needs_review: 0,
    skipped: 0,
  };
}

function emptyInterpretationCounts() {
  return interpretationCategories.reduce((counts, category) => {
    counts[category] = 0;
    return counts;
  }, {});
}

function buildInterpretationView(report) {
  const checkedItems = Array.isArray(report?.checked) ? report.checked : [];
  const brokenItems = Array.isArray(report?.broken) ? report.broken : [];
  if (checkedItems.length === 0 && brokenItems.length === 0) {
    const counts = buildInterpretationCountsFromSummary(report?.summary || {});
    return {
      counts,
      displayItems: [],
      displayTotal: countDisplayInterpretations(counts),
    };
  }

  const counts = emptyInterpretationCounts();
  const brokenByKey = new Map(brokenItems.map((item) => [getInterpretationItemKey(item), item]));
  const sourceItems = checkedItems.length > 0 ? checkedItems : brokenItems;
  const displayItems = [];
  const displayedKeys = new Set();

  for (const item of sourceItems) {
    const displaySource = brokenByKey.get(getInterpretationItemKey(item)) || item;
    const interpretation = getInterpretation(displaySource, report);
    counts[interpretation.category] = (counts[interpretation.category] || 0) + 1;
    if (!shouldDisplayInterpretation(displaySource, interpretation)) {
      continue;
    }

    const key = getInterpretationItemKey(displaySource);
    if (displayedKeys.has(key)) {
      continue;
    }
    displayedKeys.add(key);
    displayItems.push({ ...displaySource, interpretation });
  }

  return {
    counts,
    displayItems,
    displayTotal: displayItems.length,
  };
}

function buildInterpretationCountsFromSummary(summary = {}) {
  if (summary.interpretationByCategory && typeof summary.interpretationByCategory === "object") {
    return {
      ...emptyInterpretationCounts(),
      ...summary.interpretationByCategory,
    };
  }

  const counts = emptyInterpretationCounts();
  const brokenByType = summary.brokenByType || emptyBreakdown();
  const redirectByType = summary.redirectByType || emptyRedirectBreakdown();
  const confirmedMissing = Number(summary.confirmation?.confirmed_missing || 0);
  const redirectProblems = Number(redirectByType.redirect_to_error || 0)
    + Number(redirectByType.too_many_redirects || 0)
    + Number(redirectByType.redirect_loop || 0);

  counts.action_required = confirmedMissing + redirectProblems;
  counts.needs_review = Number(brokenByType.protected || 0)
    + Number(brokenByType.access_denied || 0)
    + Number(brokenByType.timeout || 0)
    + Number(brokenByType.network_error || 0);
  counts.likely_problem = Math.max(0, Number(brokenByType.not_found || 0) - confirmedMissing)
    + Number(brokenByType.http_error || 0)
    + Number(brokenByType.unknown_error || 0);
  counts.redirect_ok = Math.max(0, Number(summary.redirects || 0) - redirectProblems);

  const displayTotal = countDisplayInterpretations(counts);
  counts.ok = Math.max(0, Number(summary.urlsChecked || 0) - displayTotal);
  return counts;
}

function countDisplayInterpretations(counts) {
  return Object.entries(counts || {})
    .filter(([category]) => category !== "ok")
    .reduce((total, [, count]) => total + (Number(count) || 0), 0);
}

function getInterpretationItemKey(item) {
  return item?.canonicalUrl || item?.url || item?.finalUrl || JSON.stringify(item);
}

function shouldDisplayInterpretation(item, interpretation) {
  if (!interpretation || interpretation.category === "ok") {
    return false;
  }
  return Boolean(item?.url || item?.finalUrl);
}

function getInterpretation(item, report = currentReport) {
  const existing = item?.interpretation;
  if (existing?.category) {
    return {
      ...buildInterpretation(existing.category, item),
      ...existing,
    };
  }

  const issueType = item.issueType || getIssueType(item);
  const confirmationOutcome = item.confirmation?.outcome;
  const externalLimited = isExternalLimitedResult(item, report);

  if (item.ok) {
    return buildInterpretation(item.redirected ? "redirect_ok" : "ok", item);
  }
  if (issueType === "redirect_to_error" || issueType === "too_many_redirects" || issueType === "redirect_loop") {
    return buildInterpretation("action_required", item);
  }
  if (issueType === "not_found") {
    if (confirmationOutcome === "confirmed_missing") {
      return buildInterpretation("action_required", item);
    }
    if (confirmationOutcome === "needs_review") {
      return buildInterpretation(externalLimited ? "external_limited" : "needs_review", item);
    }
    return buildInterpretation("likely_problem", item);
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
    return buildInterpretation(externalLimited ? "external_limited" : "needs_review", item);
  }
  if (item.status >= 400 || issueType === "http_error" || issueType === "unknown_error") {
    return buildInterpretation("likely_problem", item);
  }
  if (item.redirected) {
    return buildInterpretation("redirect_ok", item);
  }
  return buildInterpretation("needs_review", item);
}

function buildInterpretation(category, item) {
  const actions = {
    action_required: "請優先確認來源頁，並修正或移除連結。",
    needs_review: "請用瀏覽器人工確認是否可正常開啟，再決定是否交辦修正。",
    external_limited: "外部網站可能拒絕或限制工具請求，建議人工確認或與對方網站窗口協調。",
    likely_problem: "請確認網址、伺服器狀態或頁面是否仍存在。",
    redirect_ok: "連結目前可到達；若 final URL 穩定，可視情況更新原連結。",
    ok: "目前不需處理。",
    page_quality_notice: "此項屬頁內品質提醒，請視內容維護需求處理。",
  };
  const severity = {
    action_required: "high",
    likely_problem: "medium",
    needs_review: "review",
    external_limited: "review",
    redirect_ok: "info",
    ok: "ok",
    page_quality_notice: "notice",
  };

  return {
    category,
    label: interpretationLabels[category] || category,
    severity: severity[category] || "review",
    action: actions[category] || actions.needs_review,
    needsManualReview: ["needs_review", "external_limited", "likely_problem"].includes(category),
  };
}

function isExternalLimitedResult(item, report = currentReport) {
  if (!item?.url || !report?.startUrl) {
    return false;
  }
  const issueType = item.issueType || getIssueType(item);
  if (!["protected", "access_denied", "timeout", "network_error", "http_error", "unknown_error"].includes(issueType)
      && item.status !== 429
      && !item.suspectedWaf
      && !item.suspectedBot) {
    return false;
  }
  try {
    return new URL(item.url).origin !== new URL(report.startUrl).origin;
  } catch {
    return false;
  }
}

function buildBreakdown(items) {
  const counts = emptyBreakdown();
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

function buildConfirmationBreakdown(items) {
  const counts = emptyConfirmationBreakdown();
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

function updateIssueBreakdown(counts, total) {
  issueNotFound.textContent = counts.action_required || 0;
  issueProtected.textContent = counts.needs_review || 0;
  issueAccessDenied.textContent = counts.external_limited || 0;
  issueHttp.textContent = counts.likely_problem || 0;
  issueTimeout.textContent = counts.redirect_ok || 0;
  issueNetwork.textContent = counts.ok || 0;
  issueUnknown.textContent = counts.page_quality_notice || 0;
  brokenCount.textContent = total || 0;
}

function updateFilterCounts(counts, total) {
  for (const button of filterBar.querySelectorAll("button[data-filter]")) {
    const filter = button.dataset.filter;
    const count = filter === "all" ? total : counts[filter] || 0;
    button.querySelector("span").textContent = count;
  }
}

function updateRedirectBreakdown(counts, total) {
  redirectTotal.textContent = total || 0;
  redirectPermanent.textContent = counts.permanent_redirect || 0;
  redirectTemporary.textContent = counts.temporary_redirect || 0;
  redirectCrossHost.textContent = counts.cross_host_redirect || 0;
  redirectLong.textContent = counts.long_redirect_chain || 0;
  redirectUnresolved.textContent = (counts.redirect_to_error || 0)
    + (counts.too_many_redirects || 0)
    + (counts.redirect_loop || 0);
}

function updateConfirmationBreakdown(counts) {
  confirmationCandidates.textContent = counts.enabled ? counts.candidates || 0 : 0;
  confirmationRecovered.textContent = counts.enabled ? counts.recovered || 0 : 0;
  confirmationNeedsReview.textContent = counts.enabled ? counts.needs_review || 0 : 0;
  confirmationMissing.textContent = counts.enabled ? counts.confirmed_missing || 0 : 0;
}

function updateIncrementalSummary(incremental) {
  if (!incrementalPanel) {
    return;
  }
  if (!incremental?.enabled) {
    incrementalPanel.hidden = true;
    incrementalMode.textContent = "-";
    incrementalNew.textContent = "0";
    incrementalKnown.textContent = "0";
    incrementalReused.textContent = "0";
    incrementalDisappeared.textContent = "0";
    incrementalPriority.textContent = "0 / 0";
    return;
  }

  const priority = incremental.priority || {};
  incrementalPanel.hidden = false;
  incrementalMode.textContent = incremental.mode === "changed_only" ? "復用穩定結果" : "優先重查";
  incrementalNew.textContent = incremental.new || 0;
  incrementalKnown.textContent = incremental.known || 0;
  incrementalReused.textContent = incremental.reused || 0;
  incrementalDisappeared.textContent = incremental.disappeared || 0;
  incrementalPriority.textContent = `${priority.boosted || 0} / ${priority.deferred || 0}`;
}

function updateActiveFilter() {
  for (const button of filterBar.querySelectorAll("button[data-filter]")) {
    button.classList.toggle("active", button.dataset.filter === currentFilter);
  }
}

function getIssueType(item) {
  if (item.classification === "redirect_error") {
    return item.issueType || "unknown_error";
  }
  if (item.classification === "protected") {
    return "protected";
  }
  if (item.classification === "access_denied" || item.status === 403) {
    return "access_denied";
  }
  if (item.status === 404 || item.status === 410) {
    return "not_found";
  }
  if (item.classification === "network_error") {
    return item.error?.toLowerCase().includes("timeout") || item.cause?.code === "ETIMEDOUT"
      ? "timeout"
      : "network_error";
  }
  if (item.status >= 400) {
    return "http_error";
  }
  return "unknown_error";
}

function formatIssueLabel(item) {
  if (item.classification === "protected") {
    return item.protection?.provider ? `防護阻擋: ${item.protection.provider}` : "防護阻擋";
  }
  if ((item.issueType || getIssueType(item)) === "access_denied") {
    return "存取被拒";
  }
  if (item.classification === "redirect_error") {
    if ((item.issueType || getIssueType(item)) === "redirect_to_error") {
      return "轉址後無法到達";
    }
    if ((item.issueType || getIssueType(item)) === "too_many_redirects") {
      return "轉址過多";
    }
    if ((item.issueType || getIssueType(item)) === "redirect_loop") {
      return "轉址循環";
    }
    return "轉址無法到達";
  }
  if ((item.issueType || getIssueType(item)) === "not_found") {
    return "404 / 410";
  }
  if ((item.issueType || getIssueType(item)) === "timeout") {
    return "逾時";
  }
  if ((item.issueType || getIssueType(item)) === "network_error") {
    return "網路錯誤";
  }
  return item.status ? `HTTP ${item.status}` : "錯誤";
}

function formatDiagnosis(item) {
  const status = item.status ? `HTTP ${item.status}` : "未取得 HTTP 狀態";
  if ((item.issueType || getIssueType(item)) === "access_denied") {
    return item.diagnosis || `${status}，伺服器拒絕目前工具請求，需人工確認。`;
  }
  const evidence = item.protection?.evidence?.join("、");
  const diagnostics = [
    evidence ? `證據：${evidence}` : "",
    item.blockedReason ? `原因：${item.blockedReason}` : "",
    item.suspectedWaf ? "疑似 WAF" : "",
    item.suspectedBot ? "疑似 Bot challenge" : "",
  ].filter(Boolean).join("，");
  return diagnostics ? `${status}，${diagnostics}` : status;
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

  const labels = {
    recovered: "已恢復",
    needs_review: "需複查",
    confirmed_missing: "確認不存在",
  };
  const label = labels[confirmation.outcome] || confirmation.outcome || "未知";
  const status = confirmation.status ? `HTTP ${confirmation.status}` : "未取得 HTTP 狀態";
  const checkedAt = confirmation.checkedAt ? `，${confirmation.checkedAt}` : "";
  return `${label}（${status}${checkedAt}）`;
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

function shouldShowClientRedirectEvidence(evidence) {
  return Boolean(evidence?.detected);
}

function formatClientRedirectEvidence(evidence) {
  if (!evidence?.detected) {
    return "未偵測到瀏覽器端導向";
  }

  const parts = [formatClientRedirectSource(evidence)];
  if (evidence.targetUrl) {
    parts.push(`導向目標：${evidence.targetUrl}`);
  }

  if (evidence.targetChecked) {
    const status = evidence.targetStatus ? `HTTP ${evidence.targetStatus}` : "未取得 HTTP 狀態";
    parts.push(`${formatClientRedirectReason(evidence.reason)}（${status}）`);
  } else {
    parts.push(formatClientRedirectReason(evidence.reason));
  }

  if (evidence.targetFinalUrl && evidence.targetFinalUrl !== evidence.targetUrl) {
    parts.push(`最終網址：${evidence.targetFinalUrl}`);
  }

  return parts.filter(Boolean).join("；");
}

function formatClientRedirectSource(evidence) {
  const sourceLabels = {
    meta_refresh: "錯誤頁包含 meta refresh",
    script_literal: "錯誤頁包含 JavaScript 導向",
  };
  const source = sourceLabels[evidence.source] || "錯誤頁包含瀏覽器端導向";
  return evidence.attribute ? `${source}（${evidence.attribute}）` : source;
}

function formatClientRedirectReason(reason) {
  const labels = {
    target_reachable: "導向目標可開啟，建議確認原連結是否應更新",
    target_not_checked_external: "導向目標是外部網站，請人工確認是否可開啟",
    target_still_not_found: "導向目標仍是 404 / 410，建議人工確認",
    target_blocked_waf: "導向目標疑似被 WAF 阻擋，建議人工確認",
    target_blocked_bot: "導向目標疑似遇到 Bot challenge，建議人工確認",
    target_blocked_by_security_policy: "導向目標被安全政策阻擋，建議人工確認",
    target_timeout: "導向目標檢查逾時，建議人工確認",
    target_network_error: "導向目標發生網路錯誤，建議人工確認",
    target_unknown: "導向目標結果不明，建議人工確認",
    target_not_http_or_invalid: "導向目標不是可檢查的 HTTP(S) 網址",
    target_queued: "導向目標尚未完成檢查",
  };
  return labels[reason] || reason || "導向目標結果不明，建議人工確認";
}
