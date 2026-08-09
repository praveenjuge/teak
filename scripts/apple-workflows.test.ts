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
  const safari = read(".github/workflows/safari-extension-release.yml");
  const status = read(".github/workflows/apple-release-status.yml");
  const issueHelper = read("scripts/apple-release-issue.mjs");
  const versionTag = read(".github/workflows/version-tag.yml");
  const productReleases = [
    read(".github/workflows/cli-release.yml"),
    read(".github/workflows/desktop-release.yml"),
    read(".github/workflows/extension-release.yml"),
  ];
  const setupAscPin =
    "rudrankriyam/setup-asc@5358c70a27a3f0d1517604b0f1fdc43e70c1cc4d";

  test("pins one explicit asc release and immutable setup action", () => {
    for (const workflow of [mobile, safari, status]) {
      expect(workflow).toContain('ASC_VERSION: "3.6.1"');
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
    const verifyHandoff = workflowStep(
      mobile,
      "Verify signed IPA handoff"
    );
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

  test("serializes app-wide iOS build-number allocation through upload", () => {
    expect(mobile).toContain(
      `group: mobile-app-store-ios-${expression("github.repository")}`
    );
    expect(mobile).not.toContain(
      `group: mobile-app-store-${expression("inputs.version")}`
    );
    expect(mobile).toContain("cancel-in-progress: false");
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
    expect(safari).toContain("teak-safari-$VERSION-mac-app-store.pkg");
    expect(safari).toContain("asc review submissions-submit");
    expect(safari).toContain("--include appStoreVersion");
    expect(safari).not.toContain("apps/safari-extension/scripts/");
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
    for (const workflow of [mobile, safari]) {
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
      "cli-release.yml",
      "desktop-release.yml",
      "extension-release.yml",
      "mobile-release.yml",
      "safari-extension-release.yml",
    ]) {
      expect(versionTag).toContain(`workflow: ${workflow}`);
    }
    expect(versionTag).toContain(
      'gh workflow run "$WORKFLOW" --repo "$GITHUB_REPOSITORY"'
    );
    expect(versionTag).toContain(
      'gh run watch "$run_id" --repo "$GITHUB_REPOSITORY"'
    );
    expect(versionTag).toContain(
      'gh run watch "$active" --repo "$GITHUB_REPOSITORY"'
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
    expect(safari).toContain(
      `run-name: Safari macOS ${expression("inputs.version")}`
    );
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

  test("publishes replayable proof manifests after exact read-only verification", () => {
    for (const workflow of [mobile, safari]) {
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
      "asc publish appstore: not used because 3.6.1 has no PKG input"
    );
  });

  test("pins every third-party action in the Apple release workflows", () => {
    const mutableAction = /^\s*uses:\s*[^./\s][^\s]*@(v\d+|main|master)\s*$/m;
    for (const workflow of [
      mobile,
      safari,
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

    for (const workflow of [mobile, safari]) {
      expect(workflow).toContain('""|PREPARE_FOR_SUBMISSION|READY_FOR_REVIEW)');
      expect(workflow).not.toContain(
        "WAITING_FOR_REVIEW|READY_FOR_REVIEW|IN_REVIEW"
      );
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
    for (const workflow of [mobile, safari, status]) {
      expect(workflow).toContain("apple-release-issue-");
    }
    expect(mobile).toContain("apple-release-issue.mjs failure");
    expect(safari).toContain("apple-release-issue.mjs failure");
    expect(issueHelper).toContain("--ref main");
    expect(issueHelper).not.toContain(" --ref v");
  });
});
