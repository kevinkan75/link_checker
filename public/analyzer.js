const linksFileInput = document.querySelector("#links-file");
const rulesFileInput = document.querySelector("#rules-file");
const searchInput = document.querySelector("#search");
const riskFilterInput = document.querySelector("#risk-filter");
const highRiskInput = document.querySelector("#high-risk-categories");
const mediumRiskInput = document.querySelector("#medium-risk-categories");
const trustedDomainsInput = document.querySelector("#trusted-domains");
const analyzeButton = document.querySelector("#analyze-button");
const exportJsonButton = document.querySelector("#export-json-button");
const exportCsvButton = document.querySelector("#export-csv-button");
const loadState = document.querySelector("#load-state");
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

let currentAnalysis = null;
let ut1Categories = [];
let appliedUt1Rules = [];

for (const input of [searchInput, riskFilterInput, highRiskInput, mediumRiskInput, trustedDomainsInput]) {
  input.addEventListener("input", () => {
    if (currentAnalysis) {
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
    loadState.textContent = "讀取中";
    const links = await loadLinksFile();
    const ruleIndex = await loadRulesFile();
    currentAnalysis = analyze(links, ruleIndex);
    renderAnalysis(currentAnalysis);
    exportJsonButton.disabled = false;
    exportCsvButton.disabled = false;
    loadState.textContent = `${links.length} 筆外連已分析`;
  } catch (error) {
    loadState.textContent = error.message;
    currentAnalysis = null;
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
  }
});

exportJsonButton.addEventListener("click", () => {
  if (!currentAnalysis) {
    return;
  }
  downloadText("external-analysis.json", `${JSON.stringify(currentAnalysis.exportable, null, 2)}\n`, "application/json");
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
    throw new Error("請先選擇 external-links.csv 或 report.json");
  }

  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    return normalizeLinksFromJson(JSON.parse(text));
  }

  return normalizeLinksFromCsv(parseCsv(text));
}

async function loadRulesFile() {
  const file = rulesFileInput.files?.[0];
  if (!file) {
    return buildCombinedRuleIndex([]);
  }

  const parsed = JSON.parse(await file.text());
  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  return buildCombinedRuleIndex(rules || []);
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

function normalizeLinksFromCsv(rows) {
  if (rows.length < 2) {
    throw new Error("CSV 沒有資料列");
  }

  const headers = rows[0].map((item) => item.trim());
  return dedupeLinks(rows.slice(1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])))
    .map(normalizeLink)
    .filter((item) => item.url));
}

function dedupeLinks(links) {
  const byUrl = new Map();
  for (const link of links) {
    if (!byUrl.has(link.url)) {
      byUrl.set(link.url, {
        ...link,
        sourcePages: new Set(link.sourcePage ? [link.sourcePage] : []),
        categories: new Set(link.categories || []),
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
  }

  return [...byUrl.values()].map((item) => ({
    ...item,
    sourcePage: [...item.sourcePages].join("; "),
    sourcePages: undefined,
    categories: [...item.categories],
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
  return {
    url,
    hostname: item.hostname || parsed?.hostname || "",
    registrableDomain: item.registrableDomain || item.domain || item.hostname || parsed?.hostname || "",
    type: item.type || "unknown",
    categories,
    checked: parseBoolean(item.checked),
    ok: item.ok === "" || item.ok === null || item.ok === undefined ? null : parseBoolean(item.ok),
    status: item.status || "",
    method: item.method || "",
    finalUrl: item.finalUrl || "",
    sourcePage: item.sourcePage || item.page || firstSourcePage(item.sources),
    tag: item.tag || firstSourceValue(item.sources, "tag"),
    attribute: item.attribute || firstSourceValue(item.sources, "attribute"),
    text: item.text || firstSourceValue(item.sources, "text"),
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
    const trusted = isTrusted(link.hostname, trustedDomains) || isTrusted(link.registrableDomain, trustedDomains);
    const sensitive = isSensitiveLink(link);
    const risk = trusted
      ? "trusted"
      : categories.some((category) => highRisk.has(category))
        ? "high"
        : categories.some((category) => mediumRisk.has(category)) || sensitive
          ? "medium"
          : categories.length === 0
            ? "uncategorized"
            : "low";
    return {
      ...link,
      categories,
      risk,
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
    medium: enriched.filter((item) => item.risk === "medium").length,
    uncategorized: enriched.filter((item) => item.risk === "uncategorized").length,
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
  return links.filter((item) => {
    if (risk !== "all" && item.risk !== risk) {
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
        types: new Set(),
        categories: new Set(),
      });
    }
    const item = domains.get(domain);
    item.linkCount += 1;
    item.risks.add(link.risk);
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

function renderDomainTable(domains) {
  if (domains.length === 0) {
    domainTable.innerHTML = '<tr class="empty-row"><td colspan="5">沒有符合條件的網域。</td></tr>';
    return;
  }

  domainTable.replaceChildren(...domains.slice(0, 300).map((item) => {
    const row = document.createElement("tr");
    row.append(
      cell(riskBadge(item.risk)),
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
    linksTable.innerHTML = '<tr class="empty-row"><td colspan="6">沒有符合條件的外連。</td></tr>';
    return;
  }

  linksTable.replaceChildren(...links.slice(0, 500).map((item) => {
    const row = document.createElement("tr");
    row.append(
      cell(riskBadge(item.risk)),
      textCell(item.url),
      textCell(item.registrableDomain || item.hostname),
      textCell(item.type || "unknown"),
      textCell(item.categories.join(", ") || "uncategorized"),
      textCell(item.sourcePage || ""),
    );
    return row;
  }));
}

function riskBadge(risk) {
  const labels = {
    high: "高風險",
    medium: "需檢視",
    low: "一般",
    trusted: "白名單",
    uncategorized: "未分類",
  };
  const span = document.createElement("span");
  span.className = `risk ${risk}`;
  span.textContent = labels[risk] || risk;
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

function riskRank(risk) {
  return {
    high: 0,
    medium: 1,
    uncategorized: 2,
    low: 3,
    trusted: 4,
  }[risk] ?? 9;
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
    "risk",
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
