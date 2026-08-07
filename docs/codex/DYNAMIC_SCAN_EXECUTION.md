# Dynamic Scan — Codex Execution Guide

Status: active execution layer  
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`  
Task directory: `docs/codex/tasks/`

## 1. Purpose

This document converts the Dynamic Scan master plan into a repeatable coding-agent workflow. It does not replace architecture, security, UX, Open Question, or release decisions in the master plan.

Codex should receive **one task packet per task**. A Phase is not a single Codex task.

## 2. Execution sequence

Initial sequence:

```text
P0-01 Core Dynamic Fixtures
  -> P0-02 Risk / Boundary Fixtures
  -> P0-03 Unified Discovery Ingestion Refactor
  -> P1-01 playwright-core + BrowserProvider
  -> P1-02 DynamicRenderer Lifecycle
  -> P1-03 Rendered DOM Discovery Integration
  -> P1-04 Browser Boundary Hooks / Telemetry
  -> P1-05 Stop / Timeout / Failure Convergence
  -> P1-06 Phase 1 Evidence + Spike Decision
```

Do not skip a dependency unless the operator explicitly records why the later task can proceed safely.

## 3. Standard task start procedure

Before editing:

```text
1. Read AGENTS.md.
2. Read the current task packet.
3. Read only the relevant master-plan sections referenced by the task.
4. Inspect git status and branch.
5. Inspect existing files/tests/fixtures/dependency manifests.
6. State the intended minimal touch points.
7. Begin changes only after the scope is understood.
```

If the worktree contains unrelated user changes, preserve them. Do not revert them to obtain a clean baseline.

## 4. Repository facts currently established

Known from project documentation/source:

- CLI core: `link-checker.mjs` / `check-links.cmd`.
- GUI server: `gui-server.mjs` / `gui.cmd`.
- GUI frontend: `public/index.html`, `public/app.js`.
- External analyzer: `public/analyzer.js`.
- Report analyzer: `public/report-analyzer.js`.
- Portable builder: `build-portable.ps1`.
- Existing test convention: root `test-*.mjs`.
- GUI is local-only and binds `127.0.0.1`.
- Portable build command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

The supplied planning/source snapshot did **not** establish a current `package.json` or package-manager contract. Therefore dependency tasks must inspect the actual repo before deciding how manifests/lockfiles are handled.

## 5. Validation discovery

### 5.1 Syntax

Project convention: run `node --check` over root `.mjs` and `public/*.js`.

On POSIX-like Codex environments, one acceptable form is:

```bash
set -e
for f in ./*.mjs; do
  [ -f "$f" ] && node --check "$f"
done
for f in ./public/*.js; do
  [ -f "$f" ] && node --check "$f"
done
```

On PowerShell:

```powershell
$files = @()
$files += Get-ChildItem -File .\*.mjs -ErrorAction SilentlyContinue
$files += Get-ChildItem -File .\public\*.js -ErrorAction SilentlyContinue
foreach ($file in $files) {
  node --check $file.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

If the repo already provides a maintained syntax script, prefer that script and record it.

### 5.2 Regression tests

Project convention: run all root `test-*.mjs`.

POSIX-like environment:

```bash
set -e
for f in ./test-*.mjs; do
  [ -f "$f" ] || continue
  node "$f"
done
```

PowerShell:

```powershell
Get-ChildItem -File .\test-*.mjs | ForEach-Object {
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
```

If zero tests are discovered, report that fact; do not call the test gate PASS merely because the loop did nothing.

### 5.3 GUI smoke

When GUI code or its API is touched, verify the local server using HTTP requests, not a full browser automation test unless the task requires one.

Required pages:

```text
/
/analyzer.html
/report-analyzer.html
```

Start the server using the repository's maintained launcher/command. Prefer a short-lived run and use existing manual shutdown or `--idle-shutdown-ms`. Do not invent a new GUI start command if the actual repo exposes one.

Expected smoke evidence:

```text
server bound to 127.0.0.1
GET / -> success
GET /analyzer.html -> success
GET /report-analyzer.html -> success
server shuts down cleanly
```

### 5.4 Portable smoke

Only required when packaging/release files are in scope.

Build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-portable.ps1
```

Verify at minimum:

- clean rebuild rather than stale `dist` reuse;
- portable zip exists;
- external/package manifests exist;
- SHA256 matches actual zip;
- source commit metadata is correct;
- manual shutdown;
- idle shutdown;
- Dynamic Render release work later also covers Edge, Chrome fallback, and browser-unavailable cases.

If running outside Windows, mark Windows-only smoke `HUMAN_WINDOWS_REQUIRED` or `ENV_BLOCKED` rather than PASS.

## 6. Validation Environment Matrix

| Evidence | Codex automated | Controlled fixture | Windows/target environment | Human required |
| --- | --- | --- | --- | --- |
| Node syntax | Yes | No | No | No |
| Existing `test-*.mjs` | Yes | Sometimes | No | No |
| Dynamic HTML fixtures | Yes | Yes | No | No |
| BrowserProvider mocked/unit behavior | Yes | Yes | No | No |
| Actual Edge launch | Environment-dependent | No | Preferred | Sometimes |
| Chrome fallback | Environment-dependent | No | Preferred | Sometimes |
| No-browser graceful path | Yes where environment controllable | Yes | Useful | No |
| Enterprise Group Policy | No | No | Yes | Yes |
| Portable `.exe` | Usually no on Linux | No | Yes | Yes/review |
| DNS rebinding/TOCTOU security fixture | Environment-dependent | Yes | Specialized | Review |
| Persona A usability | No | No | Any suitable workstation | Yes |

## 7. Security test rule

Dynamic Scan is a network-capable feature. By default:

- use local controlled fixture servers;
- do not scan arbitrary public websites;
- do not probe real metadata/private endpoints;
- simulate SSRF-sensitive outcomes inside controlled fixtures where possible;
- never weaken the security policy just to create a passing fixture.

Phase 1 may create hooks and telemetry but **does not close OQ-3**. Phase 2 owns the formal DNS/SSRF Security Gate.

## 8. Dependency handling

Before P1-01:

```text
inspect package.json
inspect package-lock.json / npm-shrinkwrap / other lockfile
inspect build-portable.ps1 dependency-copy behavior
```

If package metadata already exists, follow it.

If package metadata does not exist, P1-01 may introduce the minimum metadata necessary to make `playwright-core` a reproducible formal dependency, but must:

- document the finding;
- avoid unrelated npm scripts/tooling migrations;
- pin through a lockfile;
- not download/bundle Playwright-managed Chromium;
- flag portable dependency copying as Phase 6 work unless the current task explicitly owns it.

## 9. Task acceptance states

Use only:

```text
PASS
FAIL
ENV_BLOCKED
NOT_APPLICABLE
```

For overall environment evidence, additionally tag:

```text
AUTOMATED_PASS
LOCAL_FIXTURE_PASS
HUMAN_WINDOWS_REQUIRED
HUMAN_USABILITY_REQUIRED
```

A missing environment never becomes PASS by inference.

## 10. Scope-control rules

When a task needs a prerequisite that is absent:

1. make the smallest prerequisite change if it is clearly inside the task intent;
2. otherwise stop and report `BLOCKED_BY_PREREQUISITE`;
3. do not absorb the next task/Phase to avoid the block.

Examples:

- P0-03 must not add Playwright.
- P1-01 must not implement GUI.
- P1-03 must not declare the report schema final.
- P1-04 must not declare OQ-3 closed.
- P1-06 must not proceed to Phase 2 implementation; it only records the Phase 1 decision.

## 11. Open Question handling

Codex output may say:

```text
Evidence suggests OQ-1 is provisionally acceptable.
```

It must not say:

```text
OQ-1 is closed.
```

unless the master plan's required Decision By evidence has actually been produced.

For OQ-3:

```text
PASS -> closed only at Phase 2 Security Gate
FAIL_CLOSED_BUT_FIXABLE -> blocked
REPRODUCIBLE_SSRF_BYPASS -> no_go
```

Do not downgrade a reproducible SSRF bypass to `closed_with_known_limitation`.

## 12. Standard completion report

Every task should finish with:

```text
Task: <ID / title>

Summary
- ...

Files changed
- path: purpose

Validation
- command: result
- evidence state: AUTOMATED_PASS / LOCAL_FIXTURE_PASS / ENV_BLOCKED / ...

Acceptance criteria
- [PASS] ...
- [ENV_BLOCKED] ...

Open Questions / risks
- OQ-x: evidence collected / unchanged / newly affected

Scope check
- Outside-scope changes: none | <explain>

Next task readiness
- READY | BLOCKED | HUMAN_VERIFICATION_REQUIRED
```

## 13. Task prompting pattern

Recommended operator prompt:

```text
Execute only docs/codex/tasks/<task-file>.md.
Follow AGENTS.md and docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md.
Do not perform Git writes unless explicitly requested.
Run all validation required by the task and return the standard completion report.
If required evidence cannot be produced in this environment, mark it ENV_BLOCKED instead of guessing.
```

This keeps the prompt lean; repo files carry durable context.
