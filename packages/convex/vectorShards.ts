import {
  CURRENT_VECTOR_SHARD,
  vectorNamespaceForUser,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Which Vectorize shard holds a user's card embeddings. Each shard is one
 * index (`CARD_VECTORS_<shard>` in the Files Worker) and each user is one
 * namespace in it. A user stays on the shard they were first placed on, and
 * new users go to CURRENT_VECTOR_SHARD, so adding an index for growth only
 * moves where new users land.
 */
export const getOrAssignVectorShard = async (
  ctx: MutationCtx,
  userId: string
): Promise<{ namespace: string; shard: number }> => {
  const namespace = vectorNamespaceForUser(userId);
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
