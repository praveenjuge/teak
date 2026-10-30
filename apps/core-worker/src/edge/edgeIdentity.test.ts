import { describe, expect, test } from "bun:test";
import {
  buildEdgeIdentitySigningPayload,
  EDGE_IDENTITY_PATH,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "../lib";
import {
  EDGE_IDENTITY_KNOWN_TTL_SECONDS,
  EDGE_IDENTITY_UNKNOWN_TTL_SECONDS,
  type EdgeIdentityDeps,
  type EdgeIdentityEnv,
  resolveEdgeIdentity,
} from "./edgeIdentity";

const SECRET = "edge-identity-secret";
const API_KEY = `teakapi_secret_live_abcd1234_${"f".repeat(64)}`;
const JWT = "header.payload.signature";
const CLIENT_IP = "203.0.113.9";

class FakeKv {
  readonly values = new Map<string, string>();
  readonly ttls = new Map<string, number | undefined>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number }
  ): Promise<void> {
    this.values.set(key, value);
    this.ttls.set(key, options?.expirationTtl);
    return Promise.resolve();
  }
}

interface LookupCall {
  body: unknown;
  headers: Headers;
  url: string;
}

const convex = (
  owners: Record<string, string>,
  respond?: () => Response | Promise<Response>
) => {
  const calls: LookupCall[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const body = JSON.parse(String(init.body)) as Partial<
      Record<string, string>
    >;
    calls.push({ body, headers: new Headers(init.headers), url: String(url) });
    if (respond) {
      return await respond();
    }
    const credential = body.tokenHash ?? body.workosUserId ?? "";
    return Response.json({ userId: owners[credential] ?? null });
  }) as typeof fetch;
  return { calls, fetcher };
};

const env = (kv = new FakeKv()): EdgeIdentityEnv & { kv: FakeKv } => ({
  API_PUBLIC_HOST: "teakvault.com",
  API_UPSTREAM_ORIGIN: "https://upstream.example.convex.site",
  API_WORKOS_ISSUER: "https://auth.example.com",
  EDGE_IDENTITY: kv as unknown as KVNamespace,
  FILES_SIGNING_SECRET: SECRET,
  kv,
});

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil(promise: Promise<unknown>) {
    pending.push(promise);
  },
};
const settle = async () => {
  await Promise.all(pending.splice(0));
};

const request = (path: string, authorization?: string) =>
  new Request(`https://teakvault.com${path}`, {
    headers: {
      "cf-connecting-ip": CLIENT_IP,
      ...(authorization ? { Authorization: authorization } : {}),
    },
  });

const verifiedAs =
  (workosUserId: string): EdgeIdentityDeps["verifyToken"] =>
  (token, config) =>
    Promise.resolve(
      token === JWT && config.issuer === "https://auth.example.com"
        ? { clientId: "client_1", consentId: "app_consent_1", workosUserId }
        : null
    );

