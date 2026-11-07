#!/usr/bin/env bash
# Runs the XCUITest flows against this checkout's local E2E stack.
#   bun run --cwd packages/tests e2e:stack    # in another terminal
#   apps/apple/scripts/ui-tests.sh ios|ipad|mac [extra xcodebuild args]
set -euo pipefail
cd "$(dirname "$0")/.."
# Fails with "Start the E2E stack first" unless this checkout's E2E stack is ready.
runner_env="$(bun --no-env-file run scripts/e2e-session.ts --runner-env)"
eval "$runner_env"
case "${1:-ios}" in
  ios) destination="platform=iOS Simulator,name=${TEAK_IPHONE:-iPhone 17 Pro}" ;;
  ipad) destination="platform=iOS Simulator,name=${TEAK_IPAD:-iPad Pro 13-inch (M5)}" ;;
  mac) destination="platform=macOS,arch=arm64" ;;
  *) echo "Usage: $0 ios|ipad|mac" >&2; exit 2 ;;
esac
shift || true
exec xcodebuild test -project Teak.xcodeproj -scheme Teak -destination "$destination" \
  -derivedDataPath "${TEAK_DERIVED_DATA:-build/DerivedData}" -allowProvisioningUpdates "$@"
