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
const systemCaStatus = document.querySelector("#system-ca-status");
const systemCaNote = document.querySelector("#system-ca-note");
const systemCaRestartButton = document.querySelector("#system-ca-restart");
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
const urlPatternNote = document.querySelector("#url-pattern-note");
const scanAdviceNote = document.querySelector("#scan-advice-note");
const coverageNotice = document.querySelector("#coverage-notice");
const pages = document.querySelector("#pages");
const checked = document.querySelector("#checked");
const pendingUrls = document.querySelector("#pending-urls");
const active = document.querySelector("#active");
const queue = document.querySelector("#queue");
const brokenCount = document.querySelector("#broken-count");
const skipped = document.querySelector("#skipped");
const currentUrl = document.querySelector("#current-url");
const logLocation = document.querySelector("#log-location");
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
const browserUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const defaultUserAgent = `${browserUserAgent} LocalLinkChecker/1.0`;
const sessionHeaderName = "X-Link-Checker-Session";
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
let queuePollTimer = null;
let watchedQueueItemId = null;
let watchedQueueUrl = null;
let manualWatchSelected = false;
let activePreset = "balanced";
let scanInProgress = false;
let queueInProgress = false;
let suppressNextUnloadWarning = false;
let sessionSystemCaEnabled = false;
let systemCaRestarting = false;
const sessionTokenPromise = loadSessionToken();

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
  await mutationFetch(`/api/jobs/${currentJobId}/stop`, { method: "POST" });
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
    const response = await mutationFetch("/api/shutdown", { method: "POST" });
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

systemCaRestartButton?.addEventListener("click", async () => {
  await restartWithSystemCa();
});

addQueueButton.addEventListener("click", async () => {
  await addQueueItems();
});

