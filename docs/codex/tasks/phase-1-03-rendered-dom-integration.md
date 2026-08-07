Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-03 — Rendered DOM Discovery Integration

## Objective

Prove the central Feasibility Spike: runtime DOM URLs discovered by Browser rendering flow through the existing extractor, unified ingestion, inventory, and existing HTTP validator without changing HTTP truth.

## Depends on

P0-03 unified ingestion + P1-02 lifecycle.

## In scope

Add first-use CLI/internal options as specified by the master plan:

```text
--dynamic-render
--render-browser <auto|msedge|chrome>
--render-timeout <ms>
--render-concurrency <n>
--render-max-pages <n>
```

Development defaults:

```text
dynamicRender = false
renderBrowser = auto
renderConcurrency = 1
renderTimeoutMs = 15000
renderMaxPages = 25
```

Implement render eligibility only for already-successful same-origin page-like HTML pages.

Render flow:

```text
page.goto(... domcontentloaded)
-> minimum settle floor
-> bounded URL-attribute signature stability
-> page.content()
-> challenge/size guard
-> getDocumentBaseUrl(renderedHtml, page.url())
-> existing extractLinks()
-> override sourceType to rendered_dom
-> existing ingestDiscoveredLinks()
-> existing inventory / HTTP validation
```

Development settle values:

```text
renderSettleMinMs = 1000
renderSettleIntervalMs = 250
renderSettleStableSamples = 3
renderSettleMaxMs = 2500
```

Settle max reached after successful navigation should preserve current DOM as partial evidence (`rendered_unsettled`) instead of discarding it.

## Out of scope

- No final schema bump/contract; Phase 3 owns that.
- No GUI.
- No automatic render recommendation/fallback.
- No browser cache.
- No unsafe HTTP methods.
- No authenticated browsing.

Compact discovery provenance may be produced for spike evidence, but do not claim the formal report schema is finalized in this task.

## Acceptance criteria

- `csr-basic` URL absent from static HTML is found when Dynamic Render is enabled.
- Same URL is validated by existing Node HTTP checker, not Browser status.
- `duplicate-link` merges into existing canonical inventory and retains both provenance types.
- `runtime-base-url` resolves according to runtime `<base>` / `page.url()` contract.
- `csr-delayed` is found using bounded settle.
- Dynamic Render disabled preserves existing behavior/output semantics.
- No Browser attempt occurs for 403/TLS/security-blocked/non-HTML/bodyless pages.

## Validation

Run syntax + all tests + core fixture integration.

Browser-dependent integration is `LOCAL_FIXTURE_PASS` where a supported browser exists; otherwise report `ENV_BLOCKED` for actual Browser execution and retain unit-level tests.

## Required completion evidence

- Static-vs-dynamic discovery comparison.
- Inventory count/provenance evidence.
- HTTP validation proof for a `rendered_dom` URL.
- Duplicate merge evidence.
- Runtime base URL expected vs actual.

## Suggested commit message

`feat: add rendered dom discovery spike`
