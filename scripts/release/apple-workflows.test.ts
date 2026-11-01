import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../..");
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
  const apple = read(".github/workflows/apple-release.yml");
  const status = read(".github/workflows/apple-release-status.yml");
  const issueHelper = read("scripts/release/apple-release-issue.ts");
  const latestReview = read("scripts/release/apple-latest-review.ts");
  const versionTag = read(".github/workflows/version-tag.yml");
  const productReleases = [
    read(".github/workflows/cli-release.yml"),
    read(".github/workflows/extension-release.yml"),
  ];
  const setupAscPin =
    "rudrankriyam/setup-asc@5358c70a27a3f0d1517604b0f1fdc43e70c1cc4d";

  test("pins one explicit asc release and immutable setup action", () => {
    for (const [workflow, version] of [
      [apple, "5.14.0"],
      [status, "3.6.1"],
    ]) {
      expect(workflow).toContain(`ASC_VERSION: "${version}"`);
      expect(workflow).toContain(setupAscPin);
      expect(workflow).not.toContain("setup-asc@v");
    }
  });

  test("serializes app-wide Apple mutations across versions", () => {
    // One App Store app for every platform; the group name predates
    // apple-release.yml and must stay stable.
    expect(apple).toContain(
      `group: mobile-app-store-ios-${expression("github.repository")}`
    );
    expect(apple).toContain("cancel-in-progress: false");
  });

  test("permits mutation only from the exact tag or current main", () => {
    for (const workflow of [apple]) {
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

  test("replays or dispatches every release from the one version tag", () => {
    for (const workflow of [
      "sdk-release.yml",
      "cli-release.yml",
      "extension-release.yml",
      "apple-release.yml",
    ]) {
      expect(versionTag).toContain(`workflow: ${workflow}`);
    }
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
      'node scripts/release/watch-release-run.ts "$GITHUB_REPOSITORY" "$run_id"'
    );
    expect(versionTag).toContain(
      'node scripts/release/watch-release-run.ts "$GITHUB_REPOSITORY" "$active"'
    );
    expect(versionTag).toContain(".display_title == $title");
    expect(versionTag).toContain('.event == "workflow_dispatch"');
    expect(versionTag).toContain("Reusing successful $WORKFLOW run");
    expect(versionTag).toContain("Waiting for existing $WORKFLOW run");
    expect(versionTag).toContain(
      "Waiting briefly for the tag-triggered $WORKFLOW run"
    );
    expect(versionTag).toContain("fail-fast: false");
    expect(versionTag).toContain("release-version.ts patch");
    expect(versionTag).toContain(
      'if [ "$previous_version" = "$VERSION" ]; then'
    );
    expect(versionTag).toContain('echo "changed=false" >> "$GITHUB_OUTPUT"');
  });

  test("supports safe dry runs and scheduled two-platform status checks", () => {
    expect(status).toContain('cron: "17 */6 * * *"');
    expect(status).toContain("--platform IOS");
    expect(status).toContain("--platform MAC_OS");
    expect(status).toContain("apple-release-issue.ts status");
    expect(status).toContain("apple-release-issue.ts versions");
    expect(status).toContain("itunes.apple.com/lookup?id=$IOS_APP_ID");
    expect(status).toContain("itunes.apple.com/lookup?id=$SAFARI_APP_ID");
    expect(status).toContain('--ios-store-version "$ios_store"');
    expect(status).toContain('--safari-store-version "$safari_store"');
  });

  test("starts the Mac release once per version after iOS is live", () => {
    const check = workflowStep(status, "Check every pending Apple release");
    expect(status).toContain("  actions: write\n");
    expect(check).toContain(
      'apple-release-issue.ts mac-due --ios-state "$ios_state" --safari-state "$safari_state"'
    );
    expect(check).toContain(
      'if [ "$GITHUB_EVENT_NAME" = "schedule" ] && [ "$version" = "$root_version" ] && [ "$mac_due" = "true" ]; then'
    );
    expect(check).toContain(
      "versions | jq -c --arg version \"$root_version\" '. + [$version] | unique'"
    );
    expect(check).toContain(
      "gh run list --workflow apple-release.yml --limit 1000"
    );
    expect(check).toContain(
      '\\"Apple Mac $version (release)\\" or .displayTitle == \\"Apple iOS + Mac $version (release)\\"'
    );
    expect(check).toContain(
      'gh workflow run apple-release.yml --ref main -f "version=$version" -f platforms=macos -f dry_run=false'
    );
    expect(apple).toContain(
      `run-name: Apple ${expression("inputs.platforms == 'both' && 'iOS + Mac' || inputs.platforms == 'macos' && 'Mac' || 'iOS'")} ${expression("inputs.version")} (${expression("inputs.dry_run && 'dry run' || 'release'")})`
    );
  });

  test("makes the newest package version replace an older Apple review", () => {
    for (const workflow of [apple]) {
      const releaseState = workflowStep(
        workflow,
        "Resolve current Apple release state"
      );
      expect(releaseState).toContain(
        'node scripts/release/apple-latest-review.ts apply "$versions_json" "$VERSION" "$ASC_APP_ID" "$PLATFORM" "$DRY_RUN"'
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
    for (const workflow of [apple]) {
      expect(workflow).toContain("apple-release-proof.ts verify");
      expect(workflow).toContain('asc builds info --build-id "$build_id"');
      expect(workflow).toContain(
        'asc review submissions-get --id "$submission_id" --include appStoreVersionForReview'
      );
      expect(workflow).toContain("apple-release-manifest.ts create");
      expect(workflow).toContain("app-store.json");
      expect(workflow).toContain("gh release upload");
      expect(workflow).toContain("asc release stage");
    }
  });

  test("ships the native app per platform from one archive-and-submit flow", () => {
    expect(apple).toContain(
      "options:\n          - ios\n          - macos\n          - both"
    );
    expect(apple).toContain("default: ios");
    expect(apple).toContain("dry_run:");
    expect(apple).toContain("runs-on: xcode-27");
    expect(apple).toContain("apps/apple/scripts/select-xcode.sh");
    expect(apple).toContain("if: inputs.dry_run == false");
    expect(apple).toContain("max-parallel: 1");
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
      'node scripts/release/apple-build-number.ts "$RUNNER_TEMP/apple-ios-all-builds.json" "$RUNNER_TEMP/apple-macos-all-builds.json"'
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
      "TeakPostHogToken",
      "keychain-access-groups:0",
      "com.apple.security.application-groups:0",
      "com.apple.security.app-sandbox",
      "embedded.mobileprovision",
      "Contents/embedded.provisionprofile",
      "codesign --verify --deep --strict",
      '"$SHARE_EXTENSION_BUNDLE_ID"|"$SAFARI_EXTENSION_BUNDLE_ID"|"$WIDGETS_EXTENSION_BUNDLE_ID"',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a Bash array length in the script, not a JS template.
      '[ "${#extensions[@]}" -ne 3 ]',
    ]) {
      expect(verify).toContain(expected);
    }
    const handoff = workflowStep(apple, "Verify signed package handoff");
    expect(handoff).toContain("Signed package handoff digest mismatch");
    expect(verify).toContain(
      'if [ "$expected_bundle" = "$APP_BUNDLE_ID" ] && [ -z "$posthog_token" ]; then'
    );
    expect(verify).toContain("must not carry TeakPostHogToken");
    expect(apple.indexOf("Upload dSYMs to PostHog")).toBeLessThan(
      apple.indexOf("  submit:")
    );
  });

  test("builds the app with the PostHog token and uploads its dSYMs", () => {
    const archive = workflowStep(apple, "Archive the Release build");
    expect(archive).toContain(
      `POSTHOG_PROJECT_TOKEN: ${expression("secrets.POSTHOG_PROJECT_TOKEN")}`
    );
    expect(archive).toContain('TEAK_POSTHOG_TOKEN="$POSTHOG_PROJECT_TOKEN"');
    const posthog = workflowStep(apple, "Upload dSYMs to PostHog");
    expect(apple).toContain('POSTHOG_CLI_VERSION: "0.18.10"');
    expect(apple).toContain("POSTHOG_CLI_HOST: https://us.posthog.com");
    expect(posthog).toContain(
      'npx --yes "@posthog/cli@$POSTHOG_CLI_VERSION" dsym upload'
    );
    expect(posthog).toContain(
      'if [ -z "$POSTHOG_CLI_API_KEY" ] || [ -z "$POSTHOG_CLI_PROJECT_ID" ]; then'
    );
    expect(posthog).toContain("::warning::");
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
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a Bash array length in the script, not a JS template.
    expect(script).toContain('if [ "${#pngs[@]}" -eq 0 ]; then');
    expect(script).toContain(
      'bash scripts/store-assets/publish-apple.sh "apple-$set_name" "$VERSION_ID"'
    );
  });

  test("reuses Apple builds only with exact canonical provenance", () => {
    expect(apple).toContain(
      'manifest_name="teak-apple-$SLUG-$VERSION-app-store.json"'
    );
    expect(apple).toContain('reuse=false\n            build_id=""');
  });

  test("pins every third-party action in the Apple release workflows", () => {
    const mutableAction = /^\s*uses:\s*[^./\s][^\s]*@(v\d+|main|master)\s*$/m;
    for (const workflow of [apple, status, versionTag, ...productReleases]) {
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

    for (const workflow of [apple]) {
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
    for (const workflow of [apple, status]) {
      expect(workflow).toContain("apple-release-issue-");
    }
    expect(apple).toContain("--workflow-file apple-release.yml");
    expect(apple).toContain("apple-release-issue.ts failure");
    expect(issueHelper).toContain("--ref main");
    expect(issueHelper).not.toContain(" --ref v");
  });
});
