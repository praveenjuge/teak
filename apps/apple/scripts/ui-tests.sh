#!/usr/bin/env bash
# Runs the XCUITest flows against this checkout's local E2E stack.
#   bun run --cwd packages/tests e2e:stack    # in another terminal
#   apps/apple/scripts/ui-tests.sh ios|ipad|mac [extra xcodebuild args]
set -euo pipefail
cd "$(dirname "$0")/.."
state="../../.agents/.state/stack.json"
if ! grep -q '"mode": "e2e"' "$state" 2>/dev/null || ! grep -q '"ready": true' "$state"; then
  echo "Start the E2E stack first: bun run --cwd packages/tests e2e:stack" >&2
  exit 1
fi
url() { python3 -c "import json,sys; print(json.load(open('$state'))['urls'][sys.argv[1]])" "$1"; }
case "${1:-ios}" in
  ios) destination="platform=iOS Simulator,name=${TEAK_IPHONE:-iPhone 17 Pro}" ;;
  ipad) destination="platform=iOS Simulator,name=${TEAK_IPAD:-iPad Pro 13-inch (M5)}" ;;
  mac) destination="platform=macOS,arch=arm64" ;;
  *) echo "Usage: $0 ios|ipad|mac" >&2; exit 2 ;;
esac
shift || true
export TEST_RUNNER_TEAK_E2E_CONVEX_URL="$(url convexUrl)"
export TEST_RUNNER_TEAK_E2E_EMULATOR_URL="$(url emulatorOrigin)"
export TEST_RUNNER_TEAK_E2E_WEB_URL="$(url appOrigin)"
exec xcodebuild test -project Teak.xcodeproj -scheme Teak -destination "$destination" \
  -derivedDataPath "${TEAK_DERIVED_DATA:-build/DerivedData}" -allowProvisioningUpdates "$@"
