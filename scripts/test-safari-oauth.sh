#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_build_dir="$(mktemp -d "${TMPDIR:-/tmp}/teak-safari-oauth.XXXXXX")"
xcrun swiftc -parse-as-library \
  "apps/safari-extension/Shared (App)/Shared (Core)/SafariOAuth.swift" \
  "apps/safari-extension/Shared (App)/Shared (Core)/SafariCredentialStore.swift" \
  "apps/safari-extension/Shared (App)/Shared (Core)/TeakSafariService.swift" \
  apps/safari-extension/tests/SafariOAuthTests.swift \
  -o "$test_build_dir/safari-oauth-tests"
"$test_build_dir/safari-oauth-tests"
