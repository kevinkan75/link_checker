const linksFileInput = document.querySelector("#links-file");
const pickLinksButton = document.querySelector("#pick-links-button");
const rulesFileInput = document.querySelector("#rules-file");
const searchInput = document.querySelector("#search");
const riskFilterInput = document.querySelector("#risk-filter");
const governanceFilterInput = document.querySelector("#governance-filter");
const highRiskInput = document.querySelector("#high-risk-categories");
const mediumRiskInput = document.querySelector("#medium-risk-categories");
const trustedDomainsInput = document.querySelector("#trusted-domains");
const analyzeButton = document.querySelector("#analyze-button");
const exportJsonButton = document.querySelector("#export-json-button");
const exportCsvButton = document.querySelector("#export-csv-button");
const loadState = document.querySelector("#load-state");
const fileStatus = document.querySelector("#file-status");
const importEmptyState = document.querySelector("#import-empty-state");
const flowSelect = document.querySelector("#flow-select");
const flowAnalyze = document.querySelector("#flow-analyze");
const flowExport = document.querySelector("#flow-export");
const metricLinks = document.querySelector("#metric-links");
const metricDomains = document.querySelector("#metric-domains");
const metricHigh = document.querySelector("#metric-high");
const metricMedium = document.querySelector("#metric-medium");
const metricUncategorized = document.querySelector("#metric-uncategorized");
const metricSensitive = document.querySelector("#metric-sensitive");
const domainTable = document.querySelector("#domain-table");
const linksTable = document.querySelector("#links-table");
const domainSummaryCount = document.querySelector("#domain-summary-count");
const categorySummaryCount = document.querySelector("#category-summary-count");
const categoryList = document.querySelector("#category-list");
const linksSummary = document.querySelector("#links-summary");
const ut1FolderInput = document.querySelector("#ut1-folder");
const ut1MinDomainsInput = document.querySelector("#ut1-min-domains");
const ut1SearchInput = document.querySelector("#ut1-search");
const ut1State = document.querySelector("#ut1-state");
const ut1PickerButton = document.querySelector("#ut1-picker-button");
const ut1CommonButton = document.querySelector("#ut1-common-button");
const ut1SecurityButton = document.querySelector("#ut1-security-button");
const ut1SelectAllButton = document.querySelector("#ut1-select-all-button");
const ut1ClearButton = document.querySelector("#ut1-clear-button");
const ut1ApplyButton = document.querySelector("#ut1-apply-button");
const ut1DownloadButton = document.querySelector("#ut1-download-button");
const ut1CategoryTable = document.querySelector("#ut1-category-table");

const sessionHeaderName = "X-Link-Checker-Session";
const sessionTokenPromise = loadSessionToken().catch(() => "");

startSessionHeartbeat();

const UT1_COMMON_CATEGORIES = new Set([
  "social_networks",
  "shortener",
  "webmail",
  "shopping",
  "malware",
  "phishing",
  "vpn",
  "download",
  "filehosting",
  "publicite",
  "redirector",
  "strict_redirector",
  "strong_redirector",
  "cryptojacking",
  "ddos",
  "hacking",
  "stalkerware",
]);

const UT1_SECURITY_CATEGORIES = new Set([
  "malware",
  "phishing",
  "cryptojacking",
  "ddos",
  "hacking",
  "stalkerware",
  "dialer",
  "dangerous_material",
  "redirector",
  "strict_redirector",
  "strong_redirector",
  "vpn",
]);

const FILE_SIZE_WARN_BYTES = 15 * 1024 * 1024;
const FILE_SIZE_LARGE_BYTES = 50 * 1024 * 1024;
const LINK_LIST_INITIAL_COUNT = 200;
const LINK_LIST_INCREMENT = 200;

const RISK_REASON_GROUPS = [
  {
    id: "governance",
    label: "治理規則",
    reasons: ["blocked_domain", "watchlisted_domain", "allowed_domain", "trusted_domain"],
  },
  {
    id: "content",
    label: "內容分類",
    reasons: [
      "shortener",
      "tracking_or_analytics",
      "tracking_query",
      "form",
      "embedded_content",
      "download",
      "social",
      "cdn",
      "maps",
      "webmail",
      "asset",
      "media",
      "repeated_reference",
    ],
  },
  {
    id: "http",
    label: "HTTP 狀態",
    reasons: ["external_http_error", "access_denied", "rate_limited"],
  },
  {
    id: "redirect",
    label: "轉址",
    reasons: [
      "cross_host_redirect",
      "long_redirect_chain",
      "redirect_to_error",
      "too_many_redirects",
      "redirect_loop",
    ],
  },
  {
    id: "protection",
    label: "防護限制",
    reasons: ["blocked_waf", "blocked_bot", "suspected_false_positive"],
  },
];

const RISK_REASON_GROUP_BY_REASON = new Map(
  RISK_REASON_GROUPS.flatMap((group) => group.reasons.map((reason) => [reason, group.id])),
);

const RISK_REASON_LABELS = new Map([
  ["blocked_domain", "封鎖名單"],
  ["watchlisted_domain", "觀察名單"],
  ["allowed_domain", "白名單"],
  ["trusted_domain", "可信任網域"],
  ["shortener", "短網址"],
  ["tracking_or_analytics", "追蹤/分析服務"],
  ["tracking_query", "追蹤參數"],
  ["form", "外部表單"],
  ["embedded_content", "外部嵌入內容"],
  ["download", "下載連結"],
  ["social", "社群平台"],
  ["cdn", "CDN / 外部資源"],
  ["maps", "地圖服務"],
  ["webmail", "Webmail"],
  ["asset", "外部素材/程式資源"],
  ["media", "媒體連結"],
  ["repeated_reference", "多處引用"],
  ["external_http_error", "外部 HTTP 錯誤"],
  ["access_denied", "拒絕存取"],
  ["rate_limited", "請求頻率限制"],
  ["cross_host_redirect", "跨網域轉址"],
  ["long_redirect_chain", "轉址鏈過長"],
  ["redirect_to_error", "轉址後錯誤"],
  ["too_many_redirects", "轉址次數過多"],
  ["redirect_loop", "轉址循環"],
  ["blocked_waf", "WAF / 網站防護阻擋"],
  ["blocked_bot", "Bot challenge / 自動檢查阻擋"],
  ["suspected_false_positive", "疑似防護頁或誤判"],
]);

