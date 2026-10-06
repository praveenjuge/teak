/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import polarTest from "@convex-dev/polar/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import workflowTest from "@convex-dev/workflow/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false"));
afterEach(() => vi.unstubAllEnvs());

async function setup(kind: "API key" | "OAuth" = "API key") {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  polarTest.register(t);
  workflowTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: "Identity boundary",
        email: "identity-bearer@example.com",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: user._id,
        token: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 3_600_000,
      },
    },
  });
  const client = t.withIdentity({
    issuer: process.env.CONVEX_SITE_URL,
    subject: user._id,
    sessionId: session._id,
  });
  let token: string;
  let revoke: () => Promise<unknown>;
  if (kind === "API key") {
    const key = await client.mutation(api.apiKeys.createUserApiKey, {
      name: "Boundary proof",
    });
    token = key.key;
    revoke = () =>
      client.mutation(api.apiKeys.revokeUserApiKey, { keyId: key.id });
  } else {
    await t.mutation(internal.oauthClients.ensureOAuthClients, {});
    token = "o".repeat(32);
    await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "oauthAccessToken",
        data: {
          clientId: "teak-cli",
          userId: user._id,
          accessToken: token,
          refreshToken: "r".repeat(32),
          accessTokenExpiresAt: now + 3_600_000,
          refreshTokenExpiresAt: now + 86_400_000,
          createdAt: now,
          updatedAt: now,
          scopes: "profile email offline_access",
        },
      },
    });
    revoke = () =>
      client.action(api.oauthTokens.revokeOAuthConnection, {
        clientId: "teak-cli",
      });
  }
  return { t, user, revoke, token };
}

// Failure modes: unauthenticated access, wrong owner selected from input,
// revoked/expired bearer reuse, stale legacy email overriding the mirror,
// deleted identities, and missing profiles. These exercise the real HTTP router,
// credential components, rate limiter, and database rather than mocked helpers.
test("me rejects missing credentials and provides the public API preflight", async () => {
  const { t } = await setup();
  const denied = await t.fetch("/v1/me");
  expect(denied.status).toBe(401);
  expect(await denied.json()).toMatchObject({ code: "UNAUTHORIZED" });
  expect(denied.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const preflight = await t.fetch("/v1/me", { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
    "Authorization"
  );
});

test.each(["API key", "OAuth"] as const)(
  "me returns the permanent owner for %s and rejects revoked credentials",
  async (kind) => {
    const { t, user, token, revoke } = await setup(kind);
    const request = () =>
      t.fetch("/v1/me?userId=foreign-owner", {
        headers: { Authorization: `Bearer ${token}` },
      });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        id: user._id,
        email: "identity-bearer@example.com",
        name: "Identity boundary",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    await revoke();
    expect((await request()).status).toBe(401);
  }
);

test("me reads the real mirror profile without exposing its row or WorkOS ID", async () => {
  const { t, user, token } = await setup("OAuth");
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      teakUserId: "foreign-owner",
      email: "foreign@example.com",
      emailVerified: true,
    });
    await ctx.db.insert("users", {
      teakUserId: user._id,
      email: "updated@example.com",
      emailVerified: true,
      workosUserId: "user_workos_is_not_the_owner",
    });
  });
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
  const response = await t.fetch("/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      id: user._id,
      email: "updated@example.com",
      name: "Identity boundary",
    },
  });
});

test("me fails closed for tombstoned identities even in shadow mode", async () => {
  const { t, user, token } = await setup("OAuth");
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: user._id,
      email: "deleted@example.com",
      emailVerified: true,
      deletedAt: Date.now(),
    })
  );
  expect(
    (await t.fetch("/v1/me", { headers: { Authorization: `Bearer ${token}` } }))
      .status
  ).toBe(401);
});

test("me rejects expired OAuth credentials", async () => {
  const { t, token } = await setup("OAuth");
  await t.mutation(components.betterAuth.adapter.updateOne, {
    input: {
      model: "oauthAccessToken",
      where: [{ field: "accessToken", operator: "eq", value: token }],
      update: { accessTokenExpiresAt: Date.now() - 1 },
    },
  });
  expect(
    (await t.fetch("/v1/me", { headers: { Authorization: `Bearer ${token}` } }))
      .status
  ).toBe(401);
});

test("me requires a canonical mapping when enforcement is enabled", async () => {
  const { t, token } = await setup("OAuth");
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
  const response = await t.fetch("/v1/me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(401);
});

test.each(["API key", "OAuth"] as const)(
  "me denies %s credentials after their legacy account is deleted",
  async (kind) => {
    const { t, user, token } = await setup(kind);
    await t.mutation(components.betterAuth.adapter.deleteOne, {
      input: {
        model: "user",
        where: [{ field: "_id", operator: "eq", value: user._id }],
      },
    });
    const response = await t.fetch("/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
  }
);
