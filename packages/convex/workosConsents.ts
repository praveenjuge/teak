import { paginationOptsValidator } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { readWorkosConnectClients } from "./publicApiMeta";
import { getSessionUser } from "./securitySessions";

const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
type ConsentAuthorization =
  | { status: "ok"; teakUserId: string }
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
  },
  returns: v.union(
    v.object({ status: v.literal("ok"), teakUserId: v.string() }),
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
    const owner: ConsentAuthorization = await ctx.runQuery(
      internal.workosIdentity.resolveWorkosOwner,
      {
        workosUserId: args.workosUserId,
        ...(args.externalId === undefined
          ? {}
          : { externalId: args.externalId }),
        verification: { kind: "connect" },
      }
    );
    if (owner.status !== "ok") {
      return owner;
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
      await ctx.db.patch(existing._id, { lastSeenAt: now });
    }
    return owner;
  },
});

// The owner argument must be derived from the caller's authenticated Teak
// session. This internal primitive never grants access or clears a revocation.
export const revokeConnectConsent = internalMutation({
  args: { consentId: v.string(), teakUserId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    if (matches.length !== 1 || matches[0].userId !== args.teakUserId) {
      return false;
    }
    const consent = matches[0];
    if (consent.revokedAt === undefined) {
      await ctx.db.patch(consent._id, { revokedAt: Date.now() });
    }
    return true;
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
  args: { paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(connectionValidator),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { paginationOpts }): Promise<ConnectionPage> => {
    const session = await getSessionUser(ctx);
    if (session?.provider !== "workos") {
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

// Authentication and revocation share one transaction, including deletion guards.
// Disconnect affects this consent only; other grants for the same app survive.
export const disconnectConnection = mutation({
  args: { consentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { consentId }) => {
    const session = await getSessionUser(ctx);
    if (
      session?.provider !== "workos" ||
      !/^app_consent_[A-Za-z0-9]+$/.test(consentId)
    ) {
      throw new Error("WorkOS sign-in required");
    }
    const rows = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", consentId))
      .take(2);
    if (
      rows.length !== 1 ||
      rows[0].userId !== session.teakUserId ||
      rows[0].workosUserId !== session.workosUserId
    ) {
      throw new Error("Connection unavailable");
    }
    const revoked: boolean = await ctx.runMutation(
      internal.workosConsents.revokeConnectConsent,
      { consentId, teakUserId: session.teakUserId }
    );
    if (!revoked) {
      throw new Error("Connection unavailable");
    }
    return null;
  },
});
