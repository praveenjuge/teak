#!/usr/bin/env bash
# CI: select the Xcode the app is built with (TEAK_XCODE_VERSION, default
# 27.0), never a beta. GitHub's `xcode-27` image links some release-looking
# names, such as Xcode_27.2.app, to betas, so the resolved path is checked.
set -euo pipefail
version="${TEAK_XCODE_VERSION:-27.0}"
xcode="/Applications/Xcode_${version}.app"
resolved="$(cd "$xcode" 2>/dev/null && pwd -P || true)"
if [[ -z "$resolved" || "$resolved" == *[Bb]eta* ]]; then
  echo "Xcode $version (non-beta) is not installed on this runner." >&2
  ls -d /Applications/Xcode*.app >&2 || true
  exit 1
fi
sudo xcode-select -s "$resolved/Contents/Developer"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "DEVELOPER_DIR=$resolved/Contents/Developer" >> "$GITHUB_ENV"
fi
xcodebuild -version
