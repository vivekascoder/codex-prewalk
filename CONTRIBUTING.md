# Contributing

Thanks for contributing to codex-prewalk.

## Before opening a PR

1. Check existing issues and pull requests to avoid duplicate work.
2. Keep changes focused; prefer one behavior or fix per PR.
3. For app-server changes, verify the protocol against the current Codex implementation rather than relying on older examples.
4. Preserve the core Prewalk invariant: the planner must establish a plan and land the first successful edit before the executor takes over the same thread.

## Development

Requirements:

- Node.js 18+
- Git
- A current Codex CLI with `codex app-server`

Clone and validate:

```bash
git clone https://github.com/vivekascoder/codex-prewalk.git
cd codex-prewalk
npm run check
```

For runtime changes, test through the installed skill when possible:

```text
$prewalk <coding task>
```

Useful cases to exercise:

- planner plans and edits in the first turn
- planner plans, stops, then needs a continuation turn before editing
- planner fails to reach an edit boundary and exits clearly after the continuation limit
- executor receives the same thread after the first successful edit

## Pull requests

Include:

- what changed
- why it changed
- how you tested it
- any Codex/app-server version assumptions

Do not include generated files, local Codex state, credentials, or unrelated formatting changes.