let currentAnalysis = null;
let ut1Categories = [];
let appliedUt1Rules = [];
let linkListState = {
  key: "",
  visibleCount: LINK_LIST_INITIAL_COUNT,
};

function startSessionHeartbeat() {
  const send = async () => {
    const token = await sessionTokenPromise;
    if (!token) {
      return;
    }
    return fetch("/api/session/heartbeat", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: {
        [sessionHeaderName]: token,
      },
    }).catch(() => {});
  };

  send();
  setInterval(send, 30000);
  window.addEventListener("pagehide", send);
}

async function loadSessionToken() {
  const response = await fetch("/api/session", { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.sessionToken) {
    throw new Error(data.error || "Unable to load local GUI session");
  }
  return data.sessionToken;
}

pickLinksButton.addEventListener("click", () => {
  linksFileInput.click();
});

linksFileInput.addEventListener("change", () => {
  const file = linksFileInput.files?.[0];
  if (!file) {
    currentAnalysis = null;
    resetLinkListState();
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
    analyzeButton.disabled = true;
    setFileStatus(null);
    setImportFlow("select", "尚未載入外部連結清單");
    setImportEmptyStateVisible(true);
    return;
  }
  currentAnalysis = null;
  resetLinkListState();
  exportJsonButton.disabled = true;
  exportCsvButton.disabled = true;
  analyzeButton.disabled = false;
  setImportEmptyStateVisible(true);
  const profile = getFileSizeProfile(file);
  setFileStatus(profile.message, profile.level);
  setImportFlow("analyze", `已選擇 ${file.name}（${formatBytes(file.size)}），下一步按「載入並分析」`);
});

for (const input of [searchInput, riskFilterInput, governanceFilterInput, highRiskInput, mediumRiskInput, trustedDomainsInput]) {
  input.addEventListener("input", () => {
    if (currentAnalysis) {
      resetLinkListState();
      currentAnalysis = analyze(currentAnalysis.links, currentAnalysis.ruleIndex);
      renderAnalysis(currentAnalysis);
    }
  });
}

ut1FolderInput.addEventListener("change", async () => {
  const selectedFiles = [...ut1FolderInput.files];
  await loadUt1Files(selectedFiles);
});

ut1PickerButton.addEventListener("click", async () => {
  try {
    if (!window.showDirectoryPicker) {
      throw new Error("此瀏覽器不支援遞迴資料夾選擇器，請改用上方資料夾欄位或 Chrome/Edge");
    }
    const handle = await window.showDirectoryPicker({ mode: "read" });
    const files = await readDirectoryHandle(handle);
    await loadUt1Files(files);
  } catch (error) {
    ut1State.textContent = error.message;
  }
});

ut1SearchInput.addEventListener("input", renderUt1Categories);
ut1MinDomainsInput.addEventListener("input", renderUt1Categories);

ut1CategoryTable.addEventListener("change", (event) => {
  const checkbox = event.target.closest("input[type='checkbox'][data-category]");
  if (!checkbox) {
    return;
  }
  const category = ut1Categories.find((item) => item.category === checkbox.dataset.category);
  if (category) {
    category.selected = checkbox.checked;
    updateUt1State();
  }
});

ut1CommonButton.addEventListener("click", () => {
  applyUt1Preset(UT1_COMMON_CATEGORIES);
  renderUt1Categories();
});

ut1SecurityButton.addEventListener("click", () => {
  applyUt1Preset(UT1_SECURITY_CATEGORIES);
  renderUt1Categories();
});

ut1SelectAllButton.addEventListener("click", () => {
  for (const category of ut1Categories) {
    category.selected = true;
  }
  renderUt1Categories();
});

ut1ClearButton.addEventListener("click", () => {
  for (const category of ut1Categories) {
    category.selected = false;
  }
  renderUt1Categories();
});

ut1ApplyButton.addEventListener("click", () => {
  try {
    const payload = buildUt1RulesPayload();
    appliedUt1Rules = payload.rules;
    rulesFileInput.value = "";
    if (currentAnalysis) {
      const ruleIndex = buildCombinedRuleIndex([]);
      resetLinkListState();
      currentAnalysis = analyze(currentAnalysis.links, ruleIndex);
      renderAnalysis(currentAnalysis);
    }
    ut1State.textContent = `已套用 ${payload.ruleCount} 個 UT1 分類，${payload.domainCount} 個網域`;
  } catch (error) {
    ut1State.textContent = error.message;
  }
});

ut1DownloadButton.addEventListener("click", () => {
  try {
    const payload = buildUt1RulesPayload();
    downloadText("ut1-rules.json", `${JSON.stringify(payload, null, 2)}\n`, "application/json");
    ut1State.textContent = `已產生 ${payload.ruleCount} 個分類，${payload.domainCount} 個網域`;
  } catch (error) {
    ut1State.textContent = error.message;
  }
});

analyzeButton.addEventListener("click", async () => {
  try {
    analyzeButton.disabled = true;
    const file = linksFileInput.files?.[0];
    if (file) {
      const profile = getFileSizeProfile(file);
      setFileStatus(profile.message, profile.level);
      setImportFlow("analyze", `正在載入並分析 ${file.name}（${formatBytes(file.size)}）`);
    } else {
      setImportFlow("analyze", "正在載入並分析");
    }
    await yieldToBrowser();
    const links = await loadLinksFile();
    const ruleIndex = await loadRulesFile();
    resetLinkListState();
    currentAnalysis = analyze(links, ruleIndex);
    renderAnalysis(currentAnalysis);
    exportJsonButton.disabled = false;
    exportCsvButton.disabled = false;
    analyzeButton.disabled = false;
    if (file) {
      setFileStatus(`${file.name} 已分析，大小 ${formatBytes(file.size)}。`, "ok");
    }
    setImportFlow("export", `${getAnalysisStatusText(currentAnalysis)}；可匯出目前篩選結果`);
  } catch (error) {
    currentAnalysis = null;
    analyzeButton.disabled = !linksFileInput.files?.[0];
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
    setFileStatus(error.message, "error");
    setImportEmptyStateVisible(true);
    setImportFlow("analyze", "載入或分析失敗");
  }
});

exportJsonButton.addEventListener("click", () => {
  if (!currentAnalysis) {
    return;
  }
  downloadText("external-analysis.json", `${JSON.stringify(makeFilteredExport(currentAnalysis), null, 2)}\n`, "application/json");
});

exportCsvButton.addEventListener("click", () => {
  if (!currentAnalysis) {
    return;
  }
  downloadText("external-analysis.csv", makeAnalysisCsv(currentAnalysis.filteredLinks), "text/csv");
});

async function loadLinksFile() {
  const file = linksFileInput.files?.[0];
  if (!file) {
    throw new Error("請先選擇 external-links.csv、external-links.ndjson 或 report.json");
  }

  try {
    const text = await file.text();
    const name = file.name.toLowerCase();
    if (name.endsWith(".ndjson")) {
      try {
        return normalizeLinksFromNdjson(parseNdjsonContent(text), file);
      } catch (error) {
        throw makeImportError("ndjson", error, file);
      }
    }
    if (name.endsWith(".json")) {
      try {
        return normalizeLinksFromJson(JSON.parse(text));
      } catch (error) {
        throw makeImportError("json", error, file);
      }
    }

    try {
      return normalizeLinksFromCsv(parseCsv(text));
    } catch (error) {
      throw makeImportError("csv", error, file);
    }
  } catch (error) {
    if (error.isImportError) {
      throw error;
    }
    throw makeImportError("read", error, file);
  }
}

async function loadRulesFile() {
  const file = rulesFileInput.files?.[0];
  if (!file) {
    return buildCombinedRuleIndex([]);
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    throw makeImportError("rules", error, file);
  }
  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  return buildCombinedRuleIndex(rules || []);
}

function getFileSizeProfile(file) {
  if (file.size >= FILE_SIZE_LARGE_BYTES) {
    return {
      level: "warn",
      message: `${file.name} 大小 ${formatBytes(file.size)}，瀏覽器載入與分析可能會停頓。若是 GUI log 目錄輸出，建議優先使用 external-links.csv 或 external-links.ndjson。`,
    };
  }
  if (file.size >= FILE_SIZE_WARN_BYTES) {
    return {
      level: "warn",
      message: `${file.name} 大小 ${formatBytes(file.size)}，載入與分析可能需要一點時間。`,
    };
  }
  return {
    level: "ok",
    message: `${file.name} 大小 ${formatBytes(file.size)}，可直接載入並分析。`,
  };
}

function makeImportError(kind, error, file) {
  let message;
  if (error instanceof RangeError || /allocation|memory|out of memory|maximum/i.test(error.message || "")) {
    message = `${file.name} 太大，瀏覽器可能無法一次處理。請改用 external-links.csv / external-links.ndjson，或先縮小報告範圍。`;
  } else if (kind === "ndjson") {
    message = `${file.name} 不是可解析的 external-links.ndjson；請確認檔案是一行一筆 JSON object，且來源為 GUI log 目錄的 external-links.ndjson。${error.message}`;
  } else if (kind === "json" && error instanceof SyntaxError) {
    message = `${file.name} 不是可解析的 JSON；請確認檔案是完整 report.json 或含 externalLinks 的 JSON。`;
  } else if (kind === "csv") {
    message = `${file.name} 不是可解析的 external-links.csv；請確認第一列欄位與檔案內容完整。`;
  } else if (kind === "rules" && error instanceof SyntaxError) {
    message = `${file.name} 不是可解析的分類規則 JSON；請確認規則檔格式完整。`;
  } else {
    message = `讀取 ${file.name} 失敗：${error.message}`;
  }
  const importError = new Error(message);
  importError.isImportError = true;
  return importError;
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

function buildCombinedRuleIndex(rules) {
  return buildRuleIndex([
    ...(Array.isArray(rules) ? rules : []),
    ...appliedUt1Rules,
  ]);
}

async function loadUt1Files(files) {
  try {
    setUt1Busy(true);
    ut1State.textContent = "讀取 UT1 資料夾中";
    ut1Categories = await readUt1Categories(files);
    applyUt1Preset(UT1_COMMON_CATEGORIES);
    renderUt1Categories();
    setUt1ControlsEnabled(ut1Categories.length > 0);
    ut1State.textContent = `${ut1Categories.length} 個分類可用`;
  } catch (error) {
    ut1Categories = [];
    renderUt1Categories();
    setUt1ControlsEnabled(false);
    ut1State.textContent = error.message;
  } finally {
    setUt1Busy(false);
  }
}

async function readDirectoryHandle(handle, prefix = handle.name) {
  const files = [];
  for await (const entry of handle.values()) {
    const path = `${prefix}/${entry.name}`;
    if (entry.kind === "directory") {
      files.push(...await readDirectoryHandle(entry, path));
      continue;
    }
    if (entry.kind === "file") {
      const file = await entry.getFile();
      files.push({
        name: file.name,
        relativePath: path,
        webkitRelativePath: path,
        text: () => file.text(),
      });
    }
  }
  return files;
}

async function readUt1Categories(files) {
  if (files.length === 0) {
    throw new Error("沒有讀到任何檔案，請選擇 UT1 解壓後的 blacklists 資料夾");
  }

  const domainFiles = files
    .map((file) => ({
      file,
      category: getUt1CategoryName(file),
    }))
    .filter((item) => item.category);

  if (domainFiles.length === 0) {
    const examples = files
      .slice(0, 5)
      .map(getFilePathForDisplay)
      .join(" | ");
    throw new Error(`找不到 UT1 分類底下的 domains 檔案；已讀取 ${files.length} 個檔案，路徑範例：${examples || "無"}`);
  }

  const categories = [];
  for (const item of domainFiles) {
    const domains = parseUt1Domains(await item.file.text());
    if (domains.length === 0) {
      continue;
    }
    categories.push({
      category: item.category,
      domains,
      selected: UT1_COMMON_CATEGORIES.has(item.category),
    });
  }

  if (categories.length === 0) {
    throw new Error(`找到 ${domainFiles.length} 個 domains 檔案，但沒有有效網域資料`);
  }

  return categories.sort((a, b) => a.category.localeCompare(b.category));
}

function getUt1CategoryName(file) {
  const path = getFilePathForDisplay(file);
  const parts = path.split(/[\\/]/).filter(Boolean);
  const domainsIndex = parts.findLastIndex((part) => normalizeFileName(part) === "domains");
  if (domainsIndex <= 0) {
    return "";
  }
  return parts[domainsIndex - 1];
}

function getFilePathForDisplay(file) {
  return file.webkitRelativePath || file.relativePath || file.name || "";
}

function normalizeFileName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.txt$/, "");
}

