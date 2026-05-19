import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import process from "node:process";

const apiBase = "https://api.appstoreconnect.apple.com";
const platform = "IOS";

const appDirectory = path.resolve(import.meta.dirname, "..");
loadLocalEnv(path.join(appDirectory, ".env.local"));

const pollIntervalMs = Number(process.env.ASC_BUILD_POLL_INTERVAL_MS ?? 30_000);
const pollTimeoutMs = Number(
  process.env.ASC_BUILD_POLL_TIMEOUT_MS ?? 15 * 60_000
);

const storeConfig = readJson(path.join(appDirectory, "store.config.json"));
const easConfig = readJson(path.join(appDirectory, "eas.json"));

const appId =
  process.env.ASC_APP_ID ??
  easConfig.submit?.production?.ios?.ascAppId ??
  fail(
    "Missing App Store Connect app id. Set ASC_APP_ID or eas.json submit.production.ios.ascAppId."
  );
const version =
  process.env.ASC_VERSION ??
  storeConfig.apple?.version ??
  fail(
    "Missing release version. Set ASC_VERSION or apps/mobile/store.config.json apple.version."
  );

for (const name of ["APPLE_API_ISSUER", "APPLE_API_KEY_ID"]) {
  if (!process.env[name]) {
    fail(`Missing required environment variable: ${name}`);
  }
}

if (!(process.env.APPLE_API_KEY_PATH || process.env.APPLE_API_KEY_P8)) {
  fail(
    "Missing App Store Connect API private key. Set APPLE_API_KEY_PATH or APPLE_API_KEY_P8."
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadLocalEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!name || process.env[name] !== undefined) {
      continue;
    }

    process.env[name] = unquoteEnvValue(rawValue);
  }
}

function unquoteEnvValue(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    return value.slice(1, -1);
  }
  return value;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}

function derToJose(signature) {
  let offset = 2;
  const rLength = signature[offset + 1];
  let r = signature.subarray(offset + 2, offset + 2 + rLength);
  offset += 2 + rLength;
  const sLength = signature[offset + 1];
  let s = signature.subarray(offset + 2, offset + 2 + sLength);

  r = r[0] === 0 ? r.subarray(1) : r;
  s = s[0] === 0 ? s.subarray(1) : s;

  if (r.length > 32 || s.length > 32) {
    throw new Error("Invalid ES256 signature length.");
  }

  return Buffer.concat([
    Buffer.concat([Buffer.alloc(32 - r.length), r]),
    Buffer.concat([Buffer.alloc(32 - s.length), s]),
  ]);
}

function readPrivateKey() {
  if (process.env.APPLE_API_KEY_P8) {
    return process.env.APPLE_API_KEY_P8.replaceAll("\\n", "\n");
  }

  const keyPath = path.isAbsolute(process.env.APPLE_API_KEY_PATH)
    ? process.env.APPLE_API_KEY_PATH
    : path.join(appDirectory, process.env.APPLE_API_KEY_PATH);
  return fs.readFileSync(keyPath, "utf8");
}

function createJwt() {
  const key = crypto.createPrivateKey({
    key: readPrivateKey(),
    format: "pem",
  });
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: process.env.APPLE_API_KEY_ID,
    typ: "JWT",
  };
  const payload = {
    aud: "appstoreconnect-v1",
    exp: now + 20 * 60,
    iss: process.env.APPLE_API_ISSUER,
  };
  const body = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign("sha256", Buffer.from(body), key);
  return `${body}.${base64url(derToJose(signature))}`;
}

