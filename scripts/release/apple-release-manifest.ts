import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ReleaseProof } from "./apple-release-proof.ts";
import { parseArguments, readJson, required } from "./release-cli.ts";

interface ReleaseContext {
  appId?: string;
  artifactName?: string;
  artifactSha?: string;
  ascVersion?: string;
  generatedAt?: string;
  publishExit?: string;
  sourceSha?: string;
  stageExit?: string;
  tag?: string;
  workflow?: string;
}

export interface ReleaseManifest
  extends Omit<
    ReleaseProof,
    "buildId" | "buildNumber" | "submissionId" | "submissionState"
  > {
  appId: string;
  artifact: { name: string; sha256: string };
  ascVersion: string;
  build: { id: string; number: string };
  generatedAt: string;
  highLevelEvaluation: {
    publishAppStoreDryRunExit: string;
    releaseStageDryRunExit: string;
  };
  sourceSha: string;
  sourceWorkflow: string;
  submission: { id: string; state: string };
  tag: string;
  verifiedAt: string;
  workflow: string;
}

function verifyPrior(
  prior: Partial<ReleaseManifest>,
  proof: ReleaseProof,
  context: { appId: string; tag: string }
) {
  const pairs = [
    [prior.version, proof.version, "version"],
    [prior.platform, proof.platform, "platform"],
    [prior.tag, context.tag, "tag"],
    [prior.appId, context.appId, "app ID"],
    [prior.build?.id, proof.buildId, "build ID"],
    [prior.build?.number, proof.buildNumber, "build number"],
    [prior.submission?.id, proof.submissionId, "submission ID"],
  ];
  for (const [actual, expected, label] of pairs) {
    if (
      required(actual, `prior ${label}`) !==
      required(expected, `current ${label}`)
    ) {
      throw new Error(`Prior manifest ${label} does not match current proof.`);
    }
  }
}

export function createReleaseManifest({
  proof,
  prior,
  context,
}: {
  context: ReleaseContext;
  prior?: Partial<ReleaseManifest>;
  proof: ReleaseProof;
}): ReleaseManifest {
  const now = required(context.generatedAt, "verification time");
  const tag = required(context.tag, "tag");
  const appId = required(context.appId, "app ID");
  if (prior) {
    verifyPrior(prior, proof, { tag, appId });
  }

  const artifact = prior?.artifact ?? {
    name: required(context.artifactName, "artifact name"),
    sha256: required(context.artifactSha, "artifact SHA-256"),
  };
  const sourceWorkflow =
    prior?.sourceWorkflow ??
    prior?.workflow ??
    required(context.workflow, "workflow URL");
  const stageExit =
    context.stageExit === "not_run"
      ? (prior?.highLevelEvaluation?.releaseStageDryRunExit ?? "not_run")
      : required(context.stageExit, "asc release stage result");
  const publishExit =
    context.publishExit === "not_run"
      ? (prior?.highLevelEvaluation?.publishAppStoreDryRunExit ?? "not_run")
      : required(context.publishExit, "asc publish appstore result");

  const {
    buildId,
    buildNumber,
    submissionId,
    submissionState,
    ...proofFields
  } = proof;
  const manifest: ReleaseManifest = {
    ...proofFields,
    tag,
    sourceSha: prior?.sourceSha ?? required(context.sourceSha, "source SHA"),
    sourceWorkflow,
    appId,
    artifact,
    ascVersion:
      prior?.ascVersion ?? required(context.ascVersion, "asc version"),
    highLevelEvaluation: {
      releaseStageDryRunExit: stageExit,
      publishAppStoreDryRunExit: publishExit,
    },
    workflow: required(context.workflow, "workflow URL"),
    generatedAt: prior?.generatedAt ?? now,
    verifiedAt: now,
    build: { id: buildId, number: buildNumber },
    submission: { id: submissionId, state: submissionState },
  };
  return manifest;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "create") {
    throw new Error("Expected create command.");
  }
  const values = parseArguments(args);
  const manifest = createReleaseManifest({
    proof: readJson<ReleaseProof>(values.proof, "release proof"),
    prior: values.prior
      ? readJson<Partial<ReleaseManifest>>(values.prior, "prior manifest")
      : undefined,
    context: {
      tag: values.tag,
      sourceSha: values["source-sha"],
      appId: values["app-id"],
      artifactName: values["artifact-name"],
      artifactSha: values["artifact-sha"],
      ascVersion: values["asc-version"],
      stageExit: values["stage-exit"],
      publishExit: values["publish-exit"],
      workflow: values.workflow,
      generatedAt: values["generated-at"],
    },
  });
  fs.writeFileSync(
    required(values.output, "output path"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 }
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
