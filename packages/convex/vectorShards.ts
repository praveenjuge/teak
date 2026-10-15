import {
  CURRENT_VECTOR_SHARD,
  vectorNamespaceForUser,
} from "@teak/files-protocol";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { getR2KeyPrefix } from "./storage/r2Keys";

export const getOrAssignVectorShard = async (
  ctx: MutationCtx,
  userId: string
): Promise<{ namespace: string; shard: number }> => {
  const namespace = vectorNamespaceForUser(`${getR2KeyPrefix()}${userId}`);
  if (!namespace) {
    throw new Error("vector_namespace_invalid");
  }
  const existing = await ctx.db
    .query("vectorShards")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    return { namespace, shard: existing.shard };
  }
  await ctx.db.insert("vectorShards", {
    userId,
    shard: CURRENT_VECTOR_SHARD,
  });
  return { namespace, shard: CURRENT_VECTOR_SHARD };
};

export const assignVectorShard = internalMutation({
  args: { userId: v.string() },
  returns: v.object({ namespace: v.string(), shard: v.number() }),
  handler: (ctx, { userId }) => getOrAssignVectorShard(ctx, userId),
});

/** The user's shard, without placing a user who has none yet. */
export const getUserShard = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("vectorShards")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return row?.shard ?? null;
  },
});
