import { describe, expect, test } from "bun:test";
import { createReleaseManifest } from "./apple-release-manifest.mjs";

const proof = {
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
};

const context = {
  tag: "v1.0.61",
  sourceSha: "a".repeat(40),
  appId: "6756574989",
  artifactName: "Teak-1.0.61.ipa",
  artifactSha: "b".repeat(64),
  sentrySizeAnalysis: "success",
  ascVersion: "3.6.1",
  stageExit: "0",
  publishExit: "0",
  workflow: "https://github.com/praveenjuge/teak/actions/runs/100",
  generatedAt: "2026-08-09T00:00:00Z",
};

describe("Apple release manifest", () => {
  test("records immutable artifact provenance and exact proof", () => {
    const manifest = createReleaseManifest({ proof, context });
    expect(manifest.artifact.sha256).toBe(context.artifactSha);
    expect(manifest.build).toEqual({ id: "ios-build-65", number: "65" });
    expect(manifest.submission.id).toBe("ios-submission-61");
    expect(manifest.sentrySizeAnalysis).toBe("success");
    expect(manifest.sourceWorkflow).toBe(context.workflow);
    expect(manifest.verifiedAt).toBe(context.generatedAt);
  });

  test("preserves provenance while refreshing read-only proof", () => {
    const prior = createReleaseManifest({ proof, context });
    const replay = createReleaseManifest({
      proof: { ...proof, state: "IN_REVIEW", submissionState: "IN_REVIEW" },
      prior,
      context: {
        ...context,
        sourceSha: "c".repeat(40),
        artifactName: "",
        artifactSha: "",
        stageExit: "not_run",
        publishExit: "not_run",
        workflow: "https://github.com/praveenjuge/teak/actions/runs/101",
        generatedAt: "2026-08-09T01:00:00Z",
      },
    });
    expect(replay.sourceSha).toBe(prior.sourceSha);
    expect(replay.sourceWorkflow).toBe(prior.sourceWorkflow);
    expect(replay.artifact).toEqual(prior.artifact);
    expect(replay.highLevelEvaluation).toEqual(prior.highLevelEvaluation);
    expect(replay.generatedAt).toBe(prior.generatedAt);
    expect(replay.verifiedAt).toBe("2026-08-09T01:00:00Z");
    expect(replay.state).toBe("IN_REVIEW");
  });

  test("rejects a prior manifest for another build", () => {
    const prior = createReleaseManifest({ proof, context });
    prior.build.id = "unrelated-build";
    expect(() => createReleaseManifest({ proof, prior, context })).toThrow(
      "Prior manifest build ID does not match current proof"
    );
  });
});
