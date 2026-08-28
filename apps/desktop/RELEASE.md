# Desktop release runbook

Teak desktop ships signed and notarized macOS Apple Silicon builds through `.github/workflows/desktop-release.yml`.

## Canonical release

1. Complete the shared preparation in `../../docs/agents/releases.md` and merge the scoped version change to `main`.
2. `Version Tag` verifies the patch and lockstep invariants, creates `v<version>`, and dispatches every product release for that tag.
3. `Desktop Release` builds, signs, notarizes, and verifies the app before publishing the DMG, zip, blockmaps, and `latest-mac.yml` to the matching GitHub Release.
4. Install the published DMG on a test Mac. Verify launch, sign-in, sync, codesigning, Gatekeeper acceptance, and the stapled notarization ticket.
5. From an older installation, verify the updater resolves and installs the new version using the published `latest-mac.yml`.
6. Monitor authentication, sync, updater failures, crash reports, and support reports for 72 hours.

The release is complete only when the workflow is green, the published artifact passes the installed-app smoke test, and an older build can resolve the update.

## Retry and recovery

- Rerun the failed GitHub Actions job when the failure is transient.
- If source or workflow changes are required after a tag exists, ship the fix as the next patch version. Keep published version tags immutable.
- The workflow skips a completed version only when all five required release assets exist. A rerun rebuilds and safely replaces the asset set when any artifact is missing.
- For a critical regression, mark the affected GitHub Release as a prerelease or add a warning, direct users to the last known good build, and ship a corrected patch. Do not silently replace a published tag or artifact.

## Required repository secrets

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_P8`
- `APPLE_API_ISSUER`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_DESKTOP_DSN`

GitHub supplies the release token. Treat every signing and service credential as runtime-only secret material.
