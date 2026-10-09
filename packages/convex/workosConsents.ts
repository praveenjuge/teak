import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { limitApiRequests, rateLimitResultValidator } from "./publicApi";
import { readWorkosConnectClients } from "./publicApiMeta";
import { getSessionUser } from "./securitySessions";
import { disconnectApplication } from "./workosApplicationDisconnect";
import { resolveOwner } from "./workosIdentity";

const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
type ConsentAuthorization =
  | {
      status: "ok";
      teakUserId: string;
      rateLimit?: { ok: boolean; retryAt?: number };
    }
  | { status: "denied"; reason: string };

// Internal callers must first cryptographically verify the Connect token and its
// resource audience. Mapping, verification, deletion and consent state are read
// in this mutation's transaction; a refreshed token never clears revocation.
export const authorizeConnectConsent = internalMutation({
  args: {
    workosUserId: v.string(),
    externalId: v.optional(v.union(v.string(), v.null())),
    consentId: v.string(),
    clientId: v.string(),
    chargeRateLimit: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      teakUserId: v.string(),
      rateLimit: v.optional(rateLimitResultValidator),
    }),
    v.object({ status: v.literal("denied"), reason: v.string() })
  ),
  handler: async (ctx, args): Promise<ConsentAuthorization> => {
    if (
      !(
        /^app_consent_[A-Za-z0-9]+$/.test(args.consentId) &&
        /^user_[A-Za-z0-9]+$/.test(args.workosUserId) &&
        args.clientId
      ) ||
      args.clientId.length > 2048
    ) {
      return { status: "denied" as const, reason: "invalid_credential" };
    }
    const owner = await resolveOwner(ctx, {
      workosUserId: args.workosUserId,
      ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
      verification: { kind: "connect" },
    });
    if (owner.status !== "ok") {
      return owner;
    }
    // A disconnect the previous flow left unfinished keeps the app denied until
    // a new disconnect confirms the grant is gone at WorkOS.
    const fences = await ctx.db
      .query("workosApplicationDisconnects")
      .withIndex("by_workosUserId_and_clientId", (q) =>
        q.eq("workosUserId", args.workosUserId).eq("clientId", args.clientId)
      )
      .take(2);
    if (fences.some((fence) => fence.state !== "completed")) {
      return { status: "denied" as const, reason: "application_disconnected" };
    }
    const matches = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    if (matches.length > 1) {
      return { status: "denied" as const, reason: "duplicate_consent" };
    }
    const existing = matches[0];
    if (existing?.revokedAt !== undefined) {
      return { status: "denied" as const, reason: "revoked_consent" };
    }
    if (
      existing &&
      (existing.userId !== owner.teakUserId ||
        existing.workosUserId !== args.workosUserId ||
        existing.clientId !== args.clientId)
    ) {
      return { status: "denied" as const, reason: "consent_binding_conflict" };
    }
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("workosConsents", {
        consentId: args.consentId,
        userId: owner.teakUserId,
        workosUserId: args.workosUserId,
        clientId: args.clientId,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    } else if (now - existing.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
      await ctx.db.patch("workosConsents", existing._id, { lastSeenAt: now });
    }
    if (!args.chargeRateLimit) {
      return { status: "ok" as const, teakUserId: owner.teakUserId };
    }
    return {
      status: "ok" as const,
      teakUserId: owner.teakUserId,
      rateLimit: await limitApiRequests(
        ctx,
        `key:workos:${args.clientId}:${owner.teakUserId}`
      ),
    };
  },
});

const connectionValidator = v.object({
  consentId: v.string(),
  clientId: v.string(),
  name: v.string(),
  connectedAt: v.number(),
  lastUsedAt: v.number(),
});
interface ConnectionPage {
  continueCursor: string;
  isDone: boolean;
  page: Infer<typeof connectionValidator>[];
}
const connectionNames: Record<string, string> = {
  cli: "Teak CLI",
  raycast: "Raycast",
  chrome: "Chrome extension",
  firefox: "Firefox extension",
  safari: "Teak for Mac",
};

// Pagination preserves empty pages of revoked records; clients must honor isDone.
export const listConnections = query({
  args: {
    paginationOpts: paginationOptsValidator,
    retryKey: v.optional(v.string()),
  },
  returns: v.object({
    page: v.array(connectionValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }): Promise<ConnectionPage> => {
    const session = await getSessionUser(ctx);
    if (!session) {
      throw new Error("WorkOS sign-in required");
    }
    if (
      !Number.isInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    ) {
      throw new Error("Invalid page size");
    }
    const labels = new Map(
      Object.entries(readWorkosConnectClients()).map(([surface, clientId]) => [
        clientId,
        connectionNames[surface],
      ])
    );
    const result = await ctx.db
      .query("workosConsents")
      .withIndex("by_userId_and_firstSeenAt", (q) =>
        q.eq("userId", session.teakUserId)
      )
      .order("desc")
      .paginate(paginationOpts);
    return {
      isDone: result.isDone,
      continueCursor: result.continueCursor,
      page: result.page
        .filter(
          (row) =>
            row.revokedAt === undefined &&
            row.workosUserId === session.workosUserId &&
            /^app_consent_[A-Za-z0-9]+$/.test(row.consentId) &&
            row.clientId.length > 0 &&
            row.clientId.length <= 2048
        )
        .map((row) => ({
          consentId: row.consentId,
          clientId: row.clientId,
          name: labels.get(row.clientId) ?? "External app",
          connectedAt: row.firstSeenAt,
          lastUsedAt: row.lastSeenAt,
        })),
    };
  },
});

// Settings and signed-token logout share the same durable provider operation.
export const disconnectConnection = action({
  args: { consentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { consentId }) => {
    const session = await getSessionUser(ctx);
    if (!(session && /^app_consent_[A-Za-z0-9]+$/.test(consentId))) {
      throw new Error("WorkOS sign-in required");
    }
    const row: { workosUserId: string; clientId: string } | null =
      await ctx.runQuery(internal.workosApplicationDisconnect.sessionConsent, {
        consentId,
        userId: session.teakUserId,
        workosUserId: session.workosUserId,
      });
    if (!row) {
      throw new Error("Connection unavailable");
    }
    const result = await disconnectApplication(ctx, {
      workosUserId: row.workosUserId,
      clientId: row.clientId,
      consentId,
      externalId: session.teakUserId,
    });
    if (result !== 204) {
      throw new Error("Connection unavailable. Please try again.");
    }
    return null;
  },
});
