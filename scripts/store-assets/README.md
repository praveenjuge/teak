# Store images

One pipeline makes the App Store images for Mac and iPhone and the Play Store
images for Android. Every image is the same meadow wallpaper, one short
headline, and a real capture of the app showing a designer's library.

| Store | Raw captures | Final images |
| --- | --- | --- |
| Mac App Store | `apps/mac/assets/screenshots/source/` | `apps/mac/assets/screenshots/en-US/` (2880 × 1800) |
| iPhone App Store | `apps/mobile/store/apple/source/` | `apps/mobile/store/apple/screenshot/en-US/APP_IPHONE_67/` (1320 × 2868) |
| Play Store | `apps/android/store/source/` | `apps/android/store/listing/en-US/graphics/phone-screenshots/` (1080 × 1920) and `feature_graphic.png` (1024 × 500) |

Raw captures are committed, so a headline change is a re-render, not a
recapture.

## Files

- `shots.ts`: every image, in store order, with its headline. Keep headlines
  short: one line on Mac, two at most on phones (`\n` sets the break).
- `showcase.ts` and `seed/`: the cards the screenshots show, with each file's
  source and license.
- `seed.ts`: puts those cards at the top of the account the CLI is signed in to.
- `capture.ts`: clean status bars and raw captures.
- `render.ts`: frames, composes, and validates every image.
- `publish-apple.sh`: uploads a set to App Store Connect and verifies it.
- `wallpaper.jpg`: the shared background, a public-domain meadow painting.

## Refresh the images

1. **Library.** Build the CLI (`bun run build:cli`), then run
   `bun scripts/store-assets/seed.ts`. It reports what is missing. `--apply` adds
   missing cards; `--refresh` moves the old showcase cards to Trash and adds the
   whole set again, so it leads the library after newer personal cards.
   Link previews and AI tags finish a minute later.
2. **Apps.** Run each app against production and sign in to the showcase
   account by hand (Claude can't type passwords into WorkOS):
   - Mac: build the `teak-mac (macOS)` scheme in Release and launch it with
     `--args -NSRequiresAquaSystemAppearance YES` for light mode.
   - iPhone: `expo prebuild`, then a Release `xcodebuild` for the simulator with
     the production `EXPO_PUBLIC_CONVEX_*` values from `mobile-release.yml`,
     signed with `CODE_SIGN_IDENTITY=-` so the keychain works. Use the
     iPhone 17 Pro Max simulator.
   - Android: `./gradlew :app:assembleRelease`, then `zipalign` and `apksigner`
     with the debug keystore, on a Pixel 9 emulator (Android 17).
3. **Status bars.** `bun scripts/store-assets/capture.ts prepare iphone` and
   `... prepare android`.
4. **Captures.** Put each app on the screen a shot needs, then run
   `bun scripts/store-assets/capture.ts <mac|iphone|android> <name>`.
   - iPhone uses `asc screenshots capture`, which brings Teak to the front first.
     For another app's screen, like the Safari share sheet, add `--as-is`.
   - Mac captures a window by ID in the background. Use
     `--window "Quick Capture"` for the panel. Clicking in the window needs it
     on the current desktop.
5. **Render.** `bun scripts/store-assets/render.ts [mac iphone android]`. It
   frames iPhone captures in an iPhone 17 Pro Max with `asc screenshots frame`,
   draws Android in a Pixel frame, and runs `asc screenshots validate` on both
   Apple sets. Look at every image before committing.
6. **Publish** (only after the images are approved):
   - Mac: the release workflow uploads the committed set for each release.
   - iPhone: `bash scripts/store-assets/publish-apple.sh iphone <version-id>`
     with the editable App Store version's ID (`asc versions list --app
     <app-id>`). It validates, replaces the set, and waits until Apple holds the
     exact files in order.
   - Play: upload by hand in Play Console until the app is live.

## Tools

asc 5.14 or newer, Koubou 0.20.0 (`pipx install koubou==0.20.0`, then
`kou setup-frames`), `axe` (`brew install cameroncooke/axe/axe`), Google Chrome,
and for Android a JDK 21 and the Android SDK with an Android 17 system image.
