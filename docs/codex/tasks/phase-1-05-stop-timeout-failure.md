Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-05 — Stop / Timeout / Failure Convergence

## Objective

Make Dynamic Render failures additive and bounded: user stop, timeout, Browser absence, launch failure, navigation failure, and unexpected close must converge without hanging the scan or leaving Browser processes/queued render jobs running.

## Depends on

P1-02 through P1-04.

## In scope

Implement/verify:

- `LinkChecker.stop()` requests DynamicRenderer stop;
- active Context/Page is closed promptly;
- queued limiter jobs check stop state before creating Context/Page;
- scan `run()` cleanup always closes Browser;
- hard per-page `renderTimeoutMs` covers setup/navigation/settle/content/extraction;
- navigation timeout vs hard render timeout diagnostics are distinguishable where practical;
- settle max produces `rendered_unsettled` partial evidence, not fatal failure;
- Browser unavailable / launch failed / unexpected close do not fail static scan;
- no infinite Browser relaunch loop;
- partial completed render diagnostics remain available.

## Out of scope

- GUI stop UX (Phase 4).
- Final report schema (Phase 3).
- Performance tuning (Phase 5).

## Acceptance criteria

- Stop during active render returns without waiting for full render timeout where Context close can interrupt it.
- No queued render starts after stop.
- Browser process closes at normal completion, error completion, and user stop.
- `render-timeout` fixture cannot hang the whole scan.
- Browser unavailable path completes static scan.
- Unexpected Browser close degrades later render attempts safely.
- Existing static regression remains green.

## Validation

- syntax + all tests;
- timeout fixture;
- stop-during-render fixture/test;
- queued-job stop test;
- unavailable/launch failure tests;
- actual orphan-process observation where environment permits.

If process-level observation cannot be made in Codex environment, mark that criterion `ENV_BLOCKED` and provide automated lifecycle evidence.

## Required completion evidence

- stop latency observation;
- queued-job count before/after stop;
- Browser/Context close counts;
- timeout outcome samples;
- static scan completion evidence after render failure.

## Suggested commit message

`feat: make dynamic render failures converge safely`
