/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { verifyWorkosConnectToken } from "./workosTokens";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://logout-tests.authkit.app";
const user = "user_LOGOUT",
  owner = "legacy-owner",
  consent = "app_consent_LOGOUT",
  client = "client_LOGOUT";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
});
beforeEach(async () => {
  vi.stubEnv("SITE_URL", "https://app.teakvault.com");
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", issuer);
  vi.stubEnv("WORKOS_API_KEY", "non-secret-disconnect-test-fixture");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_TEST");
  vi.stubEnv("WORKOS_CLIENT_ID", "client_AUTHKIT");
  const jwk = await exportJWK(keys.publicKey);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth2/jwks")) {
      return Promise.resolve(
        Response.json({ keys: [{ ...jwk, kid: "logout-key", alg: "RS256" }] })
      );
    }
    if (init?.method === "DELETE") {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(
      Response.json({
        data: [{ application: { id: "connect_app_TEST", client_id: client } }],
        list_metadata: {},
      })
    );
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function token(overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: "https://teakvault.com/api",
    sub: user,
    sid: consent,
    client_id: client,
    scope: "openid profile email offline_access",
    external_id: owner,
    iat: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "logout-key" })
    .sign(keys.privateKey);
}
async function setup(existing = true) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: owner,
      workosUserId: user,
      email: "owner@example.test",
      emailVerified: true,
      workosEmailVerified: true,
    });
    await ctx.db.insert("workosProfiles", {
      workosUserId: user,
      teakUserId: owner,
      providerUpdatedAt: "2026-10-06T00:00:00Z",
      revision: 1,
      source: "event",
      profile: {
        email: "owner@example.test",
        emailVerified: true,
        externalId: owner,
        firstName: null,
        lastName: null,
        profilePictureUrl: null,
      },
    });
    if (existing) {
      await ctx.db.insert("workosConsents", {
        consentId: consent,
        clientId: client,
        userId: owner,
        workosUserId: user,
        firstSeenAt: 1,
        lastSeenAt: 1,
      });
    }
    await ctx.db.insert("workosConsents", {
      consentId: "app_consent_SIBLING",
      clientId: client,
      userId: owner,
      workosUserId: user,
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
  });
  const disconnect = (access: string) =>
    t.fetch("/v1/oauth/disconnect", {
      method: "POST",
      headers: { Authorization: `Bearer ${access}` },
    });
  const rows = () => t.run((ctx) => ctx.db.query("workosConsents").take(10));
  return { t, disconnect, rows };
}
// Failure modes: signature/expiry/audience/session confusion; conflicting subject,
// client/owner/consent; duplicate/missing ownership; unseen consent; auth rollback;
// repeated logout or refresh resurrecting credentials; sibling grants and outages.
test("disconnect survives auth rollback and permanently denies the application", async () => {
  const f = await setup();
  const access = await token();
  expect((await f.disconnect(access)).status).toBe(204);
  expect(
    await f.t.mutation(internal.workosConsents.authorizeConnectConsent, {
      workosUserId: user,
      consentId: consent,
      clientId: client,
      externalId: owner,
    })
  ).toMatchObject({ status: "denied", reason: "application_disconnected" });
  const first = (await f.rows()).find(
    (r) => r.consentId === consent
  )?.revokedAt;
  expect(first).toBeTypeOf("number");
  expect((await f.disconnect(access)).status).toBe(204);
  expect((await f.rows()).find((r) => r.consentId === consent)?.revokedAt).toBe(
    first
  );
  expect(
    (await f.rows()).find((r) => r.consentId === "app_consent_SIBLING")
      ?.revokedAt
  ).toBeTypeOf("number");
  expect(
    (await f.rows()).find((r) => r.consentId === "app_consent_SIBLING")
      ?.disconnectCompletedAt
  ).toBeTypeOf("number");
});
test("logout before first request creates an already revoked canonical consent", async () => {
  const f = await setup(false);
  expect((await f.disconnect(await token())).status).toBe(204);
  expect((await f.rows()).find((r) => r.consentId === consent)).toMatchObject({
    userId: owner,
    workosUserId: user,
    clientId: client,
    revokedAt: expect.any(Number),
  });
});
test.each([
  { aud: "https://teakvault.com/mcp" },
  { aud: "client_AUTHKIT" },
  { sub: "user_OTHER" },
  { client_id: "client_OTHER" },
  { external_id: "other-owner" },
  { sid: "session_AUTHKIT" },
  { scope: "openid" },
])(
  "denies conflicting or invalid signed token %j without writes",
  async (claims) => {
    const f = await setup();
    expect((await f.disconnect(await token(claims))).status).toBe(401);
    expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
  }
);
test("opaque refresh and missing bearer cannot revoke", async () => {
  const f = await setup();
  expect((await f.disconnect("opaque-refresh")).status).toBe(401);
  expect(
    (await f.t.fetch("/v1/oauth/disconnect", { method: "POST" })).status
  ).toBe(401);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
});
test("duplicate consent bindings cannot revoke either record", async () => {
  const f = await setup();
  await f.t.run((ctx) =>
    ctx.db.insert("workosConsents", {
      consentId: consent,
      clientId: client,
      userId: "other-owner",
      workosUserId: user,
      firstSeenAt: 1,
      lastSeenAt: 1,
    })
  );
  expect((await f.disconnect(await token())).status).toBe(401);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
});
test("unseen consent requires a canonical owner", async () => {
  const f = await setup(false);
  await f.t.run(async (ctx) => {
    const row = await ctx.db.query("users").first();
    if (row) {
      await ctx.db.delete(row._id);
    }
  });
  expect((await f.disconnect(await token())).status).toBe(401);
  expect((await f.rows()).some((r) => r.consentId === consent)).toBe(false);
});
test("missing issuer reports unavailable without writes", async () => {
  const f = await setup();
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", "");
  expect((await f.disconnect(await token())).status).toBe(503);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
});

