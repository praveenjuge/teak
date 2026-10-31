import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import {
  buildEdgeRateLimitSigningPayload,
  EDGE_RATE_LIMIT_HEADER,
} from "@teak/files-protocol";
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
import { setOwnerVerified } from "../__tests__/helpers/workosOwner.test-utils";
import { api as backendApi, components, internal } from "../_generated/api";
import { syncCardSearchTagsBatchHandler } from "../card/searchSync";
import schema from "../schema";
import { API_KEY_TOKEN_PREFIX } from "../shared/apiKeyFormat";
import { RATE_LIMIT_CONFIG } from "../shared/rateLimits";
import { hmacSha256Hex, sha256Hex } from "../storage/r2Keys";

const modules = import.meta.glob("../**/*.ts");
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
  vi.stubEnv("SITE_URL", "https://app.teakvault.com");
  const jwk = await exportJWK(keys.publicKey);
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
  rateLimiterTest.register(t, "rateLimiterV2");
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", {
      teakUserId: ownerId,
      email: "legacy@example.test",
      emailVerified: true,
      workosUserId: userId,
    })
  );
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

  test("a deployment's resource origin replaces the production audiences", async () => {
    vi.stubEnv("WORKOS_RESOURCE_ORIGIN", "https://dev.convex.site");
    const f = await setup();
    expect(
      (await f.read(await token("https://dev.convex.site/api"))).status
    ).toBe(200);
    expect(
      (await f.mcp(await token("https://dev.convex.site/mcp"))).status
    ).toBe(200);
    expect((await f.read(await token(apiAudience))).status).toBe(401);
    expect((await f.mcp(await token(mcpAudience))).status).toBe(401);
  });

  test("a malformed resource origin fails closed", async () => {
    vi.stubEnv("WORKOS_RESOURCE_ORIGIN", "https://dev.convex.site/mcp");
    const f = await setup();
    expect((await f.read(await token())).status).toBe(500);
    expect((await f.mcp(await token(mcpAudience))).status).toBe(500);
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
    await f.t.run((ctx) => syncCardSearchTagsBatchHandler(ctx, id));
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

  test("profile reads the owner row's email and name and the permanent vault", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("users")
        .withIndex("by_teakUserId", (q) => q.eq("teakUserId", ownerId))
        .unique();
      if (row) {
        await ctx.db.patch("users", row._id, { name: "Row Name" });
      }
    });
    const access = await token();
    const profile = await f.read(access, "/v1/me");
    expect(profile.status).toBe(200);
    expect(await profile.json()).toEqual({
      data: {
        id: ownerId,
        email: "legacy@example.test",
        name: "Row Name",
        cardCount: 1,
        cardLimit: 200,
        plan: "free",
        locale: "en",
        settingsUrl: "https://app.teakvault.com/settings",
      },
    });
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
      ["GET", "/v1/folders"],
      ["POST", "/v1/folders"],
      ["PATCH", "/v1/folders/folder_id"],
      ["POST", "/v1/folders/folder_id/cards"],
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
    await setOwnerVerified(f.t, userId, false);
    expect((await f.read(access)).status).toBe(401);
    await setOwnerVerified(f.t, userId, true);
    expect((await f.read(access)).status).toBe(200);
    await f.t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
      userId: ownerId,
    });
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
    await setOwnerVerified(f.t, userId, false);
    expect((await f.read(key.key)).status).toBe(401);
    await setOwnerVerified(f.t, userId, true);
    expect((await f.read(key.key)).status).toBe(200);
    await f.t.run((ctx) => apiKeys.revoke(ctx, { keyId: key.keyId, ownerId }));
    expect((await f.read(key.key)).status).toBe(401);
    expect((await f.mcp(key.key, "ping")).status).toBe(401);
  });
});

