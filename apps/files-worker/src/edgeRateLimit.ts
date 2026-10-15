/**
 * Edge rate limits for the public API and MCP server.
 *
 * Each proxied request is charged to its edge identity (`edgeIdentity.ts`):
 *
 * - `API_REQUEST_LIMITER` (120 a minute) for a known user, and for a request
 *   with no credential at all, keyed by address;
 * - `UNKNOWN_CREDENTIAL_LIMITER` (60 a minute) for a request whose credential
 *   the edge cannot tie to a user, keyed by address.
 *
 * A request within its user's limit is forwarded with an attestation
 * (`@teak/files-protocol` EDGE_RATE_LIMIT_HEADER), signed over its own
 * `Authorization` value, and Convex then skips its own per-request charge.
 * Requests without a known user, and JSON-RPC batches, which Convex charges
 * per call, get no attestation and are charged by Convex as before. When the
 * limiters or signing are unavailable the request goes through unattested,
 * so Convex's own limit still applies.
 *
 * Over a limit, `/api` answers the public API's 429 and `/mcp` an HTTP 429
 * with a JSON-RPC error body: the MCP specification (2026-07-28) defines no
 * rate-limit error and expects an intermediary to answer with an HTTP status.
 * Both carry `Retry-After`. The Workers limiter counts in fixed windows per
 * Cloudflare location, so these limits are approximate.
 */

import { PUBLIC_API_CORS_HEADERS } from "@teak/convex/shared/publicApiHeaders";
import {
  buildEdgeRateLimitSigningPayload,
  EDGE_RATE_LIMIT_MAX_TTL_SECONDS,
} from "@teak/files-protocol";
import {
  type EdgeIdentity,
  type EdgeIdentityDeps,
  type EdgeIdentityEnv,
  resolveEdgeIdentity,
} from "./edgeIdentity";
import { hmacSha256Hex, sha256Hex } from "./lib";

/** The Workers rate limiting binding. */
export interface RateLimiter {
  limit: (options: { key: string }) => Promise<{ success: boolean }>;
}

export interface EdgeRateLimitEnv extends EdgeIdentityEnv {
  API_REQUEST_LIMITER?: RateLimiter;
  UNKNOWN_CREDENTIAL_LIMITER?: RateLimiter;
}

/** Requests per window for each limiter; matches `wrangler.jsonc`. */
export const EDGE_API_REQUEST_LIMIT = 120;
export const EDGE_UNKNOWN_CREDENTIAL_LIMIT = 60;
/** Window length in seconds; the Workers limiter counts in fixed windows. */
export const EDGE_RATE_LIMIT_PERIOD_SECONDS = 60;

/**
 * JSON-RPC error code for an MCP request refused by the edge limit. MCP
 * reserves -32000 to -32099 and asks for application codes outside the
 * JSON-RPC range (-32768 to -32000).
 */
export const MCP_EDGE_RATE_LIMITED_CODE = -31_429;

/** Largest MCP body read to find the JSON-RPC id of a refused request. */
const MAX_MCP_BODY_BYTES = 64 * 1024;

export type EdgeRateLimitOutcome =
  /** Refused: answer with this response. */
  | { response: Response }
  /** Allowed: forward, with this attestation header value when not null. */
  | { attestation: string | null };

const isMcpPath = (request: Request): boolean => {
  const { pathname } = new URL(request.url);
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
};

/** The request's JSON-RPC body, or undefined when it is not one. */
const readJsonRpcBody = async (request: Request): Promise<unknown> => {
  if (request.method !== "POST") {
    return;
  }
  try {
    const text = await request.clone().text();
    return text.length > MAX_MCP_BODY_BYTES ? undefined : JSON.parse(text);
  } catch {}
};

