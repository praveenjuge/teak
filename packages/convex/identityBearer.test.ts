/// <reference types="vite/client" />
import betterAuthTest from "@convex-dev/better-auth/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "false"));
afterEach(() => vi.unstubAllEnvs());

async function setup() {
  const t = convexTest(schema, modules);
  betterAuthTest.register(t);
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
  const client = t.withIdentity({ subject: user._id, sessionId: session._id });
  const key = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Boundary proof",
  });
  const card = (owner: string, content: string) =>
    t.run((ctx) =>
      ctx.db.insert("cards", {
        userId: owner,
        content,
        type: "text",
        createdAt: now,
        updatedAt: now,
      })
    );
  const own = await card(user._id, "Original vault");
  const foreign = await card("another-owner", "Foreign vault");
  const read = (id: string) =>
    t.fetch(`/v1/cards/${id}`, {
      headers: { Authorization: `Bearer ${key.key}` },
    });
  const mcp = () =>
    t.fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key.key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      }),
    });
  return { t, client, user, key, own, foreign, read, mcp };
}

// Failure modes: missing mappings break shadow API access; foreign cards leak;
// strict mode accepts missing/deleted mappings; cached credentials evade revocation.
test("real API keys retain their original vault in shadow mode and deny foreign cards", async () => {
  const { t, own, foreign, read, mcp } = await setup();
  expect((await read(own)).status).toBe(200);
  expect((await read(foreign)).status).toBe(404);
  expect((await mcp()).status).toBe(200);
  expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
});

test("strict API and MCP requests require an active mapping and still honor key revocation", async () => {
  const { t, client, user, key, own, read, mcp } = await setup();
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
  expect((await read(own)).status).toBe(401);
  expect((await mcp()).status).toBe(401);
  const row = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: user._id,
      email: user.email,
      emailVerified: true,
    })
  );
  expect((await read(own)).status).toBe(200);
  expect((await mcp()).status).toBe(200);
  await t.run((ctx) => ctx.db.patch("users", row, { deletedAt: Date.now() }));
  expect((await read(own)).status).toBe(401);
  expect((await mcp()).status).toBe(401);
  await t.run((ctx) => ctx.db.patch("users", row, { deletedAt: undefined }));
  await client.mutation(api.apiKeys.revokeUserApiKey, { keyId: key.id });
  expect((await read(own)).status).toBe(401);
  expect((await mcp()).status).toBe(401);
});
