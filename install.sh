#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/vivekascoder/codex-prewalk.git"
PLUGIN_NAME="codex-prewalk"
PLUGIN_DIR="${CODEX_PREWALK_DIR:-$HOME/plugins/$PLUGIN_NAME}"
MARKETPLACE="${CODEX_MARKETPLACE_FILE:-$HOME/.agents/plugins/marketplace.json}"

info() { printf '→ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

for cmd in git node codex python3; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  fail "Node.js 18+ is required (found $(node --version))"
fi

mkdir -p "$(dirname "$PLUGIN_DIR")"

if [ -d "$PLUGIN_DIR/.git" ]; then
  info "Updating existing checkout at $PLUGIN_DIR"
  git -C "$PLUGIN_DIR" fetch --quiet origin main
  git -C "$PLUGIN_DIR" checkout --quiet main
  git -C "$PLUGIN_DIR" pull --ff-only --quiet origin main
else
  if [ -e "$PLUGIN_DIR" ]; then
    fail "$PLUGIN_DIR already exists and is not a git checkout"
  fi
  info "Cloning codex-prewalk to $PLUGIN_DIR"
  git clone --quiet "$REPO_URL" "$PLUGIN_DIR"
fi

mkdir -p "$(dirname "$MARKETPLACE")"

MARKETPLACE="$MARKETPLACE" python3 <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["MARKETPLACE"])
entry = {
    "name": "codex-prewalk",
    "source": {"source": "local", "path": "./plugins/codex-prewalk"},
    "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
    "category": "Developer Tools",
}

if path.exists():
    try:
        data = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"Expected a JSON object in {path}")
else:
    data = {
        "name": "local-plugins",
        "interface": {"displayName": "Local Plugins"},
        "plugins": [],
    }

plugins = data.setdefault("plugins", [])
if not isinstance(plugins, list):
    raise SystemExit(f"Expected 'plugins' to be an array in {path}")

for index, plugin in enumerate(plugins):
    if isinstance(plugin, dict) and plugin.get("name") == "codex-prewalk":
        plugins[index] = entry
        break
else:
    plugins.append(entry)

path.write_text(json.dumps(data, indent=2) + "\n")
PY

node --check "$PLUGIN_DIR/scripts/prewalk.mjs" >/dev/null

ok "Installed codex-prewalk"
printf '\nRestart Codex, then run:\n\n  $prewalk fix the failing auth refresh tests\n\n'