function parseUt1Domains(text) {
  const domains = new Set();
  for (const line of text.split(/\r?\n/)) {
    const domain = normalizeUt1Domain(line);
    if (domain) {
      domains.add(domain);
    }
  }
  return [...domains].sort();
}

function normalizeUt1Domain(value) {
  const domain = String(value || "").trim().toLowerCase();
  if (!domain || domain.startsWith("#")) {
    return "";
  }
  if (domain.includes("/") || domain.includes("*") || domain.includes(" ")) {
    return "";
  }
  return domain.replace(/^\.+/, "").replace(/\.$/, "");
}

function renderUt1Categories() {
  const visible = filterUt1Categories();
  if (ut1Categories.length === 0) {
    ut1CategoryTable.innerHTML = '<tr class="empty-row"><td colspan="3">選擇 UT1 blacklists 資料夾後會顯示分類。</td></tr>';
    return;
  }
  if (visible.length === 0) {
    ut1CategoryTable.innerHTML = '<tr class="empty-row"><td colspan="3">沒有符合條件的 UT1 分類。</td></tr>';
    updateUt1State();
    return;
  }

  ut1CategoryTable.replaceChildren(...visible.map((item) => {
    const row = document.createElement("tr");
    const include = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.category = item.category;
    checkbox.checked = item.selected;
    include.append(checkbox);
    row.append(
      include,
      textCell(item.category),
      textCell(item.domains.length),
    );
    return row;
  }));
  updateUt1State();
}

