#!/usr/bin/env bash
# `docker build` for Claude Code cloud sessions. The session's HTTPS proxy
# re-signs outbound TLS with its own CA, which images don't trust, so a build
# step that downloads (apk add, bun install) fails with "certificate not
# trusted". This builds the Dockerfile unchanged on disk, adding the proxy's CA
# to the system bundle at the start of every stage. Outside a cloud session it
# is a plain `docker build`. Never use it for images you deploy.
#
#   scripts/cloud-docker-build.sh <tag> <context> [Dockerfile] [-- docker build args]
#   scripts/cloud-docker-build.sh teak-renderer apps/files-worker/container
#   scripts/cloud-docker-build.sh teak-fetcher . apps/files-worker/fetcher/Dockerfile
set -euo pipefail

if (($# < 2)); then
  sed -n '9,11p' "$0" >&2
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

ca=/root/.ccr/ca-bundle.crt
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" || ! -f "$ca" ]]; then
  exec docker build -t "$tag" -f "$dockerfile" "$@" "$context"
fi

# A rewritten copy, with the Dockerfile's own ignore file beside it so the
# build context is filtered exactly as a plain build filters it.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
awk '
  { print }
  /^FROM[[:space:]]/ {
    print "COPY --from=teak-proxy-ca ca-bundle.crt /tmp/teak-proxy-ca.crt"
    print "RUN cat /tmp/teak-proxy-ca.crt >> /etc/ssl/certs/ca-certificates.crt"
  }
' "$dockerfile" >"$tmp/Dockerfile"
if [[ -f "$dockerfile.dockerignore" ]]; then
  cp "$dockerfile.dockerignore" "$tmp/Dockerfile.dockerignore"
fi
docker build -t "$tag" -f "$tmp/Dockerfile" \
  --build-context "teak-proxy-ca=$(dirname "$ca")" "$@" "$context"
