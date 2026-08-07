Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P0-01 — Core Dynamic Fixtures

## Objective

Create the minimum controlled fixture harness needed to prove static-vs-runtime DOM discovery differences without changing production scanning behavior.

## Read first

- Master plan: Phase 0 / fixture requirements; Phase 1 Feasibility Spike.
- Existing repository test and fixture conventions.

## Preconditions

- Worktree inspected and unrelated changes preserved.
- Existing `test-*.mjs` pattern inspected.

## In scope

Create or extend controlled local fixtures for:

- `static-html`
- `csr-basic`
- `csr-delayed`
- `duplicate-link`
- `runtime-base-url`

The fixtures must be deterministic and runnable without external websites.

If the repo has no fixture convention, preferred fallback is a clearly isolated directory such as `test-fixtures/dynamic-scan/`; document the choice rather than creating multiple competing structures.

## Out of scope

- Production crawler behavior changes.
- Playwright dependency.
- GUI changes.
- Report schema changes.
- Phase 2 SSRF conclusions.

## Expected touch points

- Existing test/fixture files, if present.
- New local fixture files/server helper only if no equivalent exists.
- Do not modify `link-checker.mjs` unless a test-only export is strictly necessary; if so, justify it.

## Fixture contract

### static-html
Contains normal `<a href>` links available in the initial response.

### csr-basic
Initial response does not contain the target link. JavaScript creates same-origin and external `<a>` links after load.

### csr-delayed
Target link appears after a deterministic short delay.

### duplicate-link
Same canonical URL is present in static HTML and later in runtime DOM.

### runtime-base-url
Exercises runtime URL resolution: history/location state and/or `<base>` changes followed by a relative link. Expected resolved URL must be explicit in the test.

## Acceptance criteria

- Fixtures run entirely under controlled local infrastructure.
- Static fixture remains discoverable by current static extraction.
- CSR target link is absent from raw response HTML and appears only after script execution.
- Delayed fixture timing is deterministic enough for bounded settle testing.
- Duplicate fixture has a known canonical expected URL.
- Runtime-base fixture has an explicit expected resolved URL.
- Existing production behavior remains unchanged.
- Existing tests still pass.

## Validation

Run syntax checks and all existing `test-*.mjs`. Run any new targeted fixture test.

If no browser is available, this task can still PASS because it only creates fixtures; browser execution belongs to Phase 1.

## Required completion evidence

- Fixture paths.
- How each fixture is started/accessed.
- Expected URLs for each fixture.
- Existing test results.
- Confirmation that no production scan behavior changed.

## Stop conditions

Stop and report if existing tests depend on a different fixture harness that cannot be safely extended without broader restructuring.

## Suggested commit message

`test: add core dynamic scan fixtures`
