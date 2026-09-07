/// <reference types="vite/client" />

import betterAuthTest from "@convex-dev/better-auth/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { TEST_APPLE_PRIVATE_KEY } from "./__tests__/helpers/appleAuth.test-utils";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const accessToken = "a".repeat(32);
const refreshToken = "r".repeat(32);

beforeEach(() => {
  vi.stubEnv("SITE_URL", "http://app.teak.localhost:1355");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test");
  vi.stubEnv("APPLE_CLIENT_ID", "test-client");
  vi.stubEnv("APPLE_KEY_ID", "test-key");
  vi.stubEnv("APPLE_TEAM_ID", "test-team");
  vi.stubEnv("APPLE_PRIVATE_KEY", TEST_APPLE_PRIVATE_KEY);
});

const setup = async () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: "Safari test",
        email: "safari@example.com",
        emailVerified: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  await t.mutation(internal.oauthClients.ensureOAuthClients, {});
  await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "oauthAccessToken",
      data: {
        accessToken,
        refreshToken,
        clientId: "teak-safari",
        userId: user._id,
        accessTokenExpiresAt: Date.now() + 3_600_000,
        refreshTokenExpiresAt: Date.now() + 86_400_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        scopes: "profile email offline_access",
      },
    },
  });
  return { t, userId: user._id };
};

const revokeRequest = (token: string, clientId = "teak-safari") => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ token, client_id: clientId }).toString(),
});

describe("Safari OAuth connection", () => {
  test("appears in Connected apps and app-wide disconnect invalidates its credential", async () => {
    const { t, userId } = await setup();
    const authenticated = t.withIdentity({ subject: userId });
    expect(
      await authenticated.query(api.oauthTokens.listOAuthConnections, {})
    ).toEqual([
      expect.objectContaining({ clientId: "teak-safari", name: "Teak Safari" }),
    ]);
    await authenticated.action(api.oauthTokens.revokeOAuthConnection, {
      clientId: "teak-safari",
    });
    expect(
      await authenticated.query(api.oauthTokens.listOAuthConnections, {})
    ).toEqual([]);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: accessToken,
      })
    ).toBeNull();
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "oauthAccessToken",
        where: [{ field: "refreshToken", operator: "eq", value: refreshToken }],
      })
    ).toBeNull();
  });

  test("exact URL lookup is user-scoped and excludes deleted cards", async () => {
    const { t, userId } = await setup();
    const url = "https://example.com/safari";
    const expected = await t.run(async (ctx) => {
      const fields = {
        content: url,
        url,
        type: "link" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const own = await ctx.db.insert("cards", { ...fields, userId });
      await ctx.db.insert("cards", { ...fields, userId: "other-user" });
      await ctx.db.insert("cards", { ...fields, userId, isDeleted: true });
      return own;
    });
    const response = await t.fetch(
      `/v1/cards/duplicate?url=${encodeURIComponent(url)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ cardId: expected });
    const absent = await t.fetch(
      `/v1/cards/duplicate?url=${encodeURIComponent(`${url}/different`)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    expect(await absent.json()).toEqual({ cardId: null });
    const unsafe = await t.fetch(
      "/v1/cards/duplicate?url=javascript:alert(1)",
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    expect(unsafe.status).toBe(400);
    const unauthenticated = await t.fetch(
      `/v1/cards/duplicate?url=${encodeURIComponent(url)}`
    );
    expect(unauthenticated.status).toBe(401);
  });

  test("local sign-out revokes only the presented installation and is idempotent", async () => {
    const { t, userId } = await setup();
    await t.mutation(components.betterAuth.adapter.create, {
      input: {
        model: "oauthAccessToken",
        data: {
          clientId: "teak-safari",
          userId,
          accessToken: "b".repeat(32),
          refreshToken: "s".repeat(32),
          accessTokenExpiresAt: Date.now() + 3_600_000,
          refreshTokenExpiresAt: Date.now() + 86_400_000,
        },
      },
    });
    expect(
      (
        await t.fetch(
          "/api/oauth/revoke",
          revokeRequest(refreshToken, "teak-cli")
        )
      ).status
    ).toBe(200);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: accessToken,
      })
    ).not.toBeNull();
    expect(
      (await t.fetch("/api/oauth/revoke", revokeRequest(refreshToken))).status
    ).toBe(200);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: accessToken,
      })
    ).toBeNull();
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: "b".repeat(32),
      })
    ).not.toBeNull();
    expect(
      (await t.fetch("/api/oauth/revoke", revokeRequest(refreshToken))).status
    ).toBe(200);
    expect(
      (await t.fetch("/api/oauth/revoke", revokeRequest("b".repeat(32)))).status
    ).toBe(200);
    expect(
      await t
        .withIdentity({ subject: userId })
        .query(api.oauthTokens.listOAuthConnections, {})
    ).toEqual([]);
    const save = await t.fetch("/v1/cards", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://example.com" }),
    });
    expect(save.status).toBe(401);
  });

  test("provider refresh rotates credentials before local sign-out", async () => {
    const { t, userId } = await setup();
    const refreshed = await t.fetch("/api/auth/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "teak-safari",
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    });
    expect(refreshed.status).toBe(200);
    const tokens = await refreshed.json();
    expect(tokens.refresh_token).toBeTypeOf("string");
    expect(tokens.refresh_token).not.toBe(refreshToken);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: accessToken,
      })
    ).toBeNull();
    expect(
      await t.query(components.betterAuth.adapter.findOne, {
        model: "oauthAccessToken",
        where: [{ field: "refreshToken", operator: "eq", value: refreshToken }],
      })
    ).toBeNull();
    expect(
      (await t.fetch("/api/oauth/revoke", revokeRequest(tokens.refresh_token)))
        .status
    ).toBe(200);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: tokens.access_token,
      })
    ).toBeNull();
    expect(
      await t
        .withIdentity({ subject: userId })
        .query(api.oauthTokens.listOAuthConnections, {})
    ).toEqual([]);
    const retry = await t.fetch("/api/auth/mcp/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "teak-safari",
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      }).toString(),
    });
    expect(retry.status).toBe(401);
  });

  test("rejects invalid or oversized revocation forms", async () => {
    const { t } = await setup();
    expect(
      (await t.fetch("/api/oauth/revoke", { method: "POST", body: "{}" }))
        .status
    ).toBe(400);
    expect((await t.fetch("/api/oauth/revoke", revokeRequest(""))).status).toBe(
      400
    );
    expect(
      (await t.fetch("/api/oauth/revoke", revokeRequest("a".repeat(4096))))
        .status
    ).toBe(400);
    expect(
      await t.mutation(internal.oauthTokens.validateOAuthAccessToken, {
        token: accessToken,
      })
    ).not.toBeNull();
  });
});
