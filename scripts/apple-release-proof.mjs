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
    buildNumber: attributes.buildNumber,
    submissionId:
      attributes.submissionId ??
      row?.relationships?.appStoreVersionSubmission?.data?.id,
  };
}

function statusRecord(payload) {
  return {
    versionId: payload?.appstore?.versionId,
    version: payload?.appstore?.version,
    platform: payload?.appstore?.platform,
    state: payload?.appstore?.state,
    buildId: payload?.builds?.latest?.id,
    buildVersion: payload?.builds?.latest?.version,
    buildNumber: payload?.builds?.latest?.buildNumber,
    processingState: payload?.builds?.latest?.processingState,
    submissionId: payload?.review?.latestSubmissionId,
    submissionState: payload?.review?.state,
    inFlight: payload?.submission?.inFlight,
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
  status,
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
  const dashboard = statusRecord(status);
  const versionId = required(
    expected.versionId ?? listed.id ?? viewed.id,
    "version ID"
  );
  const buildId = required(expected.buildId, "expected build ID");
  const buildNumber = required(expected.buildNumber, "expected build number");

  same(listed.id, versionId, "listed version ID");
  same(viewed.id, versionId, "viewed version ID");
  same(dashboard.versionId, versionId, "status version ID");
  for (const [actual, label] of [
    [listed.version, "listed version"],
    [dashboard.version, "status version"],
    [dashboard.buildVersion, "build marketing version"],
  ]) {
    same(actual, version, label);
  }
  if (viewed.version) {
    same(viewed.version, version, "viewed version");
  }
  for (const [actual, label] of [
    [listed.platform, "listed platform"],
    [dashboard.platform, "status platform"],
  ]) {
    same(String(actual).toUpperCase(), platform, label);
  }
  if (viewed.platform) {
    same(String(viewed.platform).toUpperCase(), platform, "viewed platform");
  }

  const state = required(
    dashboard.state ?? listed.state ?? viewed.state,
    "release state"
  ).toUpperCase();
  if (!reviewStates.has(state)) {
    throw new Error(
      `Release state ${state} is not waiting for review or later.`
    );
  }
  for (const candidate of [listed.state, viewed.state, dashboard.state].filter(
    Boolean
  )) {
    same(String(candidate).toUpperCase(), state, "release state");
  }

  same(listed.releaseType, "AFTER_APPROVAL", "release type");
  if (viewed.releaseType) {
    same(viewed.releaseType, "AFTER_APPROVAL", "viewed release type");
  }
  same(viewed.buildId, buildId, "attached build ID");
  same(dashboard.buildId, buildId, "status build ID");
  if (viewed.buildNumber) {
    same(viewed.buildNumber, buildNumber, "attached build number");
  }
  same(dashboard.buildNumber, buildNumber, "status build number");
  same(dashboard.processingState, "VALID", "build processing state");

  const submissionId = required(
    expected.submissionId ?? viewed.submissionId ?? dashboard.submissionId,
    "submission ID"
  );
  same(dashboard.submissionId, submissionId, "status submission ID");
  const submissionState = required(
    dashboard.submissionState,
    "submission state"
  ).toUpperCase();
  if (
    ["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state) &&
    dashboard.inFlight !== true
  ) {
    throw new Error(`${state} must have an in-flight review submission.`);
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
    status: readJson(values.status, "release status"),
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
