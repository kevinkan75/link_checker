# AGENTS.md — Local Link Checker

## Purpose

This repository contains Local Link Checker, a local-only website link checking tool. For Dynamic Scan development, the authoritative product/architecture/security plan is:

`docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`

Codex should execute one task packet at a time from:

`docs/codex/tasks/`

Shared execution rules are in:

`docs/codex/DYNAMIC_SCAN_EXECUTION.md`

## Authority and conflict rules

When instructions conflict, use this order:

1. Accepted Architecture Decisions, Security Gates, and No-Go rules in `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`.
2. This `AGENTS.md`.
3. The current task packet.
4. General guidance in `docs/codex/DYNAMIC_SCAN_EXECUTION.md`.

An operator may narrow a task, but do not silently weaken an accepted security boundary.

## Product boundaries that must remain true

- Local Link Checker is a local auxiliary tool, not a centralized monitoring platform, CMS, scheduler, WAF bypass tool, or browser automation test platform.
- GUI server remains localhost-only (`127.0.0.1`).
- Dynamic Render is opt-in and default-off.
- Browser rendering is a discovery/evidence source only. Existing Node.js HTTP validation remains status truth.
- Do not use Browser rendering to rescue HTTP 403, WAF/bot challenge, CAPTCHA, TLS failure, security-blocked URL, or Node HTTP connection failure.
- Do not use an existing user browser profile, cookies, passwords, storage state, HTTP credentials, or login session.
- First release runtime is `playwright-core`; browser priority is `msedge` then `chrome`; do not bundle Chromium in Phase 0–6.
- Browser HTTP method policy is GET / HEAD / OPTIONS only. Do not enable POST/PUT/PATCH/DELETE/CONNECT/TRACE to improve coverage.
- WebSocket is blocked in the first release.
- Main-frame rendering must not leave the allowed crawl origin.
- Do not weaken private-IP / localhost / metadata / reserved-address protections to make tests pass.
- Do not save screenshot, trace, video, HAR, full rendered DOM dumps, request bodies, browser profile data, or credentials in reports/tests.

## Target audience rule

Default GUI behavior is designed for government website staff who may only follow an SOP and may not understand HTTP, SPA, CSR, JavaScript, Playwright, or browser automation.

Keep internal technical terms separate from user-facing terminology. The normal GUI term for Dynamic Render is:

`加強檢查動態網頁`

Do not expose internal Playwright errors as the primary user message. User-facing warnings must explain:

1. what happened;
2. what it affects;
3. what the user can do next.

## Work granularity

- Execute only the explicitly selected task packet.
- Do not implement the entire Phase or Sprint unless explicitly asked.
- Do not pull Phase 2+, GUI, packaging, auto-render, cache, authenticated browsing, or bundled-browser work into an earlier task.
- If a task exposes a new architectural/security question, stop at evidence + recommendation instead of silently choosing a new architecture.

## Open Questions

Never close an Open Question by assumption.

You may:

- add instrumentation;
- add fixtures;
- run tests;
- collect evidence;
- propose a conclusion.

You may not:

- mark an OQ closed without its required evidence;
- turn a Phase 2 security No-Go into a known limitation;
- change an Accepted Architecture Decision without an explicit operator decision.

## Repository discovery before editing

At the start of every task:

1. Read the selected task packet.
2. Read the relevant sections of `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`.
3. Inspect `git status --short` and current branch.
4. Inspect the repository layout and existing test/fixture conventions.
5. Inspect existing dependency manifests/lockfiles before adding package-management files.
6. Identify the smallest existing code path to modify.

Do not create parallel test infrastructure when an existing convention can be extended.

## Git behavior

Unless the operator explicitly asks for Git writes:

- do not switch branches;
- do not create branches;
- do not commit;
- do not push;
- do not merge;
- do not open or close pull requests;
- do not rewrite history.

It is acceptable to inspect status, branch, diff, and history.

Expected development branch is normally `feature/js-dynamic-scan`, but branch creation/selection is an operator responsibility unless explicitly delegated.

## Network testing safety

