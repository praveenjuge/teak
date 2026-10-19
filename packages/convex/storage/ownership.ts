import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "../_generated/server";
import { accountDeletionOwnsRows } from "../accountDeletion";
import { isFilesWorkerConfigured } from "./filesWorkerClient";
import { assertR2KeyInNamespace } from "./r2Keys";

const accountClosedOrClosing = async (ctx: MutationCtx, userId: string) => {
  const owner = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .unique();
  return (
    owner?.deletedAt !== undefined ||
    (await accountDeletionOwnsRows(ctx, userId))
  );
};

export const registerOwnedObject = async (
  ctx: MutationCtx,
  userId: string,
  key: string,
  exportJobId?: Id<"exportJobs">
) => {
  assertR2KeyInNamespace(key);
  if (await accountClosedOrClosing(ctx, userId)) {
    return false;
  }
  const matches = await ctx.db
    .query("accountStorageObjects")
    .withIndex("by_key", (q) => q.eq("key", key))
    .take(2);
  if (matches.some((row) => row.userId !== userId) || matches.length > 1) {
    throw new Error("storage_owner_conflict");
  }
  if (!matches.length) {
    await ctx.db.insert("accountStorageObjects", {
      userId,
      key,
      ...(exportJobId ? { exportJobId } : {}),
    });
  }
  return true;
};
export const registerObject = internalMutation({
  args: {
    userId: v.string(),
    key: v.string(),
    exportJobId: v.optional(v.id("exportJobs")),
  },
  returns: v.boolean(),
  handler: (ctx, { userId, key, exportJobId }) =>
    registerOwnedObject(ctx, userId, key, exportJobId),
});
/** Registers several keys at once; false when the account takes no writes. */
export const registerObjects = internalMutation({
  args: { userId: v.string(), keys: v.array(v.string()) },
  returns: v.boolean(),
  handler: async (ctx, { userId, keys }) => {
    if (keys.length > 100) {
      throw new Error("too_many_storage_keys");
    }
    for (const key of keys) {
      if (!(await registerOwnedObject(ctx, userId, key))) {
        return false;
      }
    }
    return true;
  },
});
export const getObjectsPage = internalQuery({
  args: { userId: v.string() },
  handler: (ctx, { userId }) =>
    ctx.db
      .query("accountStorageObjects")
      .withIndex("by_userId_and_key", (q) => q.eq("userId", userId))
      .take(100),
});

export const ensureObjectOwnership = async (
  ctx: Pick<ActionCtx, "runMutation">,
  userId: string,
  key: string,
  exportJobId?: Id<"exportJobs">
) => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  if (
    !(await ctx.runMutation(internal.storage.ownership.registerObject, {
      userId,
      key,
      ...(exportJobId ? { exportJobId } : {}),
    }))
  ) {
    throw new Error("account_storage_write_denied");
  }
};
