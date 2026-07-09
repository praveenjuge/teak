import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  apiPath,
  normalizeSerial,
  request,
  requireEnv,
} from "./app-store-connect-api.mjs";

requireEnv([
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_ID",
  "APPLE_API_KEY_PATH",
  "APPLE_DISTRIBUTION_CSR_PATH",
  "APPLE_DISTRIBUTION_PRIVATE_KEY_PATH",
]);

const certificateTypes = (
  process.env.APPLE_DISTRIBUTION_CERTIFICATE_TYPES ||
  "DISTRIBUTION,MAC_APP_DISTRIBUTION"
)
  .split(",")
  .map((type) => type.trim())
  .filter(Boolean);
const createCertificateType =
  process.env.APPLE_DISTRIBUTION_CREATE_CERTIFICATE_TYPE ||
  certificateTypes[0] ||
  "DISTRIBUTION";
const outputPrefix =
  process.env.APPLE_DISTRIBUTION_OUTPUT_PREFIX || "APPLE_CERTIFICATE";
const certificatePath =
  process.env.APPLE_DISTRIBUTION_CERTIFICATE_PATH ||
  path.join(os.tmpdir(), "apple-distribution.pem");

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  if (process.env.GITHUB_ENV) {
    fs.appendFileSync(process.env.GITHUB_ENV, `${name}=${value}\n`);
  }
}

function certificateToPem(certificateContent) {
  const body = certificateContent.replace(/\s/g, "");
  const lines = body.match(/.{1,64}/g) || [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
}

function publicKeyForCertificate(certificateContent) {
  const certificate = new crypto.X509Certificate(
    Buffer.from(certificateContent, "base64")
  );
  return certificate.publicKey.export({ format: "der", type: "spki" });
}

function publicKeyForPrivateKey() {
  const privateKey = crypto.createPrivateKey(
    fs.readFileSync(process.env.APPLE_DISTRIBUTION_PRIVATE_KEY_PATH, "utf8")
  );
  return crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" });
}

async function listCertificates() {
  const certificates = [];
  for (const certificateType of certificateTypes) {
    const response = await request(
      "GET",
      apiPath("/v1/certificates", {
        "filter[certificateType]": certificateType,
        "fields[certificates]":
          "activated,certificateContent,certificateType,displayName,expirationDate,serialNumber",
        limit: "200",
        sort: "-id",
      })
    );
    certificates.push(
      ...(response.data || []).filter(
        (certificate) =>
          certificate.attributes?.activated !== false &&
          certificate.attributes?.certificateContent
      )
    );
  }
  return certificates;
}

function findMatchingCertificate(certificates, expectedPublicKey) {
  return certificates.find((certificate) => {
    try {
      return crypto.timingSafeEqual(
        publicKeyForCertificate(certificate.attributes.certificateContent),
        expectedPublicKey
      );
    } catch {
      return false;
    }
  });
}

async function createCertificate() {
  const csrContent = fs.readFileSync(
    process.env.APPLE_DISTRIBUTION_CSR_PATH,
    "utf8"
  );
  const response = await request("POST", "/v1/certificates", {
    data: {
      type: "certificates",
      attributes: {
        certificateType: createCertificateType,
        csrContent,
      },
    },
  });
  return response.data;
}

const expectedPublicKey = publicKeyForPrivateKey();
const existingCertificate = findMatchingCertificate(
  await listCertificates(),
  expectedPublicKey
);
const certificate = existingCertificate || (await createCertificate());
const certificateContent = certificate.attributes?.certificateContent;
const certificateSerial = normalizeSerial(certificate.attributes?.serialNumber);

if (!(certificateContent && certificateSerial)) {
  throw new Error(
    "Apple distribution certificate is missing content or serial."
  );
}

fs.writeFileSync(certificatePath, certificateToPem(certificateContent), {
  mode: 0o600,
});

output(`${outputPrefix}_PATH`, certificatePath);
output(`${outputPrefix}_SERIAL`, certificateSerial);
console.log(
  `${existingCertificate ? "Reused" : "Created"} ${createCertificateType} certificate ${certificateSerial}.`
);
