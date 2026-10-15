# Teak Apple Release Process

The native Apple app ships iPhone, iPad, and Mac builds of `com.praveenjuge.teak`
to one App Store listing, "Teak: Save Inspirations" (app `6756574989`), through
`.github/workflows/apple-release.yml`. A lockstep `package.json` patch bump
merged to `main` is the only normal manual release action. The app replaced
the Expo iPhone app and Teak for Mac (app `6770003409`, off sale), whose code
and release workflows are gone.

## Canonical release

1. Complete the shared preparation in `../../.agents/releases.md`. It moves the
   Safari extension manifest and `MARKETING_VERSION` in `project.yml` and the
   generated `Teak.xcodeproj` with every other version source.
2. Merge that scoped version change to `main`.
3. `Version Tag` creates `v<version>` and dispatches this workflow with
   `platforms=ios`. Release the Mac after App Review approves iOS (see
   **Releasing the Mac** below).
4. A `plan` job turns `platforms` (`ios`, `macos`, or `both`) into one build and
   one submit leg per platform: `IOS` covers iPhone and iPad, `MAC_OS` covers
   the Mac.
5. Each build leg on the `xcode-27` runner (Xcode pinned by
   `scripts/select-xcode.sh`) verifies the tag, the lockstep versions, Xcode
   27, asc, and credentials. If an older version of the same platform is in
   review or rejected, asc clears it and promotes that record to the new
   version. Dry runs stop after reporting this plan.
6. It reuses an exact `VALID` build when the release manifest proves it.
   Otherwise it allocates one build number above every iOS and macOS build on
   the listing (never below 90, past the Expo builds), cross-checked against
   `asc builds next-build-number`.
7. asc resolves the distribution certificates that match the repository key
   (iOS Distribution; Apple Distribution plus Mac Installer for macOS) and the
   App Store profiles for the app, share extension, and Safari extension. Each
   profile must carry `group.com.praveenjuge.teak`.
8. Xcode archives scheme `Teak` in Release and exports an IPA or PKG. The
   workflow verifies bundle IDs, version, build number, production Convex URL,
   PostHog token (app only; the extensions carry none), entitlements (App
   Group, keychain group, sandbox on macOS), embedded profiles, and signatures
   for all three bundles, then uploads the archive's dSYMs to PostHog with
   `posthog-cli dsym upload`.
9. The signed package and a SHA-256 descriptor move to an Ubuntu submit leg,
   which checks the digest, uploads with `asc builds upload --wait`, and
   requires exactly one `VALID` build.
10. asc finds or creates the platform's App Store version (`AFTER_APPROVAL`),
    carries forward review details, and runs
    `scripts/apply-store-metadata.sh` to apply and verify `store/store.config.json`
    and the screenshot sets (see `store/screenshots/README.md`). Empty sets are
    skipped. It completes the social-media age-rating fields, attaches the exact
    build, validates, runs review doctor, and submits. Submit legs run one at a
    time because both platforms share the listing's app info.
11. A read-only proof pass waits for `WAITING_FOR_REVIEW` or later and writes
    `teak-apple-<ios|macos>-<version>-app-store.json` to the GitHub Release.

Release notes come from `version.whatsNew` in `store/store.config.json`, or the
`release_notes` input. Update them when a release changes what people see. The
first version on a platform skips What's New, since Apple doesn't allow it.

## One-time setup

Do these before the first run that needs them. The workflow fails with a
pointer here when one is missing.

- **PostHog.** The repository secret `POSTHOG_PROJECT_TOKEN` holds the project
  token; the archive passes it as `TEAK_POSTHOG_TOKEN`, and the workflow fails
  without it. For dSYM upload, set the secrets `POSTHOG_CLI_API_KEY` (a PostHog
  personal API key) and `POSTHOG_CLI_PROJECT_ID`.
  Without them, dSYM upload is skipped with a warning.
- **Safari extension ID.** Register `com.praveenjuge.teak.safari-extension` as a
  universal bundle ID in the developer portal, or with
  `asc bundle-ids create --identifier com.praveenjuge.teak.safari-extension --name "Teak Safari Extension" --platform UNIVERSAL`.
- **App Group.** In the developer portal, turn on App Groups for
  `com.praveenjuge.teak`, `com.praveenjuge.teak.share-extension`, and
  `com.praveenjuge.teak.safari-extension`, and assign `group.com.praveenjuge.teak`
  to each. The API can't assign groups. Profiles made before this change are
  replaced automatically.
- **iPad screenshots.** The first iPad-capable build needs a 13" iPad set in
  `store/screenshots/ipad/en-US/`.
- **Mac launch.** Done on 2026-10-13: the Mac app is live on this listing, and
  Teak for Mac (`6770003409`) is off sale and no longer released.

## Releasing the Mac

iPhone, iPad and Mac share one app info. While one platform's version is in
review there are two (live and in review), and `asc validate` stops with
"app infos match". So each version ships iOS first, and the Mac once iOS is
approved:

```bash
gh workflow run apple-release.yml --ref main -f version=<version> -f platforms=macos -f dry_run=false
```

If iOS is still in review and the Mac can't wait, the Mac version can be
submitted directly once the run has attached its build:
`asc review submissions-create --app 6756574989 --platform MAC_OS`, then
`asc review items-add` with the version ID and `asc review submissions-submit`.

## Dry run

```bash
version="$(node -p "require('./package.json').version")"
gh workflow run apple-release.yml --ref main -f "version=$version" -f platforms=ios -f dry_run=true
```

Use `platforms=macos` or `both` to check the Mac path. A dry run builds nothing
and changes nothing in App Store Connect.

## Reliability and recovery

- Every run takes the app-wide `apple-app-store-6756574989` concurrency group,
  so build-number allocation through upload never overlaps for app
  `6756574989`.
- Reruns reuse an exact `VALID` build only when its manifest proves the build ID,
  number, and artifact digest. A target version already in review or live stays
  read-only and passes after the proof pass.
- A failed build or submit leg opens or updates the `Apple release v<version>`
  issue with redacted asc status, review doctor output, and the rerun command
  for that platform:

  ```bash
  gh workflow run apple-release.yml --ref main -f version=<version> -f platforms=<ios|macos> -f dry_run=false
  ```

- Recovery runs must start from the `v<version>` tag or from current `main`
  that descends from it.
- `asc release stage --dry-run` and `asc publish appstore --dry-run` exits are
  recorded in the manifest. The explicit asc sequence stays canonical.

App Store Connect app: `6756574989`

Bundle IDs: `com.praveenjuge.teak`, `com.praveenjuge.teak.share-extension`,
`com.praveenjuge.teak.safari-extension`

App Group: `group.com.praveenjuge.teak`
