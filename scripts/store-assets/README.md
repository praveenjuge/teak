# Store images

One pipeline makes the App Store images for iPhone, iPad and Mac and the Play
Store images for Android. Every image is the same meadow wallpaper, one short
headline, and a real capture of the app showing a designer's library.

| Store | Raw captures | Final images |
| --- | --- | --- |
| Apple app, iPhone (`apple-iphone`) | `apps/apple/store/source/iphone/` | `apps/apple/store/screenshots/iphone/en-US/` (1320 × 2868) |
| Apple app, iPad (`apple-ipad`) | `apps/apple/store/source/ipad/` | `apps/apple/store/screenshots/ipad/en-US/` (2064 × 2752) |
| Apple app, Mac (`apple-mac`) | `apps/apple/store/source/mac/` | `apps/apple/store/screenshots/mac/en-US/` (2880 × 1800) |
| Play Store | `apps/android/store/source/` | `apps/android/store/listing/en-US/graphics/phone-screenshots/` (1080 × 1920) and `feature_graphic.png` (1024 × 500) |

Raw captures are committed, so a headline change is a re-render, not a
recapture.

The `apple-*` sets belong to the native Apple app; its release workflow
publishes them (see `apps/apple/store/screenshots/README.md`). Each store in `shots.ts` names the
simulator or Mac window it captures from and the device frame it renders in.

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
   - Apple app (iPhone, iPad, Mac): a Release build of the `Teak` scheme in
     `apps/apple` talks to production. Run it on the iPhone 17 Pro Max and
     iPad Pro 13-inch simulators, and on the Mac with the window at
     1440 × 900 points and Settings › Appearance set to Light.
   - Android: `./gradlew :app:assembleRelease`, then `zipalign` and `apksigner`
     with the debug keystore, on a Pixel 9 emulator (Android 17).
3. **Status bars.** `bun scripts/store-assets/capture.ts prepare apple-iphone`,
   `... prepare apple-ipad` and `... prepare android`.
4. **Captures.** Put each app on the screen a shot needs, then run
   `bun scripts/store-assets/capture.ts <apple-iphone|apple-ipad|apple-mac|android> <name>`.
   - iPhone and iPad use `asc screenshots capture`, which brings Teak to the front first.
     For another app's screen, like the Safari share sheet, add `--as-is`.
   - Mac captures a window by ID in the background. Use
     `--window "Quick Capture"` for the panel. Clicking in the window needs it
     on the current desktop.
5. **Render.** `bun scripts/store-assets/render.ts [apple-iphone apple-ipad apple-mac android]`.
   It frames iPhone and iPad captures with `asc screenshots frame`, draws
   Android in a Pixel frame, and runs `asc screenshots validate` on every
   Apple set. Look at every image before committing.
6. **Publish** (only after the images are approved):
   - Apple app: the release workflow uploads the committed sets for each
     release. By hand, run `bash scripts/store-assets/publish-apple.sh
     apple-<iphone|ipad|mac> <version-id>` with the editable App Store
     version's ID (`asc versions list --app 6756574989`). It validates,
     replaces the set, and waits until Apple holds the exact files in order.
   - Play: upload by hand in Play Console until the app is live.

## Tools

asc 5.14 or newer, Koubou 0.20.0 (`pipx install koubou==0.20.0`, then
`kou setup-frames`), `axe` (`brew install cameroncooke/axe/axe`), Google Chrome,
and for Android a JDK 21 and the Android SDK with an Android 17 system image.
