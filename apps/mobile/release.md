# Teak iOS Release Process

Teak iOS ships through `.github/workflows/mobile-release.yml`. A lockstep
`package.json` patch bump merged to `main` is the only normal manual release
action. Root `package.json` is the sole marketing-version source; Expo resolves
that version through `app.config.js`. App Store Connect is the sole build-number
authority; the workflow allocates the next positive integer from its current
iOS build history.

## Canonical release

1. Complete the shared preparation in `../../docs/agents/releases.md`.
2. Merge that scoped version change to `main`.
3. `Version Tag` verifies that the change is exactly one patch, creates
   `v<version>`, and dispatches every product release at that tag. A rerun
   reuses successful or active child runs and dispatches only missing work.
4. The workflow verifies the tag, lockstep packages, dynamic Expo version, asc
   version, and credentials.
5. The package version is authoritative. If an older version is waiting for,
   currently in, or rejected by App Review, asc clears the superseded review
   item, waits for Apple to make the version editable, updates the same version
   record to the new package version, and preserves its metadata. Dry runs
   report this plan without changing App Store Connect.
6. It reuses an exact valid App Store Connect build for the target marketing
   version when one exists. Otherwise it allocates the next build number from
   App Store Connect, generates the native iOS project with Expo Prebuild, and
   uses CocoaPods plus Xcode directly on the GitHub Actions macOS runner.
7. asc finds or creates the exact iOS distribution certificate and App Store
   provisioning profiles for the Teak app and share extension. The workflow
   archives, exports, and verifies the signed IPA locally, including bundle IDs,
   marketing version, build number, embedded profiles, and signatures.
8. The macOS job uploads the verified IPA to mandatory Sentry Size Analysis,
   then publishes the signed IPA and a SHA-256 handoff descriptor as a
   one-day private Actions artifact. An Ubuntu job verifies the digest before
   any external upload.
9. asc uploads the exact IPA directly to App Store Connect and waits for a
   `VALID` build.
10. asc finds or creates the iOS App Store version, copies localization metadata
   from the prior live iOS version without copying What's New, applies the
   generic release note, preserves review details, sets `AFTER_APPROVAL`,
   sparsely completes Apple's social-media age-rating fields without changing
   the existing declaration, attaches the exact build, validates readiness,
   runs review doctor, and submits directly to App Review.
11. A separate read-only proof pass verifies the exact version, platform,
   attached `VALID` build, submission, `AFTER_APPROVAL`, and review state. It
   writes `teak-ios-<version>-app-store.json` to the GitHub Release.
12. The workflow succeeds only after iOS reaches `WAITING_FOR_REVIEW` or a later
   valid state.

The release note is:

> Small fixes and polish to keep saving and organizing your ideas smooth and reliable.

## Dry run

After workflow changes, verify the live credentials and release identity without
creating a build or mutating App Store Connect:

```bash
version="$(node -p "require('./package.json').version")"
gh workflow run mobile-release.yml --ref main -f "version=$version" -f dry_run=true
```

## Reliability and recovery

- App-wide concurrency keeps build-number allocation through upload atomic.
  Reruns reuse an exact valid Apple build only when its release manifest proves
  the artifact, Sentry analysis, build, submission, and prior workflow.
- The newest lockstep package version wins. A different version in an active
  review is cancelled and promoted to the new version before submission. The
  workflow fails closed if multiple active reviews or a newer App Store version
  make that choice ambiguous.
- An exact target version already in review or live remains read-only and
  returns success. Rejected versions are removed from their unresolved
  submission and returned to the canonical submission flow automatically.
- A terminal workflow failure opens or updates the single
  `Apple release v<version>` GitHub issue with the workflow link, redacted asc
  status, doctor remediation, and the exact rerun command.
- `.github/workflows/apple-release-status.yml` checks every open Apple release
  issue every six hours. It closes an issue only when both ASC states are live
  and both public storefronts report that exact version.
- `asc release stage --dry-run` and `asc publish appstore --dry-run` are recorded
  in the manifest for parity evaluation. The explicit lower-level asc sequence
  remains canonical until a real patch proves the higher-level path equivalent.

App Store Connect app: `6756574989`

Bundle ID: `com.praveenjuge.teak`

Expo project: `@praveenjuge/teak` (`a5a2124f-d673-47f8-90e2-ed4ae3d41cc1`)

The Expo project identity remains part of the app configuration for development,
but production iOS releases do not call or consume Expo's hosted EAS Build
service.
