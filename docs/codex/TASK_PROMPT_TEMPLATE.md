# Codex Task Prompt Template

Use this with exactly one task packet:

```text
Execute only docs/codex/tasks/<TASK_FILE>.md.
Follow AGENTS.md, docs/codex/DYNAMIC_SCAN_EXECUTION.md, and the accepted decisions/security gates in docs/JS_DYNAMIC_SCAN_PLAN_REVIEWED.md.
Do not perform Git writes unless explicitly requested.
Do not scan arbitrary external targets; use controlled fixtures unless I provide an authorized target.
Run all validation required by the task.
If required evidence cannot be produced in this environment, mark it ENV_BLOCKED rather than guessing.
Return the standard completion report from DYNAMIC_SCAN_EXECUTION.md.
```
