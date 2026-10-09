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
} from "./workosAuthorizedApps";
import { resolveOwner } from "./workosIdentity";

const principalValidator = {
  workosUserId: v.string(),
  consentId: v.string(),
  clientId: v.string(),
  externalId: v.optional(v.union(v.string(), v.null())),
  tokenExpiresAt: v.optional(v.number()),
};
const MAX_APP_PAGES = 20;

// Disconnecting revokes the app's grant at WorkOS, then marks every consent
// Teak has seen for that app as revoked. Revoked consents are denied at once
// and forever. A token from a consent Teak has not seen yet stops working when
// it expires, within five minutes.

// The caller supplies a verified Connect token or a live session. A consent
// Teak already knows must belong to the same owner, user and app.
export const check = internalMutation({
  args: principalValidator,
  returns: v.union(
    v.object({ status: v.literal("denied") }),
    v.object({ status: v.literal("revoked") }),
    v.object({ status: v.literal("ok"), userId: v.string() })
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
          known.clientId !== args.clientId ||
          (typeof args.externalId === "string" &&
            args.externalId !== known.userId)))
    ) {
      return { status: "denied" as const };
    }
    if (known?.revokedAt !== undefined) {
      return { status: "revoked" as const };
    }
    if (known) {
      return { status: "ok" as const, userId: known.userId };
    }
    const owner = await resolveOwner(ctx, {
      workosUserId: args.workosUserId,
      ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
      verification: { kind: "connect" },
    });
    return owner.status === "ok"
      ? { status: "ok" as const, userId: owner.teakUserId }
      : { status: "denied" as const };
  },
});

// Runs once the grant is gone at WorkOS. Marks the triggering consent and every
// consent seen for the app before this disconnect began as revoked, and settles
// any disconnect the previous flow left unfinished for this app.
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
      // A consent first seen after this disconnect began is a new grant.
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

// Returns an HTTP status: 204 when disconnected, 401 when the principal can't
// disconnect this consent, 503 when WorkOS could not be reached.
export async function disconnectApplication(
  ctx: ActionCtx,
  principal: {
    workosUserId: string;
    consentId: string;
    clientId: string;
    externalId?: string | null;
    tokenExpiresAt?: number;
  }
): Promise<number> {
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
  // An expired token proves an old sign-in, not today's grant, so it may only
  // replay a finished disconnect. Otherwise a leaked old token could lock the
  // owner out of this app.
  if (
    principal.tokenExpiresAt !== undefined &&
    principal.tokenExpiresAt * 1000 <= startedAt
  ) {
    return 401;
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
  returns: v.number(),
  handler: disconnectApplication,
});