function filterUt1Categories() {
  const query = ut1SearchInput.value.trim().toLowerCase();
  const minDomains = Math.max(1, Number.parseInt(ut1MinDomainsInput.value, 10) || 1);
  return ut1Categories.filter((item) => (
    item.domains.length >= minDomains
    && (!query || item.category.toLowerCase().includes(query))
  ));
}

function applyUt1Preset(preset) {
  for (const category of ut1Categories) {
    category.selected = preset.has(category.category);
  }
}

function buildUt1RulesPayload() {
  const selected = ut1Categories.filter((item) => item.selected);
  if (selected.length === 0) {
    throw new Error("請至少選擇一個 UT1 分類");
  }
  const rules = selected.map((item) => ({
    category: item.category,
    domains: item.domains,
  }));
  return {
    source: "UT1",
    generatedAt: new Date().toISOString(),
    ruleCount: rules.length,
    domainCount: rules.reduce((total, rule) => total + rule.domains.length, 0),
    rules,
  };
}

function updateUt1State() {
  const selected = ut1Categories.filter((item) => item.selected);
  const domainCount = selected.reduce((total, item) => total + item.domains.length, 0);
  ut1State.textContent = `${selected.length} / ${ut1Categories.length} 個分類已選，${domainCount} 個網域`;
}

function setUt1ControlsEnabled(enabled) {
  for (const button of [
    ut1CommonButton,
    ut1SecurityButton,
    ut1SelectAllButton,
    ut1ClearButton,
    ut1ApplyButton,
    ut1DownloadButton,
  ]) {
    button.disabled = !enabled;
  }
}

function setUt1Busy(busy) {
  ut1PickerButton.disabled = busy;
  for (const button of [
    ut1CommonButton,
    ut1SecurityButton,
    ut1SelectAllButton,
    ut1ClearButton,
    ut1ApplyButton,
    ut1DownloadButton,
  ]) {
    button.disabled = busy || ut1Categories.length === 0;
  }
}

function normalizeLinksFromJson(value) {
  const items = Array.isArray(value) ? value : value.externalLinks;
  if (!Array.isArray(items)) {
    throw new Error("JSON 內找不到 externalLinks");
  }
  return dedupeLinks(items.map(normalizeLink).filter((item) => item.url));
}

function normalizeLinksFromNdjson(items, file = null) {
  if (!Array.isArray(items)) {
    throw new Error("NDJSON 格式不正確");
  }
  if (items.length === 0) {
    return [];
  }
  const links = dedupeLinks(items.map(normalizeLink).filter((item) => item.url));
  if (links.length === 0) {
    const fileName = file?.name ? `${file.name} ` : "";
    throw new Error(`${fileName}沒有讀到外部連結資料；請確認來源是 GUI log 目錄的 external-links.ndjson。`);
  }
  return links;
}

