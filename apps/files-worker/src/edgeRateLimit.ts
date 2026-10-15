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
  addressKey,
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
/** Longest wait for a refused MCP body before answering without its id. */
export const MCP_BODY_READ_TIMEOUT_MS = 1000;

export type EdgeRateLimitOutcome =
  /** Refused: answer with this response. */
  | { response: Response }
  /** Allowed: forward, with this attestation header value when not null. */
  | { attestation: string | null };

const isMcpPath = (request: Request): boolean => {
  const { pathname } = new URL(request.url);
  return pathname === "/mcp" || pathname.startsWith("/mcp/");
};

/**
 * Reads a cloned POST body chunk by chunk, for at most MCP_BODY_READ_TIMEOUT_MS
 * and MAX_MCP_BODY_BYTES: the edge only peeks at bodies, so a stalled or huge
 * one is never worth waiting for or buffering. `onChunk` returns a result to
 * stop early; the stream ending, the cap or the timeout give `fallback`.
 */
const peekBody = async <T>(
  request: Request,
  fallback: T,
  onChunk: (chunk: Uint8Array, done: boolean) => T | undefined
): Promise<T> => {
  const reader =
    request.method === "POST" ? request.clone().body?.getReader() : undefined;
  if (!reader) {
    return fallback;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), MCP_BODY_READ_TIMEOUT_MS);
  });
  let size = 0;
  try {
    for (;;) {
      const read = await Promise.race([reader.read(), timedOut]);
      if (read === "timeout") {
        return fallback;
      }
      const chunk = read.value ?? new Uint8Array();
      // Each chunk is looked at before the cap applies, so one large chunk
      // still shows where the body starts.
      const result = onChunk(chunk, read.done);
      if (result !== undefined) {
        return result;
      }
      size += chunk.byteLength;
      if (read.done || size > MAX_MCP_BODY_BYTES) {
        return fallback;
      }
    }
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    reader.cancel().catch(() => undefined);
  }
};

/** The request's JSON-RPC body, or undefined when it is not one. */
const readJsonRpcBody = (request: Request): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  return peekBody<unknown>(request, undefined, (chunk, done) => {
    chunks.push(chunk);
    size += chunk.byteLength;
    if (size > MAX_MCP_BODY_BYTES) {
      return null;
    }
    if (!done) {
      return;
    }
    try {
      return JSON.parse(new TextDecoder().decode(concat(chunks)));
    } catch {
      return null;
    }
  });
};

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
};

/**
 * True when a POST body may be a JSON array (a JSON-RPC batch). A body whose
 * first character the edge cannot see in time counts as one, so it goes
 * through unattested and Convex charges each call itself.
 */
const mayBeJsonArrayBody = (request: Request): Promise<boolean> => {
  if (request.method !== "POST" || !request.body) {
    return Promise.resolve(false);
  }
  const decoder = new TextDecoder();
  return peekBody(request, true, (chunk, done) => {
    const text = decoder.decode(chunk, { stream: !done }).trimStart();
    if (text) {
      return text.startsWith("[");
    }
    return done ? false : undefined;
  });
};

/** A JSON-RPC notification: a method call without an id, owed no reply. */
const isNotification = (body: unknown): boolean =>
  Boolean(body) &&
  typeof body === "object" &&
  !Array.isArray(body) &&
  typeof (body as { method?: unknown }).method === "string" &&
  !("id" in (body as object));

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
    const body = await readJsonRpcBody(request);
    if (isNotification(body)) {
      // JSON-RPC never answers a notification; the status is the refusal.
      const { "Content-Type": _, ...bodyless } = headers;
      return new Response(null, { status: 429, headers: bodyless });
    }
    const id = jsonRpcId(body);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        // JSON-RPC answers a request whose id cannot be read with null.
        id: id ?? null,
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
  // Each API key lookup the identity cache cannot answer is first charged to
  // the address on the unknown-credential limiter, so made-up keys cannot
  // make the edge ask Convex more often than that limit allows.
  const lookupGate: { state: "unused" | "allowed" | "refused" } = {
    state: "unused",
  };
  const allowLookup = async (): Promise<boolean> => {
    const gate = env.UNKNOWN_CREDENTIAL_LIMITER;
    if (!gate) {
      return true;
    }
    try {
      const { success } = await gate.limit({ key: addressKey(request) });
      lookupGate.state = success ? "allowed" : "refused";
      return success;
    } catch {
      return true;
    }
  };
  const identity = await resolveEdgeIdentity(request, env, ctx, {
    ...deps,
    allowLookup,
  });
  if (lookupGate.state === "refused") {
    return {
      response: await rateLimitedResponse(
        request,
        EDGE_UNKNOWN_CREDENTIAL_LIMIT
      ),
    };
  }
  const unknownCredential =
    !isKnownUser(identity) && request.headers.has("authorization");
  // The gate already charged this request to the unknown-credential limit.
  if (unknownCredential && lookupGate.state === "allowed") {
    return { attestation: null };
  }
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
  if (isMcpPath(request) && (await mayBeJsonArrayBody(request))) {
    return { attestation: null };
  }
  return {
    attestation: await attestationFor(request, env.FILES_SIGNING_SECRET),
  };
};
