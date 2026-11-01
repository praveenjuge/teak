# Teak Android release process

Each version tag builds the signed bundle in `.github/workflows/android-release.yml` and uploads its R8 mapping to PostHog, so crashes show readable stack traces. Uploading the bundle to Play is still done by hand.

The app ID is `com.praveenjuge.teak`. The version name is the root `package.json` version. The version code defaults to `major × 1,000,000 + minor × 1,000 + patch`, so 1.0.85 becomes 1000085. Pass `-Pteak.versionCode=N` only when Play needs a higher number for the same version.

## One-time setup

1. **Play Console**
   - A personal developer account with identity, Android device and phone verified.
   - The app entry "Teak" with package `com.praveenjuge.teak`.
2. **Upload key**
   - The key lives at `~/.teak-android/teak-upload.jks`, alias `upload`.
   - Its password is in the macOS login Keychain under `teak-android-upload-key`.
   - Keep a backup of both in a password manager. Losing the key means asking Google for an upload-key reset.
   - Upload certificate SHA-256: `5C:3E:DD:C4:BE:80:5D:6F:F6:CC:7E:38:A2:92:6A:AD:9E:55:86:10:A3:5E:18:ED:F6:A3:B8:47:93:1D:1C:11`.
3. **Play App Signing**
   - It's on, and Google manages the app signing key. Google re-signs every install. The upload key only proves the upload came from us.
   - App signing certificate SHA-256: `1D:91:49:74:38:43:74:CB:6D:AA:EF:53:FA:84:77:78:6F:F1:95:06:42:80:6F:2B:0E:25:A8:DF:81:A3:8C:BE`.
4. **`apps/android/keystore.properties`**
   - It's gitignored and points at the key:

     ```properties
     storeFile=/Users/<you>/.teak-android/teak-upload.jks
     keyAlias=upload
     ```

5. **PostHog**
   - Set `POSTHOG_ANDROID_TOKEN` (the PostHog project token) for release builds. Without it, PostHog stays off. Debug builds never send anything.
   - Install `posthog-cli` (`npm i -g @posthog/cli@0.18.10`) and set `POSTHOG_CLI_API_KEY` (a PostHog personal API key) and `POSTHOG_CLI_PROJECT_ID`. The PostHog Gradle plugin then uploads the R8 mapping file after each release build, so crashes show readable stack traces. Without both variables, the upload is skipped.
6. **GitHub secrets for the automated build**
   - `POSTHOG_PROJECT_TOKEN`, `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` are shared with the Apple release.
   - `ANDROID_UPLOAD_KEYSTORE_BASE64` and `ANDROID_UPLOAD_KEYSTORE_PASSWORD` hold the upload key:

     ```bash
     base64 -i ~/.teak-android/teak-upload.jks | tr -d '\n' | gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 -R praveenjuge/teak
     security find-generic-password -s teak-android-upload-key -w | gh secret set ANDROID_UPLOAD_KEYSTORE_PASSWORD -R praveenjuge/teak
     ```

   - A run with any of them missing fails and points here.

## Each release

1. Complete the shared preparation in `../../.agents/runbooks/releases.md`, and merge the version change to `main`.

2. `Version Tag` starts `Android Release`, which runs lint, the unit tests and the signed release bundle, uploads the R8 mapping to PostHog, checks the bundle carries the upload certificate and the version code, and attaches `teak-android-<version>.aab` and its mapping to the GitHub Release. Download the bundle:

   ```bash
   gh release download v<version> -p 'teak-android-*.aab' -R praveenjuge/teak
   ```

   Upload that exact bundle to Play: PostHog matches crashes to the mapping by the map ID inside it, so a bundle built anywhere else has no mapping. A rerun skips a tag whose release already has the bundle.

   To build by hand instead (when GitHub Actions is down), from `apps/android`:

   ```bash
   export TEAK_UPLOAD_KEYSTORE_PASSWORD="$(security find-generic-password -s teak-android-upload-key -w)"
   export POSTHOG_ANDROID_TOKEN="<project token from PostHog project settings>"
   export POSTHOG_CLI_API_KEY="<PostHog personal API key>"
   export POSTHOG_CLI_PROJECT_ID="<PostHog project ID>"
   export POSTHOG_CLI_HOST="https://us.posthog.com"
   ./gradlew clean lint testDebugUnitTest :app:bundleRelease
   ```

   The bundle is `app/build/outputs/bundle/release/app-release.aab`.

3. Check it:
   - For a bundle built by hand, `jarsigner -verify app/build/outputs/bundle/release/app-release.aab` shows the upload certificate above (the workflow checks its own).
   - Install it on a real phone through Play's internal track, sign in, save a note, upload a photo and share a link into Teak.
   - Check a 16 KB-page emulator (`system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a`) as well.

4. **Internal testing**
   - Play Console, Test and release, Internal testing, Create new release. The testers are the "Teak team" email list, and they install from https://play.google.com/apps/internaltest/4701620222568108073.
   - Upload the AAB and use the release note below.
   - Roll out to internal testers.

5. **Closed testing**
   - The first time only: promote the internal release to Closed testing, with the Google Group [teak-android-testers@googlegroups.com](https://groups.google.com/g/teak-android-testers) as its testers. Anyone can join the group.
   - Testers join the group, then opt in at https://play.google.com/apps/testing/com.praveenjuge.teak and install Teak from Google Play.
   - Google requires 12 or more testers opted in for 14 days in a row before you can apply for production. Updates during the test don't reset the clock.

6. **Production access**
   - After 14 days, apply in Play Console, under Dashboard and then "Apply for production".
   - Answer the questions about the closed test truthfully.

7. **Production**
   - Once approved, create a production release from the same AAB as a staged rollout: 20 percent, then 100 percent after a day with no new crashes in PostHog error tracking.

8. Record the version code you shipped in the GitHub release notes for `v<version>`.

The release note is:

> Small fixes and polish to keep saving and organizing your ideas smooth and reliable.

## If something goes wrong

- **Play rejects the version code:** rebuild with `-Pteak.versionCode=<higher number>`.
- **"You uploaded an APK or Android App Bundle that is signed with the wrong key":** the bundle wasn't signed with the upload key. Check `keystore.properties` and the password export.
- **Crashes without readable stack traces:** upload the mapping file for that build in Play Console (App bundle explorer, Downloads), or rebuild with `POSTHOG_CLI_API_KEY` and `POSTHOG_CLI_PROJECT_ID` set.
