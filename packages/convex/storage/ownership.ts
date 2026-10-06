import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx, type ActionCtx } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { assertR2KeyInNamespace } from "./r2Keys";

// Exact keys, never inferred from the 32-bit legacy owner prefix.
export const registerOwnedObject = async (ctx: MutationCtx, userId: string, key: string, exportJobId?: Id<"exportJobs">) => {
  assertR2KeyInNamespace(key);
  const owner = await ctx.db.query("users").withIndex("by_teakUserId", q => q.eq("teakUserId", userId)).unique();
  // This internal inventory never authorizes an owner. Callers carry owner IDs
  // already bound to their card/job/session; missing mirrors may still have
  // legacy diagnostic jobs. Terminal deletion remains an unconditional fence.
  if (owner?.deletedAt !== undefined || await getAccountDeletionState(ctx, userId)) return false;
  const matches = await ctx.db.query("accountStorageObjects").withIndex("by_key", q => q.eq("key", key)).take(2);
  if (matches.some(row => row.userId !== userId) || matches.length > 1) throw new Error("storage_owner_conflict");
  if (!matches.length) await ctx.db.insert("accountStorageObjects", { userId, key, ...(exportJobId ? { exportJobId } : {}) });
  return true;
};
export const registerObject = internalMutation({
  args: { userId: v.string(), key: v.string(), exportJobId: v.optional(v.id("exportJobs")) }, returns: v.boolean(),
  handler: (ctx, { userId, key, exportJobId }) => registerOwnedObject(ctx, userId, key, exportJobId),
});
export const getObjectsPage = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, { userId }) => ctx.db.query("accountStorageObjects").withIndex("by_userId_and_key", q => q.eq("userId", userId)).take(100),
});
export const forgetObjects = internalMutation({
  args: { userId: v.string(), ids: v.array(v.id("accountStorageObjects")) }, returns: v.null(),
  handler: async (ctx, { userId, ids }) => {
    if (ids.length > 100) throw new Error("storage_cleanup_batch_limit");
    for (const id of ids) {
      const row = await ctx.db.get("accountStorageObjects", id);
      if (row?.userId === userId) await ctx.db.delete("accountStorageObjects", id);
    }
    return null;
  },
});

export const ensureObjectOwnership = async (ctx: Pick<ActionCtx, "runMutation">, userId: string, key: string, exportJobId?: Id<"exportJobs">) => {
  if (!(await ctx.runMutation(internal.storage.ownership.registerObject, { userId, key, ...(exportJobId ? { exportJobId } : {}) }))) throw new Error("account_storage_write_denied");
};