test("expired signed access token replays only a completed receipt", async () => {
  const f = await setup();
  const expired = await token({
    exp: Math.floor(Date.now() / 1000) - 10,
    iat: Math.floor(Date.now() / 1000) - 300,
  });
  expect(
    await verifyWorkosConnectToken(expired, {
      issuer,
      audience: "https://teakvault.com/api",
    })
  ).toBeNull();
  expect((await f.disconnect(expired)).status).toBe(401);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
  expect((await f.disconnect(await token())).status).toBe(204);
  expect((await f.disconnect(expired)).status).toBe(204);
  expect(
    (await f.rows()).find((r) => r.consentId === consent)?.revokedAt
  ).toBeTypeOf("number");
});

test("tampered signature never revokes even with expired payload", async () => {
  const f = await setup();
  const signed = await token({ exp: 1 });
  const parts = signed.split(".");
  parts[2] = `${parts[2][0] === "A" ? "B" : "A"}${parts[2].slice(1)}`;
  expect((await f.disconnect(parts.join("."))).status).toBe(401);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
});
test.each([
  { iat: Math.floor(Date.now() / 1000) + 300 },
  { nbf: Math.floor(Date.now() / 1000) + 300 },
])("future-dated claims cannot revoke %j", async (claims) => {
  const f = await setup();
  expect((await f.disconnect(await token(claims))).status).toBe(401);
  expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
});
test.each(["offline", "server-error"])(
  "JWKS %s reports unavailable and preserves grants",
  async (failure) => {
    const f = await setup();
    const isolated = `https://${failure}-logout.authkit.app`;
    vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", isolated);
    vi.stubGlobal("fetch", () =>
      failure === "offline"
        ? Promise.reject(new Error("Offline"))
        : Promise.resolve(new Response(null, { status: 503 }))
    );
    expect((await f.disconnect(await token({ iss: isolated }))).status).toBe(
      503
    );
    expect((await f.rows()).every((r) => r.revokedAt === undefined)).toBe(true);
  }
);

test("historical consent can be revoked during account deletion without granting access", async () => {
  const f = await setup();
  await f.t.run(async (ctx) => {
    const row = await ctx.db.query("users").first();
    if (row) {
      await ctx.db.patch(row._id, { deletedAt: Date.now() });
    }
  });
  expect((await f.disconnect(await token())).status).toBe(204);
  expect(
    (await f.rows()).find((r) => r.consentId === consent)?.revokedAt
  ).toBeTypeOf("number");
});
test("unseen consent with an unverified canonical profile cannot be inserted", async () => {
  const f = await setup(false);
  await f.t.run(async (ctx) => {
    const row = await ctx.db.query("workosProfiles").first();
    if (row?.profile) {
      await ctx.db.patch(row._id, {
        profile: { ...row.profile, emailVerified: false },
      });
    }
  });
  expect((await f.disconnect(await token())).status).toBe(401);
  expect((await f.rows()).some((r) => r.consentId === consent)).toBe(false);
});
