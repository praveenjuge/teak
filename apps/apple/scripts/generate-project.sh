#!/usr/bin/env bash
# Regenerates Teak.xcodeproj from project.yml. With --check, fails when the
# committed project differs from what project.yml produces.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" == "--check" ]]; then
  before="$(mktemp)"
  tar -cf "$before" Teak.xcodeproj
  xcodegen generate --quiet
  if ! git diff --quiet -- Teak.xcodeproj; then
    git --no-pager diff --stat -- Teak.xcodeproj
    echo "Teak.xcodeproj is out of date. Run apps/apple/scripts/generate-project.sh and commit it." >&2
    exit 1
  fi
else
  xcodegen generate --quiet
fi
