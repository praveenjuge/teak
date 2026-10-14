import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { readSignupsDisabled } from "./env";
import { getSessionUser } from "./securitySessions";

// Shared pieces of the superadmin console: who may use it, the audit log every
// admin action writes to, the kill switches, and which accounts are internal.

export interface AdminActor {
  email: string;
  teakUserId: string;
}

type AdminCtx = QueryCtx | MutationCtx | ActionCtx;

export const readAdminActor = async (
  ctx: AdminCtx
): Promise<AdminActor | null> => {
  const user = await getSessionUser(ctx);
  if (!user) {
    return null;
  }
  const mapping: Doc<"users"> | null = await ctx.runQuery(
    internal.securitySessions.identityMapping,
    { teakUserId: user.teakUserId }
  );
  if (mapping?.role !== "admin" || mapping.deletedAt !== undefined) {
    return null;
  }
  return { teakUserId: mapping.teakUserId, email: mapping.email };
};

export const ensureAdmin = async (ctx: AdminCtx): Promise<AdminActor> => {
  const actor = await readAdminActor(ctx);
  if (!actor) {
    throw new Error("Unauthorized");
  }
  return actor;
};

/* Audit log -------------------------------------------------------------- */

export interface AuditEntry {
  action: string;
  details?: Record<string, unknown>;
  reason?: string;
  targetCardId?: string;
  targetTeakUserId?: string;
}

const MAX_REASON_LENGTH = 500;

export const writeAudit = async (
  ctx: MutationCtx,
  actor: AdminActor,
  entry: AuditEntry
) => {
  await ctx.db.insert("adminAuditLog", {
    actorTeakUserId: actor.teakUserId,
    actorEmail: actor.email,
    action: entry.action,
    at: Date.now(),
    ...(entry.targetTeakUserId === undefined
      ? {}
      : { targetTeakUserId: entry.targetTeakUserId }),
    ...(entry.targetCardId === undefined
      ? {}
      : { targetCardId: entry.targetCardId }),
    ...(entry.reason === undefined
      ? {}
      : { reason: entry.reason.slice(0, MAX_REASON_LENGTH) }),
    ...(entry.details === undefined ? {} : { details: entry.details }),
  });
};

// Actions have no database; they audit through this mutation.
export const recordAudit = internalMutation({
  args: {
    actor: v.object({ teakUserId: v.string(), email: v.string() }),
    action: v.string(),
    targetTeakUserId: v.optional(v.string()),
    targetCardId: v.optional(v.string()),
    reason: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.any())),
  },
  returns: v.null(),
  handler: async (ctx, { actor, ...entry }) => {
    await writeAudit(ctx, actor, entry);
    return null;
  },
});

/** A required, trimmed reason for actions that expose or change user data. */
export const requireReason = (reason: string | undefined): string => {
  const trimmed = reason?.trim() ?? "";
  if (trimmed.length < 3) {
    throw new Error("A reason is required");
  }
  return trimmed.slice(0, MAX_REASON_LENGTH);
};

/* Settings --------------------------------------------------------------- */

export type PrimaryMetric = "mrr" | "weeklyActiveSavers";

export interface AdminSettings {
  aiPaused: boolean;
  linkFetchPaused: boolean;
  primaryMetric: PrimaryMetric;
  signupsPaused: boolean;
  updatedAt: number | null;
  weeklyGrowthTargetPct: number;
}

// Paul Graham's "good" weekly growth rate during YC is 5-7%.
export const DEFAULT_WEEKLY_GROWTH_TARGET_PCT = 5;

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  signupsPaused: false,
  aiPaused: false,
  linkFetchPaused: false,
  weeklyGrowthTargetPct: DEFAULT_WEEKLY_GROWTH_TARGET_PCT,
  primaryMetric: "mrr",
  updatedAt: null,
};

type DbCtx = Pick<QueryCtx, "db">;

export const readSettingsRow = (ctx: DbCtx) =>
  ctx.db
    .query("adminSettings")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();

