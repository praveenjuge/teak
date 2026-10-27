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
  elif [[ "$(cat node_modules/.teak-install 2>/dev/null)" != "$(sha256sum bun.lock | cut -c1-64)" ]] ||
    [[ "${CONVEX_DEPLOY_KEY:-}" == dev:* && ! -f apps/web/.env.local ]]; then
    # The cached snapshot predates this checkout's bun.lock, or the setup
    # script ran without the environment's secrets (it always does) and so
    # never wired the checkout to the dev deployment. About 15 seconds.
    .agents/setup --session >&2 || true
  fi
  # A cold typecheck takes about three minutes, so fill the Turbo cache in the
  # background, once per VM, rather than make setup wait for it.
  if [[ ! -f .turbo/teak-warm ]] && command -v bun >/dev/null 2>&1; then
    mkdir -p .turbo
    setsid nohup nice -n 19 .agents/setup --warm \
      >>.turbo/teak-warm.log 2>&1 </dev/null &
  fi
  if [[ -d "$browsers" && -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export PLAYWRIGHT_BROWSERS_PATH="%s"\n' "$browsers" >>"$CLAUDE_ENV_FILE"
  fi
  # MCP servers keep the image's PLAYWRIGHT_BROWSERS_PATH, not the export
  # above, so the e2e MCP server looks for e2e's pinned browsers in the
  # image's directory. Link them in; installing them there instead would let
  # Playwright prune the image's own.
  if [[ -d "$browsers" && -d /opt/pw-browsers && -w /opt/pw-browsers ]]; then
    for build in "$browsers"/*/; do
      build="${build%/}"
      [[ -e "/opt/pw-browsers/${build##*/}" ]] || ln -s "$build" "/opt/pw-browsers/${build##*/}"
    done
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
  # The image ships Docker without running it; the Files Worker's Containers
  # need it (.agents/cloud.md, "Containers"). Processes aren't cached with the
  # setup script's snapshot, so start it each session.
  .agents/hooks/start-docker.sh || true
  # Image builds that download fail on the proxy's certificate; wrangler dev
  # builds the Containers through a docker that adds its CA to local images.
  if [[ -n "${CLAUDE_ENV_FILE:-}" ]]; then
    printf 'export WRANGLER_DOCKER_BIN="%s"\n' "$root/scripts/cloud-docker.sh" >>"$CLAUDE_ENV_FILE"
  fi
fi

# Stdout becomes the agent's context, so every session starts knowing that
# work ends with proof (AGENTS.md, Verification).
printf '%s\n' 'Every change ends with proof: follow .agents/skills/principle-prove-it-works, and for anything a user can observe, .agents/skills/verify-teak (launch, doctor, drive the touched features, keep the evidence, update features/ for new or changed features). See AGENTS.md, Verification.'

command -v bun >/dev/null 2>&1 || exit 0
bun --no-env-file scripts/dev.ts --status 2>/dev/null || true
