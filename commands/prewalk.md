---
description: Run a coding task with a Prewalk planner-to-executor handoff
argument-hint: "[--planner MODEL] [--executor MODEL] <task>"
allowed-tools: Bash(node:*)
---

Run the bundled Prewalk orchestrator for the user's task.

Resolve the plugin root in this order:
1. `${CODEX_PLUGIN_ROOT}` when it is set.
2. The plugin root containing this command file.

Then execute:

```bash
node "<plugin-root>/scripts/prewalk.mjs" $ARGUMENTS
```

Relay the orchestrator's final result. If it exits non-zero, report the error rather than silently re-running the task outside Prewalk.
