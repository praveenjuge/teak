import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  type AdminSettings,
  DEFAULT_ADMIN_SETTINGS,
  ensureAdmin,
  readAdminSettings,
  readSettingsRow,
  readUserFlags,
  upsertUserFlags,
  writeAudit,
} from "./adminAccess";
import { scheduleAdminAlert } from "./adminAlerts";
import { readSignupsDisabled } from "./env";

// Console settings, account flags, the audit log and the founder's notes.
// Every change here writes an audit entry.

const AUDIT_PAGE_LIMIT = 100;
const NOTES_LIMIT = 200;
const MAX_NOTE_LENGTH = 2000;

export const getSettings = query({
  args: {},
  handler: async (ctx) => {
    await ensureAdmin(ctx);
    return {
      ...(await readAdminSettings(ctx)),
      // The deployment's own freeze wins over the console switch.
      signupsDisabledByEnv: readSignupsDisabled(),
    };
  },
});

const switchValidator = v.union(
  v.literal("signupsPaused"),
  v.literal("aiPaused"),
  v.literal("linkFetchPaused")
);

const writeSettings = async (
  ctx: MutationCtx,
  patch: Partial<Omit<AdminSettings, "updatedAt">>
) => {
  const row = await readSettingsRow(ctx);
  const now = Date.now();
  if (row) {
    await ctx.db.patch("adminSettings", row._id, { ...patch, updatedAt: now });
    return;
  }
  const { updatedAt: _ignored, ...defaults } = DEFAULT_ADMIN_SETTINGS;
  await ctx.db.insert("adminSettings", {
    key: "global",
    ...defaults,
    ...patch,
    updatedAt: now,
  });
};

/** Flips one kill switch. A reason is kept with the audit entry. */
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
    await writeSettings(ctx, { [name]: enabled });
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
    await writeSettings(ctx, { weeklyGrowthTargetPct, primaryMetric });
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

/** Marks an account internal (left out of every metric) or AI-disabled. */
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

/** Flags admins, e2e and reserved-domain accounts as internal right away. */
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

/* Notes: "what's blocking growth" --------------------------------------- */

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

/**
 * Called by the console right after an admin signs in: writes the sign-in to
 * the audit log and posts it to the alert webhook.
 */
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
    await scheduleAdminAlert(
      ctx,
      `Teak console sign-in: ${actor.email}${
        ipAddress ? ` from ${ipAddress.slice(0, 64)}` : ""
      }`
    );
    return null;
  },
});
