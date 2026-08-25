# Maintenance Foundation Record - 2026-08-25

## Purpose

MAINT-FND-1 and MAINT-FND-2 completed maintenance work to improve regression consistency and formal-release safety without changing product behavior, report schema, version, build output, tags, or GitHub Release state.

## MAINT-FND-1 - Unified Regression Runner

- status = COMPLETE
- commit = `6b6c6365b95e8a8097ed332a6dbe784448ea313d`
- canonical entry point = `scripts/run-tests.ps1`
- root-level `test-*.mjs` discovery is deterministic and owned by the runner
- final known regression = 30 / 30 PASS

## MAINT-FND-2 - Release Fail-Fast Automation

- status = COMPLETE
- commit = `46dcf9cb3904ba8386c46cdb6e7f3fa92a0a81fd`

Final release model:

```text
AUTOMATED PRECHECK
-> MANUAL PUBLICATION
-> AUTOMATED VERIFY
```

Major accepted behavior:

- preflight nonzero = hard publication stop
- publication remains manual
- post-publication verify is read-only
- fetch does not auto-follow or create local release tags
- native stderr alone is not treated as process failure
- no automatic tag, GitHub Release, or asset publication
- no product version, schema, or runtime behavior change

Validation summary:

- preflight focused and full validation accepted
- verifier validation accepted
- final regression = 30 / 30 PASS
- main integration = PASS
- remote verification = PASS

## Final State

- main = `46dcf9cb3904ba8386c46cdb6e7f3fa92a0a81fd`
- latest formal release = `v1.3.0`
- maintenance foundation = COMPLETE
- product direction = Static Discovery Resilience / real-site compatibility
