# codex-prewalk

Prewalk for Codex: use a frontier model for repository exploration, planning, and the first implementation edit, then continue the **same trajectory** with a faster/cheaper model.

Based on [Stencil's Prewalk](https://stencil.so/blog/prewalk), `pi-prewalk`, and the implementation upstreamed to `oh-my-pi`.

## Why

A normal planner/executor split throws away the useful part of planning: the actual trajectory. The executor receives prose, then re-reads the same files and rediscovers the same constraints.

Prewalk instead lets the planner explore, build a compact todo list, and make one high-confidence edit. At that boundary the executor inherits the same thread: repository reads, tool outputs, plan state, reasoning context visible to the harness, and the first working implementation pattern.

## How this Codex implementation works

Codex plugin hooks can observe tool calls but do not expose a public operation for changing the active model mid-turn. `codex-prewalk` therefore uses Codex's own `app-server` protocol as a small orchestration layer.

The flow is:

1. Start a Codex thread on the planner model (default `gpt-5.6-sol`).
2. Add the Prewalk nudge as turn-scoped developer instructions.
3. Wait until Codex emits a non-empty `turn/plan/updated` event.
4. Wait for the first successful `fileChange` item.
5. Interrupt the planner turn immediately after that edit lands.
6. Start an **empty-input turn on the same thread** with the executor model (default `gpt-5.6-luna`).
7. Continue until the executor finishes the task and validations.

Using turn-scoped developer instructions means the planner-only nudge is not inserted into the user's task text. The executor gets its own continuation instructions instead of being told to keep planning.

## Usage

From the installed plugin, invoke the `prewalk` skill/command with the task. The underlying script can also be run directly:

```bash
node scripts/prewalk.mjs \
  --planner gpt-5.6-sol \
  --executor gpt-5.6-luna \
  "fix the failing auth refresh tests"
```

Options:

```text
--planner <model>          default: gpt-5.6-sol
--executor <model>         default: gpt-5.6-luna
--planner-effort <level>   default: high
--executor-effort <level>  default: medium
--cwd <path>               default: current directory
```

The same defaults can be configured with `CODEX_PREWALK_PLANNER`, `CODEX_PREWALK_EXECUTOR`, `CODEX_PREWALK_PLANNER_EFFORT`, and `CODEX_PREWALK_EXECUTOR_EFFORT`.

## Requirements

- A current Codex CLI with `codex app-server` and per-turn model overrides.
- Authentication/configuration for both selected models.
- Node.js 18+.

The nested task runs with Codex `workspaceWrite` sandboxing and does not grant extra filesystem/network permissions.

## Difference from the Pi implementation

Pi exposes a direct in-process `setModel` API, so `pi-prewalk` can switch the active model inside one running agent turn. Codex does not expose that operation to plugin hooks today. This implementation reaches the same practical boundary through app-server: interrupt immediately after the first successful edit, then issue an empty-input continuation on the same persisted thread with the executor model.

That adds one turn boundary, but avoids the important failure mode of `/plan`: there is no prose-plan handoff and no fresh executor thread.
