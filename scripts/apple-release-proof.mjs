import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseVersion } from "./release-version.mjs";

export const reviewStates = new Set([
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "PENDING_APPLE_RELEASE",
  "PROCESSING_FOR_DISTRIBUTION",
  "READY_FOR_DISTRIBUTION",
  "READY_FOR_SALE",
]);

function required(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing ${label}.`);
  }
  return normalized;
}

function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!(flag?.startsWith("--") && value !== undefined)) {
      throw new Error(`Invalid argument near ${flag ?? "end of command"}.`);
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

function readJson(path, label) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function versionRecord(payload) {
  const row = payload?.data?.[0] ?? payload?.data ?? payload;
  const attributes = row?.attributes ?? row ?? {};
  return {
    id: row?.id ?? attributes.id,
    version: attributes.versionString ?? attributes.version,
    platform: attributes.platform,
    state:
      attributes.appVersionState ??
      attributes.appStoreState ??
      attributes.state,
    releaseType: attributes.releaseType,
    buildId:
      attributes.buildId ??
      row?.relationships?.build?.data?.id ??
      payload?.included?.find?.((item) => item.type === "builds")?.id,
    buildNumber: attributes.buildNumber ?? attributes.buildVersion,
    submissionId:
      attributes.submissionId ??
      row?.relationships?.appStoreVersionSubmission?.data?.id,
  };
}

function buildRecord(payload) {
  const row = payload?.data ?? payload;
  const preReleaseVersion = payload?.included?.find?.(
    (item) => item.type === "preReleaseVersions"
  );
  return {
    id: row?.id,
    buildNumber: row?.attributes?.version,
    processingState: row?.attributes?.processingState,
    version: preReleaseVersion?.attributes?.version,
    platform: preReleaseVersion?.attributes?.platform,
  };
}

function submissionRecord(payload) {
  const row = payload?.data ?? payload;
  return {
    id: row?.id,
    state: row?.attributes?.state,
    platform: row?.attributes?.platform,
    versionId: row?.relationships?.appStoreVersionForReview?.data?.id,
  };
}

function same(actual, expected, label) {
  if (required(actual, label) !== required(expected, `expected ${label}`)) {
    throw new Error(
      `${label} mismatch: received ${actual}, expected ${expected}.`
    );
  }
}

export function verifyReleaseProof({
  versionList,
  versionView,
  build,
  submission,
  expected,
}) {
  const version = required(expected.version, "expected version");
  parseVersion(version);
  const platform = required(
    expected.platform,
    "expected platform"
  ).toUpperCase();
  if (!new Set(["IOS", "MAC_OS"]).has(platform)) {
    throw new Error(`Unsupported platform: ${platform}.`);
  }

  const listed = versionRecord(versionList);
  const viewed = versionRecord(versionView);
  const exactBuild = buildRecord(build);
  const exactSubmission = submissionRecord(submission);
  const versionId = required(
    expected.versionId ?? listed.id ?? viewed.id,
    "version ID"
  );
  const buildId = required(expected.buildId, "expected build ID");
  const buildNumber = required(expected.buildNumber, "expected build number");

  same(listed.id, versionId, "listed version ID");
  same(viewed.id, versionId, "viewed version ID");
  same(listed.version, version, "listed version");
  if (viewed.version) {
    same(viewed.version, version, "viewed version");
  }
  same(String(listed.platform).toUpperCase(), platform, "listed platform");
  if (viewed.platform) {
    same(String(viewed.platform).toUpperCase(), platform, "viewed platform");
  }

  const state = required(
    listed.state ?? viewed.state,
    "release state"
  ).toUpperCase();
  if (!reviewStates.has(state)) {
    throw new Error(
      `Release state ${state} is not waiting for review or later.`
    );
  }
  for (const candidate of [listed.state, viewed.state].filter(Boolean)) {
    same(String(candidate).toUpperCase(), state, "release state");
  }

  same(listed.releaseType, "AFTER_APPROVAL", "release type");
  if (viewed.releaseType) {
    same(viewed.releaseType, "AFTER_APPROVAL", "viewed release type");
  }
  same(viewed.buildId, buildId, "attached build ID");
  if (viewed.buildNumber) {
    same(viewed.buildNumber, buildNumber, "attached build number");
  }
  same(exactBuild.id, buildId, "exact build ID");
  same(exactBuild.buildNumber, buildNumber, "exact build number");
  same(exactBuild.version, version, "exact build marketing version");
  same(
    String(exactBuild.platform).toUpperCase(),
    platform,
    "exact build platform"
  );
  same(exactBuild.processingState, "VALID", "build processing state");

  const submissionId = required(expected.submissionId, "submission ID");
  same(exactSubmission.id, submissionId, "exact submission ID");
  same(exactSubmission.versionId, versionId, "submission version ID");
  same(
    String(exactSubmission.platform).toUpperCase(),
    platform,
    "submission platform"
  );
  const submissionState = required(
    exactSubmission.state,
    "submission state"
  ).toUpperCase();
  if (["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state)) {
    same(submissionState, state, "in-flight submission state");
  }

  return {
    version,
    platform,
    versionId,
    state,
    releaseType: "AFTER_APPROVAL",
    buildId,
    buildNumber,
    processingState: "VALID",
    submissionId,
    submissionState,
  };
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command !== "verify") {
    throw new Error("Expected verify command.");
  }
  const values = parseArguments(args);
  const proof = verifyReleaseProof({
    versionList: readJson(values["version-list"], "version list"),
    versionView: readJson(values["version-view"], "version view"),
    build: readJson(values.build, "exact build"),
    submission: readJson(values.submission, "exact submission"),
    expected: readJson(values.expected, "expected release"),
  });
  const output = `${JSON.stringify(proof, null, 2)}\n`;
  if (values.output) {
    fs.writeFileSync(values.output, output, { mode: 0o600 });
  } else {
    process.stdout.write(output);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
