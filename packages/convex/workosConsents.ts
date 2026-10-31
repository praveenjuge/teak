import { paginationOptsValidator } from "convex/server";
import { ConvexError, type Infer, type ObjectType, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  limitApiRequests,
  rateLimitResultValidator,
  type ValidatedRateLimitKey,
} from "./publicApi";
import { readWorkosConnectClients } from "./publicApi/http/meta";
import { getSessionUser } from "./securitySessions";
import { rateLimiter } from "./shared/rateLimits";
import { CONNECT_CONSENT_ID, WORKOS_USER_ID } from "./shared/workosIds";
import { disconnectApplication } from "./workosApplicationDisconnect";
import { resolveOwner } from "./workosIdentity";

const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;
export type ConsentAuthorization =
  | {
      status: "ok";
      teakUserId: string;
      rateLimit?: { ok: boolean; retryAt?: number };
    }
  | { status: "denied"; reason: string };

const consentArgs = {
  workosUserId: v.string(),
  consentId: v.string(),
  clientId: v.string(),
};
type ConsentArgs = ObjectType<typeof consentArgs>;

const deniedValidator = v.object({
  status: v.literal("denied"),
  reason: v.string(),
});

// Mapping, verification, deletion and consent state, read in one transaction.
// A refreshed token never clears revocation.
const checkConsent = async (ctx: QueryCtx, args: ConsentArgs) => {
  if (
    !(
      CONNECT_CONSENT_ID.test(args.consentId) &&
      WORKOS_USER_ID.test(args.workosUserId) &&
      args.clientId
    ) ||
    args.clientId.length > 2048
  ) {
    return { status: "denied" as const, reason: "invalid_credential" };
  }
  const owner = await resolveOwner(ctx, {
    workosUserId: args.workosUserId,
    verification: { kind: "connect" },
  });
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
  return { status: "ok" as const, teakUserId: owner.teakUserId, existing };
};

// The read-only check most Connect requests need: a known consent that was
// seen recently. Its caller writes through `authorizeConnectConsent` when
// `lastSeenAt` is missing or older than `LAST_SEEN_INTERVAL_MS`.
export const readConnectConsent = internalQuery({
  args: consentArgs,
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      teakUserId: v.string(),
      lastSeenAt: v.union(v.number(), v.null()),
    }),
    deniedValidator
  ),
  handler: async (ctx, args) => {
    const result = await checkConsent(ctx, args);
    return result.status === "ok"
      ? {
          status: "ok" as const,
          teakUserId: result.teakUserId,
          lastSeenAt: result.existing?.lastSeenAt ?? null,
        }
      : result;
  },
});

export const isConsentSeenRecently = (lastSeenAt: number | null) =>
  lastSeenAt !== null && Date.now() - lastSeenAt < LAST_SEEN_INTERVAL_MS;

export const authorizeConnectConsent = internalMutation({
  args: { ...consentArgs, chargeRateLimit: v.optional(v.boolean()) },
  returns: v.union(
    v.object({
      status: v.literal("ok"),
      teakUserId: v.string(),
      rateLimit: v.optional(rateLimitResultValidator),
    }),
    deniedValidator
  ),
  handler: async (
    ctx,
    { chargeRateLimit, ...args }
  ): Promise<ConsentAuthorization> => {
    const result = await checkConsent(ctx, args);
    if (result.status !== "ok") {
      return result;
    }
    const { existing, teakUserId } = result;
    const now = Date.now();
    if (!existing) {
      await ctx.db.insert("workosConsents", {
        consentId: args.consentId,
        userId: teakUserId,
        workosUserId: args.workosUserId,
        clientId: args.clientId,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    } else if (now - existing.lastSeenAt >= LAST_SEEN_INTERVAL_MS) {
      await ctx.db.patch("workosConsents", existing._id, { lastSeenAt: now });
    }
    if (!chargeRateLimit) {
      return { status: "ok" as const, teakUserId };
    }
    return {
      status: "ok" as const,
      teakUserId,
      rateLimit: await limitApiRequests(
        ctx,
        `key:workos:${args.clientId}:${teakUserId}` as ValidatedRateLimitKey
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
};

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
            CONNECT_CONSENT_ID.test(row.consentId) &&
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

export const disconnectConnection = action({
  args: { consentId: v.string() },
  returns: v.null(),
  handler: async (ctx, { consentId }) => {
    const session = await getSessionUser(ctx);
    if (!(session && CONNECT_CONSENT_ID.test(consentId))) {
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
    const allowed = await rateLimiter.limit(ctx, "workosDisconnects", {
      key: session.teakUserId,
      throws: false,
    });
    if (!allowed.ok) {
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryAt: Date.now() + allowed.retryAfter,
      });
    }
    const result = await disconnectApplication(ctx, {
      workosUserId: row.workosUserId,
      clientId: row.clientId,
      consentId,
    });
    if (result !== 204) {
      throw new Error("Connection unavailable. Please try again.");
    }
    return null;
  },
});
