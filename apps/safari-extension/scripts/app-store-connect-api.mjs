import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";

export const apiBase = "https://api.appstoreconnect.apple.com";
export const platform = "MAC_OS";

export function requireEnv(names) {
  for (const name of names) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }
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
  const body = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(payload)
  )}`;
  const signature = crypto.sign("sha256", Buffer.from(body), key);
  return `${body}.${base64url(derToJose(signature))}`;
}

export function request(method, pathname, body) {
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

export function apiPath(pathname, params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function normalizeSerial(serial) {
  return serial?.replaceAll(":", "").trim().toUpperCase();
}
