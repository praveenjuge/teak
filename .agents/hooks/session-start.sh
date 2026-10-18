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
  # The pinned Playwright's Chromium can't open the Convex WebSocket through
  # the session's HTTPS proxy (the handshake loses its Upgrade header), so the
  # web app never loads against the dev deployment in it. The image's older
  # Chromium can; point agents at it (.agents/cloud.md).
  cloud_chromium="$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$cloud_chromium" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export TEAK_CLOUD_CHROMIUM="%s"\n' "$cloud_chromium" >>"$CLAUDE_ENV_FILE"
  fi
  # Turbo's strict env mode drops NODE_EXTRA_CA_CERTS, so Node tasks under it
  # (ray lint, Google Fonts) reject the HTTPS proxy's certificate. Turbo passes
  # NODE_OPTIONS through, and the system store already trusts the proxy CA.
  # The line re-checks when sourced, so a resumed session doesn't add it twice.
  if [[ -n "${CLAUDE_ENV_FILE:-}" && " ${NODE_OPTIONS:-} " != *" --use-openssl-ca "* ]]; then
    printf '%s\n' 'case " $NODE_OPTIONS " in *" --use-openssl-ca "*) ;; *) export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--use-openssl-ca" ;; esac' >>"$CLAUDE_ENV_FILE"
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

# Stdout becomes the agent's context, so every session starts knowing that
# work ends with proof (AGENTS.md, Verification).
printf '%s\n' 'Every change ends with proof: follow .agents/skills/principle-prove-it-works, and for anything a user can observe, .agents/skills/verify-teak (launch, doctor, drive the touched features, keep the evidence, update features/ for new or changed features). See AGENTS.md, Verification.'

command -v bun >/dev/null 2>&1 || exit 0
bun --no-env-file scripts/dev.ts --status 2>/dev/null || true
