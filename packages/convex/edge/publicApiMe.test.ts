import polarTest from "@convex-dev/polar/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import { ApiKeys } from "@vllnt/convex-api-keys";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api, components } from "../_generated/api";
import schema from "../schema";

const modules = import.meta.glob("../**/*.ts");
const OWNER = "permanent-owner";

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://app.teakvault.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, OWNER);
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_boundary",
    email_verified: true,
    external_id: OWNER,
  });
  const key = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Boundary proof",
  });
  const request = (path = "/v1/me") =>
    t.fetch(path, { headers: { Authorization: `Bearer ${key.key}` } });
  const revoke = () =>
    client.mutation(api.apiKeys.revokeUserApiKey, { keyId: key.id });
  return { t, workosUserId, key: key.key, request, revoke };
}

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

test("me returns the permanent owner for an API key and rejects it once revoked", async () => {
  const { request, revoke } = await setup();
  const response = await request("/v1/me?userId=foreign-owner");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      id: OWNER,
      email: `${OWNER}@example.test`,
      cardCount: 0,
      cardLimit: 200,
      plan: "free",
      locale: "en",
      settingsUrl: "https://app.teakvault.com/settings",
    },
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  await revoke();
  expect((await request()).status).toBe(401);
});

test("me reads the email and name sign-in stored on the owner row without exposing provider IDs", async () => {
  const { t, workosUserId, request } = await setup();
  const unchanged = await (await request()).json();
  expect(unchanged.data).toMatchObject({ email: `${OWNER}@example.test` });
  expect(unchanged.data).not.toHaveProperty("name");
  await t
    .withIdentity({
      issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
      subject: workosUserId,
      sid: "session_profile",
      email_verified: true,
      email: "updated@example.test",
      first_name: "Identity",
      last_name: "Boundary",
    })
    .mutation(api.workosBootstrap.ensureUser, {});
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: {
      id: OWNER,
      email: "updated@example.test",
      name: "Identity Boundary",
      cardCount: 0,
      cardLimit: 200,
      plan: "free",
      locale: "en",
      settingsUrl: "https://app.teakvault.com/settings",
    },
  });
});

test("me reports the language chosen in Settings, and English for a code it doesn't support", async () => {
  const { t, workosUserId, request } = await setup();
  const owner = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_settings",
    email_verified: true,
    external_id: OWNER,
  });
  await owner.mutation(api.settings.preferences.setLocale, { locale: "pt-BR" });
  expect((await (await request()).json()).data.locale).toBe("pt-BR");

  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("userPreferences")
      .withIndex("by_userId", (q) => q.eq("userId", OWNER))
      .unique();
    if (!row) {
      throw new Error("Missing preferences fixture");
    }
    await ctx.db.patch("userPreferences", row._id, { locale: "xx" });
  });
  expect((await (await request()).json()).data.locale).toBe("en");
});

test("me reports active cards against the free limit, not trashed ones", async () => {
  const { t, request } = await setup();
  await t.run(async (ctx) => {
    for (const isDeleted of [undefined, undefined, true] as const) {
      await ctx.db.insert("cards", {
        userId: OWNER,
        type: "text",
        content: "note",
        createdAt: 1,
        updatedAt: 1,
        ...(isDeleted ? { isDeleted, deletedAt: 1 } : {}),
      });
    }
  });
  const { data } = await (await request()).json();
  expect(data).toMatchObject({ cardCount: 2, cardLimit: 200, plan: "free" });
});

test("me denies an API key once its account is deleted", async () => {
  const { t, request } = await setup();
  await t.run(async (ctx) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", OWNER))
      .unique();
    if (!owner) {
      throw new Error("Missing owner fixture");
    }
    await ctx.db.patch("users", owner._id, { deletedAt: Date.now() });
  });
  expect((await request()).status).toBe(401);
});

test("a self-hosted deployment's API links open its own web app", async () => {
  vi.stubEnv("SITE_URL", "https://app.selfhost.example");
  const { request } = await setup();
  const me = await (await request()).json();
  expect(me.data.settingsUrl).toBe("https://app.selfhost.example/settings");
});

test("on the shared dev deployment, API links open the dev web app", async () => {
  vi.stubEnv("TEAK_DEV_DEPLOYMENT", "true");
  const { key, request, t } = await setup();
  const me = await (await request()).json();
  expect(me.data.settingsUrl).toBe("http://localhost:3000/settings");

  const created = await t.fetch("/v1/cards", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: "dev link note" }),
  });
  expect(created.status).toBe(200);
  const body = await created.json();
  expect(body.appUrl).toBe(`http://localhost:3000/?card=${body.card.id}`);
});

test("requests in quick succession reuse one key validation", async () => {
  vi.useFakeTimers();
  try {
    const { t, request } = await setup();
    for (let index = 0; index < 3; index += 1) {
      expect((await request()).status).toBe(200);
    }
    const [keyRow] = await t.run((ctx) =>
      ctx.db.query("apiKeyAuthCache").collect()
    );
    const apiKeys = new ApiKeys(components.apiKeys);
    const usage = await t.run((ctx) =>
      apiKeys.getUsage(ctx, { keyId: keyRow.keyId, ownerId: OWNER })
    );
    expect(usage.total).toBe(1);
    vi.advanceTimersByTime(61_000);
    expect((await request()).status).toBe(200);
    const refreshed = await t.run((ctx) =>
      apiKeys.getUsage(ctx, { keyId: keyRow.keyId, ownerId: OWNER })
    );
    expect(refreshed.total).toBe(2);
  } finally {
    vi.useRealTimers();
  }
});

test("a key revoked outside Teak's revoke paths stops working at once", async () => {
  const { t, request } = await setup();
  expect((await request()).status).toBe(200);
  const [keyRow] = await t.run((ctx) =>
    ctx.db.query("apiKeyAuthCache").collect()
  );
  await t.run((ctx) =>
    new ApiKeys(components.apiKeys).revoke(ctx, {
      keyId: keyRow.keyId,
      ownerId: OWNER,
    })
  );
  expect((await request()).status).toBe(401);
});

test("revoking a key clears its cached validation", async () => {
  const { t, request, revoke } = await setup();
  expect((await request()).status).toBe(200);
  await revoke();
  expect(
    await t.run((ctx) => ctx.db.query("apiKeyAuthCache").collect())
  ).toEqual([]);
  expect((await request()).status).toBe(401);
});

test("an account created at sign-in can mint a key and read me", async () => {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: "teak_early",
      identityOrigin: "workos",
      email: "early@example.com",
      emailVerified: true,
      workosUserId: "user_EARLY",
    })
  );
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: "user_EARLY",
    sid: "session_early",
    email_verified: true,
    email: "early@example.com",
  });
  const key = await client.mutation(api.apiKeys.createUserApiKey, {});
  const response = await t.fetch("/v1/me", {
    headers: { Authorization: `Bearer ${key.key}` },
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    data: { id: "teak_early", email: "early@example.com" },
  });
});
