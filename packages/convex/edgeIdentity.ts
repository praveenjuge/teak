import {
  buildEdgeIdentitySigningPayload,
  buildEdgeRateLimitSigningPayload,
  EDGE_IDENTITY_MAX_TTL_SECONDS,
  EDGE_RATE_LIMIT_HEADER,
  EDGE_RATE_LIMIT_MAX_TTL_SECONDS,
  type EdgeIdentityResult,
  type EdgeRateLimitCharge,
  parseEdgeIdentityLookup,
  parseEdgeRateLimitAttestation,
  SIGNED_REQUEST_HEADERS,
  sha256Hex,
  verifySignature,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  httpAction,
  internalAction,
  internalQuery,
} from "./_generated/server";
import {
  callCoreWorkerOp,
  isCoreWorkerConfigured,
} from "./storage/coreWorkerClient";

/**
 * Asks the Core Worker to forget revoked credentials' edge identity cache
 * entries (`key:<token hash>`, `workos:<WorkOS user ID>`), so the edge stops
 * charging them to their owner and answering their MCP session requests at
 * once. Convex refuses them on its own either way; the cache's five-minute
 * expiry is the backstop if this fails.
 */
const PURGE_ATTEMPTS = 3;

export const purgeEdgeIdentity = internalAction({
  args: { keys: v.array(v.string()), attempt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { keys, attempt = 1 }) => {
    if (keys.length === 0 || !isCoreWorkerConfigured()) {
      return null;
    }
    let outcome: Awaited<
      ReturnType<typeof callCoreWorkerOp<"purge-edge-identity">>
    >;
    try {
      outcome = await callCoreWorkerOp({
        op: "purge-edge-identity",
        params: { keys },
      });
    } catch (error) {
      // A network failure or a Worker error: try again shortly, a few times.
      if (attempt < PURGE_ATTEMPTS) {
        await ctx.scheduler.runAfter(
          2 ** attempt * 1000,
          internal.edgeIdentity.purgeEdgeIdentity,
          { keys, attempt: attempt + 1 }
        );
      } else {
        console.warn("[edgeIdentity] purge failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return null;
    }
    if (outcome.kind !== "ok") {
      console.warn("[edgeIdentity] purge declined", { code: outcome.code });
    }
    return null;
  },
});

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

const hasValidSignature = async (
  request: Request,
  body: ArrayBuffer,
  secret: string
): Promise<boolean> => {
  const requestId = request.headers.get(SIGNED_REQUEST_HEADERS.requestId);
  if (!requestId) {
    return false;
  }
  const bodySha256 = await sha256Hex(body);
  const check = await verifySignature(secret, {
    expiresAt: request.headers.get(SIGNED_REQUEST_HEADERS.expiresAt),
    maxTtlSeconds: EDGE_IDENTITY_MAX_TTL_SECONDS,
    payload: (expiresAt) =>
      buildEdgeIdentitySigningPayload({ bodySha256, expiresAt, requestId }),
    signature: request.headers.get(SIGNED_REQUEST_HEADERS.signature),
  });
  return check.ok;
};

/**
 * Which edge limit the Core Worker says it charged this request to (see
 * `EdgeRateLimitCharge`), or null when the request carries no valid
 * attestation for its own credential.
 */
export const edgeRateLimitCharge = async (
  request: Request
): Promise<EdgeRateLimitCharge | null> => {
  const secret = env.FILES_SIGNING_SECRET;
  const authorization = request.headers.get("authorization");
  const attestation = parseEdgeRateLimitAttestation(
    request.headers.get(EDGE_RATE_LIMIT_HEADER)
  );
  if (!(secret && authorization && attestation)) {
    return null;
  }
  const credentialSha256 = await sha256Hex(authorization);
  for (const charge of ["owner", "unknown_credential"] as const) {
    const check = await verifySignature(secret, {
      expiresAt: attestation.expiresAt,
      maxTtlSeconds: EDGE_RATE_LIMIT_MAX_TTL_SECONDS,
      payload: (expiresAt) =>
        buildEdgeRateLimitSigningPayload({
          charge,
          credentialSha256,
          expiresAt,
        }),
      signature: attestation.signature,
    });
    if (check.ok) {
      return charge;
    }
  }
  return null;
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
