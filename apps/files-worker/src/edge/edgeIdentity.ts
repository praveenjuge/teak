import { getApiKeyFormat } from "@teak/convex/shared/apiKeyFormat";
import { workosResourcesFor } from "@teak/convex/shared/workosResources";
import { verifyWorkosConnectTokenSignature } from "@teak/convex/workos/tokens";
import {
  buildEdgeIdentitySigningPayload,
  EDGE_IDENTITY_MAX_TTL_SECONDS,
  EDGE_IDENTITY_PATH,
  type EdgeIdentityLookup,
} from "@teak/files-protocol";
import { hmacSha256Hex, sha256Hex } from "../lib";
import type { ApiProxyEnv } from "./apiProxy";

export interface EdgeIdentityEnv extends ApiProxyEnv {
  API_WORKOS_ISSUER?: string;
  EDGE_IDENTITY?: KVNamespace;
  FILES_SIGNING_SECRET: string;
}

export type EdgeIdentity =
  | { key: `user:${string}`; source: "api_key" | "oauth" }
  | { key: `workos:${string}`; source: "oauth" }
  | {
      key: `ip:${string}`;
      lookup?: "charged" | "refused";
      source: "address";
    };

export const EDGE_IDENTITY_KNOWN_TTL_SECONDS = 300;
/** KV's minimum TTL, so a brand-new key is recognized within a minute. */
export const EDGE_IDENTITY_UNKNOWN_TTL_SECONDS = 60;
const LOOKUP_TIMEOUT_MS = 2000;
const MAX_JWT_LENGTH = 16_384;

export interface EdgeIdentityDeps {
  chargeLookup?: () => Promise<"charged" | "refused" | "uncharged">;
  fetcher?: typeof fetch;
  verifyToken?: typeof verifyWorkosConnectTokenSignature;
}

const IPV4_MAPPED_REGEX = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u;
const HEXTET_REGEX = /^[0-9a-f]{1,4}$/u;

/**
 * The address a limit counts against. A host is routinely handed a whole
 * IPv6 /64, so an IPv6 client is one bucket per /64: otherwise it could take
 * a fresh address, and a fresh bucket, for every request.
 */
export const addressBucket = (address: string): string => {
  const lower = address.trim().toLowerCase();
  if (!lower.includes(":")) {
    return lower;
  }
  const mapped = IPV4_MAPPED_REGEX.exec(lower);
  if (mapped?.[1]) {
    return mapped[1];
  }
  const halves = lower.split("::");
  if (halves.length > 2) {
    return lower;
  }
  const groupsOf = (part: string | undefined): string[] =>
    part ? part.split(":") : [];
  const head = groupsOf(halves[0]);
  const tail = groupsOf(halves[1]);
  // An embedded IPv4 tail fills the last two groups, past the /64.
  const width = (groups: string[]) =>
    groups.reduce((total, group) => total + (group.includes(".") ? 2 : 1), 0);
  const missing = 8 - width(head) - width(tail);
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    return lower;
  }
  const groups = [
    ...head,
    ...new Array<string>(Math.max(missing, 0)).fill("0"),
    ...tail,
  ];
  const prefix = groups.slice(0, 4);
  if (!prefix.every((group) => HEXTET_REGEX.test(group))) {
    return lower;
  }
  return `${prefix.map((group) => Number.parseInt(group, 16).toString(16)).join(":")}::/64`;
};

export const addressKey = (request: Request): `ip:${string}` =>
  `ip:${addressBucket(request.headers.get("cf-connecting-ip") ?? "unknown")}`;

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

const audienceFor = (request: Request, host: string): string => {
  const resources = workosResourcesFor(`https://${host}`);
  return new URL(request.url).pathname.startsWith("/mcp")
    ? resources.mcp
    : resources.api;
};

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
  const verifyToken = deps.verifyToken ?? verifyWorkosConnectTokenSignature;
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
