# Teak iOS Release Process

Teak iOS ships through `.github/workflows/mobile-release.yml`. A lockstep
`package.json` patch bump merged to `main` is the only normal manual release
action. Root `package.json` is the sole marketing-version source; Expo resolves
that version through `app.config.js`, while EAS keeps the remote build number
and increments it for production builds.

## Canonical release

1. Patch-bump every tracked `package.json` to the same next version.
2. Merge that scoped bump to `main`.
3. `Version Tag` verifies that the change is exactly one patch, creates
   `v<version>`, and dispatches `Mobile App Store Release` at that tag.
4. The workflow verifies the tag, lockstep packages, Expo project, dynamic Expo
   version, asc version, and credentials.
5. It reuses an exact successful production EAS build for the tag when one
   exists. Otherwise it starts a hosted non-interactive production build and
   waits for completion. EAS owns the remote build number and
   `build.production.autoIncrement` remains enabled in `eas.json`.
6. It downloads that IPA and uploads it to Sentry Size Analysis. A failed or
   missing Sentry upload stops the release.
7. asc uploads the exact IPA directly to App Store Connect and waits for a
   `VALID` build. EAS Submit is not part of this flow.
8. asc finds or creates the iOS App Store version, copies localization metadata
   from the prior live iOS version without copying What's New, applies the
   generic release note, preserves review details, sets `AFTER_APPROVAL`,
   attaches the exact build, validates readiness, runs review doctor, and
   submits directly to App Review.
9. The workflow succeeds only after iOS reaches `WAITING_FOR_REVIEW` or a later
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

- Concurrency is scoped by iOS version. Reruns reuse matching EAS and Apple
  builds.
- In-review or already-live versions are read-only and return success.
- Rejected versions are never resubmitted or modified automatically.
- A terminal workflow failure opens or updates the single
  `Apple release v<version>` GitHub issue with the workflow link, redacted asc
  status, doctor remediation, and the exact rerun command.
- `.github/workflows/apple-release-status.yml` checks iOS and Safari every six
  hours and closes that issue only after both versions are live.

App Store Connect app: `6756574989`

Bundle ID: `com.praveenjuge.teak`

Expo project: `@praveenjuge/teak` (`a5a2124f-d673-47f8-90e2-ed4ae3d41cc1`)
