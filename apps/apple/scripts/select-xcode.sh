#!/usr/bin/env bash
# CI: use the newest installed Xcode 27, which the app needs.
set -euo pipefail
xcode="$(ls -d /Applications/Xcode_27*.app 2>/dev/null | sort -V | tail -1 || true)"
if [[ -z "$xcode" ]]; then
  echo "Xcode 27 is not installed on this runner." >&2
  ls -d /Applications/Xcode*.app >&2 || true
  exit 1
fi
sudo xcode-select -s "$xcode/Contents/Developer"
xcodebuild -version
