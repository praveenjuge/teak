# Desktop Release Runbook

This runbook defines Teak desktop launch and incident response for macOS Apple Silicon releases.

## Ownership

- Release owner: Desktop maintainer on duty
- Backup owner: Platform maintainer on duty
- Incident channel: `#desktop-release`
- On-call window: first 72 hours after each production desktop release

## Promotion Procedure

1. Update root `package.json` `version`, then push to `main`.
2. `Version Bump` workflow runs automatically:
   - Syncs every workspace `package.json` to the root version
   - Syncs `apps/mobile/app.json`, `apps/mobile/store.config.json`, and `apps/extension/wxt.config.ts`
   - Pushes sync commit if needed
   - Creates and pushes `v<version>` tag
3. `Desktop Release` workflow runs from that tag:
   - Builds renderer, main, and preload via `electron-vite build`
   - Imports signing credentials from GitHub Actions secrets
   - Packages, signs, and notarizes the macOS Apple Silicon app via `electron-builder`
   - Verifies codesign, Gatekeeper assessment, and the stapled notarization ticket
   - Publishes GitHub Release assets including `latest-mac.yml` updater metadata only after verification passes
4. Validate release gates:
   - Codesign verification (`codesign --verify --deep --strict`)
   - Gatekeeper assessment (`spctl --assess --type execute`)
   - Smoke test install from DMG
5. Verify updater metadata publish:
   - `latest-mac.yml` is present in the GitHub Release assets
   - `electron-updater` resolves the new version on a test machine
6. Announce release in team channel with:
   - Version
   - Release URL
   - Known issues (if any)

## Rollback Procedure

Use rollback when critical regressions impact launch, auth, sync, or update safety.

1. Identify last known good release tag.
2. Edit the GitHub Release for the bad version: mark as pre-release or add a warning note.
3. Re-publish the last good version's `latest-mac.yml` as a new GitHub Release so `electron-updater` picks it up.
4. Update `/apps` and support communications to steer users to stable build.
5. Post-incident notes:
   - impact window
   - root cause
   - corrective actions

## 72-Hour Launch Monitoring Checklist

- Auth success/failure rates are stable.
- Updater success/failure rates are stable.
- Crash reports and support tickets are reviewed at least twice daily.
- New regressions are triaged with owner and ETA.

## Release Artifacts

- DMG installer for manual install.
- Zip archive for auto-update delivery via `electron-updater`.
- `latest-mac.yml` metadata for `electron-updater` version resolution.
- GitHub Release description is intentionally left empty by the release workflow.

## Required CI Secrets

- `CSC_LINK` — Base64-encoded Developer ID Application `.p12` signing certificate
- `CSC_KEY_PASSWORD` — Password for the signing certificate
- `APPLE_API_KEY_ID` — App Store Connect API key ID for notarization
- `APPLE_API_KEY_P8` — Raw `.p8` App Store Connect API private key content for notarization
- `APPLE_API_ISSUER` — App Store Connect API issuer UUID for notarization
- `GH_TOKEN` — GitHub token for publishing releases
- `VITE_WEB_URL`
- `VITE_PUBLIC_CONVEX_URL`
- `VITE_PUBLIC_CONVEX_SITE_URL`
