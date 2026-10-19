import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { UserIdentity } from "convex/server";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { readWorkosSessionIdentity } from "../securitySessions";
import { verifyWorkosConnectTokenSignature } from "../workosTokens";
import { asFetch } from "./helpers/convex.test-utils";

const issuer = "https://workos-token-test.authkit.app";
const apiAudience = "https://teakvault.com/api";
const mcpAudience = "https://teakvault.com/mcp";
const clientId = "client_TEST123";
const userId = "user_TEST123";
const consentId = "app_consent_TEST123";
const originalFetch = globalThis.fetch;
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let wrongKeys: Awaited<ReturnType<typeof generateKeyPair>>;
const requests: string[] = [];

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
  wrongKeys = await generateKeyPair("RS256");
  const publicKey = await exportJWK(keys.publicKey);
  globalThis.fetch = asFetch((input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    if (url !== `${issuer}/oauth2/jwks`) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(
      Response.json({
        keys: [{ ...publicKey, kid: "test-key", alg: "RS256" }],
      })
    );
  });
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

async function token(overrides: JWTPayload = {}, key = keys.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    iss: issuer,
    aud: apiAudience,
    sub: userId,
    sid: consentId,
    client_id: clientId,
    scope: "openid profile email offline_access",
    iat: now,
    exp: now + 300,
    external_id: "legacy-owner",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(key);
}

const config = { issuer, audience: apiAudience };

const issuedFor = (issuedAt: number, lifetimeSeconds: number) =>
  token({ iat: issuedAt, exp: issuedAt + lifetimeSeconds });

describe("Connect credential validation", () => {
  test("accepts signed API and MCP tokens only at their own resource", async () => {
    const apiToken = await token();
    const mcpToken = await token({ aud: mcpAudience });
    expect(await verifyWorkosConnectTokenSignature(apiToken, config)).toEqual({
      workosUserId: userId,
      consentId,
      clientId,
      externalId: "legacy-owner",
    });
    expect(
      await verifyWorkosConnectTokenSignature(mcpToken, {
        issuer,
        audience: mcpAudience,
      })
    ).not.toBeNull();
    expect(
      await verifyWorkosConnectTokenSignature(apiToken, {
        issuer,
        audience: mcpAudience,
      })
    ).toBeNull();
    expect(
      await verifyWorkosConnectTokenSignature(mcpToken, config)
    ).toBeNull();
    expect(requests).toContain(`${issuer}/oauth2/jwks`);
  });

  test("accepts CIMD client IDs and optional external IDs without fetching them", async () => {
    const cimd = "https://client.example.test/metadata.json";
    for (const external_id of [null, undefined]) {
      const verified = await verifyWorkosConnectTokenSignature(
        await token({ client_id: cimd, external_id }),
        config
      );
      expect(verified?.clientId).toBe(cimd);
      expect(verified?.externalId).toBe(external_id);
    }
    expect(requests).not.toContain(cimd);
  });

  test("preserves valid CIMD IDs whose URL spelling is significant", async () => {
    for (const value of [
      "https://client.test:443/metadata.json",
      "https://CLIENT.test/metadata.json",
    ]) {
      expect(
        (
          await verifyWorkosConnectTokenSignature(
            await token({ client_id: value }),
            config
          )
        )?.clientId
      ).toBe(value);
    }
  });

  test("rejects disallowed signature algorithms", async () => {
    const claims = {
      iss: issuer,
      aud: apiAudience,
      sub: userId,
      sid: consentId,
      client_id: clientId,
      scope: "openid profile email",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    const rs512Keys = await generateKeyPair("RS512");
    const rsa = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS512", kid: "test-key" })
      .sign(rs512Keys.privateKey);
    const hmac = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", kid: "test-key" })
      .sign(new Uint8Array(32));
    expect(await verifyWorkosConnectTokenSignature(rsa, config)).toBeNull();
    expect(await verifyWorkosConnectTokenSignature(hmac, config)).toBeNull();
  });

  test("does not require refresh permission for an access token", async () => {
    expect(
      await verifyWorkosConnectTokenSignature(
        await token({ scope: "openid profile email" }),
        config
      )
    ).not.toBeNull();
  });

  test.each([
    ["wrong issuer", { iss: "https://attacker.example.test" }],
    [
      "session issuer",
      { iss: `https://api.workos.com/user_management/${clientId}` },
    ],
    ["ID token audience", { aud: clientId }],
    ["multiple audiences", { aud: [apiAudience, mcpAudience] }],
    ["M2M subject", { sub: clientId }],
    ["missing subject", { sub: undefined }],
    ["session sid", { sid: "session_TEST123" }],
    ["missing consent", { sid: undefined }],
    ["wrong consent type", { sid: 12 }],
    ["missing client", { client_id: undefined }],
    ["malformed client", { client_id: "client_" }],
    [
      "unsafe CIMD client",
      { client_id: "https://user:secret@client.test/metadata" },
    ],
    ["missing scopes", { scope: undefined }],
    ["no email scope", { scope: "openid profile" }],
    ["no profile scope", { scope: "openid email" }],
    ["no openid scope", { scope: "profile email" }],
    ["scope type", { scope: ["openid", "profile", "email"] }],
    ["owner claim type", { external_id: 12 }],
    ["empty owner claim", { external_id: "" }],
    ["expired", { exp: 1 }],
    ["missing expiry", { exp: undefined }],
    ["missing issue time", { iat: undefined }],
    ["future issue time", { iat: Math.floor(Date.now() / 1000) + 3600 }],
    ["not yet valid", { nbf: Math.floor(Date.now() / 1000) + 3600 }],
  ] satisfies [string, JWTPayload][])(
    "rejects %s",
    async (_name: string, claims: JWTPayload) => {
      expect(
        await verifyWorkosConnectTokenSignature(await token(claims), config)
      ).toBeNull();
    }
  );

  test("accepts a token issued slightly ahead of this deployment's clock", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) + 30;
    expect(
      await verifyWorkosConnectTokenSignature(
        await issuedFor(issuedAt, 300),
        config
      )
    ).not.toBeNull();
  });

  test("enforces the signed five-minute lifetime across a clock-second boundary", async () => {
    const lastSecond = Math.floor(Date.now() / 1000) - 1;
    expect(
      await verifyWorkosConnectTokenSignature(
        await issuedFor(lastSecond, 300),
        config
      )
    ).not.toBeNull();
    expect(
      await verifyWorkosConnectTokenSignature(
        await issuedFor(lastSecond, 301),
        config
      )
    ).toBeNull();
  });

  test("rejects forged and malformed tokens", async () => {
    expect(
      await verifyWorkosConnectTokenSignature(
        await token({}, wrongKeys.privateKey),
        config
      )
    ).toBeNull();
    for (const value of ["not-a-jwt", "", "a".repeat(16_385)]) {
      expect(await verifyWorkosConnectTokenSignature(value, config)).toBeNull();
    }
  });

  test.each([
    "http://workos-token-test.authkit.app",
    `${issuer}/path`,
    `${issuer}/`,
    `${issuer}?host=attacker.test`,
    `${issuer}#fragment`,
    "https://user:password@workos-token-test.authkit.app",
    "https://workos-token-test.authkit.app:8080",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
  ])(
    "rejects unsafe issuer configuration %s before network access",
    async (value: string) => {
      const before = requests.length;
      expect(
        await verifyWorkosConnectTokenSignature(await token(), {
          issuer: value,
          audience: apiAudience,
        })
      ).toBeNull();
      expect(requests.length).toBe(before);
    }
  );

  test("reports expiry only for a token WorkOS signed", async () => {
    const past = Math.floor(Date.now() / 1000) - 600;
    let expired = 0;
    const onExpired = () => {
      expired += 1;
    };
    const forged = await token(
      { iat: past, exp: past + 300 },
      wrongKeys.privateKey
    );
    expect(
      await verifyWorkosConnectTokenSignature(forged, { ...config, onExpired })
    ).toBeNull();
    expect(expired).toBe(0);
    expect(
      await verifyWorkosConnectTokenSignature(await issuedFor(past, 300), {
        ...config,
        onExpired,
      })
    ).toBeNull();
    expect(expired).toBe(1);
  });

  test("fails closed when provider keys cannot be loaded", async () => {
    expect(
      await verifyWorkosConnectTokenSignature(await token(), {
        issuer: "https://unavailable.authkit.app",
        audience: apiAudience,
      })
    ).toBeNull();
  });
});

