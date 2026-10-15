/**
 * Who is calling the public API or MCP server, for edge rate limits.
 *
 * Every request resolves to one bucket key, so a user's limits follow the
 * user across all of their API keys and OAuth apps:
 *
 * - `user:<teakUserId>` for a Teak API key Convex has seen, or a WorkOS access
 *   token whose signature, issuer and audience verify at the edge;
 * - `workos:<workosUserId>` for a verified token Convex cannot map to a user,
 *   or cannot be asked about;
 * - `ip:<address>` for everything else: no credential, a malformed or unknown
 *   one, or a token that fails verification. Unverified input never chooses
 *   its own bucket, so spraying made-up keys cannot dodge the address limit.
 *
 * This is identity for limiting only. Convex still authenticates and
 * authorizes every request itself.
 *
 * Convex answers lookups by credential (`@teak/files-protocol`
 * edgeIdentity); the Worker sends a key's SHA-256 digest, never the key, and
 * caches each answer in KV: an hour for a known owner, the KV minimum of a
 * minute for an unknown one, so a brand-new key is recognized within a minute.
 */

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

export interface EdgeIdentity {
  key: string;
  source: "address" | "api_key" | "oauth";
}

export const EDGE_IDENTITY_KNOWN_TTL_SECONDS = 3600;
export const EDGE_IDENTITY_UNKNOWN_TTL_SECONDS = 60;
const LOOKUP_TIMEOUT_MS = 2000;
const MAX_JWT_LENGTH = 16_384;

export interface EdgeIdentityDeps {
  /**
   * Asked before each lookup the cache cannot answer; false skips the
   * lookup, so a caller can bound how often one client makes it ask Convex.
   */
  allowLookup?: () => Promise<boolean>;
  fetcher?: typeof fetch;
  verifyToken?: typeof verifyWorkosConnectToken;
}

/** The bucket key for the request's client address. */
export const addressKey = (request: Request): string =>
  `ip:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;

const addressIdentity = (request: Request): EdgeIdentity => ({
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

/** Asks Convex who owns a credential. Null when it does not know; throws when it cannot answer. */
const lookupOwner = async (
  env: EdgeIdentityEnv,
  lookup: EdgeIdentityLookup,
  fetcher: typeof fetch
): Promise<string | null> => {
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
    throw new Error(`edge identity lookup failed: ${response.status}`);
  }
  const { userId } = (await response.json()) as { userId?: unknown };
  return typeof userId === "string" && userId ? userId : null;
};

/** The owner from KV, or from Convex (then cached). Undefined when neither can say. */
const cachedOwner = async (
  env: EdgeIdentityEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  cacheKey: string,
  lookup: EdgeIdentityLookup,
  deps: Required<Pick<EdgeIdentityDeps, "fetcher">> &
    Pick<EdgeIdentityDeps, "allowLookup">
): Promise<string | null | undefined> => {
  // A failed read is a cache miss: ask Convex instead.
  const cached = await env.EDGE_IDENTITY?.get(cacheKey).catch(() => null);
  if (typeof cached === "string") {
    return cached || null;
  }
  if (deps.allowLookup && !(await deps.allowLookup())) {
    return;
  }
  const { fetcher } = deps;
  let owner: string | null;
  try {
    owner = await lookupOwner(env, lookup, fetcher);
  } catch {
    return;
  }
  if (env.EDGE_IDENTITY) {
    ctx.waitUntil(
      env.EDGE_IDENTITY.put(cacheKey, owner ?? "", {
        expirationTtl: owner
          ? EDGE_IDENTITY_KNOWN_TTL_SECONDS
          : EDGE_IDENTITY_UNKNOWN_TTL_SECONDS,
      }).catch(() => undefined)
    );
  }
  return owner;
};

/** The rate-limit bucket for a request to the public API or MCP server. */
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
    const owner = await cachedOwner(
      env,
      ctx,
      `key:${tokenHash}`,
      { tokenHash },
      { allowLookup: deps.allowLookup, fetcher }
    );
    return owner
      ? { key: `user:${owner}`, source: "api_key" }
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
  const owner = await cachedOwner(
    env,
    ctx,
    `workos:${workosUserId}`,
    { workosUserId },
    { allowLookup: deps.allowLookup, fetcher }
  );
  // A verified token names its user even when Convex cannot map it yet.
  return {
    key: owner ? `user:${owner}` : `workos:${workosUserId}`,
    source: "oauth",
  };
};
