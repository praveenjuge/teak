import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";

const requiredEnv = [
  "ASC_APP_ID",
  "APPLE_API_ISSUER",
  "APPLE_API_KEY_ID",
  "APPLE_API_KEY_PATH",
  "SAFARI_VERSION",
];

for (const name of requiredEnv) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const apiBase = "https://api.appstoreconnect.apple.com";
const platform = "MAC_OS";

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

function createJwt() {
  const key = crypto.createPrivateKey({
    key: fs.readFileSync(process.env.APPLE_API_KEY_PATH, "utf8"),
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

async function findVersion() {
  const params = new URLSearchParams({
    "filter[platform]": platform,
    "filter[versionString]": process.env.SAFARI_VERSION,
    limit: "1",
  });
  const response = await request(
    "GET",
    `/v1/apps/${process.env.ASC_APP_ID}/appStoreVersions?${params}`
  );
  return response.data?.[0];
}

function createVersion() {
  return request("POST", "/v1/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: {
        platform,
        versionString: process.env.SAFARI_VERSION,
      },
      relationships: {
        app: {
          data: {
            type: "apps",
            id: process.env.ASC_APP_ID,
          },
        },
      },
    },
  });
}

let version = await findVersion();
if (version) {
  console.log(
    `App Store Connect already has macOS version ${process.env.SAFARI_VERSION} (${version.id}).`
  );
  process.exit(0);
}

try {
  version = await createVersion();
  console.log(
    `Created App Store Connect macOS version ${process.env.SAFARI_VERSION} (${version.data.id}).`
  );
} catch (error) {
  if (error.statusCode !== 409) {
    throw error;
  }

  version = await findVersion();
  if (version) {
    console.log(
      `App Store Connect macOS version ${process.env.SAFARI_VERSION} exists after conflict (${version.id}).`
    );
  } else if (
    error.message.includes(
      "cannot create a new version of the App in the current state"
    )
  ) {
    console.log(
      `App Store Connect cannot create macOS version ${process.env.SAFARI_VERSION} in the current app state. Continuing with build upload.`
    );
  } else {
    throw error;
  }
}
