---
name: prewalk
description: Use when the user wants a coding task executed with a strong planner model first and a faster/cheaper executor model after the first successful implementation edit.
argument-hint: "<task>"
---

# Prewalk

Run the bundled Prewalk orchestrator for `$ARGUMENTS`.

Resolve this skill directory to its real path first (the user install may be a symlink under `~/.agents/skills/prewalk`). From the resolved skill directory, the repository root is two directories up and the orchestrator is:

```bash
node "<repo-root>/scripts/prewalk.mjs" --cwd "$PWD" "$ARGUMENTS"
```

## Behavior

The orchestrator:

1. Starts a fresh Codex app-server thread on the planner model.
2. Supplies the Prewalk planning nudge as turn-scoped developer instructions.
3. Requires the planner to inspect the repository, establish a compact plan/todo list, and begin implementation.
4. Watches `turn/plan/updated` and successful `fileChange` events.
5. If the planner finishes a turn before the first edit lands, continues the planner on the same thread with an implementation nudge (up to the configured continuation limit).
6. Once a plan exists and the first successful file edit lands, interrupts the planner turn.
7. Starts an empty-input continuation turn on the same thread with the executor model.
8. Lets the executor finish implementation and validation from the inherited trajectory.

If the planner never reaches the plan + successful-edit boundary within the continuation limit, the orchestrator exits non-zero instead of treating the run as successful.

## Defaults

- planner: `gpt-5.6-sol`
- executor: `gpt-5.6-luna`
- planner effort: `high`
- executor effort: `medium`
- planner continuations: `3`

Environment overrides: `CODEX_PREWALK_PLANNER`, `CODEX_PREWALK_EXECUTOR`, `CODEX_PREWALK_PLANNER_EFFORT`, `CODEX_PREWALK_EXECUTOR_EFFORT`, and `CODEX_PREWALK_PLANNER_CONTINUATIONS`.

## Constraints

- Do not replace this with ordinary Plan mode; Prewalk must preserve the same Codex thread trajectory and the planner's first edit.
- Do not continue the task yourself in the parent turn after the nested run succeeds.
- The nested Codex thread uses the `workspace-write` sandbox with `approvalPolicy: never`.
- If Codex app-server is unavailable or the orchestrator exits non-zero, report the error clearly instead of silently re-running the task outside Prewalk.
