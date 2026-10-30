import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { action, mutation, type QueryCtx, query } from "./_generated/server";
import {
  ensureAdmin,
  readAdminSettings,
  readUserFlags,
  upsertUserFlags,
  writeAdminSettings,
  writeAudit,
} from "./adminAccess";

const AUDIT_PAGE_LIMIT = 100;
const NOTES_LIMIT = 200;
const MAX_NOTE_LENGTH = 2000;

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    return await readAdminSettings(ctx);
  },
});

const switchValidator = v.union(
  v.literal("signupsPaused"),
  v.literal("aiPaused"),
  v.literal("linkFetchPaused")
);

/**
 * `aiPaused` reaches card processing within a minute: the Core Worker reuses
 * each `getAiGate` answer for up to 60 seconds (`apps/core-worker/src/ai/aiGate.ts`).
 */
export const setKillSwitch = mutation({
  args: {
    name: switchValidator,
    enabled: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { name, enabled, reason }) => {
    const actor = await ensureAdmin(ctx);
    const before = (await readAdminSettings(ctx))[name];
    await writeAdminSettings(ctx, { [name]: enabled });
    await writeAudit(ctx, actor, {
      action: `kill_switch.${name}`,
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
      details: { before, after: enabled },
    });
    return null;
  },
});

export const setGoals = mutation({
  args: {
    weeklyGrowthTargetPct: v.number(),
    primaryMetric: v.union(v.literal("mrr"), v.literal("weeklyActiveSavers")),
  },
  returns: v.null(),
  handler: async (ctx, { weeklyGrowthTargetPct, primaryMetric }) => {
    const actor = await ensureAdmin(ctx);
    if (
      !Number.isFinite(weeklyGrowthTargetPct) ||
      weeklyGrowthTargetPct <= 0 ||
      weeklyGrowthTargetPct > 100
    ) {
      throw new Error("The weekly target must be between 0 and 100 percent");
    }
    const before = await readAdminSettings(ctx);
    await writeAdminSettings(ctx, { weeklyGrowthTargetPct, primaryMetric });
    await writeAudit(ctx, actor, {
      action: "settings.goals",
      details: {
        before: {
          weeklyGrowthTargetPct: before.weeklyGrowthTargetPct,
          primaryMetric: before.primaryMetric,
        },
        after: { weeklyGrowthTargetPct, primaryMetric },
      },
    });
    return null;
  },
});

const assertAccountExists = async (
  ctx: Pick<QueryCtx, "db">,
  teakUserId: string
) => {
  const user = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
    .unique();
  if (!user) {
    throw new Error("Account not found");
  }
};

export const setUserFlag = mutation({
  args: {
    teakUserId: v.string(),
    flag: v.union(v.literal("internal"), v.literal("aiDisabled")),
    value: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { teakUserId, flag, value, reason }) => {
    const actor = await ensureAdmin(ctx);
    await assertAccountExists(ctx, teakUserId);
    const before = (await readUserFlags(ctx, teakUserId))?.[flag] ?? false;
    await upsertUserFlags(ctx, teakUserId, { [flag]: value });
    await writeAudit(ctx, actor, {
      action: `user.${flag}`,
      targetTeakUserId: teakUserId,
      ...(reason?.trim() ? { reason: reason.trim() } : {}),
      details: { before, after: value },
    });
    return null;
  },
});

export const syncInternalAccounts = action({
  args: {},
  handler: async (ctx): Promise<{ flagged: number }> => {
    const actor = await ensureAdmin(ctx);
    const flagged: number = await ctx.runAction(
      internal.adminMetrics.flagInternalAccounts,
      {}
    );
    await ctx.runMutation(internal.adminAccess.recordAudit, {
      actor,
      action: "users.sync_internal",
      details: { flagged },
    });
    return { flagged };
  },
});

export const listAuditLog = query({
  args: {
    paginationOpts: paginationOptsValidator,
    targetTeakUserId: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, targetTeakUserId }) => {
    await ensureAdmin(ctx);
    const opts = {
      ...paginationOpts,
      numItems: Math.min(paginationOpts.numItems, AUDIT_PAGE_LIMIT),
    };
    return targetTeakUserId === undefined
      ? await ctx.db
          .query("adminAuditLog")
          .withIndex("by_at")
          .order("desc")
          .paginate(opts)
      : await ctx.db
          .query("adminAuditLog")
          .withIndex("by_targetTeakUserId_and_at", (q) =>
            q.eq("targetTeakUserId", targetTeakUserId)
          )
          .order("desc")
          .paginate(opts);
  },
});

export const listNotes = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    return await ctx.db
      .query("adminNotes")
      .withIndex("by_createdAt")
      .order("desc")
      .take(NOTES_LIMIT);
  },
});

export const addNote = mutation({
  args: { body: v.string() },
  returns: v.null(),
  handler: async (ctx, { body }) => {
    await ensureAdmin(ctx);
    const text = body.trim();
    if (!text) {
      throw new Error("The note is empty");
    }
    await ctx.db.insert("adminNotes", {
      body: text.slice(0, MAX_NOTE_LENGTH),
      createdAt: Date.now(),
    });
    return null;
  },
});

export const setNoteResolved = mutation({
  args: { noteId: v.id("adminNotes"), resolved: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { noteId, resolved }) => {
    await ensureAdmin(ctx);
    const note = await ctx.db.get("adminNotes", noteId);
    if (!note) {
      throw new Error("Note not found");
    }
    await ctx.db.patch("adminNotes", noteId, {
      resolvedAt: resolved ? Date.now() : undefined,
    });
    return null;
  },
});

export const deleteNote = mutation({
  args: { noteId: v.id("adminNotes") },
  returns: v.null(),
  handler: async (ctx, { noteId }) => {
    await ensureAdmin(ctx);
    if (await ctx.db.get("adminNotes", noteId)) {
      await ctx.db.delete("adminNotes", noteId);
    }
    return null;
  },
});

export const recordSignIn = mutation({
  args: {
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { ipAddress, userAgent }) => {
    const actor = await ensureAdmin(ctx);
    const details = {
      ...(ipAddress ? { ipAddress: ipAddress.slice(0, 64) } : {}),
      ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
    };
    await writeAudit(ctx, actor, { action: "admin.sign_in", details });
    return null;
  },
});
