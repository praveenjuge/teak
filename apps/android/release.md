# Teak Android release process (manual)

Releases are manual until the app is live on Google Play. The automated workflow comes later (Phase 6), and this runbook will be rewritten for it then.

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
   - Turn it on when you create the first release, and let Google generate the app signing key.
   - Google re-signs every install. The upload key only proves the upload came from us.
4. **`apps/android/keystore.properties`**
   - It's gitignored and points at the key:

     ```properties
     storeFile=/Users/<you>/.teak-android/teak-upload.jks
     keyAlias=upload
     ```

5. **Sentry**
   - Project `teakvault/teak-android-prod`.
   - Set `SENTRY_ANDROID_DSN` for release builds. Without it, Sentry stays off.
   - Set `SENTRY_AUTH_TOKEN` to upload R8 mapping files, so crashes show readable stack traces.

## Each release

1. Complete the shared preparation in `../../.agents/releases.md`, and merge the version change to `main`.

2. Build the signed bundle from `apps/android`:

   ```bash
   export TEAK_UPLOAD_KEYSTORE_PASSWORD="$(security find-generic-password -s teak-android-upload-key -w)"
   export SENTRY_ANDROID_DSN="<DSN from Sentry project settings>"
   export SENTRY_AUTH_TOKEN="<Sentry token with project:releases>"
   ./gradlew clean lint testDebugUnitTest :app:bundleRelease
   ```

   The bundle is `app/build/outputs/bundle/release/app-release.aab`.

3. Check it:
   - `jarsigner -verify app/build/outputs/bundle/release/app-release.aab` shows the upload certificate above.
   - Install it on a real phone through Play's internal track, sign in, save a note, upload a photo and share a link into Teak.
   - Check a 16 KB-page emulator (`system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a`) as well.

4. **Internal testing**
   - Play Console, Test and release, Internal testing, Create new release.
   - Upload the AAB and use the release note below.
   - Roll out to internal testers.

5. **Closed testing**
   - The first time only: promote the internal release to Closed testing and invite at least 12 testers by email list or Google Group.
   - Each tester opts in from the link.
   - Google requires 12 or more testers opted in for 14 days in a row before you can apply for production. Updates during the test don't reset the clock.

6. **Production access**
   - After 14 days, apply in Play Console, under Dashboard and then "Apply for production".
   - Answer the questions about the closed test truthfully.

7. **Production**
   - Once approved, create a production release from the same AAB as a staged rollout: 20 percent, then 100 percent after a day with no new crashes in Sentry.

8. Record the version code you shipped in the GitHub release notes for `v<version>`.

The release note is:

> Small fixes and polish to keep saving and organizing your ideas smooth and reliable.

## If something goes wrong

- **Play rejects the version code:** rebuild with `-Pteak.versionCode=<higher number>`.
- **"You uploaded an APK or Android App Bundle that is signed with the wrong key":** the bundle wasn't signed with the upload key. Check `keystore.properties` and the password export.
- **Crashes without readable stack traces:** upload the mapping file for that build in Play Console (App bundle explorer, Downloads), or rebuild with `SENTRY_AUTH_TOKEN` set.