- Use controlled local fixtures by default.
- Do not test-scan arbitrary external sites, government sites, private networks, metadata endpoints, or third-party services unless the operator explicitly identifies an authorized target.
- SSRF tests should use controlled fixture mechanisms; never rely on probing real sensitive infrastructure.
- If a test requires unavailable network/DNS controls, report `ENV_BLOCKED` and describe the required environment.

## Validation baseline

Existing project conventions require:

- syntax checks for root `.mjs` and `public/*.js`;
- all `test-*.mjs` tests;
- localhost GUI HTTP smoke for `/`, `/analyzer.html`, `/report-analyzer.html` when GUI behavior is touched;
- portable manual/idle shutdown smoke when packaging/release work is touched.

Exact commands are defined/discovered in `docs/codex/DYNAMIC_SCAN_EXECUTION.md`. If the repository contains a more specific maintained test runner, prefer it and record the command used.

## Environment-dependent validation

Never fake PASS when the execution environment lacks a requirement. Use these evidence states:

- `AUTOMATED_PASS`
- `LOCAL_FIXTURE_PASS`
- `ENV_BLOCKED`
- `HUMAN_WINDOWS_REQUIRED`
- `HUMAN_USABILITY_REQUIRED`

Examples that may require an external environment: branded Edge/Chrome launch, Enterprise Group Policy behavior, Windows portable `.exe` smoke, and Persona A usability testing.

## Dependency rules

- Inspect existing `package.json` / lockfiles first.
- Do not invent a package manager if the repository already uses one.
- For `playwright-core`, pin the chosen dependency through the repository lockfile. Do not rely on an unrecorded floating `latest` dependency.
- Do not install/download a Playwright-managed browser for the first release design.
- Do not use arbitrary `executablePath` as the normal browser discovery path.

## Code-change principles

- Prefer the smallest change that satisfies the current task.
- Keep refactor-only commits/changes behavior-preserving.
- Reuse existing canonicalization, inventory, validation, crawl, security, reporting, and redaction logic.
- Do not duplicate link-ingestion logic for rendered DOM.
- Preserve existing report meaning unless the current task explicitly owns a schema change.
- Preserve sensitive-query redaction and sanitized diagnostics.

## Existing report contract before Phase 3

Treat the current production source/output as the baseline for already-shipped report behavior. Before Phase 3:

- Current production source is Local Link Checker `1.1.1`; current report schema is `1.3.0`.
- `checked[]` is the primary HTTP-result collection and does **not** currently contain full `sources[]`.
- `broken[]` is the failing subset of checked results plus source provenance such as `sourceCount`, `sourcesTruncated`, and `sources[]`.
- `externalLinks[]` remains a separate collection with its own `sources[]` and `externalRisk`; do not merge its governance semantics into `checked[]`.
- Root `securityPolicy` is existing production output and must be preserved, even if an older documentation summary omits it.
- Phase 0 must not add, remove, or rename report-schema fields.
- Dynamic Render must never change existing HTTP `ok`, `status`, `classification`, `issueType`, or confirmation truth.
- `report-diff.mjs` is supplementary compatibility/regression evidence, not a complete semantic-equivalence oracle. Behavior-preserving refactors must also assert inventory metrics and source provenance directly.
- Reports captured from live external websites may be used as compatibility/reference samples, but not as exact deterministic golden snapshots. Prefer controlled local or sanitized deterministic fixtures for golden regression evidence.

If maintained documentation and current production source/output disagree about an already-shipped field, preserve current production behavior and report the documentation drift instead of silently changing the runtime contract.

## Completion report

Every task response must contain:

### Summary
What changed and why.

### Files changed
Exact files and their purpose.

### Validation
Commands run, results, and evidence state.

### Acceptance criteria
Each criterion marked PASS / FAIL / ENV_BLOCKED / NOT_APPLICABLE.

### Open questions / risks
Any unresolved issue, including OQ impact.

### Scope check
Explicitly state whether anything outside the task packet was changed.

### Next task readiness
State whether the next task is ready, blocked, or requires human/environment verification.
