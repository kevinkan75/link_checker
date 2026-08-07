Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-01 — playwright-core + BrowserProvider

## Objective

Introduce the formal `playwright-core` dependency and a minimal BrowserProvider spike that can attempt local branded Chromium channels in the accepted order without yet integrating rendered DOM discovery.

## Depends on

Phase 0 exit gate, especially P0-03.

## In scope

- Inspect current dependency/package-manager state.
- Add reproducible `playwright-core` dependency using the repo's existing package manager/lockfile.
- If no package metadata exists, add only the minimum required metadata and document that decision.
- Implement BrowserProvider abstraction.
- Channel order: `msedge` -> `chrome` for `auto`.
- Support explicit `auto`, `msedge`, `chrome` selection at the internal provider level.
- Implement stable provider outcomes sufficient to distinguish:
  - available;
  - not found when evidence is reliable;
  - launch failed;
  - unexpected close observation hook.
- Record browser channel/version when launch succeeds.

## Out of scope

- Do not download/bundle Playwright-managed Chromium.
- Do not use arbitrary `executablePath` as the normal flow.
- Do not use persistent/user browser profiles.
- Do not render pages into the crawler yet.
- Do not implement GUI.
- Do not finalize report schema.

## Expected touch points

- dependency manifest/lockfile discovered in the real repo;
- `link-checker.mjs` or a small new renderer/provider module if the existing project layout clearly supports it;
- targeted test file(s).

The first spike should not trigger a large module reorganization.

## BrowserProvider contract

Conceptual API:

```js
const result = await browserProvider.launchFirstAvailable({ browser: 'auto' });
```

Success result should expose at least:

```text
ok
browser
browserChannel
browserVersion
launchOutcome
```

Failure must be normalized and sanitized. Do not expose machine-specific executable paths in report-facing data.

## Acceptance criteria

- `playwright-core` is reproducibly declared/locked.
- No Playwright-managed browser is installed as part of repository source/release design.
- `auto` attempts Edge before Chrome.
- Browser absence/failure does not crash unrelated static functionality.
- Provider launch is ready to be used single-flight by the next task.
- OQ-1 remains open; this task only begins evidence collection.

## Validation

Always run syntax + all existing tests.

Where environment permits:

- attempt Edge launch;
- attempt Chrome fallback in a controllable setup;
- exercise unavailable/failure mapping.

If branded browsers are unavailable in the Codex environment, mark actual launch evidence `ENV_BLOCKED`; unit-test provider selection/mapping instead.

## Required completion evidence

- Package-manager state discovered.
- Exact `playwright-core` version/lock mechanism.
- Provider tests.
- Actual browser launch evidence or `ENV_BLOCKED`.
- OQ-1 status recommendation: still `collecting_evidence` or `provisionally_acceptable`, never closed here.

## Suggested commit message

`feat: add playwright-core browser provider`