/** True when a POST body is a JSON array (a JSON-RPC batch), at any size. */
const isJsonArrayBody = async (request: Request): Promise<boolean> => {
  if (request.method !== "POST" || !request.body) {
    return false;
  }
  const reader = request.clone().body?.getReader();
  if (!reader) {
    return false;
  }
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return false;
      }
      const text = decoder.decode(value, { stream: true }).trimStart();
      if (text) {
        return text.startsWith("[");
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
};

const jsonRpcId = (body: unknown): string | number | undefined => {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const { id } = body as { id?: unknown };
    if (typeof id === "string" || typeof id === "number") {
      return id;
    }
  }
};

const rateLimitedResponse = async (
  request: Request,
  limit: number
): Promise<Response> => {
  const retryAfter = String(EDGE_RATE_LIMIT_PERIOD_SECONDS);
  const retryAt = Date.now() + EDGE_RATE_LIMIT_PERIOD_SECONDS * 1000;
  const headers = {
    ...PUBLIC_API_CORS_HEADERS,
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Retry-After": retryAfter,
    "X-Request-Id": crypto.randomUUID(),
  };
  if (isMcpPath(request)) {
    const id = jsonRpcId(await readJsonRpcBody(request));
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        ...(id === undefined ? {} : { id }),
        error: {
          code: MCP_EDGE_RATE_LIMITED_CODE,
          message: "Too many requests",
          data: { retryAt },
        },
      }),
      { status: 429, headers }
    );
  }
  return new Response(
    JSON.stringify({
      code: "RATE_LIMITED",
      error: "Too many requests",
      retryAt,
    }),
    {
      status: 429,
      headers: {
        ...headers,
        "RateLimit-Limit": String(limit),
        "RateLimit-Remaining": "0",
        "RateLimit-Reset": retryAfter,
      },
    }
  );
};

/** Signs that this request was charged at the edge, bound to its credential. */
const attestationFor = async (
  request: Request,
  secret: string
): Promise<string | null> => {
  const authorization = request.headers.get("authorization");
  if (!(authorization && secret)) {
    return null;
  }
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + EDGE_RATE_LIMIT_MAX_TTL_SECONDS
  );
  const signature = await hmacSha256Hex(
    secret,
    buildEdgeRateLimitSigningPayload({
      credentialSha256: await sha256Hex(authorization),
      expiresAt,
    })
  );
  return `${expiresAt}.${signature}`;
};

const isKnownUser = (identity: EdgeIdentity): boolean =>
  identity.source !== "address";

/** Charges a public API or MCP request to its edge limit. */
export const applyEdgeRateLimit = async (
  request: Request,
  env: EdgeRateLimitEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
  deps: EdgeIdentityDeps = {}
): Promise<EdgeRateLimitOutcome> => {
  // Preflights carry no credential and are cached by browsers for a day.
  if (request.method === "OPTIONS") {
    return { attestation: null };
  }
  const identity = await resolveEdgeIdentity(request, env, ctx, deps);
  const unknownCredential =
    !isKnownUser(identity) && request.headers.has("authorization");
  const limiter = unknownCredential
    ? env.UNKNOWN_CREDENTIAL_LIMITER
    : env.API_REQUEST_LIMITER;
  if (!limiter) {
    return { attestation: null };
  }

  let allowed: boolean;
  try {
    ({ success: allowed } = await limiter.limit({ key: identity.key }));
  } catch {
    // Convex's own limit still applies to an unattested request.
    return { attestation: null };
  }
  if (!allowed) {
    return {
      response: await rateLimitedResponse(
        request,
        unknownCredential
          ? EDGE_UNKNOWN_CREDENTIAL_LIMIT
          : EDGE_API_REQUEST_LIMIT
      ),
    };
  }

  if (!isKnownUser(identity)) {
    return { attestation: null };
  }
  // Convex charges each call of a JSON-RPC batch; one edge charge covers one.
  if (isMcpPath(request) && (await isJsonArrayBody(request))) {
    return { attestation: null };
  }
  return {
    attestation: await attestationFor(request, env.FILES_SIGNING_SECRET),
  };
};
