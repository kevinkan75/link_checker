Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P0-03 — Unified Discovery Ingestion Refactor

## Objective

Extract the existing `processPage()` link-ingestion loop into a reusable method such as `ingestDiscoveredLinks()` with **zero intentional scanning-behavior change**.

## Source anchors

Current `link-checker.mjs` has `processPage()` performing resolve -> source -> inventory -> validation -> page queue directly. Existing `addSource()` deduplicates source provenance and `addInventoryItem()` owns inventory merge behavior.

## In scope

Refactor the code path that currently performs:

```text
resolve
source construction
addSource
isExternal / shouldCheck / shouldCrawl
addInventoryItem
addExternalLink
schedule/enqueue validation
enqueue crawl page
```

Static HTML and framework/payload links must call the shared ingestion path.

## Out of scope

- No `playwright-core`.
- No DynamicRenderer.
- No new CLI flags.
- No report schema changes.
- No intended sourceType changes.
- No behavior cleanup unrelated to the extraction.

## Expected touch points

Primary:

- `link-checker.mjs`

Tests:

- existing relevant `test-*.mjs`
- add a narrowly targeted regression test if current coverage does not prove behavior parity.

## Must preserve

- URL resolution/fallback semantics.
- canonicalization.
- source deduplication.
- external inventory behavior.
- shouldCheck / shouldCrawl decisions.
- validation scheduling/defer-pump behavior.
- page queue depth behavior.
- SPA payload and site-rule discovery behavior.
- existing report semantics.

## Acceptance criteria

- `processPage()` no longer contains a duplicated full ingestion loop.
- Existing static and SPA/framework links enter the same extracted method.
- No Browser dependency exists after this task.
- Existing report/regression tests show no unintended semantic difference.
- Static fixture behavior is unchanged.

## Validation

Run:

- syntax gate;
- all `test-*.mjs`;
- P0 fixture tests;
- existing report snapshot/normalization checks where available.

## Required completion evidence

- Before/after responsibility summary for `processPage()`.
- New method signature and inputs/outputs.
- Tests proving no behavior change.
- Any edge case intentionally left unchanged.

## Stop conditions

If the extraction requires changing canonicalization, validation truth, crawl policy, or report schema, stop and report; that is outside a behavior-preserving refactor.

## Suggested commit message

`refactor: extract discovered link ingestion`