function normalizeLinksFromCsv(rows) {
  if (rows.length < 1) {
    throw new Error("CSV 沒有表頭列");
  }

  const headers = rows[0].map((item) => item.trim());
  if (rows.length === 1) {
    return [];
  }

  return dedupeLinks(rows.slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])))
    .map(normalizeLink)
    .filter((item) => item.url));
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

function dedupeLinks(links) {
  const byUrl = new Map();
  for (const link of links) {
    if (!byUrl.has(link.url)) {
      byUrl.set(link.url, {
        ...link,
        sourcePages: new Set(link.sourcePage ? [link.sourcePage] : []),
        categories: new Set(link.categories || []),
        sourceCount: Number(link.sourceCount) || (link.sourcePage ? 1 : 0),
      });
      continue;
    }
    const existing = byUrl.get(link.url);
    if (link.sourcePage) {
      existing.sourcePages.add(link.sourcePage);
    }
    for (const category of link.categories || []) {
      existing.categories.add(category);
    }
    existing.sourceCount = Math.max(
      Number(existing.sourceCount) || 0,
      Number(link.sourceCount) || existing.sourcePages.size,
    );
    existing.externalRisk = highestExternalRisk([existing.externalRisk, link.externalRisk]);
  }

  return [...byUrl.values()].map((item) => ({
    ...item,
    sourcePage: [...item.sourcePages].join("; "),
    sourcePages: undefined,
    categories: [...item.categories],
    sourceCount: Number(item.sourceCount) || item.sourcePages.size,
  }));
}

function normalizeLink(item) {
  const url = item.url || "";
  let parsed = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }

  const categories = Array.isArray(item.categories)
    ? item.categories
    : splitList(item.categories || "");
  const sources = Array.isArray(item.sources) ? item.sources : [];
  return {
    url,
    hostname: item.hostname || parsed?.hostname || "",
    registrableDomain: item.registrableDomain || item.domain || item.hostname || parsed?.hostname || "",
    type: item.type || "unknown",
    categories,
    externalRisk: normalizeExternalRisk(item),
    sourceCount: Number(item.sourceCount) || sources.length || 0,
    checked: parseBoolean(item.checked),
    ok: item.ok === "" || item.ok === null || item.ok === undefined ? null : parseBoolean(item.ok),
    status: item.status || "",
    method: item.method || "",
    finalUrl: item.finalUrl || "",
    sourcePage: item.sourcePage || item.page || firstSourcePage(sources),
    tag: item.tag || firstSourceValue(sources, "tag"),
    attribute: item.attribute || firstSourceValue(sources, "attribute"),
    text: item.text || firstSourceValue(sources, "text"),
  };
}

function normalizeExternalRisk(item) {
  const risk = item.externalRisk && typeof item.externalRisk === "object"
    ? item.externalRisk
    : null;
  const riskLevel = normalizeRiskLevel(risk?.riskLevel || item.riskLevel || item.risk || "");
  const governanceStatus = normalizeGovernanceStatus(risk?.governanceStatus || item.governanceStatus || "");
  const riskReasons = Array.isArray(risk?.riskReasons)
    ? risk.riskReasons
    : splitList(risk?.riskReasons || item.riskReasons || "");
  const matchedRules = Array.isArray(risk?.matchedRules)
    ? risk.matchedRules
    : splitList(risk?.matchedRules || item.matchedRules || "");
  const hasRisk = risk || riskLevel || governanceStatus || riskReasons.length > 0 || matchedRules.length > 0;
  if (!hasRisk) {
    return null;
  }
  return {
    riskLevel: riskLevel || "info",
    riskReasons,
    governanceStatus: governanceStatus || "unknown",
    matchedRules,
    needsReview: parseBoolean(risk?.needsReview ?? item.needsReview),
  };
}

function firstSourcePage(sources) {
  return Array.isArray(sources) && sources[0] ? sources[0].page || "" : "";
}

function firstSourceValue(sources, key) {
  return Array.isArray(sources) && sources[0] ? sources[0][key] || "" : "";
}

function buildRuleIndex(rules) {
  const index = new Map();
  for (const rule of rules) {
    const category = String(rule.category || "").trim();
    const domains = Array.isArray(rule.domains) ? rule.domains : [];
    if (!category || domains.length === 0) {
      continue;
    }
    for (const domain of domains) {
      const normalized = normalizeDomain(domain);
      if (!normalized) {
        continue;
      }
      if (!index.has(normalized)) {
        index.set(normalized, new Set());
      }
      index.get(normalized).add(category);
    }
  }
  return index;
}

function analyze(links, ruleIndex) {
  const highRisk = new Set(splitList(highRiskInput.value));
  const mediumRisk = new Set(splitList(mediumRiskInput.value));
  const trustedDomains = new Set(splitLines(trustedDomainsInput.value).map(normalizeDomain).filter(Boolean));

  const enriched = links.map((link) => {
    const ruleCategories = findRuleCategories(link.hostname || link.registrableDomain, ruleIndex);
    const categories = [...new Set([...link.categories, ...ruleCategories])].filter(Boolean);
    const reportRisk = link.externalRisk;
    const trusted = reportRisk?.governanceStatus === "allowed"
      || isTrusted(link.hostname, trustedDomains)
      || isTrusted(link.registrableDomain, trustedDomains);
    const sensitive = isSensitiveLink(link);
    const fallbackRisk = trusted
      ? {
          riskLevel: "info",
          riskReasons: ["trusted_domain"],
          governanceStatus: "allowed",
          matchedRules: [],
          needsReview: false,
        }
      : categories.some((category) => highRisk.has(category))
        ? buildFallbackRisk("high", "needs_review", ["high_risk_category"])
        : categories.some((category) => mediumRisk.has(category)) || sensitive
          ? buildFallbackRisk("medium", "needs_review", [sensitive ? "sensitive_link" : "medium_risk_category"])
          : categories.length === 0
            ? buildFallbackRisk("info", "unknown", ["uncategorized"])
            : buildFallbackRisk("low", "unknown", ["categorized"]);
    const externalRisk = reportRisk || fallbackRisk;
    return {
      ...link,
      categories,
      externalRisk,
      risk: externalRisk.riskLevel,
      governanceStatus: externalRisk.governanceStatus,
      riskReasons: externalRisk.riskReasons,
      needsReview: externalRisk.needsReview,
      trusted,
      sensitive,
    };
  });

  const filteredLinks = filterLinks(enriched);
  const domains = summarizeDomains(filteredLinks);
  const categories = summarizeCategories(filteredLinks);
  const metrics = {
    links: enriched.length,
    domains: summarizeDomains(enriched).length,
    high: enriched.filter((item) => item.risk === "high").length,
    medium: enriched.filter((item) => item.needsReview || item.governanceStatus === "needs_review").length,
    uncategorized: enriched.filter((item) => item.governanceStatus === "unknown" && item.risk === "info").length,
    sensitive: enriched.filter((item) => item.sensitive).length,
  };

  return {
    links,
    ruleIndex,
    enriched,
    filteredLinks,
    domains,
    categories,
    metrics,
    exportable: {
      generatedAt: new Date().toISOString(),
      metrics,
      domains,
      links: enriched,
    },
  };
}

