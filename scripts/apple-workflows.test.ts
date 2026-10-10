import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), "utf8");
const expression = (value: string) => `\${{ ${value} }}`;
const workflowStep = (workflow: string, name: string) => {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start === -1) {
    throw new Error(`Missing workflow step: ${name}`);
  }
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end === -1 ? undefined : end);
};

describe("Apple release workflows", () => {
  const mobile = read(".github/workflows/mobile-release.yml");
  const safari = read(".github/workflows/mac-release.yml");
  const apple = read(".github/workflows/apple-release.yml");
  const status = read(".github/workflows/apple-release-status.yml");
  const issueHelper = read("scripts/apple-release-issue.mjs");
  const latestReview = read("scripts/apple-latest-review.mjs");
  const versionTag = read(".github/workflows/version-tag.yml");
  const productReleases = [
    read(".github/workflows/cli-release.yml"),
    read(".github/workflows/extension-release.yml"),
  ];
  const setupAscPin =
    "rudrankriyam/setup-asc@5358c70a27a3f0d1517604b0f1fdc43e70c1cc4d";

  test("pins one explicit asc release and immutable setup action", () => {
    for (const [workflow, version] of [
      [mobile, "3.6.1"],
      [safari, "5.9.1"],
      [apple, "5.14.0"],
      [status, "3.6.1"],
    ]) {
      expect(workflow).toContain(`ASC_VERSION: "${version}"`);
      expect(workflow).toContain(setupAscPin);
      expect(workflow).not.toContain("setup-asc@v");
    }
  });

  test("hands a runner-local iOS build to an isolated Ubuntu submission job", () => {
    expect(mobile).toContain("build:\n    runs-on: macos-26");
    expect(mobile).toContain("submit:\n    if: inputs.dry_run == false");
    expect(mobile).toContain("runs-on: ubuntu-24.04");
    expect(mobile).toContain("bunx expo prebuild --platform ios");
    expect(mobile).toContain("xcodebuild");
    expect(mobile).toContain("IOS_APP_STORE");
    expect(mobile).toContain("--certificate-type IOS_DISTRIBUTION");
    expect(mobile).not.toContain("--certificate-type DISTRIBUTION");
    expect(mobile).toContain("Upload verified signed IPA handoff");
    expect(mobile).toContain("Download verified signed IPA handoff");
    const prepareHandoff = workflowStep(
      mobile,
      "Prepare verified signed IPA handoff"
    );
    const uploadHandoff = workflowStep(
      mobile,
      "Upload verified signed IPA handoff"
    );
    const downloadHandoff = workflowStep(
      mobile,
      "Download verified signed IPA handoff"
    );
    const verifyHandoff = workflowStep(mobile, "Verify signed IPA handoff");
    const sentryAnalysis = workflowStep(
      mobile,
      "Upload IPA to mandatory Sentry Size Analysis on Apple Silicon"
    );
    expect(prepareHandoff).toContain(
      'handoff_directory="$RUNNER_TEMP/ios-handoff"'
    );
    expect(prepareHandoff).toContain(
      'echo "directory=$handoff_directory" >> "$GITHUB_OUTPUT"'
    );
    expect(uploadHandoff).toContain(
      `path: ${expression("steps.handoff.outputs.directory")}`
    );
    expect(downloadHandoff).toContain(
      `path: ${expression("runner.temp")}/ios-handoff`
    );
    expect(verifyHandoff).toContain(
      'descriptor_count="$(find "$RUNNER_TEMP/ios-handoff" -maxdepth 1'
    );
    expect(verifyHandoff).toContain(
      'ipa_count="$(find "$RUNNER_TEMP/ios-handoff" -maxdepth 1'
    );
    expect(verifyHandoff).toContain(
      'if [ "$descriptor_count" -ne 1 ] || [ "$ipa_count" -ne 1 ]'
    );
    expect(sentryAnalysis).toContain(
      `IPA_PATH: ${expression("steps.ipa.outputs.path")}`
    );
    expect(sentryAnalysis).toContain(
      'bun run --cwd apps/mobile build:sentry -- "$IPA_PATH"'
    );
    expect(mobile.indexOf(sentryAnalysis)).toBeLessThan(
      mobile.indexOf("  submit:")
    );
    expect(verifyHandoff).not.toContain("build:sentry");
    expect(mobile).not.toContain(
      "Install dependencies for mandatory Sentry analysis"
    );
    expect(mobile).toContain("Signed IPA handoff digest mismatch");
    expect(mobile).toContain("asc builds upload");
    expect(mobile).toContain("asc validate");
    expect(mobile).toContain("asc review doctor");
    expect(mobile).toContain("asc review submissions-submit");
    expect(mobile).toContain("--include appStoreVersion");
    expect(mobile).not.toContain("eas submit");
    expect(mobile).not.toContain("eas-cli");
    expect(mobile).not.toContain("EXPO_TOKEN");
    expect(mobile).not.toContain("submit-app-review.mjs");
    expect(mobile).toContain("manageAppVersionAndBuildNumber bool false");
    expect(mobile).toContain("apple-build-number.mjs");
    expect(mobile).toContain("EXPO_PUBLIC_CONVEX_URL");
    expect(mobile).toContain("secrets.SENTRY_MOBILE_DSN");
    expect(mobile).toContain("asc age-rating edit");
    expect(mobile).toContain("--social-media-age-restricted false");
    expect(mobile.indexOf("build:sentry")).toBeLessThan(
      mobile.indexOf("asc builds upload")
    );
  });

  test("serializes app-wide Apple mutations across versions", () => {
    expect(mobile).toContain(
      `group: mobile-app-store-ios-${expression("github.repository")}`
    );
    expect(mobile).not.toContain(
      `group: mobile-app-store-${expression("inputs.version")}`
    );
    expect(safari).toContain(
      `group: safari-app-store-${expression("github.repository")}`
    );
    expect(safari).not.toContain(
      `group: safari-app-store-${expression("inputs.version")}`
    );
    expect(mobile).toContain("cancel-in-progress: false");
    expect(safari).toContain("cancel-in-progress: false");
  });

  test("hands a signed Safari PKG to an isolated Ubuntu submission job", () => {
    expect(safari).toContain("build:\n    runs-on: macos-26");
    expect(safari).toContain("submit:\n    if: inputs.dry_run == false");
    expect(safari).toContain("runs-on: ubuntu-24.04");
    expect(safari).toContain("xcodebuild archive");
    expect(safari).toContain("asc certificates");
    expect(safari).toContain("asc profiles");
    expect(safari).toContain("asc builds upload");
    expect(safari).toContain("--pkg");
    expect(safari).toContain("teak-mac-$VERSION-mac-app-store.pkg");
    expect(safari).toContain("asc review submissions-submit");
    expect(safari).toContain("--include appStoreVersion");
    expect(safari).not.toContain("xcrun altool");
    expect(safari).toContain('[ "$candidate_hash" = "$private_hash" ]');
    expect(safari).not.toContain("EXPECTED_SIGNING_IDENTITY");
    expect(safari).toContain("asc age-rating edit");
    expect(safari).toContain("--social-media-age-restricted false");
    expect(safari).toContain("Upload verified signed PKG handoff");
    expect(safari).toContain("Download verified signed PKG handoff");
    expect(safari).toContain("Signed PKG handoff digest mismatch");
  });

  test("permits mutation only from the exact tag or current main", () => {
    for (const workflow of [mobile, safari, apple]) {
      expect(workflow).toContain('release_tag="v$VERSION"');
      expect(workflow).toContain('"refs/tags/$release_tag")');
      expect(workflow).toContain("refs/heads/main)");
      expect(workflow).toContain(
        'if [ "$GITHUB_SHA" != "$(git rev-parse origin/main)" ] || ! git merge-base --is-ancestor "$tag_commit" "$GITHUB_SHA"; then'
      );
      expect(workflow).toContain(
        "A real release may run only from $release_tag or current main, not $GITHUB_REF."
      );
    }
  });

  test("reuses a Safari PKG only for its exact App Store build", () => {
    const assetLabel = (buildNumber: string) =>
      `App Store build ${buildNumber}`;

    expect(assetLabel("100")).not.toBe(assetLabel("101"));
    expect(safari).toContain('asset_label="App Store build $build_number"');
    expect(safari).toContain('[ "$existing_label" = "$asset_label" ]');
    expect(safari).toContain(
      'gh release upload "v$VERSION" "$PACKAGE_PATH#App Store build $build_number" --clobber'
    );
  });

  test("replays or dispatches every release from the one version tag", () => {
    for (const workflow of [
      "sdk-release.yml",
      "cli-release.yml",
      "extension-release.yml",
      "apple-release.yml",
      "mac-release.yml",
    ]) {
      expect(versionTag).toContain(`workflow: ${workflow}`);
    }
    // Expo is frozen: the native Apple app ships iPhone and iPad instead.
    expect(versionTag).not.toContain("workflow: mobile-release.yml");
    expect(versionTag).toContain(
      "title_prefix: Apple iOS\n            platforms: ios"
    );
    expect(versionTag).toContain('-f "platforms=$APPLE_PLATFORMS"');
    expect(apple).toContain(
      `run-name: Apple ${expression("inputs.platforms == 'both' && 'iOS + Mac' || inputs.platforms == 'macos' && 'Mac' || 'iOS'")} ${expression("inputs.version")}`
    );
    expect(versionTag).toContain(
      'gh workflow run "$WORKFLOW" --repo "$GITHUB_REPOSITORY"'
    );
    expect(versionTag).toContain(
      'node scripts/watch-release-run.mjs "$GITHUB_REPOSITORY" "$run_id"'
    );
    expect(versionTag).toContain(
      'node scripts/watch-release-run.mjs "$GITHUB_REPOSITORY" "$active"'
    );
    expect(versionTag).toContain(".display_title == $title");
    expect(versionTag).toContain('.event == "workflow_dispatch"');
    expect(versionTag).toContain("Reusing successful $WORKFLOW run");
    expect(versionTag).toContain("Waiting for existing $WORKFLOW run");
    expect(versionTag).toContain(
      "Waiting briefly for the tag-triggered $WORKFLOW run"
    );
    expect(versionTag).toContain("fail-fast: false");
    expect(mobile).toContain(`run-name: iOS ${expression("inputs.version")}`);
    expect(safari).toContain(`run-name: Mac ${expression("inputs.version")}`);
    expect(versionTag).toContain("release-version.mjs patch");
    expect(versionTag).toContain(
      'if [ "$previous_version" = "$VERSION" ]; then'
    );
    expect(versionTag).toContain('echo "changed=false" >> "$GITHUB_OUTPUT"');
  });

  test("supports safe dry runs and scheduled two-platform status checks", () => {
    expect(mobile).toContain("dry_run:");
    expect(safari).toContain("dry_run:");
    expect(status).toContain('cron: "17 */6 * * *"');
    expect(status).toContain("--platform IOS");
    expect(status).toContain("--platform MAC_OS");
    expect(status).toContain("apple-release-issue.mjs status");
    expect(status).toContain("apple-release-issue.mjs versions");
    expect(status).toContain("itunes.apple.com/lookup?id=$IOS_APP_ID");
    expect(status).toContain("itunes.apple.com/lookup?id=$SAFARI_APP_ID");
    expect(status).toContain('--ios-store-version "$ios_store"');
    expect(status).toContain('--safari-store-version "$safari_store"');
  });

  test("makes the newest package version replace an older Apple review", () => {
    for (const workflow of [mobile, safari, apple]) {
      const releaseState = workflowStep(
        workflow,
        "Resolve current Apple release state"
      );
      expect(releaseState).toContain(
        'node scripts/apple-latest-review.mjs apply "$versions_json" "$VERSION" "$ASC_APP_ID" "$PLATFORM" "$DRY_RUN"'
      );
      expect(releaseState).toContain('echo "target_id=$target_id"');
      expect(releaseState).toContain('echo "mutate=$mutate"');
    }
    expect(latestReview).toContain('"submit",\n      "cancel"');
    expect(latestReview).toContain('"versions",\n      "update"');
    expect(latestReview).toContain('"--version",\n      targetVersion');
    expect(latestReview).toContain("Multiple older App Store versions");
    expect(latestReview).toContain("newer than requested");
  });

  test("publishes replayable proof manifests after exact read-only verification", () => {
    for (const workflow of [mobile, safari, apple]) {
      expect(workflow).toContain("apple-release-proof.mjs verify");
      expect(workflow).toContain('asc builds info --build-id "$build_id"');
      expect(workflow).toContain(
        'asc review submissions-get --id "$submission_id" --include appStoreVersionForReview'
      );
      expect(workflow).toContain("apple-release-manifest.mjs create");
      expect(workflow).toContain("app-store.json");
      expect(workflow).toContain("gh release upload");
      expect(workflow).toContain("asc release stage");
    }
    expect(mobile).toContain("asc publish appstore");
    expect(safari).toContain(
      "asc publish appstore: explicit lower-level PKG flow remains canonical"
    );
  });

  test("ships the native app per platform from one archive-and-submit flow", () => {
    expect(apple).toContain(
      "options:\n          - ios\n          - macos\n          - both"
    );
    expect(apple).toContain("default: ios");
    expect(apple).toContain("dry_run:");
    expect(apple).toContain("runs-on: macos-26");
    expect(apple).toContain("if: inputs.dry_run == false");
    expect(apple).toContain("max-parallel: 1");
    // One App Store app, so share mobile-release's app-wide serialization.
    expect(apple).toContain(
      `group: mobile-app-store-ios-${expression("github.repository")}`
    );
    expect(apple).toContain('ASC_APP_ID: "6756574989"');
    expect(apple).toContain("PROJECT_PATH: apps/apple/Teak.xcodeproj");
    expect(apple).toContain("SCHEME_NAME: Teak");
    expect(apple).toContain('"destination":"generic/platform=iOS"');
    expect(apple).toContain('"destination":"generic/platform=macOS"');
    expect(apple).toContain("method string app-store-connect");
    expect(apple).toContain("manageAppVersionAndBuildNumber bool false");
    expect(apple).toContain(
      'ensure_certificate "IOS_DISTRIBUTION" "IOS_DISTRIBUTION"'
    );
    expect(apple).toContain("MAC_INSTALLER_DISTRIBUTION");
    expect(apple).not.toContain("expo prebuild");
    expect(apple).not.toContain("pod install");
  });

  test("allocates one build-number counter above the Expo history", () => {
    const buildState = workflowStep(
      apple,
      "Reuse an exact valid build or allocate the next Apple build number"
    );
    expect(buildState).toContain("--platform IOS --paginate");
    expect(buildState).toContain("--platform MAC_OS --paginate");
    expect(buildState).toContain(
      'node scripts/apple-build-number.mjs "$RUNNER_TEMP/apple-ios-all-builds.json" "$RUNNER_TEMP/apple-macos-all-builds.json"'
    );
    expect(buildState).toContain("asc builds next-build-number");
    expect(buildState).toContain(
      '[ "$build_number" -lt "$MINIMUM_BUILD_NUMBER" ]'
    );
    expect(apple).toContain('MINIMUM_BUILD_NUMBER: "90"');
  });

  test("verifies every signed bundle before it leaves the macOS runner", () => {
    const verify = workflowStep(
      apple,
      "Verify the signed package identity, versions, entitlements, profiles, and signatures"
    );
    for (const expected of [
      "pkgutil --check-signature",
      "CFBundleShortVersionString",
      "CFBundleVersion",
      "TeakConvexURL",
      "TeakSentryDSN",
      "keychain-access-groups:0",
      "com.apple.security.application-groups:0",
      "com.apple.security.app-sandbox",
      "embedded.mobileprovision",
      "Contents/embedded.provisionprofile",
      "codesign --verify --deep --strict",
      '"$SHARE_EXTENSION_BUNDLE_ID"|"$SAFARI_EXTENSION_BUNDLE_ID"',
    ]) {
      expect(verify).toContain(expected);
    }
    const handoff = workflowStep(apple, "Verify signed package handoff");
    expect(handoff).toContain("Signed package handoff digest mismatch");
    expect(apple.indexOf("Upload dSYMs to Sentry")).toBeLessThan(
      apple.indexOf("  submit:")
    );
  });

  test("uploads dSYMs to teak-apple-prod and skips only without a token", () => {
    const sentry = workflowStep(apple, "Upload dSYMs to Sentry");
    expect(apple).toContain("SENTRY_ORG: teakvault");
    expect(apple).toContain("SENTRY_PROJECT: teak-apple-prod");
    expect(sentry).toContain("debug-files upload");
    expect(sentry).toContain('if [ -z "$SENTRY_AUTH_TOKEN" ]; then');
    expect(sentry).toContain("::warning::");
  });

  test("applies the shared listing and skips empty screenshot sets", () => {
    const listing = workflowStep(
      apple,
      "Apply and verify the App Store listing and screenshots"
    );
    expect(listing).toContain(
      'bash apps/apple/scripts/apply-store-metadata.sh "$ASC_APP_ID" "$VERSION_ID" "$PLATFORM" "$first_version" "$RELEASE_NOTES"'
    );
    const script = read("apps/apple/scripts/apply-store-metadata.sh");
    expect(script).toContain('if [ "${#pngs[@]}" -eq 0 ]; then');
    expect(script).toContain(
      'bash scripts/store-assets/publish-apple.sh "apple-$set_name" "$VERSION_ID"'
    );
  });

  test("reuses Apple builds only with exact canonical provenance", () => {
    expect(mobile).toContain(
      'manifest_name="teak-ios-$VERSION-app-store.json"'
    );
    expect(mobile).toContain(
      '.build.id == $id and .build.number == $number and .artifact.sha256 != "" and .sentrySizeAnalysis == "success"'
    );
    expect(safari).toContain(
      'manifest_name="teak-mac-$VERSION-app-store.json"'
    );
    expect(safari).toContain('actual_sha="$(shasum -a 256 "$reusable_pkg"');
    expect(safari).toContain('[ "$actual_sha" != "$expected_sha" ]');
    expect(apple).toContain(
      'manifest_name="teak-apple-$SLUG-$VERSION-app-store.json"'
    );
    for (const workflow of [mobile, safari, apple]) {
      expect(workflow).toContain('reuse=false\n            build_id=""');
    }
  });

  test("pins every third-party action in the Apple release workflows", () => {
    const mutableAction = /^\s*uses:\s*[^./\s][^\s]*@(v\d+|main|master)\s*$/m;
    for (const workflow of [
      mobile,
      safari,
      apple,
      status,
      versionTag,
      ...productReleases,
    ]) {
      expect(workflow).not.toMatch(mutableAction);
    }
  });

  test("continues an exact version already attached to a review draft", () => {
    const exactAttachRecovery = `attach_exit=0
          asc versions attach-build`;
    const exactValidateException = `if [ "$validate_exit" -ne 0 ]; then
            if [ "$CURRENT_STATE" != "READY_FOR_REVIEW" ] || ! jq -e '
              .summary.errors == 1
              and .summary.blocking == 1
              and ([.remediation.steps[]? | select(.blocking == true) | .checkId] == ["version.state.editable"])
            '`;
    const exactDoctorException = `if [ "$doctor_exit" -ne 0 ]; then
            if [ "$CURRENT_STATE" != "READY_FOR_REVIEW" ] || ! jq -e '
              .summary.errors == 1
              and .summary.blocking == 1
              and ([.blockingChecks[]?.id] == ["version.state.editable"])
            '`;

    for (const workflow of [mobile, safari, apple]) {
      expect(workflow.split(exactAttachRecovery)).toHaveLength(2);
      expect(workflow).toContain(
        'asc versions view --version-id "$VERSION_ID" --include-build'
      );
      expect(workflow).toContain(
        '.id == $version and .state == "READY_FOR_REVIEW" and .buildId == $build'
      );
      expect(workflow.split(exactValidateException)).toHaveLength(2);
      expect(workflow.split(exactDoctorException)).toHaveLength(2);
      expect(workflow).toContain(
        "asc validate confirmed the only blocker is the expected existing READY_FOR_REVIEW draft"
      );
      expect(workflow).toContain(
        "the only blocker is the expected existing READY_FOR_REVIEW draft"
      );
    }
  });

  test("serializes failure deduplication by version", () => {
    for (const workflow of [mobile, safari, apple, status]) {
      expect(workflow).toContain("apple-release-issue-");
    }
    expect(apple).toContain("--workflow-file apple-release.yml");
    expect(mobile).toContain("apple-release-issue.mjs failure");
    expect(safari).toContain("apple-release-issue.mjs failure");
    expect(issueHelper).toContain("--ref main");
    expect(issueHelper).not.toContain(" --ref v");
  });
});
