import polarTest from "@convex-dev/polar/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import counterTest from "@convex-dev/sharded-counter/test";
import {
  buildEdgeRateLimitSigningPayload,
  EDGE_RATE_LIMIT_HEADER,
} from "@teak/files-protocol";
import apiKeysTest from "@vllnt/convex-api-keys/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { seedWorkosOwner } from "../__tests__/helpers/workosOwner.test-utils";
import { api } from "../_generated/api";
import schema from "../schema";
import { RATE_LIMIT_CONFIG } from "../shared/rateLimits";
import { hmacSha256Hex } from "../storage/r2Keys";

const modules = import.meta.glob("../**/*.ts");
const SECRET = "edge-rate-limit-test-secret";

const sha256Hex = async (text: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const attestation = async (
  authorization: string,
  options: { expiresInSeconds?: number; secret?: string } = {}
): Promise<string> => {
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + (options.expiresInSeconds ?? 30)
  );
  const signature = await hmacSha256Hex(
    options.secret ?? SECRET,
    buildEdgeRateLimitSigningPayload({
      credentialSha256: await sha256Hex(authorization),
      expiresAt,
    })
  );
  return `${expiresAt}.${signature}`;
};

beforeEach(() => {
  vi.stubEnv("FILES_SIGNING_SECRET", SECRET);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T08:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const exhaustedKey = async () => {
  const t = convexTest(schema, modules);
  polarTest.register(t);
  rateLimiterTest.register(t, "rateLimiterV2");
  apiKeysTest.register(t);
  counterTest.register(t, "apiKeys/shardedCounter");
  const workosUserId = await seedWorkosOwner(t, "edge-limit-owner");
  const client = t.withIdentity({
    issuer: `https://api.workos.com/user_management/${process.env.WORKOS_CLIENT_ID}`,
    subject: workosUserId,
    sid: "session_edgelimit",
    email_verified: true,
    external_id: "edge-limit-owner",
  });
  const { key } = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Edge limit",
  });
  const second = await client.mutation(api.apiKeys.createUserApiKey, {
    name: "Another key",
  });
  const authorization = `Bearer ${key}`;
  const me = (headers: Record<string, string> = {}) =>
    t.fetch("/v1/me", {
      headers: { Authorization: authorization, ...headers },
    });

  const { capacity } = RATE_LIMIT_CONFIG.publicApiRequests;
  let granted = 0;
  for (let attempt = 0; attempt < 5000 && granted < capacity; attempt += 1) {
    if ((await me()).status !== 429) {
      granted += 1;
    }
  }
  expect(granted).toBe(capacity);
  expect((await me()).status).toBe(429);
  return { authorization, me, otherAuthorization: `Bearer ${second.key}`, t };
};

test("an attested request skips the per-request charge Convex would refuse", async () => {
  const { authorization, me } = await exhaustedKey();

  expect((await me()).status).toBe(429);
  const attested = await me({
    [EDGE_RATE_LIMIT_HEADER]: await attestation(authorization),
  });
  expect(attested.status).toBe(200);
}, 120_000);

test.each([
  ["signed with another secret", { secret: "not-the-secret" }],
  ["expired", { expiresInSeconds: -1 }],
  ["valid for longer than a minute", { expiresInSeconds: 3600 }],
])(
  "an attestation %s is charged as usual",
  async (_label, options) => {
    const { authorization, me } = await exhaustedKey();
    const response = await me({
      [EDGE_RATE_LIMIT_HEADER]: await attestation(authorization, options),
    });
    expect(response.status).toBe(429);
  },
  120_000
);

test("an attestation for another credential is charged as usual", async () => {
  const { me, otherAuthorization } = await exhaustedKey();
  const response = await me({
    [EDGE_RATE_LIMIT_HEADER]: await attestation(otherAuthorization),
  });
  expect(response.status).toBe(429);
}, 120_000);

test("MCP tool calls carry the attestation to the operation they run", async () => {
  const { authorization, t } = await exhaustedKey();
  const callGetMe = async (headers: Record<string, string>) => {
    const response = await t.fetch("/mcp", {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: authorization,
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "teak_v1_get_me", arguments: {} },
      }),
    });
    return (await response.json()) as {
      result?: { isError?: boolean; structuredContent?: { status?: number } };
    };
  };

  const charged = await callGetMe({});
  expect(charged.result?.structuredContent?.status).toBe(429);

  const attested = await callGetMe({
    [EDGE_RATE_LIMIT_HEADER]: await attestation(authorization),
  });
  expect(attested.result?.isError).not.toBe(true);
}, 120_000);