function session(overrides: Partial<UserIdentity> = {}): UserIdentity {
  return {
    tokenIdentifier: "verified-by-convex",
    issuer: `https://api.workos.com/user_management/${clientId}`,
    subject: userId,
    sid: "session_TEST123",
    email_verified: true,
    external_id: "legacy-owner",
    ...overrides,
  };
}

describe("Convex session claims", () => {
  test("reads verified session claims without changing the permanent owner", () => {
    expect(readWorkosSessionIdentity(session(), clientId)).toEqual({
      workosUserId: userId,
      sessionId: "session_TEST123",
      emailVerified: true,
      externalId: "legacy-owner",
    });
  });

  test.each([
    { issuer },
    { issuer: "https://api.workos.com/user_management/client_OTHER" },
    { subject: clientId },
    { sid: consentId },
    { sid: undefined },
    { sid: 12 },
    { email_verified: false },
    { email_verified: undefined },
    { email_verified: "true" },
    { email_verified: undefined, emailVerified: true },
    { external_id: 12 },
    { external_id: "" },
  ] satisfies Partial<UserIdentity>[])(
    "rejects invalid session claims %j",
    (claims: Partial<UserIdentity>) => {
      expect(readWorkosSessionIdentity(session(claims), clientId)).toBeNull();
    }
  );

  test("denies missing identity or configuration and allows absent optional owner claims", () => {
    expect(readWorkosSessionIdentity(null, clientId)).toBeNull();
    expect(readWorkosSessionIdentity(session(), "")).toBeNull();
    expect(
      readWorkosSessionIdentity(session({ external_id: null }), clientId)
        ?.externalId
    ).toBeNull();
    expect(
      readWorkosSessionIdentity(session({ external_id: undefined }), clientId)
    ).toEqual({
      workosUserId: userId,
      sessionId: "session_TEST123",
      emailVerified: true,
    });
  });
});
