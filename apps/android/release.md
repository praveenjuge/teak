# Teak Android release process

A lockstep version change merged to `main` is the only release step. `Version Tag` creates `v<version>`, and `.github/workflows/android-release.yml` builds the signed bundle, uploads its R8 mapping to PostHog, and submits it to Google Play: the internal track and production, both at full rollout. Production goes live as soon as Google approves it.

The app ID is `com.praveenjuge.teak`. The version name is the root `package.json` version. The version code is `major × 1,000,000 + minor × 1,000 + patch`, so 1.0.93 becomes 1000093.

## Each release

1. Complete the shared preparation in `../../.agents/runbooks/releases.md`. If you want release notes, edit `whatsNew` in `apps/android/store/store.config.json` in the same PR (500 characters at most). An empty `whatsNew` sends the generic note: "Small fixes and polish to keep saving and organizing your ideas smooth and reliable." Whatever `whatsNew` holds goes out on every release until you change it.
2. Merge to `main`. Nothing else is needed. The run:
   - **`build`** runs lint, the unit tests and the signed release bundle from the tag, uploads the R8 mapping to PostHog, checks the upload certificate and the version code, and attaches `teak-android-<version>.aab` and its mapping to the GitHub Release. Each tag builds once; a rerun reuses the attached bundle.
   - **`publish`** downloads that exact bundle (PostHog matches crashes by the map ID inside it), then does everything in one Play edit:
     - uploads the bundle and the mapping (for readable stack traces in Play vitals)
     - syncs the listing text and images from `store.config.json`
     - points the internal and production tracks at this version code with the release notes
     - validates, then commits
   - Play reviews the change, and it goes live when approved. `teak-android-<version>-play.json` on the GitHub Release proves both tracks serve the version.
3. If a run fails, it opens an `Android release v<version>` issue with Play's error and the rerun command. A later successful run closes it.

**Only the newest version ships.** Committing cancels any review still in progress and submits the new version instead (`changesInReviewBehavior=CANCEL_IN_REVIEW_AND_SUBMIT`), so back-to-back releases end with only the latest in review. A rerun of an older tag does nothing when production already serves that version code or a higher one.

### Store listing

`apps/android/store/store.config.json` is the Play listing for `en-US`: title (30 characters), short description (80), full description (4,000), and `whatsNew`. The images it names live in `listing/en-US/graphics/`: the icon, the feature graphic, and the phone screenshots in order, which come from `scripts/store-assets`. Each release replaces an image set only when its files changed, so unchanged images don't send the listing for review. Listing edits made by hand in Play Console are overwritten by the next release, so make them in the file.

### Dry run and rerun

A dry run does the whole edit, including the upload and Play's validation, then discards it. It can start from any branch, and its summary shows what would change against what Play has now:

```bash
gh workflow run android-release.yml --ref <branch> -f version=<version> -f dry_run=true
```

To publish an existing tag again (after a failure, or with different notes), run from `main`, which must contain the tag:

```bash
gh workflow run android-release.yml --ref main -f version=<version> -f dry_run=false
```

Add `-f release_notes="…"` to override `whatsNew` for that run.

## One-time setup

Done once. A run that's missing one of these fails and points here.

1. **Play Console**
   - A personal developer account with identity, Android device and phone verified, and production access granted (November 2026).
   - The app "Teak: Save Inspirations" (`com.praveenjuge.teak`). It's live in production, with trader status declared for the account and the app, and the Terms of Service link https://teakvault.com/docs/terms-of-service.
   - Managed publishing is off, so approved changes go live at once.
2. **Upload key**
   - It lives at `~/.teak-android/teak-upload.jks`, alias `upload`. Its password is in the macOS login Keychain under `teak-android-upload-key`, and both are backed up in the password manager. Losing the key means asking Google for an upload-key reset.
   - Upload certificate SHA-256: `5C:3E:DD:C4:BE:80:5D:6F:F6:CC:7E:38:A2:92:6A:AD:9E:55:86:10:A3:5E:18:ED:F6:A3:B8:47:93:1D:1C:11`.
   - The gitignored `apps/android/keystore.properties` points a local build at the key (`storeFile=/Users/<you>/.teak-android/teak-upload.jks`, `keyAlias=upload`).
3. **Play App Signing** is on, and Google holds the app signing key. App signing certificate SHA-256: `1D:91:49:74:38:43:74:CB:6D:AA:EF:53:FA:84:77:78:6F:F1:95:06:42:80:6F:2B:0E:25:A8:DF:81:A3:8C:BE`.
4. **Play Developer API service account**
   - In Google Cloud, enable the Google Play Android Developer API (`androidpublisher.googleapis.com`) on a project, and create a service account `teak-play-publisher` with no Cloud roles.
   - In Play Console, Users and permissions, invite the service account's email with access to Teak only, and these permissions: release to production, exclude devices, and use Play App Signing; release apps to testing tracks; manage store presence.
   - Create a JSON key for the service account, store it, and delete the download:

     ```bash
     gh secret set PLAY_SERVICE_ACCOUNT_JSON -R praveenjuge/teak < ~/Downloads/<key>.json && trash ~/Downloads/<key>.json
     ```

5. **GitHub secrets for the build**
   - `POSTHOG_PROJECT_TOKEN`, `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` are shared with the Apple release.
   - `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEYSTORE_PASSWORD` hold the upload key:

     ```bash
     base64 -i ~/.teak-android/teak-upload.jks | tr -d '\n' | gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 -R praveenjuge/teak
     security find-generic-password -s teak-android-upload-key -w | gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD -R praveenjuge/teak
     ```

## If something goes wrong

- **"The caller does not have permission"** or a 403: the service account lacks a Play Console permission above, or its invitation isn't accepted yet.
- **Google sign-in failed (`invalid_grant`):** the key in `PLAY_SERVICE_ACCOUNT_JSON` was deleted or rotated. Create a new key and set the secret again.
- **Changes can't be sent for review:** a declaration in Play Console's App content is out of date (Data safety, trader status, target audience). Fix it there, then rerun.
- **"Version code … has already been used":** a bundle with that version code is already in Play's library from another release. Ship the next patch version instead.
- **"The bundle is signed with …, not the upload key":** the build used the wrong key. Check `ANDROID_UPLOAD_KEYSTORE_BASE64` and its password.
- **Google rejects the update:** fix what the email names, then release the next patch version. A new release cancels the rejected review and submits the newer one.
