import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  apiPath,
  normalizeSerial,
  request,
  requireEnv,
} from "./app-store-connect-api.mjs";

requireEnv(["APPLE_API_ISSUER", "APPLE_API_KEY_ID", "APPLE_API_KEY_PATH"]);

const appBundleId =
  process.env.SAFARI_APP_BUNDLE_ID || "com.praveenjuge.teak-safari";
const extensionBundleId =
  process.env.SAFARI_EXTENSION_BUNDLE_ID ||
  "com.praveenjuge.teak-safari.Extension";
const certificateSerial = normalizeSerial(process.env.APPLE_CERTIFICATE_SERIAL);
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY || "";
const distributionCertificateTypes = ["DISTRIBUTION", "MAC_APP_DISTRIBUTION"];
const profileDir =
  process.env.SAFARI_PROFILE_DIR ||
  path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles");

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  }
}

async function findBundleId(identifier) {
  const response = await request(
    "GET",
    apiPath("/v1/bundleIds", {
      "filter[identifier]": identifier,
      "fields[bundleIds]": "identifier,name,platform",
      limit: "10",
    })
  );
  const bundleId = response.data?.find(
    (candidate) =>
      candidate.attributes?.identifier === identifier &&
      ["MAC_OS", "UNIVERSAL"].includes(candidate.attributes?.platform)
  );
  if (!bundleId) {
    const candidates =
      response.data
        ?.map(
          (candidate) =>
            `${candidate.attributes?.identifier || "unknown"} (${candidate.attributes?.platform || "unknown"})`
        )
        .filter(Boolean)
        .join(", ") || "none";
    throw new Error(
      `No exact macOS-compatible bundle ID found for ${identifier}; found: ${candidates}.`
    );
  }
  return bundleId;
}

async function findCertificate() {
  const certificates = [];
  for (const certificateType of distributionCertificateTypes) {
    const response = await request(
      "GET",
      apiPath("/v1/certificates", {
        "filter[certificateType]": certificateType,
        "fields[certificates]":
          "certificateType,displayName,expirationDate,serialNumber,activated",
        limit: "200",
        sort: "-id",
      })
    );
    certificates.push(
      ...(response.data || []).filter(
        (certificate) => certificate.attributes?.activated !== false
      )
    );
  }

  if (certificateSerial) {
    const match = certificates.find(
      (certificate) =>
        normalizeSerial(certificate.attributes?.serialNumber) ===
        certificateSerial
    );
    if (match) {
      return match;
    }
  }

  if (signingIdentity) {
    const match = certificates.find((certificate) => {
      const displayName = certificate.attributes?.displayName || "";
      return (
        signingIdentity.includes(displayName) ||
        displayName.includes(signingIdentity)
      );
    });
    if (match) {
      return match;
    }
  }

  const [first] = certificates.sort((left, right) =>
    String(right.attributes?.expirationDate || "").localeCompare(
      String(left.attributes?.expirationDate || "")
    )
  );
  if (!first) {
    throw new Error("No active Apple distribution certificate found.");
  }
  return first;
}

async function findReusableProfile({ bundleId, certificate, name }) {
  const response = await request(
    "GET",
    apiPath("/v1/profiles", {
      "filter[profileType]": "MAC_APP_STORE",
      "filter[profileState]": "ACTIVE",
      "fields[profiles]":
        "name,profileContent,profileState,profileType,uuid,expirationDate,bundleId,certificates",
      include: "bundleId,certificates",
      limit: "200",
      "limit[certificates]": "50",
    })
  );

  return (response.data || []).find((profile) => {
    const profileBundleId = profile.relationships?.bundleId?.data?.id;
    const certificateIds =
      profile.relationships?.certificates?.data?.map(({ id }) => id) || [];
    return (
      profile.attributes?.name === name &&
      profileBundleId === bundleId.id &&
      certificateIds.includes(certificate.id)
    );
  });
}

async function createProfile({ bundleId, certificate, name }) {
  const response = await request("POST", "/v1/profiles", {
    data: {
      type: "profiles",
      attributes: {
        name,
        profileType: "MAC_APP_STORE",
      },
      relationships: {
        bundleId: {
          data: {
            type: "bundleIds",
            id: bundleId.id,
          },
        },
        certificates: {
          data: [
            {
              type: "certificates",
              id: certificate.id,
            },
          ],
        },
      },
    },
  });
  return response.data;
}

function installProfile(profile, identifier) {
  const content = profile.attributes?.profileContent;
  const uuid = profile.attributes?.uuid;
  if (!(content && uuid)) {
    throw new Error(
      `Profile for ${identifier} did not include downloadable content.`
    );
  }

  fs.mkdirSync(profileDir, { recursive: true });
  const profilePath = path.join(profileDir, `${uuid}.provisionprofile`);
  fs.writeFileSync(profilePath, Buffer.from(content, "base64"));
  return profilePath;
}

async function ensureProfile({
  certificate,
  identifier,
  outputPrefix,
  profileLabel,
}) {
  const bundleId = await findBundleId(identifier);
  const serial = normalizeSerial(certificate.attributes?.serialNumber);
  if (!serial) {
    throw new Error(
      `Mac App Distribution certificate ${certificate.id} is missing a serial number.`
    );
  }
  const name = `${profileLabel} ${serial.slice(-8)}`;
  const profile =
    (await findReusableProfile({ bundleId, certificate, name })) ||
    (await createProfile({ bundleId, certificate, name }));
  const profilePath = installProfile(profile, identifier);

  output(`${outputPrefix}_PROFILE_NAME`, profile.attributes.name);
  output(`${outputPrefix}_PROFILE_UUID`, profile.attributes.uuid);
  output(`${outputPrefix}_PROFILE_PATH`, profilePath);
  console.log(
    `Installed ${identifier} App Store profile ${profile.attributes.name} (${profile.attributes.uuid}).`
  );
}

const certificate = await findCertificate();

await ensureProfile({
  certificate,
  identifier: appBundleId,
  outputPrefix: "SAFARI_APP",
  profileLabel: "Teak Safari App Store",
});
await ensureProfile({
  certificate,
  identifier: extensionBundleId,
  outputPrefix: "SAFARI_EXTENSION",
  profileLabel: "Teak Safari Extension App Store",
});