function buildFallbackRisk(riskLevel, governanceStatus, riskReasons) {
  return {
    riskLevel,
    riskReasons,
    governanceStatus,
    matchedRules: [],
    needsReview: riskLevel === "high" || riskLevel === "medium" || governanceStatus === "needs_review",
  };
}

function findRuleCategories(hostname, ruleIndex) {
  const labels = normalizeDomain(hostname).split(".");
  const categories = new Set();
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join(".");
    for (const category of ruleIndex.get(candidate) || []) {
      categories.add(category);
    }
  }
  return [...categories];
}

function filterLinks(links) {
  const query = searchInput.value.trim().toLowerCase();
  const risk = riskFilterInput.value;
  const governance = governanceFilterInput.value;
  return links.filter((item) => {
    if (risk !== "all" && item.risk !== risk) {
      return false;
    }
    if (governance !== "all" && item.governanceStatus !== governance) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      item.url,
      item.hostname,
      item.registrableDomain,
      item.type,
      item.categories.join(" "),
      item.riskReasons.join(" "),
      item.governanceStatus,
      item.sourcePage,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function summarizeDomains(links) {
  const domains = new Map();
  for (const link of links) {
    const domain = link.registrableDomain || link.hostname || "";
    if (!domain) {
      continue;
    }
    if (!domains.has(domain)) {
      domains.set(domain, {
        domain,
        linkCount: 0,
        risks: new Set(),
        governanceStatuses: new Set(),
        needsReview: false,
        types: new Set(),
        categories: new Set(),
      });
    }
    const item = domains.get(domain);
    item.linkCount += 1;
    item.risks.add(link.risk);
    item.governanceStatuses.add(link.governanceStatus || "unknown");
    item.needsReview = item.needsReview || Boolean(link.needsReview);
    item.types.add(link.type || "unknown");
    for (const category of link.categories || []) {
      item.categories.add(category);
    }
  }

  return [...domains.values()]
    .map((item) => ({
      domain: item.domain,
      linkCount: item.linkCount,
      risk: highestRisk([...item.risks]),
      governanceStatuses: [...item.governanceStatuses].sort(),
      needsReview: item.needsReview,
      types: [...item.types].sort(),
      categories: [...item.categories].sort(),
    }))
    .sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || b.linkCount - a.linkCount || a.domain.localeCompare(b.domain));
}

function summarizeCategories(links) {
  const counts = new Map();
  for (const link of links) {
    const categories = link.categories.length ? link.categories : ["uncategorized"];
    for (const category of categories) {
      counts.set(category, (counts.get(category) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

function renderAnalysis(analysis) {
  setImportEmptyStateVisible(false);
  metricLinks.textContent = analysis.metrics.links;
  metricDomains.textContent = analysis.metrics.domains;
  metricHigh.textContent = analysis.metrics.high;
  metricMedium.textContent = analysis.metrics.medium;
  metricUncategorized.textContent = analysis.metrics.uncategorized;
  metricSensitive.textContent = analysis.metrics.sensitive;

  domainSummaryCount.textContent = `${analysis.domains.length} 個網域`;
  linksSummary.textContent = `${analysis.filteredLinks.length} / ${analysis.enriched.length} 筆`;
  categorySummaryCount.textContent = `${analysis.categories.length} 個分類`;

  renderDomainTable(analysis.domains);
  renderCategoryList(analysis.categories);
  renderLinksTable(analysis.filteredLinks);
}

function setImportEmptyStateVisible(isVisible) {
  document.body.classList.toggle("is-empty", isVisible);
  if (!importEmptyState) {
    return;
  }
  importEmptyState.hidden = !isVisible;
}

function setImportFlow(stage, message) {
  loadState.textContent = message;
  const states = {
    select: ["active", "", ""],
    analyze: ["done", "active", ""],
    export: ["done", "done", "active"],
  }[stage] || ["active", "", ""];
  [flowSelect, flowAnalyze, flowExport].forEach((item, index) => {
    if (!item) {
      return;
    }
    item.classList.remove("active", "done");
    if (states[index]) {
      item.classList.add(states[index]);
    }
  });
}

function getAnalysisStatusText(analysis) {
  const total = analysis.enriched.length;
  const uncategorized = analysis.metrics.uncategorized;
  if (total > 0 && uncategorized / total >= 0.5) {
    return `${total} 筆外部連結已分析；目前多數外部連結未分類，載入分類規則可改善風險判斷`;
  }
  return `${total} 筆外部連結已分析`;
}

function makeFilteredExport(analysis) {
  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      ...analysis.metrics,
      filteredLinks: analysis.filteredLinks.length,
      filteredDomains: analysis.domains.length,
      filteredCategories: analysis.categories.length,
    },
    domains: analysis.domains,
    links: analysis.filteredLinks,
  };
}

function renderDomainTable(domains) {
  if (domains.length === 0) {
    domainTable.innerHTML = '<tr class="empty-row"><td colspan="6">沒有符合條件的網域。</td></tr>';
    return;
  }

  domainTable.replaceChildren(...domains.slice(0, 300).map((item) => {
    const row = document.createElement("tr");
    row.append(
      cell(riskBadge(item.risk)),
      cell(governanceBadge(highestGovernanceStatus(item.governanceStatuses), { needsReview: item.needsReview })),
      textCell(item.domain),
      textCell(item.linkCount),
      textCell(item.types.join(", ")),
      textCell(item.categories.join(", ") || "uncategorized"),
    );
    return row;
  }));
}

function renderCategoryList(categories) {
  if (categories.length === 0) {
    categoryList.innerHTML = '<p class="empty-note">沒有符合條件的分類。</p>';
    return;
  }

  categoryList.replaceChildren(...categories.slice(0, 80).map((item) => {
    const row = document.createElement("div");
    row.className = "category-item";
    const label = document.createElement("strong");
    label.textContent = item.category;
    const count = document.createElement("span");
    count.textContent = `${item.count} 筆`;
    row.append(label, count);
    return row;
  }));
}

function renderLinksTable(links) {
  if (links.length === 0) {
    linksTable.innerHTML = '<p class="empty-note link-empty">沒有符合條件的外部連結。</p>';
    return;
  }

  const sortedLinks = sortLinksForDisplay(links);
  const key = getLinkListKey(links);
  if (linkListState.key !== key) {
    linkListState = {
      key,
      visibleCount: LINK_LIST_INITIAL_COUNT,
    };
  }
  const visibleCount = Math.min(linkListState.visibleCount, sortedLinks.length);
  const visibleLinks = sortedLinks.slice(0, visibleCount);
  linksTable.replaceChildren(...visibleLinks.map(renderLinkItem));
  if (sortedLinks.length > visibleLinks.length) {
    linksTable.append(renderLoadMoreControl({
      shown: visibleLinks.length,
      total: sortedLinks.length,
      onLoadMore: () => {
        linkListState.visibleCount += LINK_LIST_INCREMENT;
        renderLinksTable(links);
      },
    }));
  }
}

function resetLinkListState() {
  linkListState = {
    key: "",
    visibleCount: LINK_LIST_INITIAL_COUNT,
  };
}

function getLinkListKey(links) {
  return [
    searchInput.value.trim().toLowerCase(),
    riskFilterInput.value,
    governanceFilterInput.value,
    links.length,
  ].join("\u0001");
}

function renderLoadMoreControl({ shown, total, onLoadMore }) {
  const wrapper = document.createElement("div");
  wrapper.className = "list-pagination";

  const note = document.createElement("p");
  note.className = "list-limit-note";
  note.textContent = `目前顯示 ${shown} / ${total} 筆。`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "load-more-button";
  button.textContent = "載入更多";
  button.addEventListener("click", onLoadMore);

  wrapper.append(note, button);
  return wrapper;
}

function renderLinkItem(item) {
  const row = document.createElement("article");
  row.className = "link-item";

  const header = document.createElement("div");
  header.className = "link-item-header";
  const domain = document.createElement("strong");
  domain.textContent = item.registrableDomain || item.hostname || "unknown domain";
  header.append(
    riskBadge(item.risk),
    governanceBadge(item.governanceStatus, { needsReview: item.needsReview }),
    linkStatusBadge(item),
    domain,
    metaBadge(item.type || "unknown"),
    metaBadge(item.categories.join(", ") || "uncategorized"),
  );

  row.append(
    header,
    detailLine("URL", item.url),
    detailLineNode("風險原因", renderRiskReasonGroups(item.riskReasons)),
    detailLine("來源頁", item.sourcePage || "無來源頁"),
  );
  if (item.sourceCount > 1) {
    row.append(detailLine("引用次數", item.sourceCount));
  }
  return row;
}

function sortLinksForDisplay(links) {
  return [...links].sort((a, b) => (
    riskRank(a.risk) - riskRank(b.risk)
    || governanceRank(a.governanceStatus) - governanceRank(b.governanceStatus)
    || String(a.registrableDomain || a.hostname || "").localeCompare(String(b.registrableDomain || b.hostname || ""))
    || String(a.sourcePage || "").localeCompare(String(b.sourcePage || ""))
    || String(a.url || "").localeCompare(String(b.url || ""))
  ));
}

function linkStatusBadge(item) {
  const span = document.createElement("span");
  const status = item.status ? `HTTP ${item.status}` : "";
  if (!item.checked) {
    span.className = "status-badge unchecked";
    span.textContent = "未檢查";
    return span;
  }
  if (item.ok === false) {
    span.className = "status-badge failed";
    span.textContent = status || "檢查失敗";
    return span;
  }
  if (item.ok !== true) {
    span.className = "status-badge unchecked";
    span.textContent = status || "已檢查";
    return span;
  }
  span.className = "status-badge ok";
  span.textContent = status || "已檢查";
  return span;
}

function detailLine(label, value) {
  const row = document.createElement("div");
  row.className = "link-detail-line";
  const labelElement = document.createElement("span");
  labelElement.className = "detail-label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "detail-value";
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  return row;
}

function detailLineNode(label, valueNode) {
  const row = document.createElement("div");
  row.className = "link-detail-line";
  const labelElement = document.createElement("span");
  labelElement.className = "detail-label";
  labelElement.textContent = label;
  const valueElement = document.createElement("span");
  valueElement.className = "detail-value";
  valueElement.append(valueNode);
  row.append(labelElement, valueElement);
  return row;
}

function renderRiskReasonGroups(reasons = []) {
  const groups = groupRiskReasons(reasons);
  if (groups.length === 0) {
    const empty = document.createElement("span");
    empty.className = "reason-empty";
    empty.textContent = "無";
    return empty;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "reason-groups";
  for (const group of groups) {
    const section = document.createElement("div");
    section.className = "reason-group";

    const label = document.createElement("span");
    label.className = "reason-group-label";
    label.textContent = group.label;

    const chips = document.createElement("span");
    chips.className = "reason-chip-list";
    for (const reason of group.reasons) {
      chips.append(reasonChip(reason));
    }

    section.append(label, chips);
    wrapper.append(section);
  }
  return wrapper;
}

function groupRiskReasons(reasons = []) {
  const uniqueReasons = [...new Set(reasons.filter(Boolean))];
  const groupsById = new Map(RISK_REASON_GROUPS.map((group) => [
    group.id,
    { id: group.id, label: group.label, reasons: [] },
  ]));
  const otherGroup = { id: "other", label: "其他原因", reasons: [] };

  for (const reason of uniqueReasons) {
    const groupId = RISK_REASON_GROUP_BY_REASON.get(reason);
    if (groupId && groupsById.has(groupId)) {
      groupsById.get(groupId).reasons.push(reason);
    } else {
      otherGroup.reasons.push(reason);
    }
  }

  const orderedGroups = RISK_REASON_GROUPS
    .map((group) => groupsById.get(group.id))
    .filter((group) => group.reasons.length > 0);
  if (otherGroup.reasons.length > 0) {
    orderedGroups.push(otherGroup);
  }
  return orderedGroups;
}

function reasonChip(reason) {
  const span = document.createElement("span");
  span.className = "reason-chip";
  span.textContent = RISK_REASON_LABELS.get(reason) || reason;
  span.title = reason;
  return span;
}

function metaBadge(value) {
  const span = document.createElement("span");
  span.className = "meta-badge";
  span.textContent = value;
  return span;
}

function riskBadge(risk) {
  const labels = {
    high: "高風險",
    medium: "需檢視",
    low: "一般",
    info: "資訊",
  };
  const span = document.createElement("span");
  span.className = `risk ${risk}`;
  span.textContent = labels[risk] || risk;
  return span;
}

function governanceBadge(status, { needsReview = false } = {}) {
  const labels = {
    allowed: "白名單",
    blocked: "黑名單",
    watchlisted: "觀察",
    needs_review: "需確認",
    unknown: "未知",
  };
  const isAllowedNeedsReview = status === "allowed" && needsReview;
  const span = document.createElement("span");
  span.className = `governance ${status || "unknown"}${isAllowedNeedsReview ? " needs-review" : ""}`;
  span.textContent = isAllowedNeedsReview ? "白名單需檢視" : labels[status] || status || "未知";
  return span;
}

function cell(child) {
  const td = document.createElement("td");
  td.append(child);
  return td;
}

function textCell(value) {
  const td = document.createElement("td");
  td.textContent = String(value ?? "");
  return td;
}

function highestRisk(risks) {
  return risks.sort((a, b) => riskRank(a) - riskRank(b))[0] || "low";
}

function highestExternalRisk(risks) {
  return risks
    .filter(Boolean)
    .sort((a, b) => riskRank(a.riskLevel) - riskRank(b.riskLevel))[0] || null;
}

function normalizeRiskLevel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["high", "medium", "low", "info"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "trusted" || normalized === "uncategorized") {
    return "info";
  }
  return "";
}

function normalizeGovernanceStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["allowed", "blocked", "watchlisted", "unknown", "needs_review"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "trusted" || normalized === "allowlisted") {
    return "allowed";
  }
  return "";
}

function riskRank(risk) {
  return {
    high: 0,
    medium: 1,
    low: 2,
    info: 3,
  }[risk] ?? 9;
}

function governanceRank(status) {
  return {
    blocked: 0,
    watchlisted: 1,
    needs_review: 2,
    unknown: 3,
    allowed: 4,
  }[status] ?? 9;
}

function highestGovernanceStatus(statuses) {
  return [...statuses].sort((a, b) => governanceRank(a) - governanceRank(b))[0] || "unknown";
}

function isSensitiveLink(link) {
  return link.type === "form"
    || link.type === "embedded_content"
    || (link.type === "asset" && ["script", "iframe", "object", "embed"].includes(link.tag));
}

function isTrusted(hostname, trustedDomains) {
  const domain = normalizeDomain(hostname);
  if (!domain) {
    return false;
  }
  for (const trusted of trustedDomains) {
    if (domain === trusted || domain.endsWith(`.${trusted}`)) {
      return true;
    }
  }
  return false;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === "\"") {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }

  if (rows[0]?.[0]?.charCodeAt(0) === 0xFEFF) {
    rows[0][0] = rows[0][0].slice(1);
  }
  return rows.filter((item) => item.some((value) => value.trim()));
}

function makeAnalysisCsv(links) {
  const rows = [[
    "riskLevel",
    "riskReasons",
    "governanceStatus",
    "matchedRules",
    "needsReview",
    "sourceCount",
    "url",
    "hostname",
    "registrableDomain",
    "type",
    "categories",
    "checked",
    "ok",
    "status",
    "sourcePage",
  ]];
  for (const link of links) {
    rows.push([
      link.risk,
      link.riskReasons.join(";"),
      link.governanceStatus,
      formatMatchedRules(link.externalRisk?.matchedRules || []),
      link.needsReview ? "yes" : "no",
      link.sourceCount || "",
      link.url,
      link.hostname,
      link.registrableDomain,
      link.type,
      link.categories.join(";"),
      link.checked ? "yes" : "no",
      link.ok === null ? "" : link.ok ? "yes" : "no",
      link.status,
      link.sourcePage,
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
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

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function parseBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return ["true", "yes", "1"].includes(String(value || "").trim().toLowerCase());
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
}
