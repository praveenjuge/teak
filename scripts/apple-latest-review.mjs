import { spawnSync } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseVersion } from "./release-version.mjs";

const cancellableStates = new Set([
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "WAITING_FOR_EXPORT_COMPLIANCE",
  "WAITING_FOR_REVIEW",
]);
const cancellationReadyStates = new Set([
  "DEVELOPER_REJECTED",
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
]);
const reusableStates = new Set(["PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW"]);
const releasedStates = new Set([
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_SALE",
]);
const completedStates = new Set([
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PENDING_DEVELOPER_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_SALE",
  "WAITING_FOR_EXPORT_COMPLIANCE",
  "WAITING_FOR_REVIEW",
]);
const mutableStates = new Set([
  "",
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
]);

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

function normalizeVersion(resource) {
  const attributes = resource?.attributes ?? {};
  const version = attributes.versionString;
  if (typeof resource?.id !== "string" || typeof version !== "string") {
    throw new Error(
      "Every App Store version must have an id and versionString."
    );
  }
  parseVersion(version);
  return {
    id: resource.id,
    state: attributes.appVersionState ?? attributes.appStoreState ?? "",
    version,
  };
}

function newest(versions) {
  return versions.toSorted((left, right) =>
    compareVersions(right.version, left.version)
  )[0];
}

export function planLatestReviewVersion(response, targetVersion) {
  parseVersion(targetVersion);
  if (!Array.isArray(response?.data)) {
    throw new Error(
      "Expected an App Store versions response with a data array."
    );
  }
  const versions = response.data.map(normalizeVersion);
  const newer = versions.find(
    (candidate) => compareVersions(candidate.version, targetVersion) > 0
  );
  if (newer) {
    throw new Error(
      `App Store version ${newer.version} is newer than requested ${targetVersion}.`
    );
  }

  const targets = versions.filter(
    (candidate) => candidate.version === targetVersion
  );
  if (targets.length > 1) {
    throw new Error(`Multiple App Store versions match ${targetVersion}.`);
  }
  const target = targets[0];
  const activeOlder = versions.filter(
    (candidate) =>
      candidate.version !== targetVersion &&
      cancellableStates.has(candidate.state)
  );
  if (activeOlder.length > 1) {
    throw new Error(
      `Multiple older App Store versions have active reviews: ${activeOlder
        .map((candidate) => `${candidate.version}/${candidate.state}`)
        .join(", ")}.`
    );
  }

  const reusableOlder = versions.filter(
    (candidate) =>
      candidate.version !== targetVersion && reusableStates.has(candidate.state)
  );
  const superseded =
    activeOlder[0] ?? (target ? undefined : newest(reusableOlder));
  const source = newest(
    versions.filter(
      (candidate) =>
        candidate.version !== targetVersion &&
        releasedStates.has(candidate.state)
    )
  );

  return {
    cancelSuperseded: Boolean(
      superseded && cancellableStates.has(superseded.state)
    ),
    promoteSuperseded: Boolean(superseded && !target),
    sourceVersion: source?.version ?? "",
    supersededId: superseded?.id ?? "",
    supersededState: superseded?.state ?? "",
    supersededVersion: superseded?.version ?? "",
    targetId: target?.id ?? "",
    targetState: target?.state ?? "",
  };
}

function runAsc(args) {
  const result = spawnSync("asc", [...args, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `asc ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`
    );
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : {};
}

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForCancellation(versionId, runCommand, waitCommand) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const version = runCommand(["versions", "view", "--version-id", versionId]);
    if (cancellationReadyStates.has(version.state)) {
      return version;
    }
    await waitCommand(15_000);
  }
  throw new Error(
    `Timed out waiting for App Store version ${versionId} cancellation.`
  );
}

function mutationForState(state, allowCancelledDeveloperRejection) {
  if (mutableStates.has(state)) {
    return true;
  }
  if (state === "DEVELOPER_REJECTED" && allowCancelledDeveloperRejection) {
    return true;
  }
  if (completedStates.has(state)) {
    return false;
  }
  throw new Error(`Refusing to mutate App Store version in state: ${state}`);
}

export async function applyLatestReviewVersion({
  appId,
  dryRun,
  platform,
  response,
  runCommand = runAsc,
  targetVersion,
  waitCommand = wait,
}) {
  const plan = planLatestReviewVersion(response, targetVersion);
  if (dryRun) {
    return { ...plan, mutate: false };
  }

  if (plan.cancelSuperseded) {
    runCommand([
      "submit",
      "cancel",
      "--version-id",
      plan.supersededId,
      "--app",
      appId,
      "--confirm",
    ]);
    await waitForCancellation(plan.supersededId, runCommand, waitCommand);
  }

  let targetId = plan.targetId;
  let targetState = plan.targetState;
  if (plan.promoteSuperseded) {
    runCommand([
      "versions",
      "update",
      "--version-id",
      plan.supersededId,
      "--version",
      targetVersion,
      "--release-type",
      "AFTER_APPROVAL",
    ]);
    const exact = runCommand([
      "versions",
      "list",
      "--app",
      appId,
      "--platform",
      platform,
      "--version",
      targetVersion,
      "--limit",
      "2",
    ]).data;
    if (exact?.length !== 1 || exact[0].id !== plan.supersededId) {
      throw new Error(
        `App Store did not promote exactly one version to ${targetVersion}.`
      );
    }
    targetId = exact[0].id;
    targetState =
      exact[0].attributes?.appVersionState ??
      exact[0].attributes?.appStoreState ??
      "";
  }

  return {
    ...plan,
    mutate: mutationForState(
      targetState,
      plan.cancelSuperseded && plan.promoteSuperseded
    ),
    targetId,
    targetState,
  };
}

function usage() {
  throw new Error(
    "Usage: node scripts/apple-latest-review.mjs plan <versions-json> <target-version> | apply <versions-json> <target-version> <app-id> <platform> <dry-run>"
  );
}

async function main() {
  const [command, inputPath, targetVersion, appId, platform, dryRun] =
    process.argv.slice(2);
  if (!(inputPath && targetVersion)) {
    usage();
  }
  const response = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (command === "plan" && !appId) {
    process.stdout.write(
      `${JSON.stringify(planLatestReviewVersion(response, targetVersion))}\n`
    );
    return;
  }
  if (
    command !== "apply" ||
    !appId ||
    !platform ||
    !["true", "false"].includes(dryRun)
  ) {
    usage();
  }
  const result = await applyLatestReviewVersion({
    appId,
    dryRun: dryRun === "true",
    platform,
    response,
    targetVersion,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
