#!/usr/bin/env bash
# Claude Code SessionStart hook (.claude/settings.json). Tells the agent how to
# run this checkout's dev stack. In Claude Code on the web it first prepares a
# fresh VM with .agents/setup, once.
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$root"

if [[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]]; then
  export PATH="$HOME/.local/bin:$PATH"
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export PATH="$HOME/.local/bin:$PATH"\n' >>"$CLAUDE_ENV_FILE"
  fi
  browsers="$HOME/.cache/ms-playwright"
  if ! command -v bun >/dev/null 2>&1 || [[ ! -d node_modules ]] ||
    [[ ! -d "$browsers" ]]; then
    # Setup output goes to stderr; stdout becomes the agent's context.
    .agents/setup >&2
  fi
  if [[ -d "$browsers" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export PLAYWRIGHT_BROWSERS_PATH="%s"\n' "$browsers" >>"$CLAUDE_ENV_FILE"
  fi
  # Exports win over the dotenv files bun run dev and the E2E suite manage.
  stray=()
  for name in CONVEX_DEPLOYMENT WORKOS_CLIENT_ID WORKOS_API_KEY \
    WORKOS_COOKIE_PASSWORD NEXT_PUBLIC_CONVEX_URL NEXT_PUBLIC_CONVEX_SITE_URL \
    NEXT_PUBLIC_WORKOS_REDIRECT_URI; do
    [[ -n "${!name:-}" ]] && stray+=("$name")
  done
  if ((${#stray[@]} > 0)); then
    printf 'Warning: this cloud environment exports %s. They override the dotenv files bun run dev writes; remove them from the environment settings (only CONVEX_DEPLOY_KEY is needed) or unset them for the command. See .agents/cloud.md.\n' "${stray[*]}"
  fi
fi

command -v bun >/dev/null 2>&1 || exit 0
bun --no-env-file scripts/dev.ts --status 2>/dev/null || true