export const readAdminSettings = async (ctx: DbCtx): Promise<AdminSettings> => {
  const row = await readSettingsRow(ctx);
  if (!row) {
    return DEFAULT_ADMIN_SETTINGS;
  }
  return {
    signupsPaused: row.signupsPaused,
    aiPaused: row.aiPaused,
    linkFetchPaused: row.linkFetchPaused,
    weeklyGrowthTargetPct: row.weeklyGrowthTargetPct,
    primaryMetric: row.primaryMetric,
    updatedAt: row.updatedAt,
  };
};

/** The environment freeze or the console switch, whichever is on. */
export const readSignupsPaused = async (ctx: DbCtx): Promise<boolean> =>
  readSignupsDisabled() || (await readAdminSettings(ctx)).signupsPaused;

export const readUserFlags = (ctx: DbCtx, teakUserId: string) =>
  ctx.db
    .query("adminUserFlags")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
    .unique();

/** Whether a card owner's AI processing should run right now. */
export const getAiGate = internalQuery({
  args: { userId: v.string() },
  returns: v.union(
    v.literal("allowed"),
    v.literal("paused"),
    v.literal("user_disabled")
  ),
  handler: async (ctx, { userId }) => {
    if ((await readAdminSettings(ctx)).aiPaused) {
      return "paused" as const;
    }
    const flags = await readUserFlags(ctx, userId);
    return flags?.aiDisabled
      ? ("user_disabled" as const)
      : ("allowed" as const);
  },
});

export const isLinkFetchPaused = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await readAdminSettings(ctx)).linkFetchPaused,
});

/* Internal accounts ------------------------------------------------------ */

// Reserved domains never belong to customers; e2e accounts carry "e2e-".
const RESERVED_EMAIL_DOMAIN =
  /(^|\.)(example\.(com|net|org)|example|test|invalid|localhost)$/;

/** Accounts that are never customers: admins, e2e and reserved-domain emails. */
export const isAutoInternalAccount = (
  user: Pick<Doc<"users">, "email" | "role">
): boolean => {
  if (user.role === "admin") {
    return true;
  }
  const email = user.email.toLowerCase();
  const domain = email.split("@").pop() ?? "";
  return email.includes("e2e-") || RESERVED_EMAIL_DOMAIN.test(domain);
};

// Internal accounts are few; this bound only guards a misconfiguration.
const INTERNAL_ACCOUNT_LIMIT = 2000;

/** Teak user ids flagged internal, auto or by hand. */
export const readInternalUserIds = async (ctx: DbCtx): Promise<Set<string>> => {
  const rows = await ctx.db
    .query("adminUserFlags")
    .withIndex("by_internal", (q) => q.eq("internal", true))
    .take(INTERNAL_ACCOUNT_LIMIT);
  return new Set(rows.map((row) => row.teakUserId));
};

export const listInternalUserIds = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => [...(await readInternalUserIds(ctx))],
});

export const upsertUserFlags = async (
  ctx: MutationCtx,
  teakUserId: string,
  patch: Partial<Pick<Doc<"adminUserFlags">, "internal" | "aiDisabled">>
) => {
  const existing = await readUserFlags(ctx, teakUserId);
  const now = Date.now();
  if (existing) {
    await ctx.db.patch("adminUserFlags", existing._id, {
      ...patch,
      updatedAt: now,
    });
    return { ...existing, ...patch };
  }
  const row = {
    teakUserId,
    internal: patch.internal ?? false,
    aiDisabled: patch.aiDisabled ?? false,
    updatedAt: now,
  };
  await ctx.db.insert("adminUserFlags", row);
  return row;
};

/** Flags accounts the auto rule calls internal. Never unflags anyone. */
export const flagAutoInternalAccounts = internalMutation({
  args: { teakUserIds: v.array(v.string()) },
  returns: v.number(),
  handler: async (ctx, { teakUserIds }) => {
    let flagged = 0;
    for (const teakUserId of teakUserIds) {
      const existing = await readUserFlags(ctx, teakUserId);
      if (!existing?.internal) {
        await upsertUserFlags(ctx, teakUserId, { internal: true });
        flagged += 1;
      }
    }
    return flagged;
  },
});
