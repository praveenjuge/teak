import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireTeakUserId } from "./securitySessions";
import {
  getTagOperationForUser,
  startTagOperationForUser,
  tagOperationKindValidator,
  tagOperationReturnValidator,
} from "./tag/tagOperations";

export const startTagOperationForApi = internalMutation({
  args: {
    userId: v.string(),
    kind: tagOperationKindValidator,
    from: v.string(),
    to: v.optional(v.string()),
  },
  returns: tagOperationReturnValidator,
  handler: async (ctx, { userId, ...args }) =>
    startTagOperationForUser(ctx, await requireTeakUserId(ctx, userId), args),
});

export const getTagOperationForApi = internalQuery({
  args: { userId: v.string(), operationId: v.string() },
  returns: v.union(tagOperationReturnValidator, v.null()),
  handler: async (ctx, args) =>
    getTagOperationForUser(
      ctx,
      await requireTeakUserId(ctx, args.userId),
      args.operationId
    ),
});
