import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { CONNECT_CONSENT_ID } from "./shared/workosIds";
import {
  deleteAuthorizedApp,
  listAuthorizedAppsPage,
} from "./workos/authorizedApps";
import { resolveOwner } from "./workosIdentity";

const principalValidator = {
  workosUserId: v.string(),
  consentId: v.string(),
  clientId: v.string(),
  tokenExpiresAt: v.optional(v.number()),
};
const MAX_APP_PAGES = 20;

// The caller supplies a verified Connect token or a live session. A consent
// Teak already knows must belong to the same owner, user and app.
export const check = internalMutation({
  args: principalValidator,
  returns: v.union(
    v.object({ status: v.literal("denied") }),
    v.object({ status: v.literal("revoked") }),
    v.object({
      status: v.literal("ok"),
      userId: v.string(),
      alreadyRevoked: v.optional(v.boolean()),
    })
  ),
  handler: async (ctx, args) => {
    if (!CONNECT_CONSENT_ID.test(args.consentId)) {
      return { status: "denied" as const };
    }
    const consents = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    const known = consents[0];
    if (
      consents.length > 1 ||
      (known &&
        (known.workosUserId !== args.workosUserId ||
          known.clientId !== args.clientId))
    ) {
      return { status: "denied" as const };
    }
    if (known?.revokedAt !== undefined) {
      const fences = await ctx.db
        .query("workosApplicationDisconnects")
        .withIndex("by_workosUserId_and_clientId", (q) =>
          q.eq("workosUserId", args.workosUserId).eq("clientId", args.clientId)
        )
        .take(2);
      return fences.some((fence) => fence.state !== "completed")
        ? { status: "ok" as const, userId: known.userId, alreadyRevoked: true }
        : { status: "revoked" as const };
    }
    if (known) {
      return { status: "ok" as const, userId: known.userId };
    }
    const owner = await resolveOwner(ctx, {
      workosUserId: args.workosUserId,
      verification: { kind: "connect" },
    });
    return owner.status === "ok"
      ? { status: "ok" as const, userId: owner.teakUserId }
      : { status: "denied" as const };
  },
});

export const revoke = internalMutation({
  args: {
    userId: v.string(),
    workosUserId: v.string(),
    clientId: v.string(),
    consentId: v.string(),
    startedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const trigger = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .unique();
    if (trigger) {
      if (trigger.revokedAt === undefined) {
        await ctx.db.patch("workosConsents", trigger._id, {
          revokedAt: args.startedAt,
          disconnectCompletedAt: now,
        });
      }
    } else {
      await ctx.db.insert("workosConsents", {
        consentId: args.consentId,
        userId: args.userId,
        workosUserId: args.workosUserId,
        clientId: args.clientId,
        firstSeenAt: args.startedAt,
        lastSeenAt: args.startedAt,
        revokedAt: args.startedAt,
        disconnectCompletedAt: now,
      });
    }
    const siblings = await ctx.db
      .query("workosConsents")
      .withIndex(
        "by_workosUserId_and_clientId_and_disconnectCompletedAt",
        (q) =>
          q
            .eq("workosUserId", args.workosUserId)
            .eq("clientId", args.clientId)
            .eq("disconnectCompletedAt", undefined)
      )
      .take(100);
    for (const sibling of siblings) {
      if (sibling.firstSeenAt > args.startedAt) {
        continue;
      }
      await ctx.db.patch("workosConsents", sibling._id, {
        revokedAt: sibling.revokedAt ?? args.startedAt,
        disconnectCompletedAt: now,
      });
    }
    const fences = await ctx.db
      .query("workosApplicationDisconnects")
      .withIndex("by_workosUserId_and_clientId", (q) =>
        q.eq("workosUserId", args.workosUserId).eq("clientId", args.clientId)
      )
      .take(2);
    for (const fence of fences) {
      if (fence.state !== "completed") {
        await ctx.db.patch("workosApplicationDisconnects", fence._id, {
          state: "completed",
          completedAt: now,
        });
      }
    }
    return null;
  },
});

export const sessionConsent = internalQuery({
  args: { consentId: v.string(), userId: v.string(), workosUserId: v.string() },
  returns: v.union(
    v.null(),
    v.object({ workosUserId: v.string(), clientId: v.string() })
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("workosConsents")
      .withIndex("by_consentId", (q) => q.eq("consentId", args.consentId))
      .take(2);
    const row = rows[0];
    return rows.length === 1 &&
      row.userId === args.userId &&
      row.workosUserId === args.workosUserId
      ? { workosUserId: row.workosUserId, clientId: row.clientId }
      : null;
  },
});

async function findApp(workosUserId: string, clientId: string, apiKey: string) {
  let after: string | undefined;
  let found: string | undefined;
  for (let page = 0; page < MAX_APP_PAGES; page++) {
    const result = await listAuthorizedAppsPage(workosUserId, apiKey, {
      after,
      limit: 100,
      timeoutMs: 10_000,
    });
    if (!result) {
      throw new Error("Provider application lookup unavailable");
    }
    for (const app of result.apps) {
      if (app.clientId === clientId) {
        if (found && found !== app.id) {
          throw new Error("Ambiguous provider application");
        }
        found = app.id;
      }
    }
    if (!result.after) {
      return found;
    }
    after = result.after;
  }
  throw new Error("Provider application pagination limit");
}

export type DisconnectStatus = 204 | 401 | 503;

export async function disconnectApplication(
  ctx: ActionCtx,
  principal: {
    workosUserId: string;
    consentId: string;
    clientId: string;
    tokenExpiresAt?: number;
  }
): Promise<DisconnectStatus> {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    return 503;
  }
  const checked = await ctx.runMutation(
    internal.workosApplicationDisconnect.check,
    principal
  );
  if (checked.status === "denied") {
    return 401;
  }
  if (checked.status === "revoked") {
    return 204;
  }
  const startedAt = Date.now();
  if (
    principal.tokenExpiresAt !== undefined &&
    principal.tokenExpiresAt * 1000 <= startedAt
  ) {
    return checked.alreadyRevoked ? 204 : 401;
  }
  try {
    const appId = await findApp(
      principal.workosUserId,
      principal.clientId,
      apiKey
    );
    if (appId) {
      await deleteAuthorizedApp(principal.workosUserId, appId, apiKey, 10_000);
    }
  } catch {
    return 503;
  }
  await ctx.runMutation(internal.workosApplicationDisconnect.revoke, {
    userId: checked.userId,
    workosUserId: principal.workosUserId,
    clientId: principal.clientId,
    consentId: principal.consentId,
    startedAt,
  });
  return 204;
}

export const run = internalAction({
  args: principalValidator,
  returns: v.union(v.literal(204), v.literal(401), v.literal(503)),
  handler: disconnectApplication,
});
