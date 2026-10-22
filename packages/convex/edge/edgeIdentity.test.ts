import {
  buildEdgeIdentitySigningPayload,
  EDGE_IDENTITY_PATH,
} from "@teak/files-protocol";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../schema";
import { hmacSha256Hex } from "../storage/r2Keys";

const modules = import.meta.glob("../**/*.ts");
const SECRET = "edge-identity-test-secret";
const KEY_HASH = "a".repeat(64);

const sha256Hex = async (text: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const signedHeaders = async (
  body: string,
  options: { expiresInSeconds?: number; secret?: string } = {}
): Promise<Record<string, string>> => {
  const requestId = crypto.randomUUID();
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 30)
  );
  const signature = await hmacSha256Hex(
    options.secret ?? SECRET,
    buildEdgeIdentitySigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
  return {
    "Content-Type": "application/json",
    "x-teak-expires-at": expiresAt,
    "x-teak-request-id": requestId,
    "x-teak-signature": signature,
  };
};

const setup = async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("apiKeyAuthCache", {
      keyId: "key_1",
      rateLimitKey: "component:key_1",
      tokenHash: KEY_HASH,
      userId: "teak-user-key-owner",
      verifiedAt: Date.now(),
    });
    await ctx.db.insert("users", {
      email: "owner@example.com",
      emailVerified: true,
      teakUserId: "teak-user-workos",
      workosUserId: "user_01EDGEIDENTITY",
    });
  });
  const lookup = async (body: string, headers?: Record<string, string>) =>
    t.fetch(EDGE_IDENTITY_PATH, {
      method: "POST",
      body,
      headers: headers ?? (await signedHeaders(body)),
    });
  return { lookup };
};

describe("edge identity lookup", () => {
  beforeEach(() => {
    vi.stubEnv("FILES_SIGNING_SECRET", SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([
    [{ tokenHash: KEY_HASH }, "teak-user-key-owner"],
    [{ tokenHash: "b".repeat(64) }, null],
    [{ workosUserId: "user_01EDGEIDENTITY" }, "teak-user-workos"],
    [{ workosUserId: "user_01UNKNOWN" }, null],
  ])("answers %j with the owner %s", async (lookupBody, userId) => {
    const { lookup } = await setup();
    const response = await lookup(JSON.stringify(lookupBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ userId });
  });

  test("refuses an unsigned request", async () => {
    const { lookup } = await setup();
    const body = JSON.stringify({ tokenHash: KEY_HASH });
    const response = await lookup(body, { "Content-Type": "application/json" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test.each([
    ["another secret", { secret: "not-the-secret" }],
    ["an expired signature", { expiresInSeconds: -1 }],
    ["a signature valid for too long", { expiresInSeconds: 3600 }],
  ])("refuses %s", async (_label, options) => {
    const { lookup } = await setup();
    const body = JSON.stringify({ tokenHash: KEY_HASH });
    const response = await lookup(body, await signedHeaders(body, options));
    expect(response.status).toBe(401);
  });

  test("refuses a body that differs from the one signed", async () => {
    const { lookup } = await setup();
    const headers = await signedHeaders(
      JSON.stringify({ tokenHash: "b".repeat(64) })
    );
    const response = await lookup(
      JSON.stringify({ tokenHash: KEY_HASH }),
      headers
    );
    expect(response.status).toBe(401);
  });

  test.each([
    ["both credentials", { tokenHash: KEY_HASH, workosUserId: "user_01A" }],
    ["a raw API key instead of its hash", { tokenHash: "teakapi_secret_live" }],
    ["an empty object", {}],
  ])("rejects a lookup with %s", async (_label, lookupBody) => {
    const { lookup } = await setup();
    const response = await lookup(JSON.stringify(lookupBody));
    expect(response.status).toBe(400);
  });

  test("is unavailable until the signing secret is configured", async () => {
    vi.stubEnv("FILES_SIGNING_SECRET", "");
    const { lookup } = await setup();
    const response = await lookup(JSON.stringify({ tokenHash: KEY_HASH }));
    expect(response.status).toBe(503);
  });
});
