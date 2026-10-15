import {
  buildEdgeIdentitySigningPayload,
  EDGE_IDENTITY_MAX_TTL_SECONDS,
  type EdgeIdentityResult,
  parseEdgeIdentityLookup,
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

const sha256Hex = async (bytes: ArrayBuffer): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
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
  const expiry = Number(expiresAt);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiry) ||
    String(expiry) !== expiresAt ||
    expiry < now ||
    expiry > now + EDGE_IDENTITY_MAX_TTL_SECONDS
  ) {
    return false;
  }
  const expected = await hmacSha256Hex(
    secret,
    buildEdgeIdentitySigningPayload({
      bodySha256: await sha256Hex(body),
      expiresAt,
      requestId,
    })
  );
  // Compare keyed digests of both values, so the comparison's timing reveals
  // nothing about the expected signature.
  const [given, wanted] = await Promise.all([
    hmacSha256Hex(secret, `compare\n${signature}`),
    hmacSha256Hex(secret, `compare\n${expected}`),
  ]);
  return given === wanted;
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
