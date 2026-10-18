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
import { hmacSha256Hex, sha256Hex } from "./storage/r2Keys";

export const lookup = internalQuery({
  args: {
    credential: v.union(
      v.object({ tokenHash: v.string() }),
      v.object({ workosUserId: v.string() })
    ),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { credential }) => {
    if ("tokenHash" in credential) {
      const cached = await ctx.db
        .query("apiKeyAuthCache")
        .withIndex("by_tokenHash", (q) =>
          q.eq("tokenHash", credential.tokenHash)
        )
        .first();
      return cached?.userId ?? null;
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", credential.workosUserId)
      )
      .first();
    return user?.teakUserId ?? null;
  },
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  });

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
  const credential = parseEdgeIdentityLookup(parsed);
  if (!credential) {
    return json(400, { error: "invalid_lookup" });
  }
  const result: EdgeIdentityResult = {
    userId: await ctx.runQuery(internal.edgeIdentity.lookup, { credential }),
  };
  return json(200, result);
});
