# Teak for Safari Release Process

The Safari extension source lives in `apps/safari-extension/`. It is a
macOS-only Mac App Store build and shares the same version train as the desktop
and Chrome extension releases.

The Xcode project and Apple identifiers intentionally still use `teak-safari`
names because they are tied to App Store Connect, signing, App Groups, native
messaging, and keychain access.

## Automated Release

1. Bump the `version` field in every tracked `package.json` across the
   monorepo.
2. Commit and push the version bump.
3. Create and push a matching tag:

   ```bash
   git tag v<version>
   git push origin v<version>
   ```

The `Safari Extension Release` workflow runs on that tag. It verifies every
tracked app/package version matches the tag, creates or reuses the matching
macOS version in App Store Connect, archives `Teak for Safari`, exports a Mac
App Store package, validates it, uploads it to App Store Connect, and attaches
the uploaded package to the GitHub Release.

The workflow intentionally stops before submitting the version for App Review.
After Apple finishes processing the uploaded build, choose the build in App
Store Connect and submit it manually.

## Required GitHub Secrets

These are already shared with the Apple release workflows:

- `APPLE_API_ISSUER`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_P8`
- `APPLE_CERTIFICATE_BASE64`
- `APPLE_CERTIFICATE_PASSWORD`

The App Store Connect app id is stored in the workflow as `6770003409`.
