# Desktop Release Runbook

This runbook defines Teak desktop launch and incident response for macOS Apple Silicon releases.

## Ownership

- Release owner: Desktop maintainer on duty
- Backup owner: Platform maintainer on duty
- Incident channel: `#desktop-release`
- On-call window: first 72 hours after each production desktop release

## One-Time `teakvault.com/updates` Setup (Vercel)

1. Use the existing `teakvault.com` docs Vercel project.
2. Ensure the Vercel project Root Directory is `apps/docs`.
3. Confirm automatic production deployments from `main` are enabled.
4. Deploy once from `main` so the updater rewrite in `apps/docs/vercel.json` is active.

## Promotion Procedure

1. Update only `apps/desktop/package.json` `version`, then push to `main`.
2. `Desktop Auto Tag` workflow runs automatically:
   - Syncs `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/Cargo.toml`
   - Pushes sync commit if needed
   - Creates and pushes `v<version>` tag
3. `Desktop Release` workflow runs from that tag:
   - Builds/signs/notarizes/staples macOS Apple Silicon release
   - Publishes GitHub Release assets
   - Writes updater metadata JSON files into `apps/docs/public/updates/darwin/aarch64/`
   - Pushes metadata commit to `main`
4. Vercel detects the new `apps/docs` commit and deploys `teakvault.com`.
5. Validate release gates:
   - Codesign verification
   - Gatekeeper assessment
   - Stapler validation
   - Smoke test install from DMG
6. Verify updater metadata publish:
   - `https://teakvault.com/updates/darwin/aarch64/latest.json`
   - `https://teakvault.com/updates/darwin/aarch64/<current_version>`
7. Announce release in team channel with:
   - Version
   - Release URL
   - Known issues (if any)

## Rollback Procedure

Use rollback when critical regressions impact launch, auth, sync, or update safety.

1. Identify last known good release tag.
2. Repoint updater metadata on `teakvault.com/updates` to the last good bundle for:
   - `darwin/aarch64/latest.json`
   - all active current-version paths (`darwin/aarch64/<version>`)
3. Re-deploy Vercel docs project after metadata rollback commit to `main`.
4. Mark bad GitHub Release as pre-release or add a warning note.
5. Update `/apps` and support communications to steer users to stable build.
6. Post-incident notes:
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
- Signed updater archive + `.sig` for auto-update flow.
- GitHub Release description is intentionally left empty by the release workflow.

## Required CI Secrets

- Updater keypair (generated with `bunx tauri signer generate`):
  - Public key belongs in `apps/desktop/src-tauri/tauri.conf.json`
  - Private key goes to `TAURI_SIGNING_PRIVATE_KEY`
  - Password goes to `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_P8_BASE64`
- `VITE_WEB_URL`
- `VITE_PUBLIC_CONVEX_URL`
- `VITE_PUBLIC_CONVEX_SITE_URL`
