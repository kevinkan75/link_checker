#!/usr/bin/env node

import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    input: null,
    output: null,
    include: null,
    exclude: new Set(),
    minDomains: 1,
    pretty: false,
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }
    if (arg === "--input") {
      options.input = args.shift();
      continue;
    }
    if (arg === "--output") {
      options.output = args.shift();
      continue;
    }
    if (arg === "--include") {
      options.include = new Set(splitList(args.shift()));
      continue;
    }
    if (arg === "--exclude") {
      options.exclude = new Set(splitList(args.shift()));
      continue;
    }
    if (arg === "--min-domains") {
      options.minDomains = readPositiveInteger(args.shift(), "--min-domains");
      continue;
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!options.input) {
    throw new Error("Missing --input");
  }
  if (!options.output) {
    throw new Error("Missing --output");
  }
  return options;
}

async function convertUt1Rules(options) {
  const categories = await findCategoryDirs(options.input);
  const rules = [];

  for (const category of categories) {
    if (options.include && !options.include.has(category.name)) {
      continue;
    }
    if (options.exclude.has(category.name)) {
      continue;
    }

    const domains = await readDomainsFile(join(category.path, "domains"));
    if (domains.length < options.minDomains) {
      continue;
    }
    rules.push({
      category: category.name,
      domains,
    });
  }

  const payload = {
    source: "UT1",
    generatedAt: new Date().toISOString(),
    input: options.input,
    ruleCount: rules.length,
    domainCount: rules.reduce((total, rule) => total + rule.domains.length, 0),
    rules,
  };

  const json = options.pretty
    ? `${JSON.stringify(payload, null, 2)}\n`
    : `${JSON.stringify(payload)}\n`;
  await writeFile(options.output, json, "utf8");
  return payload;
}

async function findCategoryDirs(inputDir) {
  const entries = await readdir(inputDir, { withFileTypes: true });
  const categories = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const path = join(inputDir, entry.name);
    try {
      const info = await stat(join(path, "domains"));
      if (info.isFile()) {
        categories.push({ name: entry.name, path });
      }
    } catch {
      // Categories without a domains file are not useful for domain classification.
    }
  }
  return categories.sort((a, b) => a.name.localeCompare(b.name));
}

async function readDomainsFile(path) {
  const text = await readFile(path, "utf8");
  const domains = new Set();
  for (const line of text.split(/\r?\n/)) {
    const domain = normalizeDomain(line);
    if (domain) {
      domains.add(domain);
    }
  }
  return [...domains].sort();
}

function normalizeDomain(value) {
  const trimmed = String(value || "").trim().toLowerCase();
  if (!trimmed || trimmed.startsWith("#")) {
    return "";
  }
  if (trimmed.includes("/") || trimmed.includes("*") || trimmed.includes(" ")) {
    return "";
  }
  return trimmed.replace(/^\.+/, "").replace(/\.$/, "");
}

function splitList(value) {
  return String(value || "")
    .split(/[,\n;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPositiveInteger(value, name) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return number;
}

function printHelp() {
  console.log(`UT1 Rules Converter

Usage:
  node convert-ut1-rules.mjs --input <ut1-blacklists-folder> --output <rules.json> [options]

Options:
  --include <list>      Comma-separated categories to include.
  --exclude <list>      Comma-separated categories to exclude.
  --min-domains <n>     Skip categories with fewer domains. Default: 1.
  --pretty             Write formatted JSON.
  --help, -h           Show this help.

Example:
  node convert-ut1-rules.mjs --input .\\ut1-blacklists\\blacklists --output .\\ut1-rules.json --include social_networks,shortener,webmail,shopping,malware,phishing,vpn --pretty
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const payload = await convertUt1Rules(options);
  console.log(`Created ${options.output}`);
  console.log(`Rules: ${payload.ruleCount}`);
  console.log(`Domains: ${payload.domainCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