startQueueButton.addEventListener("click", async () => {
  await mutationFetch("/api/queue/start", {
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
  await mutationFetch("/api/queue/stop", { method: "POST" });
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

function startSessionHeartbeat() {
  const send = () => mutationFetch("/api/session/heartbeat", {
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

function updateSystemCaRestartButton() {
  if (!systemCaRestartButton) {
    return;
  }
  const shouldShow = !sessionSystemCaEnabled;
  systemCaRestartButton.hidden = !shouldShow;
  systemCaRestartButton.disabled = systemCaRestarting || hasUnfinishedWork();
  systemCaRestartButton.textContent = systemCaRestarting
    ? "正在重新啟動..."
    : "重新啟動並使用 Windows 系統憑證";
}

async function restartWithSystemCa() {
  if (sessionSystemCaEnabled || systemCaRestarting) {
    return;
  }
  if (hasUnfinishedWork()) {
    window.alert("目前有掃描工作進行中，請先停止或等待完成後再重新啟動。");
    return;
  }

  systemCaRestarting = true;
  if (systemCaNote) {
    systemCaNote.textContent = "正在重新啟動 Link Checker...";
  }
  updateSystemCaRestartButton();

  try {
    const response = await mutationFetch("/api/restart-system-ca", {
      method: "POST",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 409) {
      throw new Error(data.error || "目前有掃描工作進行中，請先停止或等待完成後再重新啟動。");
    }
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    if (data.status === "already_enabled" || data.systemCaEnabled === true) {
      updateSystemCaStatus(true);
      suppressNextUnloadWarning = true;
      window.location.reload();
      return;
    }

    await waitForSystemCaSession();
    suppressNextUnloadWarning = true;
    window.location.reload();
  } catch (error) {
    systemCaRestarting = false;
    updateSystemCaStatus(sessionSystemCaEnabled);
    window.alert(`重新啟動失敗：${error.message}\n\n請關閉 Link Checker 後，再使用系統憑證模式啟動。`);
  }
}

async function waitForSystemCaSession({ attempts = 40, delayMs = 750 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    try {
      const response = await fetch("/api/session", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.systemCaEnabled === true) {
        return data;
      }
    } catch {
      // The old local server is expected to disconnect briefly during restart.
    }
  }
  throw new Error("等待 Link Checker 重新啟動逾時。");
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

async function loadSessionToken() {
  const response = await fetch("/api/session", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.sessionToken) {
    throw new Error(data.error || "無法取得本機工作階段");
  }
  updateSystemCaStatus(data.systemCaEnabled === true);
  return data.sessionToken;
}

function updateSystemCaStatus(enabled) {
  sessionSystemCaEnabled = enabled === true;
  if (!systemCaStatus || !systemCaNote) {
    return;
  }
  systemCaStatus.textContent = sessionSystemCaEnabled ? "已啟用" : "未啟用";
  systemCaStatus.className = sessionSystemCaEnabled ? "session-status-enabled" : "session-status-disabled";
  systemCaNote.textContent = sessionSystemCaEnabled
    ? "此設定套用於目前 Link Checker 執行期間。"
    : "如網站在瀏覽器可正常開啟，但掃描出現憑證問題，可重新啟動 Link Checker 並使用 Windows 系統信任憑證。";
  systemCaRestarting = false;
  updateSystemCaRestartButton();
}

async function mutationFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set(sessionHeaderName, await sessionTokenPromise);
  return fetch(url, {
    ...options,
    headers,
  });
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
  downloadButton.disabled = true;
  setScanEmptyStateVisible(false);
  updateIssueBreakdown(emptyInterpretationCounts(), 0);
  updateRedirectBreakdown(emptyRedirectBreakdown(), 0);
  updateIncrementalSummary(null);
  pendingUrls.textContent = "0";
  updateScanPhaseDisplay({ state: "running" });
  updatePendingUrlDisplay(0, 0, 0);
  updatePageDiscoveryDisplay(0, maxPagesInput.value, 0);
  updateUrlPatternDisplay(null);
  updateScanAdvice(null);
  updateCoverageNotice(null);
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
    const response = await mutationFetch("/api/jobs", {
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

  const response = await mutationFetch("/api/queue/items", {
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
  updateSystemCaRestartButton();

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
  scanInProgress = true;
  downloadButton.disabled = true;
  eventLog.replaceChildren();
  eventLog.removeAttribute("aria-label");
  updateIncrementalSummary(null);
  updateCoverageNotice(null);
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
  const response = await mutationFetch(`/api/queue/items/${id}/remove`, { method: "POST" });
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
  updateUrlPatternDisplay(status.urlPatternSummary || null);
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
  updateRedirectBreakdown(status.redirectByType || emptyRedirectBreakdown(), status.redirects || 0);
  updateConfirmationBreakdown(emptyConfirmationBreakdown());
  updateIncrementalSummary(null);

  setProgressValue(getScanProgress(status));
}

function setProgressValue(value) {
  const normalized = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
  progressBar.style.width = `${normalized}%`;
  progressPercent.textContent = `${normalized}%`;
  progressTrack.setAttribute("aria-valuenow", String(normalized));
}

function capIncompleteProgress(value) {
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  return Math.min(95, normalized);
}

function isStatusComplete(status) {
  if (status?.state !== "finished") {
    return false;
  }
  return getPendingUrlCount(status) === 0
    && Number(status?.queuedPages || 0) === 0
    && Number(status?.activeRequests || 0) === 0;
}

function getScanProgress(status) {
  if (isStatusComplete(status)) {
    return 100;
  }

  const state = status?.state || "idle";
  if (state === "idle") {
    return 0;
  }

  const urlsChecked = Number(status?.urlsChecked || 0);
  const pending = getPendingUrlCount(status);
  const queuedPages = Number(status?.queuedPages || 0);
  const activeRequests = Number(status?.activeRequests || 0);
  const pagesCrawled = Number(status?.pagesCrawled || 0);
  const maxPages = Number(status?.maxPages || maxPagesInput.value || 0);
  const totalKnownUrls = urlsChecked + pending;
  const validationRatio = totalKnownUrls > 0 ? urlsChecked / totalKnownUrls : 0;
  const pageRatio = maxPages > 0 ? Math.min(1, pagesCrawled / maxPages) : 0;
  const discoveryActive = queuedPages > 0 || (pagesCrawled === 0 && (activeRequests > 0 || pending > 0));

  if (state === "stopping" || state === "stopped" || state === "failed") {
    return capIncompleteProgress(Math.max(pageRatio * 65, validationRatio * 95));
  }

  if (discoveryActive) {
    const discoveryProgress = Math.max(8, (pageRatio * 45) + (validationRatio * 15));
    return Math.min(65, discoveryProgress);
  }

  if (pending > 0 || activeRequests > 0) {
    return capIncompleteProgress(65 + (validationRatio * 30));
  }

  if (urlsChecked > 0) {
    return 96;
  }
  return 5;
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

  const patternSummary = status.urlPatternSummary;
  if (patternSummary?.warning && patternSummary.dominantPattern) {
    return "此網站像清單型網站，掃描器會持續驗證大量相似頁面；若只是初步盤點，可先降低最多頁面或最大深度。";
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

function updateUrlPatternDisplay(summary) {
  if (!urlPatternNote) {
    return;
  }
  if (!summary?.warning || !summary.dominantPattern) {
    urlPatternNote.hidden = true;
    urlPatternNote.textContent = "";
    return;
  }

  const dominant = summary.dominantPattern;
  const topPatterns = Array.isArray(summary.topPatterns)
    ? summary.topPatterns
      .filter((item) => item && item.count > 0)
      .map((item) => `${item.pattern} ${item.count} 個`)
      .join("、")
    : "";
  const ratio = formatRatioPercent(dominant.ratio);
  urlPatternNote.hidden = false;
  urlPatternNote.textContent = `大量相似 URL：${dominant.pattern} 佔 ${dominant.count} / ${summary.totalKnownUrls}（${ratio}）。${topPatterns ? `主要型態：${topPatterns}` : ""}`;
}

function formatRatioPercent(value) {
  const ratio = Math.max(0, Math.min(1, Number(value) || 0));
  return `${Math.round(ratio * 100)}%`;
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
  updateSystemCaRestartButton();
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
  updateUrlPatternDisplay(null);
  updateScanAdvice(null);
  skipped.textContent = summary.skippedExternal || 0;
  setProgressValue(getReportUrlValidationProgress(report));
  updateIssueBreakdown(interpretationView.counts, interpretationTotal);
  updateRedirectBreakdown(summary.redirectByType || emptyRedirectBreakdown(), summary.redirects || 0);
  updateConfirmationBreakdown(summary.confirmation || (Array.isArray(report.checked) ? buildConfirmationBreakdown(report.checked) : buildConfirmationBreakdown(broken)));
  updateIncrementalSummary(summary.incremental || null);
  updateCoverageNotice(buildCoverageNotice(report));
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

function buildCoverageNotice(report) {
  const coverage = deriveCoverageStatusForReport(report);
  if (!coverage.incomplete) {
    return null;
  }
  if (coverage.validation.incomplete) {
    return "本次掃描未完整完成，目前結果僅包含已完成驗證的 URL，不應視為完整網站檢測結果。";
  }
  if (coverage.discovery.incomplete) {
    if (coverage.discovery.reasons?.includes("start_page_fetch_failed")) {
      return "起始頁面無法取得可供探索的內容，因此本次結果可能未涵蓋網站連結。";
    }
    return "本次已完成排定的 URL 驗證，但網站探索範圍受頁面上限或 sitemap seed 限制，結果可能未涵蓋完整網站。";
  }
  return "本次掃描可能未完整涵蓋網站內容，目前結果僅代表已探索及已完成驗證的 URL。";
}

function deriveCoverageStatusForReport(report) {
  const existing = report?.summary?.coverage;
  if (existing && typeof existing === "object" && Array.isArray(existing.reasons)) {
    return {
      incomplete: existing.incomplete === true || existing.status === "incomplete",
      reasons: existing.reasons,
      discovery: existing.discovery || { incomplete: false, reasons: [] },
      validation: existing.validation || { incomplete: false, reasons: [] },
    };
  }

  const summary = report?.summary || {};
  const runStatus = report?.runStatus || {};
  const reasons = [];
  const discoveryReasons = [];
  const validationReasons = [];
  const pagesCrawled = Number(summary.pagesCrawled || 0);
  const maxPages = Number(report?.options?.maxPages || 0);
  const pendingPages = Number(runStatus.pendingPages || 0);
  const pendingValidations = Number(runStatus.pendingValidations || 0);
  const activeValidationTasks = Number(runStatus.activeValidationTasks || 0);
  const sitemapSeed = summary.incremental?.sitemap?.seed || {};
  const sitemapUrlCount = Number(summary.incremental?.sitemap?.urlCount || 0);
  const fallbackSitemap = summary.discoveryFallback?.xmlSitemap || {};
  const sitemapSeedTruncated = hasSitemapSeedTruncation({
    discovered: sitemapUrlCount,
    seeded: Number(sitemapSeed.seeded || 0),
    ignoredByMaxPages: Number(sitemapSeed.ignoredByReason?.max_pages || 0) > 0,
    pagesCrawled,
    maxPages,
  }) || hasSitemapSeedTruncation({
    discovered: Number(fallbackSitemap.urlsDiscovered || 0),
    seeded: Number(fallbackSitemap.urlsSeeded || 0),
    ignoredByMaxPages: false,
    pagesCrawled,
    maxPages,
  });

  if (runStatus.stoppedByUser === true || runStatus.stopReason === "stopped_by_user") {
    validationReasons.push("stopped_by_user");
  }
  if (runStatus.status !== "complete" && (pendingValidations + activeValidationTasks) > 0) {
    validationReasons.push("validation_incomplete");
  }
  if (sitemapSeedTruncated) {
    discoveryReasons.push("sitemap_seed_truncated");
  }
  if (
    maxPages > 0
    && pagesCrawled >= maxPages
    && (
      pendingPages > 0
      || sitemapSeedTruncated
      || Number(sitemapSeed.ignoredByReason?.max_pages || 0) > 0
      || summary.discoveryFallback?.htmlSitemap?.reason === "max_pages"
      || fallbackSitemap.reason === "max_pages"
      || runStatus.stopReason === "max_pages"
    )
  ) {
    discoveryReasons.push("max_pages_reached");
  }

  reasons.push(...new Set([...discoveryReasons, ...validationReasons]));
  return {
    incomplete: reasons.length > 0,
    reasons,
    discovery: { incomplete: discoveryReasons.length > 0, reasons: discoveryReasons },
    validation: { incomplete: validationReasons.length > 0, reasons: validationReasons },
  };
}

function hasSitemapSeedTruncation({ discovered, seeded, ignoredByMaxPages, pagesCrawled, maxPages }) {
  if (!Number.isFinite(discovered) || !Number.isFinite(seeded) || discovered <= seeded) {
    return false;
  }
  return ignoredByMaxPages || (maxPages > 0 && pagesCrawled >= maxPages && seeded <= maxPages);
}

function updateCoverageNotice(message) {
  if (!coverageNotice) {
    return;
  }
  if (!message) {
    coverageNotice.hidden = true;
    coverageNotice.textContent = "";
    return;
  }
  coverageNotice.hidden = false;
  coverageNotice.textContent = message;
}

function setScanEmptyStateVisible(isVisible) {
  if (!scanEmptyState) {
    return;
  }
  scanEmptyState.hidden = !isVisible;
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
