#!/usr/bin/env bash
# Claude Code SessionStart hook (.claude/settings.json). Tells the agent how to
# run this checkout's local stack. In Claude Code on the web it first prepares
# a fresh VM with .agents/setup, once.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export PATH="$HOME/.local/bin:$PATH"\n' >>"$CLAUDE_ENV_FILE"
  fi
  if ! command -v bun >/dev/null 2>&1 || [[ ! -d node_modules ]]; then
    # Setup output goes to stderr; stdout becomes the agent's context.
    .agents/setup >&2
  fi
fi

command -v bun >/dev/null 2>&1 || exit 0
bun --no-env-file scripts/dev.ts --status 2>/dev/null || true
