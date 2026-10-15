import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { RATE_LIMIT_CONFIG } from "@teak/convex/shared/rateLimits";
import { buildEdgeRateLimitSigningPayload } from "@teak/files-protocol";
import { unstable_readConfig } from "wrangler";
import type { EdgeIdentityDeps } from "./edgeIdentity";
import {
  applyEdgeRateLimit,
  EDGE_API_REQUEST_LIMIT,
  EDGE_UNKNOWN_CREDENTIAL_LIMIT,
  type EdgeRateLimitEnv,
  MCP_EDGE_RATE_LIMITED_CODE,
  type RateLimiter,
} from "./edgeRateLimit";
import { hmacSha256Hex, sha256Hex } from "./lib";

const SECRET = "edge-rate-limit-secret";
const CLIENT_IP = "198.51.100.4";
const keyFor = (suffix: string) =>
  `teakapi_secret_live_abcd${suffix}_${"e".repeat(64)}`;
const KEY_A = keyFor("0001");
const KEY_B = keyFor("0002");
const STRANGER_KEY = keyFor("9999");

/** Workers limiter stand-in: a fixed number of calls per key, recording keys. */
class FakeLimiter implements RateLimiter {
  readonly keys: string[] = [];
  private readonly counts = new Map<string, number>();
  private readonly allowed: number;
  private readonly fail: boolean;

  constructor(allowed: number, fail = false) {
    this.allowed = allowed;
    this.fail = fail;
  }

  limit({ key }: { key: string }) {
    if (this.fail) {
      return Promise.reject(new Error("limiter unavailable"));
    }
    this.keys.push(key);
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    return Promise.resolve({ success: count <= this.allowed });
  }
}

/** Convex answers: both test keys belong to one user; anything else is unknown. */
const deps = async (): Promise<EdgeIdentityDeps> => {
  const owners: Record<string, string> = {
    [await sha256Hex(KEY_A)]: "teak-user-1",
    [await sha256Hex(KEY_B)]: "teak-user-1",
  };
  return {
    fetcher: ((_url: string, init: RequestInit = {}) => {
      const { tokenHash } = JSON.parse(String(init.body)) as {
        tokenHash?: string;
      };
      return Promise.resolve(
        Response.json({ userId: owners[tokenHash ?? ""] ?? null })
      );
    }) as typeof fetch,
  };
};

const env = (
  limits: { api?: RateLimiter; unknown?: RateLimiter } = {}
): EdgeRateLimitEnv & { api: FakeLimiter; unknown: FakeLimiter } => {
  const api = (limits.api as FakeLimiter) ?? new FakeLimiter(2);
  const unknown = (limits.unknown as FakeLimiter) ?? new FakeLimiter(1);
  return {
    API_PUBLIC_HOST: "teakvault.com",
    API_REQUEST_LIMITER: api,
    API_UPSTREAM_ORIGIN: "https://upstream.example.convex.site",
    FILES_SIGNING_SECRET: SECRET,
    UNKNOWN_CREDENTIAL_LIMITER: unknown,
    api,
    unknown,
  };
};

const ctx = { waitUntil: () => undefined };

