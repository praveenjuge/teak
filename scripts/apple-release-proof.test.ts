import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { verifyReleaseProof } from "./apple-release-proof.mjs";

const fixtureRoot = path.join(import.meta.dir, "fixtures/apple-release");
const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8"));

const waiting = () => ({
  versionList: fixture("waiting-ios-version-list.json"),
  versionView: fixture("waiting-ios-version-view.json"),
  build: fixture("waiting-ios-build.json"),
  submission: fixture("waiting-ios-submission.json"),
  expected: fixture("waiting-ios-expected.json"),
});

describe("Apple release proof", () => {
  test("accepts an exact valid build waiting for review with automatic release", () => {
    expect(verifyReleaseProof(waiting())).toEqual({
      version: "1.0.61",
      platform: "IOS",
      versionId: "ios-version-61",
      state: "WAITING_FOR_REVIEW",
      releaseType: "AFTER_APPROVAL",
      buildId: "ios-build-65",
      buildNumber: "65",
      processingState: "VALID",
      submissionId: "ios-submission-61",
      submissionState: "WAITING_FOR_REVIEW",
    });
  });

  test("rejects the wrong attached build", () => {
    const input = waiting();
    input.expected.buildId = "unrelated-build";
    expect(() => verifyReleaseProof(input)).toThrow(
      "attached build ID mismatch"
    );
  });

  test("rejects manual release configuration", () => {
    const input = waiting();
    input.versionList.data[0].attributes.releaseType = "MANUAL";
    expect(() => verifyReleaseProof(input)).toThrow("release type mismatch");
  });

  test("rejects a non-valid build", () => {
    const input = waiting();
    input.build.data.attributes.processingState = "PROCESSING";
    expect(() => verifyReleaseProof(input)).toThrow(
      "build processing state mismatch"
    );
  });

  test("rejects a waiting version without an in-flight submission", () => {
    const input = waiting();
    input.submission.data.attributes.state = "READY_FOR_REVIEW";
    expect(() => verifyReleaseProof(input)).toThrow(
      "in-flight submission state mismatch"
    );
  });

  test("ignores newer app-wide latest records when replaying an older release", () => {
    const input = {
      ...waiting(),
      status: fixture("waiting-ios-status.json"),
    };
    input.status.appstore.version = "1.0.62";
    input.status.builds.latest = {
      ...input.status.builds.latest,
      id: "ios-build-66",
      version: "1.0.62",
      buildNumber: "66",
    };
    input.status.review.latestSubmissionId = "ios-submission-62";
    expect(verifyReleaseProof(input).buildId).toBe("ios-build-65");
  });
});
