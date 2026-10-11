# App Store screenshots

One folder per screenshot set on the "Teak: Save Inspirations" listing. Each
folder holds only the final PNGs, named with a numeric prefix for their order
(`01-library.png`, `02-detail.png`, …).

| Set | Folder | Display type | Size | Capture on |
| --- | --- | --- | --- | --- |
| iPhone 6.9" | `iphone/en-US/` | `APP_IPHONE_67` | 1320 × 2868 | iPhone 17 Pro Max simulator |
| iPad 13" | `ipad/en-US/` | `APP_IPAD_PRO_3GEN_129` | 2064 × 2752 | iPad Pro 13-inch simulator |
| Mac | `mac/en-US/` | `APP_DESKTOP` | 2880 × 1800 | Teak window on a Retina Mac |

Git doesn't keep empty folders, so a folder appears with its first images.
Keep nothing but PNGs in it: `asc screenshots validate` rejects any other file,
such as a `.gitkeep` or a README.

## Capture

1. Build the `Teak` scheme in Release against production and sign in to the
   showcase account set up by `scripts/store-assets/seed.ts` (see
   `scripts/store-assets/README.md` for the library and status bars).
2. Put the app on the screen a shot needs, then capture it:
   - iPhone and iPad: `asc screenshots capture --bundle-id com.praveenjuge.teak --name 01-library --output-dir <folder>`
     with the right simulator booted (add `--udid` when more than one is).
   - Mac: `asc screenshots capture --provider macos --bundle-id com.praveenjuge.teak --name 01-library --output-dir <folder>`
     with the Teak window sized to 1440 × 900 points.
3. Frame and title the images the same way as the other store images, then
   check each set:

   ```bash
   asc screenshots validate --path apps/apple/store/screenshots/ipad/en-US --device-type APP_IPAD_PRO_3GEN_129
   ```

4. List the file names, in order, under `screenshots.<iphone|ipad|mac>` in
   `../store.config.json`. The release refuses a folder whose files don't match
   that list exactly.

## Publishing

`.github/workflows/apple-release.yml` runs `apps/apple/scripts/apply-store-metadata.sh`,
which replaces each set with `scripts/store-assets/publish-apple.sh` and waits
until App Store Connect holds the exact files in order. iOS releases publish the
iPhone and iPad sets; Mac releases publish the Mac set.

An empty set is skipped, and App Store Connect keeps the screenshots the new
version inherited. Apple still requires an iPad set before the first iPad-capable
build can pass review, and a Mac set before the first Mac submission.
