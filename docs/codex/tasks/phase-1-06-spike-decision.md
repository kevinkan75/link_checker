Status: READY
Master plan: `docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md`
Execution guide: `docs/codex/DYNAMIC_SCAN_EXECUTION.md`

# P1-06 — Phase 1 Evidence + Spike Decision

## Objective

Run the complete Phase 1 spike matrix, consolidate evidence, and issue exactly one decision:

```text
GO
ADJUST_AND_REPEAT
NO_GO
```

This task should make minimal/no production code changes except small test/diagnostic fixes needed to obtain valid Phase 1 evidence. It must not begin Phase 2 implementation.

## Depends on

P1-01 through P1-05.

## Required matrix

### Browser

- Edge launch: PASS / ENV_BLOCKED
- Chrome fallback: PASS / ENV_BLOCKED
- browser unavailable degradation
- lifecycle cleanup

### Discovery

- `csr-basic`
- `csr-delayed`
- duplicate merge
- runtime base URL

### Lifecycle

- stop during render
- queued render after stop
- hard timeout
- unexpected browser close

### Boundary observations

- unsafe method blocked
- WebSocket blocked
- main-frame cross-origin navigation blocked
- challenge links not ingested
- Browser request burst telemetry produced

### Regression

- Dynamic Render off preserves existing behavior
- all existing tests
- syntax gate

## Evidence output

Create/update a reviewable evidence file, preferred path:

`docs/codex/evidence/PHASE_1_SPIKE_RESULT.md`

If the repository uses a different evidence/archive convention, follow it and record the path.

Use this structure:

```text
Phase 1 Spike Result

Environment
Browser
Discovery
Lifecycle
Boundary observations
Observed performance/telemetry
Open / Next Gate
Decision
Rationale
Environment-blocked checks
```

At minimum include:

```text
browser launch elapsed
average render elapsed
rendered pages
new URLs discovered
browser requests/page
peak requests by host
```

## Decision rules

### GO

Use only if:

- Feasibility Spike passes;
- lifecycle/integration has no blocking defect;
- failures degrade safely;
- required Phase 2 risks are measurable;
- remaining environment-dependent checks are clearly identified and do not invalidate the technical direction.

### ADJUST_AND_REPEAT

Use if the architecture still looks viable but Phase 1 has fixable defects in lifecycle, integration, stop, URL resolution, diagnostics, or evidence quality. Name the exact task(s) to repeat.

### NO_GO

Use if Browser discovery cannot integrate reliably with existing inventory/HTTP truth, lifecycle cannot be bounded safely, or achieving the feature requires breaking accepted security/architecture boundaries.

## Open Question handling

- OQ-1 may become `provisionally_acceptable`, never fully closed in Phase 1.
- OQ-2 remains evidence collection / first conclusion due by Phase 2.
- OQ-3 remains open and must go through Phase 2 Security Gate.
- OQ-4/OQ-5/OQ-6 continue collecting evidence for Phase 5.

## Acceptance criteria

- Evidence file exists and distinguishes PASS from ENV_BLOCKED.
- No Windows/Enterprise/Persona check is falsely claimed as automated PASS.
- Decision is exactly GO, ADJUST_AND_REPEAT, or NO_GO.
- Rationale maps directly to the master-plan success/exit criteria.
- No Phase 2 implementation is included.

## Validation

Re-run the full syntax and existing test gates after the spike matrix. Record all commands and results in the evidence file.

## Required completion report

Return the standard completion report plus the final Spike Decision and evidence-file path.

## Suggested commit message

`test: record dynamic render phase 1 spike evidence`
