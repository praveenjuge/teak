#!/usr/bin/env bash
# `docker` for Claude Code cloud sessions. The session's HTTPS proxy re-signs
# outbound TLS with its own CA, which images don't trust, so a build step that
# downloads (apk add, bun install) fails with "certificate not trusted". For
# `docker build`, this adds the proxy's CA to the system bundle at the start
# of every stage, without changing the Dockerfile on disk; every other command
# goes to docker unchanged. Outside a cloud session it is plain docker. Never
# deploy an image it built.
#
# The SessionStart hook exports it as WRANGLER_DOCKER_BIN, so `wrangler dev`
# builds the Core Worker's Containers through it. Wrangler pipes the
# Dockerfile on stdin (`-f -`), which this reads too. `wrangler deploy` uses
# the same binary, so only images tagged for local use are rewritten:
# `wrangler dev` tags its builds `cloudflare-dev/…`, and
# scripts/cloud-docker-build.sh sets TEAK_CLOUD_DOCKER_BUILD=1. Any other
# build, a deploy's included, runs unchanged (and so fails here, as before).
#
#   scripts/cloud-docker.sh build -t teak-renderer apps/core-worker/container
set -euo pipefail

ca=/root/.ccr/ca-bundle.crt
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" || ! -f "$ca" || "${1:-}" != "build" ]]; then
  exec docker "$@"
fi
shift

# Take the Dockerfile out of the arguments; the context is the last one.
original=("$@")
args=()
dockerfile=""
local_tag="${TEAK_CLOUD_DOCKER_BUILD:-}"
while (($# > 0)); do
  case "$1" in
    -t | --tag)
      [[ "$2" == cloudflare-dev/* ]] && local_tag=1
      args+=("$1" "$2")
      shift 2
      ;;
    --tag=*)
      [[ "${1#*=}" == cloudflare-dev/* ]] && local_tag=1
      args+=("$1")
      shift
      ;;
    -f | --file)
      dockerfile="$2"
      shift 2
      ;;
    -f=* | --file=*)
      dockerfile="${1#*=}"
      shift
      ;;
    *)
      args+=("$1")
      shift
      ;;
  esac
done
if [[ "$local_tag" != 1 ]] || ((${#args[@]} == 0)); then
  exec docker build "${original[@]}"
fi
context="${args[-1]}"
[[ -n "$dockerfile" ]] || dockerfile="$context/Dockerfile"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if [[ "$dockerfile" == "-" ]]; then
  cat >"$tmp/Dockerfile.in"
else
  cp "$dockerfile" "$tmp/Dockerfile.in"
  # The Dockerfile's own ignore file, so the context is filtered exactly as a
  # plain build filters it.
  if [[ -f "$dockerfile.dockerignore" ]]; then
    cp "$dockerfile.dockerignore" "$tmp/Dockerfile.dockerignore"
  fi
fi
awk '
  { print }
  /^FROM[[:space:]]/ {
    print "COPY --from=teak-proxy-ca ca-bundle.crt /tmp/teak-proxy-ca.crt"
    print "RUN cat /tmp/teak-proxy-ca.crt >> /etc/ssl/certs/ca-certificates.crt"
  }
' "$tmp/Dockerfile.in" >"$tmp/Dockerfile"

# Not exec: the trap removes the rewritten copy once the build ends.
docker build -f "$tmp/Dockerfile" \
  --build-context "teak-proxy-ca=$(dirname "$ca")" "${args[@]}"
