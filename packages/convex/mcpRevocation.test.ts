/// <reference types="vite/client" />

import betterAuthTest from "@convex-dev/better-auth/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { beforeEach, expect, test, vi } from "vitest";
import { TEST_APPLE_PRIVATE_KEY } from "./__tests__/helpers/appleAuth.test-utils";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

beforeEach(() => {
  vi.stubEnv("SITE_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test");
  vi.stubEnv("APPLE_CLIENT_ID", "test-client");
  vi.stubEnv("APPLE_KEY_ID", "test-key");
  vi.stubEnv("APPLE_TEAM_ID", "test-team");
  vi.stubEnv("APPLE_PRIVATE_KEY", TEST_APPLE_PRIVATE_KEY);
});

test("disconnect blocks an already initialized MCP client without waiting for a cache to expire", async () => {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  await t.mutation(internal.oauthClients.ensureOAuthClients, {});
  const now = Date.now();
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name: "MCP connection test",
        email: "mcp-connection@example.com",
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
  const accessToken = "m".repeat(32);
  await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "oauthAccessToken",
      data: {
        clientId: "teak-cli",
        userId: user._id,
        accessToken,
        refreshToken: "n".repeat(32),
        accessTokenExpiresAt: now + 3_600_000,
        refreshTokenExpiresAt: now + 86_400_000,
        createdAt: now,
        updatedAt: now,
        scopes: "profile email offline_access",
      },
    },
  });
  const request = (method: string) =>
    t.fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: { protocolVersion: "2025-06-18" },
      }),
    });
  expect((await request("initialize")).status).toBe(200);
  expect((await request("tools/list")).status).toBe(200);
  await t
    .withIdentity({ subject: user._id, sessionId: session._id })
    .action(api.oauthTokens.revokeOAuthConnection, { clientId: "teak-cli" });
  for (const method of ["tools/list", "ping", "tools/call", "initialize"]) {
    const response = await request(method);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain(
      "resource_metadata="
    );
  }
});
