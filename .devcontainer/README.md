# Teak dev container

Opens a Linux container with the pinned Node toolchain, installs the pinned
Bun release, and validates the tree with the same `setup --check` developers
run. Provisioning itself stays in `bun run setup` so the container and a
local checkout share one path.

Targets covered: web, docs, CLI, Convex backend, files Worker, and the
test suites. iOS simulators and device builds stay on macOS.

## macOS-only requirements

These cannot move into the container:

- Xcode and the iOS simulators for `apps/mobile` device/simulator runs and
  `mobile-release.yml` signing.
- Safari and macOS for the Safari extension (`apps/safari-extension`) and
  `safari.yml`.
- Apple notarization credentials for desktop releases.
