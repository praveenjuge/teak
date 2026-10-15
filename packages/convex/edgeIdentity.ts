import {
  buildEdgeIdentitySigningPayload,
  buildEdgeRateLimitSigningPayload,
  EDGE_IDENTITY_MAX_TTL_SECONDS,
  EDGE_RATE_LIMIT_HEADER,
  EDGE_RATE_LIMIT_MAX_TTL_SECONDS,
  type EdgeIdentityResult,
  parseEdgeIdentityLookup,
  parseEdgeRateLimitAttestation,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, httpAction, internalQuery } from "./_generated/server";
import { hmacSha256Hex } from "./storage/r2Keys";

/**
 * Which Teak user a credential belongs to, for the Files Worker's edge rate
 * limits (see `@teak/files-protocol` edgeIdentity). Read-only: an API key is
 * known by the hash its validation cached in `apiKeyAuthCache`, and a WorkOS
 * user by the user row it maps to. Authorization stays where it was; every
 * request is still authenticated by the public API itself.
 */
export const lookup = internalQuery({
  // Exactly one of the two; parseEdgeIdentityLookup guarantees it.
  args: {
    tokenHash: v.optional(v.string()),
    workosUserId: v.optional(v.string()),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { tokenHash, workosUserId }) => {
    if (tokenHash) {
      const cached = await ctx.db
        .query("apiKeyAuthCache")
        .withIndex("by_tokenHash", (q) => q.eq("tokenHash", tokenHash))
        .first();
      return cached?.userId ?? null;
    }
    if (!workosUserId) {
      return null;
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
      .first();
    return user?.teakUserId ?? null;
  },
});

const sha256Hex = async (value: string | ArrayBuffer): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? new TextEncoder().encode(value) : value
      )
    ),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

/** True when `expiresAt` is a canonical epoch second in [now, now + maxTtl]. */
const isCurrentExpiry = (expiresAt: string, maxTtlSeconds: number): boolean => {
  const expiry = Number(expiresAt);
  const now = Math.floor(Date.now() / 1000);
  return (
    Number.isSafeInteger(expiry) &&
    String(expiry) === expiresAt &&
    expiry >= now &&
    expiry <= now + maxTtlSeconds
  );
};

/**
 * True when `signature` is the HMAC of `payload`. Compares keyed digests of
 * both values, so the comparison's timing reveals nothing about the expected
 * signature.
 */
const signatureMatches = async (
  secret: string,
  signature: string,
  payload: string
): Promise<boolean> => {
  const expected = await hmacSha256Hex(secret, payload);
  const [given, wanted] = await Promise.all([
    hmacSha256Hex(secret, `compare\n${signature}`),
    hmacSha256Hex(secret, `compare\n${expected}`),
  ]);
  return given === wanted;
};

/** True when the request carries a current signature over its exact body. */
const hasValidSignature = async (
  request: Request,
  body: ArrayBuffer,
  secret: string
): Promise<boolean> => {
  const requestId = request.headers.get("x-teak-request-id");
  const expiresAt = request.headers.get("x-teak-expires-at");
  const signature = request.headers.get("x-teak-signature");
  if (!(requestId && expiresAt && signature)) {
    return false;
  }
  if (!isCurrentExpiry(expiresAt, EDGE_IDENTITY_MAX_TTL_SECONDS)) {
    return false;
  }
  return await signatureMatches(
    secret,
    signature,
    buildEdgeIdentitySigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
};

/**
 * True when the Files Worker has already charged this request to its user's
 * edge rate limit (`@teak/files-protocol` EDGE_RATE_LIMIT_HEADER): a current
 * attestation signed over this request's own `Authorization` value. The
 * public API then skips its own per-request charge. Anything else, including
 * every request that reaches Convex without the Worker, is charged as before.
 */
export const hasEdgeRateLimitAttestation = async (
  request: Request
): Promise<boolean> => {
  const secret = env.FILES_SIGNING_SECRET;
  const authorization = request.headers.get("authorization");
  const attestation = parseEdgeRateLimitAttestation(
    request.headers.get(EDGE_RATE_LIMIT_HEADER)
  );
  if (!(secret && authorization && attestation)) {
    return false;
  }
  if (
    !isCurrentExpiry(attestation.expiresAt, EDGE_RATE_LIMIT_MAX_TTL_SECONDS)
  ) {
    return false;
  }
  return await signatureMatches(
    secret,
    attestation.signature,
    buildEdgeRateLimitSigningPayload({
      credentialSha256: await sha256Hex(authorization),
      expiresAt: attestation.expiresAt,
    })
  );
};

export const edgeIdentityV1 = httpAction(async (ctx, request) => {
  const secret = env.FILES_SIGNING_SECRET;
  if (!secret) {
    return json(503, { error: "not_configured" });
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > 1024) {
    return json(413, { error: "too_large" });
  }
  if (!(await hasValidSignature(request, body, secret))) {
    return json(401, { error: "unauthorized" });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    parsed = null;
  }
  const lookupArgs = parseEdgeIdentityLookup(parsed);
  if (!lookupArgs) {
    return json(400, { error: "invalid_lookup" });
  }
  const result: EdgeIdentityResult = {
    userId: await ctx.runQuery(internal.edgeIdentity.lookup, lookupArgs),
  };
  return json(200, result);
});
