Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-02 — DynamicRenderer Lifecycle

## Objective

Add the job-scoped Browser lifecycle without yet making rendered DOM links affect inventory.

## Depends on

P1-01 BrowserProvider.

## In scope

Implement:

- lazy Browser launch;
- single-flight launch across concurrent page workers;
- max one Browser instance per scan;
- fresh ephemeral BrowserContext per render job;
- one Page per Context;
- Context closed after each render job;
- Browser closed in the scan `run()` cleanup path;
- no automatic infinite relaunch after unexpected Browser close;
- separate `renderLimiter`, development default 1;
- Dynamic Render default-off plumbing sufficient for lifecycle tests.

BrowserContext defaults must include/prepare for:

```text
serviceWorkers = block
acceptDownloads = false
ignoreHTTPSErrors = false
no storageState
no HTTP credentials
no permission grants
```

Network routing policy itself is finalized in a later task/Phase; lifecycle must make it possible to install policy before Page creation.

## Out of scope

- No rendered link ingestion yet.
- No GUI.
- No final report schema.
- No request pacing solution.
- No OQ-3 closure.

## Expected touch points

- `link-checker.mjs` and/or the small provider/renderer module introduced by P1-01.
- targeted lifecycle tests.

## Acceptance criteria

- Dynamic Render disabled -> BrowserProvider is never launched.
- First eligible render request -> Browser launch happens once.
- Concurrent eligible requests do not create multiple Browser instances.
- Every render job receives a fresh Context.
- Contexts are closed after jobs.
- Scan completion/error closes Browser.
- Unexpected Browser close changes renderer state so later jobs degrade rather than relaunch indefinitely.
- Existing static scan remains unchanged when feature is off.

## Validation

- syntax + all tests;
- lifecycle unit/integration tests;
- local fixture lifecycle smoke where Browser environment exists.

Actual branded-browser lifecycle may be `ENV_BLOCKED`; mocked/provider-level lifecycle still must be automated.

## Required completion evidence

- launch-count evidence;
- Context create/close counts;
- Browser close evidence;
- feature-off proof that no Browser was launched.

## Suggested commit message

`feat: add dynamic renderer lifecycle`