const request = (
  path: string,
  init: { body?: string; key?: string; method?: string } = {}
) =>
  new Request(`https://teakvault.com${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    body: init.body,
    headers: {
      "cf-connecting-ip": CLIENT_IP,
      ...(init.key ? { Authorization: `Bearer ${init.key}` } : {}),
    },
  });

const limit = async (
  shared: EdgeRateLimitEnv,
  req: Request
): Promise<Awaited<ReturnType<typeof applyEdgeRateLimit>>> =>
  applyEdgeRateLimit(req, shared, ctx, await deps());

describe("a known user", () => {
  test("is charged to one bucket across all of their API keys", async () => {
    const shared = env();
    await limit(shared, request("/api/v1/cards", { key: KEY_A }));
    await limit(shared, request("/api/v1/cards", { key: KEY_B }));
    expect(shared.api.keys).toEqual(["user:teak-user-1", "user:teak-user-1"]);
  });

  test("within the limit, is forwarded with an attestation bound to the credential", async () => {
    const outcome = await limit(
      env(),
      request("/api/v1/cards", { key: KEY_A })
    );
    expect("attestation" in outcome).toBe(true);
    const value = "attestation" in outcome ? outcome.attestation : null;
    const [expiresAt = "", signature] = (value ?? "").split(".");
    const now = Math.floor(Date.now() / 1000);
    expect(Number(expiresAt)).toBeGreaterThan(now);
    expect(Number(expiresAt)).toBeLessThanOrEqual(now + 60);
    expect(signature).toBe(
      await hmacSha256Hex(
        SECRET,
        buildEdgeRateLimitSigningPayload({
          credentialSha256: await sha256Hex(`Bearer ${KEY_A}`),
          expiresAt,
        })
      )
    );
  });

  test("over the limit, gets the public API's 429", async () => {
    const shared = env();
    await limit(shared, request("/api/v1/cards", { key: KEY_A }));
    await limit(shared, request("/api/v1/cards", { key: KEY_B }));
    const outcome = await limit(
      shared,
      request("/api/v1/cards", { key: KEY_A })
    );
    const response = "response" in outcome ? outcome.response : null;

    expect(response?.status).toBe(429);
    expect(await response?.json()).toMatchObject({
      code: "RATE_LIMITED",
      error: "Too many requests",
    });
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(response?.headers.get("ratelimit-limit")).toBe(
      String(EDGE_API_REQUEST_LIMIT)
    );
    expect(response?.headers.get("ratelimit-remaining")).toBe("0");
    expect(response?.headers.get("access-control-allow-origin")).toBe("*");
    expect(response?.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
  });

  test("over the limit on MCP, gets HTTP 429 with a JSON-RPC error for the request", async () => {
    const shared = env({ api: new FakeLimiter(0) });
    const outcome = await limit(
      shared,
      request("/mcp", {
        key: KEY_A,
        body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call" }),
      })
    );
    const response = "response" in outcome ? outcome.response : null;

    expect(response?.status).toBe(429);
    expect(response?.headers.get("retry-after")).toBe("60");
    expect(await response?.json()).toMatchObject({
      jsonrpc: "2.0",
      id: 42,
      error: { code: MCP_EDGE_RATE_LIMITED_CODE, message: "Too many requests" },
    });
  });

  test.each([
    ["a small batch", 2],
    ["a batch larger than the id lookup reads", 2000],
  ])(
    "sends %s through unattested, so Convex charges each call",
    async (_label, calls) => {
      const batch = JSON.stringify(
        Array.from({ length: calls }, (_, id) => ({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: {
            name: "teak_v1_get_me",
            arguments: { pad: "x".repeat(32) },
          },
        }))
      );
      const outcome = await limit(
        env(),
        request("/mcp", { key: KEY_A, body: `  \n${batch}` })
      );
      expect(outcome).toEqual({ attestation: null });
    }
  );
});

describe("requests without a known user", () => {
  test("an unknown credential is limited per address on the stricter limiter, unattested", async () => {
    const shared = env();
    const first = await limit(
      shared,
      request("/api/v1/cards", { key: STRANGER_KEY })
    );
    const second = await limit(
      shared,
      request("/api/v1/cards", { key: STRANGER_KEY })
    );

    expect(first).toEqual({ attestation: null });
    expect(shared.unknown.keys).toEqual([`ip:${CLIENT_IP}`, `ip:${CLIENT_IP}`]);
    expect(shared.api.keys).toEqual([]);
    const response = "response" in second ? second.response : null;
    expect(response?.status).toBe(429);
    expect(response?.headers.get("ratelimit-limit")).toBe(
      String(EDGE_UNKNOWN_CREDENTIAL_LIMIT)
    );
  });

  test("no credential is limited per address on the request limiter, unattested", async () => {
    const shared = env();
    const outcome = await limit(shared, request("/api/openapi.json"));
    expect(outcome).toEqual({ attestation: null });
    expect(shared.api.keys).toEqual([`ip:${CLIENT_IP}`]);
  });
});

describe("when the edge cannot limit", () => {
  test.each([
    ["the limiter fails", { api: new FakeLimiter(5, true) }],
    ["the limiter is not bound", { api: undefined }],
  ])(
    "%s, the request goes through unattested for Convex to charge",
    async (_label, limiters) => {
      const shared = { ...env(), API_REQUEST_LIMITER: limiters.api };
      const outcome = await limit(
        shared,
        request("/api/v1/cards", { key: KEY_A })
      );
      expect(outcome).toEqual({ attestation: null });
    }
  );

  test("preflights are never charged", async () => {
    const shared = env();
    const outcome = await limit(
      shared,
      request("/api/v1/cards", { method: "OPTIONS" })
    );
    expect(outcome).toEqual({ attestation: null });
    expect(shared.api.keys).toEqual([]);
  });
});

describe("configuration", () => {
  const config = unstable_readConfig({
    config: resolve(import.meta.dir, "../wrangler.jsonc"),
  });
  const limiters = Object.fromEntries(
    (config.ratelimits ?? []).map((binding) => [binding.name, binding])
  );

  test("the production limiters count what the code reports", () => {
    expect(limiters.API_REQUEST_LIMITER?.simple).toEqual({
      limit: EDGE_API_REQUEST_LIMIT,
      period: 60,
    });
    expect(limiters.UNKNOWN_CREDENTIAL_LIMITER?.simple).toEqual({
      limit: EDGE_UNKNOWN_CREDENTIAL_LIMIT,
      period: 60,
    });
  });

  test("the edge limits match the Convex limits they stand in for", () => {
    expect(EDGE_API_REQUEST_LIMIT).toBe(
      RATE_LIMIT_CONFIG.publicApiRequests.capacity
    );
    expect(EDGE_UNKNOWN_CREDENTIAL_LIMIT).toBe(
      RATE_LIMIT_CONFIG.invalidApiAuth.capacity
    );
  });
});
