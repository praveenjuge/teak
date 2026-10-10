#!/usr/bin/env bash
# Regenerates Teak.xcodeproj from project.yml. With --check, fails when the
# committed project differs from what project.yml produces.
set -euo pipefail
cd "$(dirname "$0")/.."
xcodegen generate --quiet
if [[ "${1:-}" == "--check" ]] && ! git diff --quiet -- Teak.xcodeproj; then
  git --no-pager diff --stat -- Teak.xcodeproj
  echo "Teak.xcodeproj is out of date: run apps/apple/scripts/generate-project.sh and commit it." >&2
  exit 1
fi