function request(method, pathname, body) {
  const payload = body ? JSON.stringify(body) : undefined;
  const token = createJwt();

  return new Promise((resolve, reject) => {
    const req = https.request(
      `${apiBase}${pathname}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
            return;
          }

          const detail =
            parsed?.errors
              ?.map((error) => error.detail || error.title)
              .filter(Boolean)
              .join("; ") || data;
          const error = new Error(
            `App Store Connect ${method} ${pathname} failed with ${res.statusCode}: ${detail}`
          );
          error.statusCode = res.statusCode;
          error.response = parsed;
          reject(error);
        });
      }
    );

    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function params(values) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      search.set(key, value);
    }
  }
  return search.toString();
}

async function findAppStoreVersion() {
  const query = params({
    "filter[platform]": platform,
    "filter[versionString]": version,
    include: "build",
    "fields[appStoreVersions]": "versionString,appVersionState,build",
    "fields[builds]": "version,processingState,uploadedDate",
    limit: "1",
  });
  const response = await request(
    "GET",
    `/v1/apps/${appId}/appStoreVersions?${query}`
  );
  const appStoreVersion = response.data?.[0];
  if (!appStoreVersion) {
    fail(
      `No iOS App Store version ${version} found for app ${appId}. Run metadata:push first.`
    );
  }
  return appStoreVersion;
}

async function fetchAppStoreVersion(versionId) {
  const query = params({
    include: "build",
    "fields[appStoreVersions]": "versionString,appVersionState,build",
    "fields[builds]": "version,processingState,uploadedDate",
  });
  return request("GET", `/v1/appStoreVersions/${versionId}?${query}`);
}

function includedBuild(response, buildId) {
  return response.included?.find(
    (item) => item.type === "builds" && item.id === buildId
  );
}

async function findValidBuild() {
  const buildNumber = process.env.ASC_BUILD_NUMBER;
  const query = params({
    "filter[app]": appId,
    "filter[preReleaseVersion.version]": version,
    "filter[processingState]": "VALID",
    ...(buildNumber ? { "filter[version]": buildNumber } : {}),
    sort: "-uploadedDate",
    "fields[builds]": "version,processingState,uploadedDate",
    limit: "1",
  });
  const response = await request("GET", `/v1/builds?${query}`);
  return response.data?.[0];
}

async function waitForValidBuild() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < pollTimeoutMs) {
    const build = await findValidBuild();
    if (build) {
      return build;
    }

    console.log(
      `No VALID build found yet for iOS ${version}. Waiting ${Math.round(
        pollIntervalMs / 1000
      )}s...`
    );
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  fail(
    `Timed out waiting for a VALID iOS build for ${version}. Increase ASC_BUILD_POLL_TIMEOUT_MS if Apple is still processing the upload.`
  );
}

async function attachBuild(versionId, buildId) {
  await request(
    "PATCH",
    `/v1/appStoreVersions/${versionId}/relationships/build`,
    {
      data: {
        type: "builds",
        id: buildId,
      },
    }
  );
}

async function createReviewSubmission() {
  return request("POST", "/v1/reviewSubmissions", {
    data: {
      type: "reviewSubmissions",
      attributes: {
        platform,
      },
      relationships: {
        app: {
          data: {
            type: "apps",
            id: appId,
          },
        },
      },
    },
  });
}

async function addVersionToReviewSubmission(reviewSubmissionId, versionId) {
  return request("POST", "/v1/reviewSubmissionItems", {
    data: {
      type: "reviewSubmissionItems",
      relationships: {
        reviewSubmission: {
          data: {
            type: "reviewSubmissions",
            id: reviewSubmissionId,
          },
        },
        appStoreVersion: {
          data: {
            type: "appStoreVersions",
            id: versionId,
          },
        },
      },
    },
  });
}

async function submitReviewSubmission(reviewSubmissionId) {
  return request("PATCH", `/v1/reviewSubmissions/${reviewSubmissionId}`, {
    data: {
      type: "reviewSubmissions",
      id: reviewSubmissionId,
      attributes: {
        submitted: true,
      },
    },
  });
}

async function main() {
  console.log(`Preparing iOS ${version} for App Review on app ${appId}.`);

  const appStoreVersion = await findAppStoreVersion();
  const versionId = appStoreVersion.id;
  const state = appStoreVersion.attributes?.appVersionState;
  if (["WAITING_FOR_REVIEW", "IN_REVIEW"].includes(state)) {
    console.log(`iOS ${version} is already ${state}. Nothing to submit.`);
    return;
  }

  const versionWithBuild = await fetchAppStoreVersion(versionId);
  const attachedBuildId = versionWithBuild.data.relationships?.build?.data?.id;
  let build = attachedBuildId
    ? includedBuild(versionWithBuild, attachedBuildId)
    : undefined;

  if (build?.attributes?.processingState === "VALID") {
    console.log(
      `Using already attached build ${build.attributes?.version ?? build.id}.`
    );
  } else {
    build = await waitForValidBuild();
    await attachBuild(versionId, build.id);
    console.log(
      `Attached build ${build.attributes?.version ?? build.id} to iOS ${version}.`
    );
  }

  const reviewSubmission = await createReviewSubmission();
  const reviewSubmissionId = reviewSubmission.data.id;
  console.log(`Created review submission ${reviewSubmissionId}.`);

  await addVersionToReviewSubmission(reviewSubmissionId, versionId);
  console.log(`Added iOS ${version} to review submission.`);

  await submitReviewSubmission(reviewSubmissionId);
  console.log(`Submitted iOS ${version} for App Review.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