describe("API keys", () => {
  test("bucket by the key owner, asking Convex with the key's hash only", async () => {
    const keyHash = await sha256Hex(API_KEY);
    const { calls, fetcher } = convex({ [keyHash]: "teak-user-1" });
    const identity = await resolveEdgeIdentity(
      request("/api/v1/cards", `Bearer ${API_KEY}`),
      env(),
      ctx,
      { fetcher }
    );

    expect(identity).toEqual({ key: "user:teak-user-1", source: "api_key" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://upstream.example.convex.site${EDGE_IDENTITY_PATH}`
    );
    expect(calls[0]?.body).toEqual({ tokenHash: keyHash });
    expect(JSON.stringify(calls[0]?.body)).not.toContain(API_KEY);
  });

  test("signs each lookup so Convex can verify it came from this Worker", async () => {
    const { calls, fetcher } = convex({});
    await resolveEdgeIdentity(
      request("/api/v1/cards", `Bearer ${API_KEY}`),
      env(),
      ctx,
      { fetcher }
    );
    const [call] = calls;
    const expected = await hmacSha256Hex(
      SECRET,
      buildEdgeIdentitySigningPayload({
        bodySha256: await sha256Hex(JSON.stringify(call?.body)),
        expiresAt: call?.headers.get("x-teak-expires-at") ?? "",
        requestId: call?.headers.get("x-teak-request-id") ?? "",
      })
    );
    expect(call?.headers.get("x-teak-signature")).toBe(expected);
  });

  test("answer from KV for five minutes once Convex names the owner", async () => {
    const keyHash = await sha256Hex(API_KEY);
    const { calls, fetcher } = convex({ [keyHash]: "teak-user-1" });
    const shared = env();
    const req = () => request("/api/v1/cards", `Bearer ${API_KEY}`);

    await resolveEdgeIdentity(req(), shared, ctx, { fetcher });
    await settle();
    const second = await resolveEdgeIdentity(req(), shared, ctx, { fetcher });

    expect(second.key).toBe("user:teak-user-1");
    expect(calls).toHaveLength(1);
    expect(shared.kv.ttls.get(`key:${keyHash}`)).toBe(
      EDGE_IDENTITY_KNOWN_TTL_SECONDS
    );
    expect(EDGE_IDENTITY_KNOWN_TTL_SECONDS).toBe(300);
  });

  test("an unknown key falls back to the address, remembered for a minute", async () => {
    const { calls, fetcher } = convex({});
    const shared = env();
    const req = () => request("/api/v1/cards", `Bearer ${API_KEY}`);

    const first = await resolveEdgeIdentity(req(), shared, ctx, { fetcher });
    await settle();
    const second = await resolveEdgeIdentity(req(), shared, ctx, { fetcher });

    expect(first).toEqual({ key: `ip:${CLIENT_IP}`, source: "address" });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    expect(shared.kv.ttls.get(`key:${await sha256Hex(API_KEY)}`)).toBe(
      EDGE_IDENTITY_UNKNOWN_TTL_SECONDS
    );
  });

  test.each([
    ["an error status", () => new Response("down", { status: 503 })],
    ["a network failure", () => Promise.reject(new TypeError("network down"))],
  ])(
    "fall back to the address without caching when Convex gives %s",
    async (_label, respond) => {
      const { calls, fetcher } = convex({}, respond);
      const shared = env();
      const req = () => request("/api/v1/cards", `Bearer ${API_KEY}`);

      const first = await resolveEdgeIdentity(req(), shared, ctx, { fetcher });
      await settle();
      await resolveEdgeIdentity(req(), shared, ctx, { fetcher });

      expect(first.key).toBe(`ip:${CLIENT_IP}`);
      expect(shared.kv.values.size).toBe(0);
      expect(calls).toHaveLength(2);
    }
  );
});

test("a failed KV read counts as a cache miss", async () => {
  const keyHash = await sha256Hex(API_KEY);
  const { calls, fetcher } = convex({ [keyHash]: "teak-user-1" });
  const kv = new FakeKv();
  kv.get = () => Promise.reject(new Error("KV unavailable"));
  const identity = await resolveEdgeIdentity(
    request("/api/v1/cards", `Bearer ${API_KEY}`),
    env(kv),
    ctx,
    { fetcher }
  );
  expect(identity).toEqual({ key: "user:teak-user-1", source: "api_key" });
  expect(calls).toHaveLength(1);
});

describe("WorkOS access tokens", () => {
  test("bucket by the Teak user the verified token maps to", async () => {
    const { calls, fetcher } = convex({ user_01VERIFIED: "teak-user-2" });
    const identity = await resolveEdgeIdentity(
      request("/mcp", `Bearer ${JWT}`),
      env(),
      ctx,
      { fetcher, verifyToken: verifiedAs("user_01VERIFIED") }
    );
    expect(identity).toEqual({ key: "user:teak-user-2", source: "oauth" });
    expect(calls[0]?.body).toEqual({ workosUserId: "user_01VERIFIED" });
  });

  test.each([
    ["/mcp", "https://teakvault.com/mcp"],
    ["/api/v1/cards", "https://teakvault.com/api"],
  ])("verify %s tokens against the %s audience", async (path, audience) => {
    const audiences: string[] = [];
    await resolveEdgeIdentity(request(path, `Bearer ${JWT}`), env(), ctx, {
      fetcher: convex({}).fetcher,
      verifyToken: (_token, config) => {
        audiences.push(config.audience);
        return Promise.resolve(null);
      },
    });
    expect(audiences).toEqual([audience]);
  });

  test.each([
    ["Convex has no user for it", () => Response.json({ userId: null })],
    ["Convex cannot be reached", () => new Response("down", { status: 503 })],
  ])("still bucket by the WorkOS user when %s", async (_label, respond) => {
    const identity = await resolveEdgeIdentity(
      request("/mcp", `Bearer ${JWT}`),
      env(),
      ctx,
      {
        fetcher: convex({}, respond).fetcher,
        verifyToken: verifiedAs("user_01NEW"),
      }
    );
    expect(identity).toEqual({ key: "workos:user_01NEW", source: "oauth" });
  });

  test("a token that fails verification never reaches Convex", async () => {
    const { calls, fetcher } = convex({});
    const identity = await resolveEdgeIdentity(
      request("/mcp", "Bearer forged.token.value"),
      env(),
      ctx,
      { fetcher, verifyToken: verifiedAs("user_01VERIFIED") }
    );
    expect(identity).toEqual({ key: `ip:${CLIENT_IP}`, source: "address" });
    expect(calls).toHaveLength(0);
  });
});

describe("requests without a usable credential", () => {
  test.each([
    ["no Authorization header", undefined],
    ["a non-bearer scheme", `Basic ${btoa("user:pass")}`],
    ["a malformed API key", "Bearer teakapi_secret_live_short"],
    ["an opaque token", "Bearer not-a-key-or-jwt"],
  ])("bucket by address with %s", async (_label, authorization) => {
    const { calls, fetcher } = convex({});
    const identity = await resolveEdgeIdentity(
      request("/api/v1/cards", authorization),
      env(),
      ctx,
      { fetcher, verifyToken: verifiedAs("user_01VERIFIED") }
    );
    expect(identity).toEqual({ key: `ip:${CLIENT_IP}`, source: "address" });
    expect(calls).toHaveLength(0);
  });
});

describe("with the real WorkOS token verifier", () => {
  test("a token signed by the configured issuer for this audience maps to its user", async () => {
    const { exportJWK, generateKeyPair, SignJWT } = await import("jose");
    const issuer = "https://auth-real.example.com";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), alg: "RS256", kid: "k1" };
    const now = Math.floor(Date.now() / 1000);
    const sign = (audience: string) =>
      new SignJWT({
        client_id: "client_01EDGE",
        scope: "openid profile email",
        sid: "app_consent_01EDGE",
      })
        .setProtectedHeader({ alg: "RS256", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("user_01REAL")
        .setIssuedAt(now)
        .setExpirationTime(now + 300)
        .sign(privateKey);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) =>
      String(input instanceof Request ? input.url : input) ===
      `${issuer}/oauth2/jwks`
        ? Promise.resolve(Response.json({ keys: [jwk] }))
        : Promise.reject(new Error("unexpected fetch"))) as typeof fetch;
    try {
      const { fetcher } = convex({ user_01REAL: "teak-user-real" });
      const resolve = async (path: string, audience: string) =>
        resolveEdgeIdentity(
          request(path, `Bearer ${await sign(audience)}`),
          { ...env(), API_WORKOS_ISSUER: issuer },
          ctx,
          { fetcher }
        );

      expect(await resolve("/mcp", "https://teakvault.com/mcp")).toEqual({
        key: "user:teak-user-real",
        source: "oauth",
      });
      expect(await resolve("/mcp", "https://teakvault.com/api")).toEqual({
        key: `ip:${CLIENT_IP}`,
        source: "address",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
