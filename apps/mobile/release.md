# Mobile Release Process

The mobile app ships to the App Store through EAS Build and EAS Submit. Metadata, version, and release notes live in `apps/mobile/store.config.json` and are synced to App Store Connect via `eas metadata`.

Follow these steps in order from `apps/mobile/`.

## 1. Pull the current App Store metadata

```bash
bun run metadata:pull
```

This refreshes `store.config.json` with the current state from App Store Connect so any updates start from ground truth.

## 2. Update `store.config.json`

Open `apps/mobile/store.config.json` and update only what is needed:

- **`apple.version`** — bump to the next release version. Prefer a patch bump from the root `package.json` version unless the user asks for a different version. It must match `apps/mobile/app.json` → `expo.version`.
- **`apple.info.en-US.releaseNotes`** — rewrite only if there are user-visible changes since the last shipped version.
- Other fields (`description`, `keywords`, `promoText`, `subtitle`, `review`, `categories`, `advisory`, URLs) — leave unchanged unless the user explicitly asked for a copy update.

If the root `package.json` version changes for the release, keep every workspace package version in sync in the same edit:

```bash
rg '"version": "' package.json apps/*/package.json packages/*/package.json apps/mobile/app.json apps/mobile/store.config.json
```

All repo package versions, `apps/mobile/app.json` → `expo.version`, and `apps/mobile/store.config.json` → `apple.version` should report the same release version before metadata is pushed.

### Writing release notes from commits

Find the last version that shipped to the App Store (the previous value of `apple.version` before this bump) and review commits since then:

```bash
git log --oneline <last-app-store-tag-or-sha>..HEAD -- apps/mobile packages/ui packages/convex
```

Keep release notes user-focused. These rules mirror the repo's Changelog Editorial Rules and apply verbatim to App Store release notes:

- Describe only outcomes a user would notice when using the mobile app.
- Do not mention package names, frameworks, build tools, refactors, dependency bumps, tests, CI, signing, or any implementation detail (no Expo, React Native, Convex, Better Auth, EAS, etc.).
- Product-facing terms are fine: sign-in, sync, settings, share extension, notifications, search, cards, favorites, themes.
- Skip entries for internal-only work (dep bumps, refactors, tooling). If nothing user-visible has changed, leave `releaseNotes` as it was.
- Keep it short. A few bullets prefixed with `NEW:`, `IMPROVED:`, `FIXED:` matching the existing style in `store.config.json`.

## 3. Push metadata to App Store Connect

```bash
bun run metadata:push
```

This syncs the updated `store.config.json` (version, release notes, description, review info, etc.) to App Store Connect.

## 4. Build the IPA locally

```bash
bun run build:local
```

This runs `eas build --platform ios --local` and produces a signed IPA in the working directory.

## 5. Upload the IPA to App Store Connect

```bash
bun run build:submit
```

This runs `eas submit --platform ios`. Select the IPA that was just built in the previous step when prompted. The submission uses `submit.production.ios.metadataPath` from `eas.json` (which points back to `store.config.json`) so the release notes and version ride along with the binary.

When prompted for the binary, choose **Provide a path to a local app binary file** and paste the newest IPA from `apps/mobile/`:

```bash
ls -lh build-*.ipa | tail
```

## 6. Submit the uploaded build for App Review

```bash
bun run review:submit
```

This uses the App Store Connect API to find the iOS version in `store.config.json`, wait for a processed build for that version, attach the build to the version if needed, create a review submission, add the app version, and submit it for review.

Required environment:

- `APPLE_API_ISSUER`
- `APPLE_API_KEY_ID`
- `APPLE_API_KEY_PATH` or `APPLE_API_KEY_P8`

For local releases, these can live in `apps/mobile/.env.local`, with the private key stored under `apps/mobile/.secrets/`. Both paths are ignored by git. The review submit script loads `.env.local` automatically.

Optional environment:

- `ASC_APP_ID` — defaults to `submit.production.ios.ascAppId` in `eas.json`.
- `ASC_VERSION` — defaults to `apple.version` in `store.config.json`.
- `ASC_BUILD_NUMBER` — use only when you need to submit a specific processed build number.
- `ASC_BUILD_POLL_TIMEOUT_MS` — defaults to 15 minutes.
- `ASC_BUILD_POLL_INTERVAL_MS` — defaults to 30 seconds.

## Quick reference

| Step | Command                  | What it does                                        |
| ---- | ------------------------ | --------------------------------------------------- |
| 1    | `bun run metadata:pull`  | Pull current App Store metadata to local file.      |
| 2    | edit `store.config.json` | Bump version, update release notes if needed.       |
| 3    | `bun run metadata:push`  | Sync local metadata to App Store Connect.           |
| 4    | `bun run build:local`    | Build signed IPA locally via EAS.                   |
| 5    | `bun run build:submit`   | Upload the built IPA to App Store Connect.          |
| 6    | `bun run review:submit`  | Add the version/build to App Review and submit it.  |

All release scripts are defined in `apps/mobile/package.json`.

## Agent notes

When an automated agent runs this process, complete the metadata, build, and upload steps in one pass. Do not stop between `metadata:push`, `build:local`, and `build:submit` to ask for confirmation. The user already signaled intent to ship when they asked you to run the release, and pausing mid-flight leaves the App Store version metadata out of sync with the binary.

Specifically:

- Do not pause because `apple.release.automaticRelease` is `true`. That setting is deliberate — approved builds ship to users automatically, and that is the intended behavior.
- Do not pause because a build takes a long time. Run it and wait for it to finish.
- Do stop only if an actual step fails (non-zero exit from the release scripts, signing error, binary upload rejected, etc.). Report the failure and let the user decide next steps.
- Run `bun run review:submit` only when the user explicitly asks to submit the uploaded build for App Review.

If `eas metadata:push` reports a non-fatal API mismatch (for example `gamblingAndContests` on `ageRatingDeclarations`), treat it as a warning and keep going. The version, release notes, and review info still land, and the age rating is already set on the store listing.

### Handling interactive prompts in release commands

The metadata, build, and submit scripts may prompt for interactive input. Run them in an attached terminal session so prompts can be answered directly.

The typical prompt during `bun run metadata:pull`:

1. Overwrite `store.config.json` → Answer **Y** after confirming there are no local metadata edits you still need.

The typical prompts during `bun run build:local`:

1. "Do you want to log in to your Apple account?" → Answer **Y**
2. Apple ID → Pre-filled as `hello@praveenjuge.com`, just confirm
3. "Would you like to reuse the original profile?" → Answer **Y**
4. Same flow repeats for the share extension target

The typical prompts during `bun run build:submit`:

1. "What would you like to submit?" → Choose **Provide a path to a local app binary file**
2. IPA path → Paste the newest `apps/mobile/build-*.ipa`

**Do not pipe input with `echo`** — it does not work reliably with EAS CLI.

If `build:local` prints an `expo-doctor` warning for SDK patch-version drift but continues, capture the warning and keep watching the build. Treat it as a release blocker only if the command exits non-zero or EAS stops before producing an IPA.
