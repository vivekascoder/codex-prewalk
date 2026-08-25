#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/vivekascoder/codex-prewalk.git"
REPO_DIR="${CODEX_PREWALK_DIR:-$HOME/.local/share/codex-prewalk}"
SKILL_DIR="${CODEX_PREWALK_SKILL_DIR:-$HOME/.agents/skills/prewalk}"
LEGACY_MARKETPLACE="${CODEX_MARKETPLACE_FILE:-$HOME/.agents/plugins/marketplace.json}"

info() { printf '→ %s\n' "$*"; }
ok() { printf '✓ %s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }
fail() { printf '✗ %s\n' "$*" >&2; exit 1; }

for cmd in git node codex; do
  command -v "$cmd" >/dev/null 2>&1 || fail "Missing required command: $cmd"
done

node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 18 ]; then
  fail "Node.js 18+ is required (found $(node --version))"
fi

mkdir -p "$(dirname "$REPO_DIR")"
if [ -d "$REPO_DIR/.git" ]; then
  info "Updating existing checkout at $REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet origin main
  git -C "$REPO_DIR" checkout --quiet main
  git -C "$REPO_DIR" pull --ff-only --quiet origin main
else
  [ ! -e "$REPO_DIR" ] || fail "$REPO_DIR already exists and is not a git checkout"
  info "Cloning codex-prewalk to $REPO_DIR"
  git clone --quiet "$REPO_URL" "$REPO_DIR"
fi

node --check "$REPO_DIR/scripts/prewalk.mjs" >/dev/null

mkdir -p "$(dirname "$SKILL_DIR")"
if [ -L "$SKILL_DIR" ]; then
  rm "$SKILL_DIR"
elif [ -e "$SKILL_DIR" ]; then
  fail "$SKILL_DIR already exists and is not a symlink; move/remove it before installing"
fi
ln -s "$REPO_DIR/skills/prewalk" "$SKILL_DIR"
ok "Linked Codex skill at $SKILL_DIR"

# Clean up the marketplace entry created by older versions of this installer.
# This removes only codex-prewalk and preserves all other plugin entries.
if [ -f "$LEGACY_MARKETPLACE" ]; then
  MARKETPLACE="$LEGACY_MARKETPLACE" node <<'NODE'
const fs = require('fs');
const path = process.env.MARKETPLACE;
try {
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  if (Array.isArray(data.plugins)) {
    const before = data.plugins.length;
    data.plugins = data.plugins.filter(p => !(p && p.name === 'codex-prewalk'));
    if (data.plugins.length !== before) {
      fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
      console.log(`→ Removed legacy codex-prewalk marketplace entry from ${path}`);
    }
  }
} catch (error) {
  console.error(`! Could not clean legacy marketplace entry: ${error.message}`);
}
NODE
fi

legacy="$HOME/plugins/codex-prewalk"
if [ -e "$legacy" ] && [ "$legacy" != "$REPO_DIR" ]; then
  warn "Legacy checkout still exists at $legacy; it is no longer used and can be removed manually."
fi

ok "Installed codex-prewalk"
printf '\nRestart Codex, then run:\n\n  $prewalk fix the failing auth refresh tests\n\n'
