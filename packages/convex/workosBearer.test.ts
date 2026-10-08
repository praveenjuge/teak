/// <reference types="vite/client" />
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import workflowTest from "@convex-dev/workflow/test";
import authKitTest from "@convex-dev/workos-authkit/test";
import { ApiKeys } from "@vllnt/convex-api-keys";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { exportJWK, generateKeyPair, type JWTPayload, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  seedComponentUser,
  updateComponentUser,
} from "./__tests__/helpers/workosOwner.test-utils";
import { api as backendApi, components } from "./_generated/api";
import schema from "./schema";
import { API_KEY_TOKEN_PREFIX } from "./shared/apiKeyFormat";

const modules = import.meta.glob("./**/*.ts");
const issuer = "https://bearer-dev.authkit.app";
const ownerId = "legacy-owner";
const userId = "user_PROVIDER";
const consentId = "app_consent_CONSENT";
const clientId = "client_CLIENT";
const apiAudience = "https://teakvault.com/api";
const mcpAudience = "https://teakvault.com/mcp";
let keys: Awaited<ReturnType<typeof generateKeyPair>>;

beforeAll(async () => {
  keys = await generateKeyPair("RS256", { extractable: true });
});
beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubEnv("WORKOS_AUTHKIT_DOMAIN", issuer);
  vi.stubEnv("WORKOS_API_KEY", "non-secret-disconnect-test-fixture");
  vi.stubEnv("WORKOS_ENVIRONMENT_ID", "environment_TEST");
  const jwk = await exportJWK(keys.publicKey);
  // Provider JWKS is the only mocked boundary; signatures and database auth are real.
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, options?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${issuer}/oauth2/jwks`) {
        return Promise.resolve(
          Response.json({ keys: [{ ...jwk, kid: "test-key", alg: "RS256" }] })
        );
      }
      if (options?.method === "DELETE") {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(
        Response.json({
          data: [
            { application: { id: "connect_app_TEST", client_id: clientId } },
          ],
          list_metadata: {},
        })
      );
    }
  );
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function token(audience = apiAudience, overrides: JWTPayload = {}) {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({
    iss: issuer,
    aud: audience,
    sub: userId,
    sid: consentId,
    client_id: clientId,
    scope: "openid profile email offline_access",
    external_id: ownerId,
    iat: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .sign(keys.privateKey);
}

async function setup() {
  const t = convexTest(schema, modules);
  authKitTest.register(t);
  workflowTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      email: "legacy@example.test",
      emailVerified: true,
      workosUserId: userId,
    })
  );
  await seedComponentUser(t, {
    id: userId,
    email: "provider@example.test",
    externalId: ownerId,
    firstName: "Current",
    lastName: "Profile",
  });
  const own = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: ownerId,
      content: "Own vault",
      type: "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const foreign = await t.run((ctx) =>
    ctx.db.insert("cards", {
      userId: "other-owner",
      content: "Other vault",
      type: "text",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  );
  const read = (
    access: string,
    path = `/v1/cards/${own}`,
    headers: Record<string, string> = {}
  ) =>
    t.fetch(path, {
      headers: { Authorization: `Bearer ${access}`, ...headers },
    });
  const mcp = (
    access: string,
    method = "initialize",
    params: unknown = { protocolVersion: "2025-06-18" }
  ) =>
    t.fetch("/mcp", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  return { t, owner, own, foreign, read, mcp };
}

// Failures: resource confusion in synthetic REST requests; spoofed resource
// headers; ID/M2M/session tokens; refreshed credentials undo durable revocation;
// mapping/deletion bypass; WorkOS acceptance in legacy mode; raw provider owners.
describe("WorkOS REST and MCP token boundary", () => {
  test("API token reads its permanent vault while MCP token initializes and executes shared tools", async () => {
    const f = await setup();
    const api = await token();
    const mcp = await token(mcpAudience);
    expect((await f.read(api)).status).toBe(200);
    expect((await f.mcp(mcp)).status).toBe(200);
    expect((await f.mcp(mcp, "tools/list")).status).toBe(200);
    const called = await f.mcp(mcp, "tools/call", {
      name: "teak_v1_get_card",
      arguments: { cardId: f.own },
    });
    expect(called.status).toBe(200);
    expect(JSON.stringify(await called.json())).toContain("Own vault");
    const rows = await f.t.run((ctx) =>
      ctx.db.query("workosConsents").take(10)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(ownerId);
  });

  test("MCP CRUD and listing retain the permanent owner through shared REST handlers", async () => {
    const f = await setup();
    const access = await token(mcpAudience);
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await f.mcp(access, "tools/call", {
        name,
        arguments: args,
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.result.isError).not.toBe(true);
      return payload.result.structuredContent;
    };
    const created = await call("teak_v1_create_card", {
      content: "WorkOS-created card",
      tags: ["migrated"],
    });
    const id = await f.t.run(async (ctx) =>
      ctx.db.normalizeId("cards", created.cardId)
    );
    if (!id) {
      throw new Error("Create response must contain a valid card ID");
    }
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.userId).toBe(ownerId);
    await call("teak_v1_update_card", {
      cardId: id,
      content: "Updated WorkOS card",
    });
    await call("teak_v1_set_card_favorite", { cardId: id, isFavorited: true });
    const listed = await call("teak_v1_list_cards", {});
    expect(listed.items.map((card: { id: string }) => card.id).sort()).toEqual(
      [f.own, id].sort()
    );
    expect(
      JSON.stringify(await call("teak_v1_get_card", { cardId: id }))
    ).toContain("Updated WorkOS card");
    expect(JSON.stringify(await call("teak_v1_list_tags", {}))).toContain(
      "migrated"
    );
    expect(
      JSON.stringify(await call("teak_v1_get_card_changes", { since: 0 }))
    ).not.toContain(f.foreign);
    await call("teak_v1_bulk_cards", {
      operation: "update",
      items: [{ cardId: id, notes: "Bulk update" }],
    });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.notes).toBe("Bulk update");
    await call("teak_v1_delete_card", { cardId: id, confirm: true });
    expect((await f.t.run((ctx) => ctx.db.get(id)))?.isDeleted).toBe(true);
    expect((await f.t.run((ctx) => ctx.db.get(f.foreign)))?.content).toBe(
      "Other vault"
    );
  });

  test("profile and Mac account summary use the WorkOS email and permanent vault", async () => {
    const f = await setup();
    const access = await token();
    const profile = await f.read(access, "/v1/me");
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({
      data: {
        id: ownerId,
        email: "provider@example.test",
        name: "Current Profile",
      },
    });
    const summary = await f.read(access, "/api/safari/account-summary");
    expect(summary.status).toBe(200);
    expect(await summary.json()).toEqual({
      email: "provider@example.test",
      cardCount: 1,
    });
    expect(
      (await f.read(await token(mcpAudience), "/api/safari/account-summary"))
        .status
    ).toBe(401);
  });

  test("all REST route families reject MCP tokens before validation or data access", async () => {
    const f = await setup();
    const access = await token(mcpAudience);
    for (const [method, path] of [
      ["GET", "/v1/me"],
      ["GET", "/v1/cards"],
      ["POST", "/v1/cards"],
      ["POST", "/v1/uploads"],
      ["POST", "/v1/cards/bulk"],
      ["GET", "/v1/cards/changes?since=0"],
      ["GET", "/v1/tags"],
      ["PATCH", `/v1/cards/${f.own}`],
      ["DELETE", `/v1/cards/${f.own}`],
      ["POST", `/v1/cards/${f.own}/restore`],
      ["GET", "/v1/cards/duplicate?url=https://example.test"],
    ]) {
      const response = await f.t.fetch(path, {
        method,
        headers: { Authorization: `Bearer ${access}` },
      });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
    expect(
      (await f.t.run((ctx) => ctx.db.get(f.own)))?.isDeleted
    ).toBeUndefined();
    expect(
      await f.t.run((ctx) => ctx.db.query("workosConsents").take(10))
    ).toEqual([]);
  });

  test("MCP upload reaches payload validation using its own audience", async () => {
    const f = await setup();
    const response = await f.mcp(await token(mcpAudience), "tools/call", {
      name: "teak_v1_create_upload",
      arguments: {
        fileName: "blocked.exe",
        mimeType: "application/x-msdownload",
        fileSize: 100,
      },
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.isError).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("UNAUTHORIZED");
    expect(JSON.stringify(payload)).toContain("INVALID_INPUT");
  });

  test("cross-resource tokens reject before data access despite headers and query overrides", async () => {
    const f = await setup();
    expect(
      (
        await f.read(
          await token(mcpAudience),
          `/v1/cards/${f.own}?resource=${apiAudience}`,
          { "X-Teak-Resource": "api", "X-Forwarded-Host": "teakvault.com" }
        )
      ).status
    ).toBe(401);
    expect((await f.mcp(await token(), "ping")).status).toBe(401);
    expect(
      await f.t.run((ctx) => ctx.db.query("workosConsents").take(10))
    ).toEqual([]);
  });

  test.each([
    { aud: clientId },
    { sub: clientId, sid: undefined },
    { sid: "session_SESSION" },
    { iss: `https://api.workos.com/user_management/${clientId}` },
    { iss: "https://bearer-prod.authkit.app" },
    { exp: 1 },
    { scope: "openid profile" },
    { external_id: "other-owner" },
  ] satisfies JWTPayload[])(
    "rejects invalid credentials %j at both resources",
    async (claims) => {
      const f = await setup();
      expect((await f.read(await token(apiAudience, claims))).status).toBe(401);
      expect(
        (await f.mcp(await token(mcpAudience, claims), "ping")).status
      ).toBe(401);
      expect(
        await f.t.run((ctx) => ctx.db.query("workosConsents").take(10))
      ).toEqual([]);
    }
  );

  test("revoked consent denies old and freshly signed tokens including protocol-only MCP", async () => {
    const f = await setup();
    const api = await token();
    const mcp = await token(mcpAudience);
    const siblingApi = await token(apiAudience, { sid: "app_consent_SIBLING" });
    const siblingMcp = await token(mcpAudience, { sid: "app_consent_SIBLING" });
    expect((await f.read(siblingApi)).status).toBe(200);
    expect((await f.mcp(siblingMcp, "ping")).status).toBe(200);
    expect((await f.mcp(mcp)).status).toBe(200);
    vi.stubEnv("WORKOS_CLIENT_ID", "client_SESSION");
    expect(
      await f.t
        .withIdentity({
          issuer: "https://api.workos.com/user_management/client_SESSION",
          subject: userId,
          sid: "session_SETTINGS",
          email_verified: true,
          external_id: ownerId,
        })
        .action(backendApi.workosConsents.disconnectConnection, {
          consentId,
        })
    ).toBeNull();
    expect((await f.read(api)).status).toBe(401);
    expect((await f.read(await token())).status).toBe(401);
    for (const method of ["initialize", "tools/list", "ping", "tools/call"]) {
      expect((await f.mcp(mcp, method)).status).toBe(401);
      expect((await f.mcp(await token(mcpAudience), method)).status).toBe(401);
    }
    expect((await f.read(siblingApi)).status).toBe(401);
    expect((await f.mcp(siblingMcp, "ping")).status).toBe(401);
    expect(
      (
        await f.read(
          await token(apiAudience, {
            client_id: "client_OTHER",
            sid: "app_consent_OTHER",
          })
        )
      ).status
    ).toBe(200);
  });

  test("mapping verification and global deletion are rechecked after consent exists", async () => {
    const f = await setup();
    const access = await token();
    expect((await f.read(access)).status).toBe(200);
    await updateComponentUser(f.t, userId, { emailVerified: false });
    expect((await f.read(access)).status).toBe(401);
    await updateComponentUser(f.t, userId, { emailVerified: true });
    expect((await f.read(access)).status).toBe(200);
    await f.t.run((ctx) =>
      ctx.db.insert("accountDeletionStates", {
        userId: ownerId,
        startedAt: Date.now(),
      })
    );
    expect((await f.read(access)).status).toBe(401);
  });

  test("credentials cannot read or mutate another owner's cards", async () => {
    const f = await setup();
    const access = await token();
    expect((await f.read(access, `/v1/cards/${f.foreign}`)).status).toBe(404);
    expect(
      (
        await f.t.fetch(`/v1/cards/${f.foreign}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: "attack" }),
        })
      ).status
    ).toBe(404);
    expect((await f.t.run((ctx) => ctx.db.get(f.foreign)))?.content).toBe(
      "Other vault"
    );
  });

  test("API keys work without a Better Auth account and remain independently revocable", async () => {
    const f = await setup();
    apiKeysTest.register(f.t);
    counterTest.register(f.t, "apiKeys/shardedCounter");
    const apiKeys = new ApiKeys(components.apiKeys, {
      defaultType: "secret",
      prefix: API_KEY_TOKEN_PREFIX,
    });
    const key = await f.t.run((ctx) =>
      apiKeys.create(ctx, {
        ownerId,
        name: "escape hatch",
        env: "live",
        scopes: ["full_access"],
      })
    );
    expect((await f.read(key.key)).status).toBe(200);
    expect((await f.mcp(key.key)).status).toBe(200);
    await updateComponentUser(f.t, userId, { emailVerified: false });
    expect((await f.read(key.key)).status).toBe(401);
    await updateComponentUser(f.t, userId, { emailVerified: true });
    expect((await f.read(key.key)).status).toBe(200);
    await f.t.run((ctx) => apiKeys.revoke(ctx, { keyId: key.keyId, ownerId }));
    expect((await f.read(key.key)).status).toBe(401);
    expect((await f.mcp(key.key, "ping")).status).toBe(401);
  });
});
