#!/usr/bin/env bash
# Starts the Docker daemon in a Claude Code cloud session, where the image
# ships Docker but doesn't run it, so `wrangler dev` can build and run the
# Core Worker's two Containers (apps/core-worker/README.md). Safe to re-run:
# it does nothing when a daemon already answers. Never fails the session.
set -uo pipefail

[[ "${CLAUDE_CODE_REMOTE:-}" == "true" ]] || exit 0
command -v dockerd >/dev/null 2>&1 || exit 0
docker info >/dev/null 2>&1 && exit 0

log="${TMPDIR:-/tmp}/teak-dockerd.log"
started=false
for _ in $(seq 1 30); do
  if docker info >/dev/null 2>&1; then
    printf 'Docker is running (log: %s).\n' "$log" >&2
    exit 0
  fi
  # Start one daemon once no other is starting or shutting down.
  if [[ "$started" == false ]] && ! pgrep -x dockerd >/dev/null; then
    nohup dockerd >"$log" 2>&1 &
    started=true
  fi
  sleep 1
done
printf 'Docker did not start; Containers stay unavailable to wrangler dev. See %s.\n' "$log" >&2
exit 0
