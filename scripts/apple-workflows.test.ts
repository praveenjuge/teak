import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const read = (relative: string) =>
  fs.readFileSync(path.join(repoRoot, relative), "utf8");

describe("Apple release workflows", () => {
  const mobile = read(".github/workflows/mobile-release.yml");
  const safari = read(".github/workflows/safari-extension-release.yml");
  const status = read(".github/workflows/apple-release-status.yml");
  const versionTag = read(".github/workflows/version-tag.yml");
  const setupAscPin =
    "rudrankriyam/setup-asc@5358c70a27a3f0d1517604b0f1fdc43e70c1cc4d";

  test("pins one explicit asc release and immutable setup action", () => {
    for (const workflow of [mobile, safari, status]) {
      expect(workflow).toContain('ASC_VERSION: "3.6.1"');
      expect(workflow).toContain(setupAscPin);
      expect(workflow).not.toContain("setup-asc@v");
    }
  });

  test("keeps iOS on hosted EAS build plus asc upload and review", () => {
    expect(mobile).toContain("--profile production");
    expect(mobile).toContain("--non-interactive");
    expect(mobile).toContain("Upload IPA to Sentry Size Analysis");
    expect(mobile).toContain("asc builds upload");
    expect(mobile).toContain("asc validate");
    expect(mobile).toContain("asc review doctor");
    expect(mobile).toContain("asc review submit");
    expect(mobile).not.toContain("eas submit");
    expect(mobile).not.toContain("submit-app-review.mjs");
    expect(mobile).toContain("--limit 50");
    expect(mobile).not.toContain("--limit 100");
  });

  test("keeps Safari PKG artifacts while using asc for every Apple operation", () => {
    expect(safari).toContain("xcodebuild archive");
    expect(safari).toContain("asc certificates");
    expect(safari).toContain("asc profiles");
    expect(safari).toContain("asc builds upload");
    expect(safari).toContain("--pkg");
    expect(safari).toContain("teak-safari-$VERSION-mac-app-store.pkg");
    expect(safari).toContain("asc review submit");
    expect(safari).not.toContain("apps/safari-extension/scripts/");
    expect(safari).not.toContain("xcrun altool");
    expect(safari).toContain('[ "$candidate_hash" = "$private_hash" ]');
    expect(safari).not.toContain("EXPECTED_SIGNING_IDENTITY");
  });

  test("permits real recovery only from a tagged release descendant", () => {
    for (const workflow of [mobile, safari]) {
      expect(workflow).toContain('release_tag="v$VERSION"');
      expect(workflow).toContain(
        'git merge-base --is-ancestor "$tag_commit" "$GITHUB_SHA"'
      );
      expect(workflow).toContain("descendant recovery commits");
    }
  });

  test("reuses a Safari PKG only for its exact App Store build", () => {
    const assetLabel = (buildNumber: string) =>
      `App Store build ${buildNumber}`;

    expect(assetLabel("100")).not.toBe(assetLabel("101"));
    expect(safari).toContain('asset_label="App Store build $build_number"');
    expect(safari).toContain('[ "$existing_label" = "$asset_label" ]');
    expect(safari).toContain(
      'labeled_package="$PACKAGE_PATH#App Store build $BUILD_NUMBER"'
    );
  });

  test("dispatches every release from the one version tag", () => {
    for (const workflow of [
      "cli-release.yml",
      "desktop-release.yml",
      "extension-release.yml",
      "mobile-release.yml",
      "safari-extension-release.yml",
    ]) {
      expect(versionTag).toContain(`gh workflow run ${workflow}`);
    }
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
  });

  test("serializes failure deduplication by version", () => {
    for (const workflow of [mobile, safari, status]) {
      expect(workflow).toContain("apple-release-issue-");
    }
    expect(mobile).toContain("apple-release-issue.mjs failure");
    expect(safari).toContain("apple-release-issue.mjs failure");
  });
});
