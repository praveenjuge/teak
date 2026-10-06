import { v } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction, internalMutation } from "./_generated/server";
import { PUBLIC_API_CORS_HEADERS } from "./publicApiMeta";
import { WORKOS_RESOURCES } from "./shared/workosResources";
import { verifyWorkosConnectToken } from "./workosTokens";

// Only the HTTP boundary may supply this principal after signature verification.
// Revocation cannot grant access and deliberately survives auth-mode rollback.
export const disconnectConsent = internalMutation({
  args: {
    workosUserId: v.string(),
    consentId: v.string(),
    clientId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.boolean(),
  handler: async (ctx, principal) => {
    const rows = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", principal.consentId))
      .take(2);
    if (rows.length > 1) {
      return false;
    }
    const existing = rows[0];
    if (existing) {
      if (
        existing.workosUserId !== principal.workosUserId ||
        existing.clientId !== principal.clientId ||
        (principal.externalId !== null &&
          principal.externalId !== undefined &&
          principal.externalId !== existing.userId)
      ) {
        return false;
      }
      if (existing.revokedAt === undefined) {
        await ctx.db.patch(existing._id, { revokedAt: Date.now() });
      }
      return true;
    }
    const owner:
      | { status: "ok"; teakUserId: string }
      | { status: "denied"; reason: string } = await ctx.runQuery(
      internal.workosIdentity.resolveWorkosOwner,
      {
        workosUserId: principal.workosUserId,
        ...(principal.externalId === undefined
          ? {}
          : { externalId: principal.externalId }),
        verification: { kind: "connect" },
      }
    );
    if (owner.status !== "ok") {
      return false;
    }
    const now = Date.now();
    await ctx.db.insert("workosConsents", {
      consentId: principal.consentId,
      clientId: principal.clientId,
      workosUserId: principal.workosUserId,
      userId: owner.teakUserId,
      firstSeenAt: now,
      lastSeenAt: now,
      revokedAt: now,
    });
    return true;
  },
});

export const disconnectWorkosConsent = httpAction(async (ctx, request) => {
  const headers = { ...PUBLIC_API_CORS_HEADERS, "Cache-Control": "no-store" };
  const response = (status: number) => new Response(null, { status, headers });
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match || match[1].length > 16_384) {
    return response(401);
  }
  const issuer = process.env.WORKOS_AUTHKIT_DOMAIN;
  if (!issuer) {
    return response(503);
  }
  let unavailable = false;
  const principal = await verifyWorkosConnectToken(match[1], {
    issuer,
    audience: WORKOS_RESOURCES.api,
    revocationOnly: true,
    onUnavailable: () => {
      unavailable = true;
    },
  });
  if (!principal) {
    return response(unavailable ? 503 : 401);
  }
  try {
    const revoked: boolean = await ctx.runMutation(
      internal.workosConnectRevocation.disconnectConsent,
      principal
    );
    return response(revoked ? 204 : 401);
  } catch {
    return response(503);
  }
});
