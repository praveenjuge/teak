# Teak for Safari Release Process

Teak for Safari ships through
`.github/workflows/safari-extension-release.yml`. A lockstep `package.json`
patch bump merged to `main` is the only normal manual release action. Root
`package.json` is the sole marketing-version source.

## Canonical release

1. Complete the shared preparation in `../../docs/agents/releases.md` and merge
   the scoped version change to `main`.
2. `Version Tag` verifies the next-patch and lockstep invariants, creates
   `v<version>`, and dispatches every product release at that tag. A rerun
   reuses successful or active child runs and dispatches only missing work.
3. The workflow verifies the tag, Xcode project, asc version, and App Store
   Connect credentials.
4. The package version is authoritative. If an older Safari version is waiting
   for or currently in App Review, asc cancels that superseded submission,
   waits for Apple to make it editable, and updates the same version record to
   the new package version. Dry runs only report the replacement plan.
5. asc finds or creates the `MAC_OS` App Store version, copies localization
   metadata from the prior live macOS version without copying What's New,
   applies the generic note, preserves review details and the existing age
   rating declaration, sparsely completes Apple's new social-media age-rating
   fields, and sets `AFTER_APPROVAL`.
6. For a new build, asc resolves or creates the Mac App Distribution and Mac
   Installer Distribution certificates that match the repository's private key,
   then resolves, creates, and downloads the two Mac App Store provisioning
   profiles. The private key and certificates live only in the runner's secure
   temporary keychain.
7. Xcode archives and exports
   `teak-safari-<version>-mac-app-store.pkg` without changing the stable app,
   extension, App Group, native-messaging, or keychain identifiers.
8. The macOS job publishes the signed PKG and a SHA-256 handoff descriptor as a
   one-day private Actions artifact. An Ubuntu job verifies the digest before
   continuing.
9. `asc builds upload --pkg --wait` uploads the PKG from Ubuntu. The workflow resolves the
   exact returned marketing-version/build-number pair and requires one `VALID`
   `MAC_OS` build.
10. The PKG is attached to the matching GitHub Release. asc attaches the exact
   Apple build, validates readiness, runs review doctor, and submits it directly
   to App Review.
11. A separate read-only proof pass verifies the exact version, platform,
    attached `VALID` build, submission, `AFTER_APPROVAL`, and review state. It
    writes `teak-safari-<version>-app-store.json` to the GitHub Release.
12. The workflow succeeds only after Safari macOS reaches `WAITING_FOR_REVIEW`
    or a later valid state.

The release note is:

> Small fixes and polish to keep saving pages from Safari smooth and reliable.

## Dry run

```bash
version="$(node -p "require('./package.json').version")"
gh workflow run safari-extension-release.yml --ref main -f "version=$version" -f dry_run=true
```

## Reliability and recovery

- Concurrency is scoped by Safari version. Reruns reuse an exact valid Apple
  build only when the matching labeled GitHub PKG and release manifest exist.
- The workflow addresses only `MAC_OS`; unrelated iOS version records are
  ignored.
- The newest lockstep package version wins. All Safari App Store mutations are
  serialized across versions. A different Safari version in an active review is
  cancelled and promoted to the new version. Ambiguous active reviews or a newer
  App Store version fail closed.
- An exact target version already in review or live remains read-only. Terminal
  Apple rejections remain manual recovery states.
- A terminal failure opens or updates the same version-scoped Apple release
  issue used by iOS. The scheduled status workflow checks every open release
  issue and closes it only when both ASC states are live and both public
  storefronts report that exact version.
- `asc release stage --dry-run` is recorded in the release manifest for parity
  evaluation. asc 3.6.1 does not accept a PKG in `publish appstore`, so the
  explicit lower-level asc sequence remains canonical for Safari.

App Store Connect app: `6770003409`

Bundle ID: `com.praveenjuge.teak-safari`
