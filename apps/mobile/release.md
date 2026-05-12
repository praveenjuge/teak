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

- **`apple.version`** — bump to the next release version. It must match `apps/mobile/app.json` → `expo.version` (bump that too if it is behind).
- **`apple.info.en-US.releaseNotes`** — rewrite only if there are user-visible changes since the last shipped version.
- Other fields (`description`, `keywords`, `promoText`, `subtitle`, `review`, `categories`, `advisory`, URLs) — leave unchanged unless the user explicitly asked for a copy update.

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

## 5. Submit the IPA

```bash
bun run build:submit
```

This runs `eas submit --platform ios`. Select the IPA that was just built in the previous step when prompted. The submission uses `submit.production.ios.metadataPath` from `eas.json` (which points back to `store.config.json`) so the release notes and version ride along with the binary.

## Quick reference

| Step | Command                  | What it does                                   |
| ---- | ------------------------ | ---------------------------------------------- |
| 1    | `bun run metadata:pull`  | Pull current App Store metadata to local file. |
| 2    | edit `store.config.json` | Bump version, update release notes if needed.  |
| 3    | `bun run metadata:push`  | Sync local metadata to App Store Connect.      |
| 4    | `bun run build:local`    | Build signed IPA locally via EAS.              |
| 5    | `bun run build:submit`   | Submit the built IPA to App Store Connect.     |

All four scripts are defined in `apps/mobile/package.json`.

## Agent notes

When an automated agent runs this process, complete all five steps in one pass. Do not stop between `metadata:push`, `build:local`, and `build:submit` to ask for confirmation. The user already signaled intent to ship when they asked you to run the release, and pausing mid-flight leaves the App Store version metadata out of sync with the binary.

Specifically:

- Do not pause because `apple.release.automaticRelease` is `true`. That setting is deliberate — approved builds ship to users automatically, and that is the intended behavior.
- Do not pause because a build takes a long time. Run it and wait for it to finish.
- Do stop only if an actual step fails (non-zero exit from the release scripts, signing error, binary upload rejected, etc.). Report the failure and let the user decide next steps.

If `eas metadata:push` reports a non-fatal API mismatch (for example `gamblingAndContests` on `ageRatingDeclarations`), treat it as a warning and keep going. The version, release notes, and review info still land, and the age rating is already set on the store listing.

### Handling interactive prompts in `build:local` and `build:submit`

The EAS CLI prompts for interactive input during the build and submit steps. These prompts require a real terminal with stdin attached. **Use `control_bash_process` (start action) to run these commands as background processes**, then tell the user to complete the interactive prompts in their terminal.

The typical prompts during `bun run build:local`:

1. "Do you want to log in to your Apple account?" → Answer **Y**
2. Apple ID → Pre-filled as `hello@praveenjuge.com`, just confirm
3. "Would you like to reuse the original profile?" → Answer **Y**
4. Same flow repeats for the share extension target

After the build completes, `bun run build:submit` will prompt to select the IPA file.

**Do not attempt to pipe input or use `echo` to answer these prompts** — it does not work reliably with EAS CLI. Instead, tell the user to run steps 4 and 5 directly in their terminal after you complete steps 1–3 programmatically.