describe("Connect requests the Core Worker already charged", () => {
  const secret = "edge-attestation-test-secret";
  type Fixture = Awaited<ReturnType<typeof setup>>;
  beforeEach(() => {
    vi.stubEnv("FILES_SIGNING_SECRET", secret);
    vi.setSystemTime(new Date("2026-10-31T09:00:00Z"));
  });
  afterEach(() => vi.restoreAllMocks());

  // The header the Core Worker adds once it has charged the request.
  const attestation = async (access: string) => {
    const expiresAt = String(Math.floor(Date.now() / 1000) + 30);
    const signature = await hmacSha256Hex(
      secret,
      buildEdgeRateLimitSigningPayload({
        credentialSha256: await sha256Hex(`Bearer ${access}`),
        expiresAt,
      })
    );
    return { [EDGE_RATE_LIMIT_HEADER]: `${expiresAt}.${signature}` };
  };
  const readAttested = async (f: Fixture, claims: JWTPayload = {}) => {
    const access = await token(apiAudience, claims);
    return f.read(access, `/v1/cards/${f.own}`, await attestation(access));
  };
  const consents = (f: Fixture) =>
    f.t.run((ctx) => ctx.db.query("workosConsents").take(10));

  test("records a new consent, then only reads it until five minutes pass", async () => {
    const f = await setup();
    expect((await readAttested(f)).status).toBe(200);
    const [first] = await consents(f);
    expect(first).toMatchObject({
      userId: ownerId,
      consentId,
      clientId,
      firstSeenAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    vi.setSystemTime(first.lastSeenAt + 299_999);
    expect((await readAttested(f)).status).toBe(200);
    expect(await consents(f)).toEqual([first]);
    vi.setSystemTime(first.lastSeenAt + 300_000);
    expect((await readAttested(f)).status).toBe(200);
    expect(await consents(f)).toEqual([
      { ...first, lastSeenAt: first.lastSeenAt + 300_000 },
    ]);
  });

  test.each([
    {
      reason: "revoked_consent",
      change: (f: Fixture) =>
        f.t.run(async (ctx) => {
          const [row] = await ctx.db.query("workosConsents").take(1);
          await ctx.db.patch(row._id, { revokedAt: Date.now() });
        }),
    },
    {
      reason: "consent_binding_conflict",
      claims: { client_id: "client_OTHER" },
    },
    {
      reason: "verify_email",
      change: (f: Fixture) => setOwnerVerified(f.t, userId, false),
    },
    {
      reason: "deleted_user",
      change: (f: Fixture) =>
        f.t.run((ctx) => ctx.db.patch(f.owner, { deletedAt: Date.now() })),
    },
    {
      reason: "deleting_user",
      change: (f: Fixture) =>
        f.t.mutation(internal.accountDeletion.beginAccountDataDeletion, {
          userId: ownerId,
        }),
    },
  ] as {
    reason: string;
    change?: (f: Fixture) => Promise<unknown>;
    claims?: JWTPayload;
  }[])(
    "a recently seen consent is denied at once for $reason",
    async ({ reason, change, claims }) => {
      const f = await setup();
      expect((await readAttested(f)).status).toBe(200);
      await change?.(f);
      const before = await consents(f);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      expect((await readAttested(f, claims)).status).toBe(401);
      expect(
        log.mock.calls.find(
          (call) => call[0] === "public_api_auth_outcome"
        )?.[1]
      ).toMatchObject({ status: 401, reason: `owner_${reason}` });
      expect(await consents(f)).toEqual(before);
    }
  );

  test("an unattested Connect request is still charged, an attested one is not", async () => {
    const f = await setup();
    const access = await token();
    const { capacity } = RATE_LIMIT_CONFIG.publicApiRequests;
    let granted = 0;
    for (let attempt = 0; attempt < 5000 && granted < capacity; attempt += 1) {
      if ((await f.read(access)).status !== 429) {
        granted += 1;
      }
    }
    expect(granted).toBe(capacity);
    expect((await f.read(access)).status).toBe(429);
    expect(
      (await f.read(access, `/v1/cards/${f.own}`, await attestation(access)))
        .status
    ).toBe(200);
  }, 120_000);
});
