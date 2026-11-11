import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  type MutationCtx,
  mutation,
} from "./_generated/server";
import { getAccountDeletionState } from "./accountDeletion/gate";
import {
  beginAccountDeletion,
  initiateAccountDeletion,
} from "./accountDeletion/start";
import { removeCardUsage } from "./card/cardUsage";
import {
  getDeletionRetryPrincipal,
  getSessionUser,
  UNAUTHENTICATED_ERROR,
} from "./securitySessions";

export const beginAccountDataDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await beginAccountDeletion(ctx, userId);
    return null;
  },
});

export const removeAccountCardUsageHandler = async (
  ctx: MutationCtx,
  userId: string
) => {
  await removeCardUsage(ctx, userId);
  return null;
};

export const removeAccountCardUsage = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: (ctx, { userId }) => removeAccountCardUsageHandler(ctx, userId),
});

export const deleteMyAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const session = await getSessionUser(ctx);
    if (!session) {
      const retry = await getDeletionRetryPrincipal(ctx);
      if (retry) {
        const rows = await ctx.db
          .query("users")
          .withIndex("by_workosUserId", (q) =>
            q.eq("workosUserId", retry.workosUserId)
          )
          .take(2);
        if (rows.length === 1) {
          const state = await getAccountDeletionState(ctx, rows[0].teakUserId);
          if (state && state.workosUserId === retry.workosUserId) {
            return null;
          }
        }
      }
      throw new ConvexError(UNAUTHENTICATED_ERROR);
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", session.teakUserId))
      .take(2);
    if (rows.length !== 1 || rows[0].deletedAt !== undefined) {
      throw new ConvexError("Account binding unavailable");
    }
    const owner = rows[0];
    return initiateAccountDeletion(ctx, owner);
  },
});
