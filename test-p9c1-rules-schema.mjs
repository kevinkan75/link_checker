#!/usr/bin/env node

import { readFileSync } from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function validate(schema, value, root = schema, path = "$") {
  if (schema.$ref) {
    return validate(resolveRef(root, schema.$ref), value, root, path);
  }

  if (schema.anyOf) {
    const matched = schema.anyOf.some((item) => validate(item, value, root, path).valid);
    if (!matched) {
      return fail(path, "did not match any allowed schema");
    }
  }

  if (schema.allOf) {
    for (const item of schema.allOf) {
      const result = validate(item, value, root, path);
      if (!result.valid) {
        return result;
      }
    }
  }

  if (schema.type && !matchesType(schema.type, value)) {
    return fail(path, `expected ${schema.type}`);
  }

  if (schema.enum && !schema.enum.includes(value)) {
    return fail(path, `expected one of ${schema.enum.join(", ")}`);
  }

  if (typeof schema.minLength === "number" && typeof value === "string" && value.length < schema.minLength) {
    return fail(path, `expected string length >= ${schema.minLength}`);
  }

  if (typeof schema.minItems === "number" && Array.isArray(value) && value.length < schema.minItems) {
    return fail(path, `expected array length >= ${schema.minItems}`);
  }

  if (typeof schema.minProperties === "number" && isPlainObject(value) && Object.keys(value).length < schema.minProperties) {
    return fail(path, `expected object property count >= ${schema.minProperties}`);
  }

  if (schema.required && isPlainObject(value)) {
    for (const property of schema.required) {
      if (!Object.hasOwn(value, property)) {
        return fail(`${path}.${property}`, "is required");
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const result = validate(schema.items, item, root, `${path}[${index}]`);
      if (!result.valid) {
        return result;
      }
    }
  }

  if (schema.properties && isPlainObject(value)) {
    for (const [property, propertySchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, property)) {
        const result = validate(propertySchema, value[property], root, `${path}.${property}`);
        if (!result.valid) {
          return result;
        }
      }
    }
  }

  if (schema.additionalProperties === false && isPlainObject(value)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const property of Object.keys(value)) {
      if (!allowed.has(property)) {
        return fail(`${path}.${property}`, "is not allowed");
      }
    }
  } else if (isPlainObject(schema.additionalProperties) && isPlainObject(value)) {
    const allowed = new Set(Object.keys(schema.properties || {}));
    for (const [property, item] of Object.entries(value)) {
      if (!allowed.has(property)) {
        const result = validate(schema.additionalProperties, item, root, `${path}.${property}`);
        if (!result.valid) {
          return result;
        }
      }
    }
  }

  return { valid: true };
}

function resolveRef(root, ref) {
  assert(ref.startsWith("#/"), `Unsupported schema ref: ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((current, part) => current?.[part], root);
}

function matchesType(type, value) {
  if (type === "array") {
    return Array.isArray(value);
  }
  if (type === "object") {
    return isPlainObject(value);
  }
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "integer") {
    return Number.isInteger(value);
  }
  return true;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function fail(path, message) {
  return {
    valid: false,
    error: `${path} ${message}`,
  };
}

function expectValid(schema, value, label) {
  const result = validate(schema, value);
  assert(result.valid, `${label} should be valid: ${result.error}`);
}

function expectInvalid(schema, value, label) {
  const result = validate(schema, value);
  assert(!result.valid, `${label} should be invalid`);
}

const domainRulesSchema = readJson("schemas/domain-rules.schema.json");
const externalRiskRulesSchema = readJson("schemas/external-risk-rules.schema.json");
const siteLinkRulesSchema = readJson("schemas/site-link-rules.schema.json");
const basicDomainRulesTemplate = readJson("docs/rules/basic-domain-rules.template.json");
const cecSiteLinkRules = readJson("docs/rules/cec-site-link-rules.json");

expectValid(domainRulesSchema, [
  { category: "government", domains: ["gov.tw", "example.gov.tw"] },
], "domain rules array");
expectValid(domainRulesSchema, {
  schemaVersion: "domain-rules.p9c1",
  rules: [{ category: "partner", domains: ["partner.example.com"], source: "fixture" }],
}, "domain rules object");
expectValid(domainRulesSchema, basicDomainRulesTemplate, "basic domain rules template");
expectInvalid(domainRulesSchema, [{ category: "empty", domains: [] }], "empty domain rules");

expectValid(externalRiskRulesSchema, {
  allowlist: [
    "trusted.example.com",
    { id: "partner", domains: ["partner.example.com"], label: "Partner" },
  ],
  blocklist: ["blocked.example.net"],
  watchlist: [{ id: "campaign", domain: "campaign.example.org" }],
}, "external risk bucket rules");
expectValid(externalRiskRulesSchema, {
  rules: [
    { action: "allow", domains: ["trusted.example.com"] },
    { governanceStatus: "blocked", hostname: "blocked.example.net" },
    { status: "watchlisted", entry: { host: "review.example.org" } },
  ],
}, "external risk explicit rules");
expectInvalid(externalRiskRulesSchema, { rules: [{ action: "allow" }] }, "external risk rule without domains");
expectInvalid(externalRiskRulesSchema, { rules: [{ action: "unknown", domains: ["example.com"] }] }, "external risk unknown action");

expectValid(siteLinkRulesSchema, {
  fields: {
    externalUrl: ["linkUrl", "url"],
    youtubeId: ["youtubeId"],
    routePath: ["path"],
  },
}, "site link field rules");
expectValid(siteLinkRulesSchema, cecSiteLinkRules, "CEC site link rules");
expectInvalid(siteLinkRulesSchema, {}, "empty site link rules");
expectInvalid(siteLinkRulesSchema, { routeMappings: [{ template: "/article/{id}", when: {} }] }, "route mapping without condition");

console.log("ok p9c1 rules schema");
