import { getApiKeyFormat } from "@teak/convex/shared/apiKeyFormat";
import { verifyWorkosConnectToken } from "@teak/convex/workosTokens";
import {
  buildEdgeIdentitySigningPayload,
  EDGE_IDENTITY_MAX_TTL_SECONDS,
  EDGE_IDENTITY_PATH,
  type EdgeIdentityLookup,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "./lib";

export interface EdgeIdentityEnv {
  /** Host whose API paths the Worker proxies; token audiences derive from it. */
  API_PUBLIC_HOST?: string;
  /** Convex HTTP origin that answers identity lookups. */
  API_UPSTREAM_ORIGIN?: string;
  /** WorkOS AuthKit issuer (HTTPS origin) of the access tokens Teak accepts. */
  API_WORKOS_ISSUER?: string;
  /** Identity answers by credential. */
  EDGE_IDENTITY?: KVNamespace;
  FILES_SIGNING_SECRET: string;
}

/**
 * The rate-limit bucket of a public API or MCP request. A user's limits follow
 * them across every API key and OAuth app. A verified WorkOS token Convex
 * cannot map is bucketed by its WorkOS user; anything unverified is bucketed by
 * address, so made-up credentials never choose their own bucket. Convex still
 * authenticates and authorizes every request itself.
 */
export type EdgeIdentity =
  | { key: `user:${string}`; source: "api_key" | "oauth" }
  | { key: `workos:${string}`; source: "oauth" }
  | {
      key: `ip:${string}`;
      /** Set when an API key lookup was charged to, or refused by, the unknown-credential limit. */
      lookup?: "charged" | "refused";
      source: "address";
    };

/** How long a known owner is cached, so a revoked key soon stops counting against its owner. */
export const EDGE_IDENTITY_KNOWN_TTL_SECONDS = 300;
/** KV's minimum TTL, so a brand-new key is recognized within a minute. */
export const EDGE_IDENTITY_UNKNOWN_TTL_SECONDS = 60;
const LOOKUP_TIMEOUT_MS = 2000;
const MAX_JWT_LENGTH = 16_384;

export interface EdgeIdentityDeps {
  /**
   * Charges each API key lookup the cache cannot answer, so a caller can bound
   * how often one client makes the edge ask Convex. "uncharged" means no limit
   * applied. Verified WorkOS tokens are never charged.
   */
  chargeLookup?: () => Promise<"charged" | "refused" | "uncharged">;
  fetcher?: typeof fetch;
  verifyToken?: typeof verifyWorkosConnectToken;
}

export const addressKey = (request: Request): `ip:${string}` =>
  `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;

const addressIdentity = (
  request: Request
): Extract<EdgeIdentity, { source: "address" }> => ({
  key: addressKey(request),
  source: "address",
});

const bearerToken = (request: Request): string | null => {
  const [scheme, token] = (request.headers.get("authorization") ?? "")
    .trim()
    .split(/\s+/u, 2);
  return scheme?.toLowerCase() === "bearer" && token ? token : null;
};

const looksLikeJwt = (token: string): boolean =>
  token.length <= MAX_JWT_LENGTH && token.split(".").length === 3;

/** The token audience for the path: Convex checks the same two resources. */
const audienceFor = (request: Request, host: string): string =>
  new URL(request.url).pathname.startsWith("/mcp")
    ? `https://${host}/mcp`
    : `https://${host}/api`;

type OwnerLookup =
  | { kind: "owner"; userId: string }
  | { kind: "unknown" }
  | { kind: "unavailable" };

const lookupOwner = async (
  env: EdgeIdentityEnv,
  lookup: EdgeIdentityLookup,
  fetcher: typeof fetch
): Promise<OwnerLookup> => {
  const body = JSON.stringify(lookup);
  const requestId = crypto.randomUUID();
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + EDGE_IDENTITY_MAX_TTL_SECONDS
  );
  const signature = await hmacSha256Hex(
    env.FILES_SIGNING_SECRET,
    buildEdgeIdentitySigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
  const response = await fetcher(
    `${new URL(env.API_UPSTREAM_ORIGIN ?? "").origin}${EDGE_IDENTITY_PATH}`,
    {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
        "x-teak-expires-at": expiresAt,
        "x-teak-request-id": requestId,
        "x-teak-signature": signature,
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    }
  );
  if (!response.ok) {
    return { kind: "unavailable" };
  }
  const { userId } = (await response.json()) as { userId?: unknown };
  return typeof userId === "string" && userId
    ? { kind: "owner", userId }
    : { kind: "unknown" };
};

const readCachedOwner = async (
  env: EdgeIdentityEnv,
  cacheKey: string
): Promise<OwnerLookup> => {
  const cached = await env.EDGE_IDENTITY?.get(cacheKey).catch(() => null);
  if (typeof cached !== "string") {
    return { kind: "unavailable" };
  }
  return cached ? { kind: "owner", userId: cached } : { kind: "unknown" };
};

const lookupAndCacheOwner = async (
  env: EdgeIdentityEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  cacheKey: string,
  lookup: EdgeIdentityLookup,
  fetcher: typeof fetch
): Promise<OwnerLookup> => {
  const owner = await lookupOwner(env, lookup, fetcher).catch(
    (): OwnerLookup => ({ kind: "unavailable" })
  );
  if (owner.kind !== "unavailable" && env.EDGE_IDENTITY) {
    ctx.waitUntil(
      env.EDGE_IDENTITY.put(
        cacheKey,
        owner.kind === "owner" ? owner.userId : "",
        {
          expirationTtl:
            owner.kind === "owner"
              ? EDGE_IDENTITY_KNOWN_TTL_SECONDS
              : EDGE_IDENTITY_UNKNOWN_TTL_SECONDS,
        }
      ).catch(() => undefined)
    );
  }
  return owner;
};

export const resolveEdgeIdentity = async (
  request: Request,
  env: EdgeIdentityEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: EdgeIdentityDeps = {}
): Promise<EdgeIdentity> => {
  const fetcher = deps.fetcher ?? fetch;
  const verifyToken = deps.verifyToken ?? verifyWorkosConnectToken;
  const token = bearerToken(request);
  if (!(token && env.API_UPSTREAM_ORIGIN)) {
    return addressIdentity(request);
  }

  if (getApiKeyFormat(token) === "component") {
    const tokenHash = await sha256Hex(token.trim());
    const cacheKey = `key:${tokenHash}`;
    let owner = await readCachedOwner(env, cacheKey);
    let charge: "charged" | "refused" | "uncharged" = "uncharged";
    if (owner.kind === "unavailable") {
      charge = (await deps.chargeLookup?.()) ?? "uncharged";
      if (charge === "refused") {
        return { ...addressIdentity(request), lookup: "refused" };
      }
      owner = await lookupAndCacheOwner(
        env,
        ctx,
        cacheKey,
        { tokenHash },
        fetcher
      );
    }
    if (owner.kind === "owner") {
      return { key: `user:${owner.userId}`, source: "api_key" };
    }
    return charge === "charged"
      ? { ...addressIdentity(request), lookup: "charged" }
      : addressIdentity(request);
  }

  if (!(looksLikeJwt(token) && env.API_WORKOS_ISSUER && env.API_PUBLIC_HOST)) {
    return addressIdentity(request);
  }
  const principal = await verifyToken(token, {
    issuer: env.API_WORKOS_ISSUER,
    audience: audienceFor(request, env.API_PUBLIC_HOST),
  });
  if (!principal) {
    return addressIdentity(request);
  }
  const { workosUserId } = principal;
  const cacheKey = `workos:${workosUserId}`;
  let owner = await readCachedOwner(env, cacheKey);
  if (owner.kind === "unavailable") {
    owner = await lookupAndCacheOwner(
      env,
      ctx,
      cacheKey,
      { workosUserId },
      fetcher
    );
  }
  return owner.kind === "owner"
    ? { key: `user:${owner.userId}`, source: "oauth" }
    : { key: `workos:${workosUserId}`, source: "oauth" };
};
