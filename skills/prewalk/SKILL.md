---
name: prewalk
description: Run a coding task with a strong planner first, then hand off the same Codex thread to a faster/cheaper executor after the first successful implementation edit. Invoke as $prewalk <task>.
---

# Prewalk

When invoked as `$prewalk <task>`, run the bundled `scripts/prewalk.mjs` orchestrator for the user's task instead of manually simulating the workflow in the current Codex turn.

## Behavior

The orchestrator:

1. Starts a fresh Codex app-server thread on the planner model.
2. Supplies the Prewalk planning nudge as **turn-scoped developer instructions**, not as the user's task text.
3. Requires the planner to inspect the repository, establish a compact plan/todo list, and begin implementation.
4. Watches `turn/plan/updated` and successful `fileChange` events.
5. Once a plan exists and the first successful file edit lands, interrupts the planner turn.
6. Starts an empty-input continuation turn on the **same thread** with the executor model and executor-only developer instructions.
7. Lets the executor finish implementation and validation from the inherited trajectory.

This deliberately hands off the trajectory rather than generating a prose plan for a second model to re-read.

## Run

Resolve the absolute plugin root from the known location of this `SKILL.md`. Prefer `${CODEX_PLUGIN_ROOT}` if the runtime provides it; otherwise walk two directories up from this skill directory.

Then run:

```bash
node "<plugin-root>/scripts/prewalk.mjs" \
  --planner gpt-5.6-sol \
  --executor gpt-5.6-luna \
  "<user task>"
```

Preserve the user's task text exactly when passing it to the orchestrator.

Optional flags:

- `--planner <model>`
- `--executor <model>`
- `--planner-effort <level>`
- `--executor-effort <level>`
- `--cwd <path>`

Environment defaults are also supported through `CODEX_PREWALK_PLANNER`, `CODEX_PREWALK_EXECUTOR`, `CODEX_PREWALK_PLANNER_EFFORT`, and `CODEX_PREWALK_EXECUTOR_EFFORT`.

## Constraints

- Do not replace this with ordinary Plan mode. Ordinary Plan mode hands a prose artifact to another model; Prewalk must preserve the same Codex thread trajectory and the planner's first edit.
- Do not continue the task yourself in the parent turn after the nested run succeeds.
- The nested Codex thread uses `workspaceWrite` plus `approvalPolicy: never`; it does not grant permissions outside the normal workspace sandbox.
- If Codex app-server is unavailable, report that requirement clearly.
