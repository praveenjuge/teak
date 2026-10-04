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
import { buildR2UserPrefix } from "./storage/r2";

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
  const client = t.withIdentity({ subject: user._id, sessionId: session._id });
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
      headers: { Authorization: `Bearer ${token}` },
    });
  const mcp = () =>
    t.fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
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
  return { t, user, own, foreign, read, mcp, revoke };
}

// Failure modes: missing mappings break shadow API access; foreign cards leak;
// strict mode accepts missing/deleted mappings; cached credentials evade revocation.
test.each(["API key", "OAuth"] as const)(
  "real %s credentials retain their original vault in shadow mode and deny foreign cards",
  async (kind) => {
    const { t, own, foreign, read, mcp } = await setup(kind);
    expect((await read(own)).status).toBe(200);
    expect((await read(foreign)).status).toBe(404);
    expect((await mcp()).status).toBe(200);
    expect(await t.run((ctx) => ctx.db.query("users").collect())).toEqual([]);
  }
);

test.each(["API key", "OAuth"] as const)(
  "strict %s API and MCP requests require an active mapping and honor revocation",
  async (kind) => {
    const { t, user, own, read, mcp, revoke } = await setup(kind);
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
    await revoke();
    expect((await read(own)).status).toBe(401);
    expect((await mcp()).status).toBe(401);
  }
);

// Observe the storage key and persisted owner through the actual mutation paths.
test("upload URL and finalization retain the same original permanent owner", async () => {
  const { t, user } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: user._id,
      email: user.email,
      emailVerified: true,
    })
  );
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
  vi.stubEnv("FILES_BASE", "https://files.test");
  vi.stubEnv("FILES_SIGNING_SECRET", "test-upload-signing-secret");
  vi.stubEnv("R2_KEY_PREFIX", "");
  const generated = await t.mutation(
    internal.publicApiUploads.generateUploadUrlForUser,
    {
      userId: user._id,
      fileName: "photo.png",
      fileSize: 128,
      mimeType: "image/png",
    }
  );
  expect(generated.fileKey.startsWith(`${buildR2UserPrefix(user._id)}/`)).toBe(
    true
  );
  expect(decodeURIComponent(new URL(generated.uploadUrl).pathname)).toContain(
    generated.fileKey
  );
  const finalized = await t.mutation(
    internal.publicApiUploads.finalizeUploadedCardForUser,
    {
      userId: user._id,
      fileName: "photo.png",
      fileKey: generated.fileKey,
      fileSize: 128,
      storedFileSize: 128,
      mimeType: "image/png",
      storedMimeType: "image/png",
    }
  );
  expect(await t.run((ctx) => ctx.db.get(finalized.cardId))).toMatchObject({
    userId: user._id,
    fileKey: generated.fileKey,
    type: "image",
  });
});

test.each(["missing", "deleted"] as const)(
  "internal create, Raycast and restore paths deny a %s mapping",
  async (state) => {
    const { t, user, own } = await setup();
    if (state === "deleted") {
      await t.run((ctx) =>
        ctx.db.insert("users", {
          teakUserId: user._id,
          email: "",
          emailVerified: false,
          deletedAt: Date.now(),
        })
      );
    }
    vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
    const before = await t.run((ctx) => ctx.db.query("cards").collect());
    await expect(
      t.mutation(internal["card/createCard"].createCardForUser, {
        userId: user._id,
        type: "text",
        content: "Denied internal creation",
      })
    ).rejects.toThrow("User identity mapping unavailable");
    await expect(
      t.mutation(internal.raycast.quickSaveForUser, {
        userId: user._id,
        content: "Denied quick save",
      })
    ).rejects.toThrow("User identity mapping unavailable");
    await expect(
      t.mutation(internal["card/deleteCard"].restoreCardForUser, {
        userId: user._id,
        cardId: own,
      })
    ).rejects.toThrow("User identity mapping unavailable");
    expect(await t.run((ctx) => ctx.db.query("cards").collect())).toEqual(
      before
    );
  }
);

test("internal creation keeps the mapped original owner", async () => {
  const { t, user } = await setup();
  await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: user._id,
      email: user.email,
      emailVerified: true,
    })
  );
  vi.stubEnv("IDENTITY_RESOLVER_ENFORCE", "true");
  const id = await t.mutation(internal["card/createCard"].createCardForUser, {
    userId: user._id,
    type: "text",
    content: "Mapped original owner",
  });
  expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({
    userId: user._id,
    content: "Mapped original owner",
  });
});
