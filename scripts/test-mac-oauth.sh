#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test_build_dir="$(mktemp -d "${TMPDIR:-/tmp}/teak-mac-oauth.XXXXXX")"
xcrun swiftc -parse-as-library \
  "apps/mac/macOS (App)/CompanionRoute.swift" \
  "apps/mac/Shared (App)/Shared (Core)/SafariOAuth.swift" \
  "apps/mac/Shared (App)/Shared (Core)/SafariCredentialStore.swift" \
  "apps/mac/Shared (App)/Shared (Core)/TeakSafariService.swift" \
  "apps/mac/macOS (App)/LibraryModels.swift" \
  "apps/mac/macOS (App)/LibraryStore.swift" \
  apps/mac/tests/SafariOAuthTests.swift \
  apps/mac/tests/LibraryStoreRegressionTests.swift \
  -o "$test_build_dir/mac-oauth-tests"
"$test_build_dir/mac-oauth-tests"
