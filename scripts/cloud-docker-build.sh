#!/usr/bin/env bash
# `docker build` for Claude Code cloud sessions, by tag, context and
# Dockerfile: scripts/cloud-docker.sh adds the session proxy's CA to every
# stage (see there). Outside a cloud session it is a plain `docker build`.
# Never use it for images you deploy.
#
#   scripts/cloud-docker-build.sh <tag> <context> [Dockerfile] [-- docker build args]
#   scripts/cloud-docker-build.sh teak-renderer apps/files-worker/container
#   scripts/cloud-docker-build.sh teak-fetcher . apps/files-worker/fetcher/Dockerfile
set -euo pipefail

if (($# < 2)); then
  sed -n '7,9p' "$0" >&2
  exit 2
fi
tag="$1"
context="$2"
shift 2
dockerfile="$context/Dockerfile"
if (($# > 0)) && [[ "$1" != "--" ]]; then
  dockerfile="$1"
  shift
fi
[[ "${1:-}" == "--" ]] && shift

TEAK_CLOUD_DOCKER_BUILD=1 exec "$(dirname "$0")/cloud-docker.sh" build -t "$tag" -f "$dockerfile" "$@" "$context"
