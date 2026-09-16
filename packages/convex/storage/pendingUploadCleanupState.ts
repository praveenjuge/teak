import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

const STATE_NAME = "stale-pending-uploads";

export const getCursor = internalQuery({
  args: {},
  returns: v.union(v.string(), v.null()),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("pendingUploadCleanupStates")
      .withIndex("by_name", (query) => query.eq("name", STATE_NAME))
      .unique();
    return state?.cursor ?? null;
  },
});

export const setCursor = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { cursor }) => {
    const state = await ctx.db
      .query("pendingUploadCleanupStates")
      .withIndex("by_name", (query) => query.eq("name", STATE_NAME))
      .unique();
    const value = { cursor, name: STATE_NAME, updatedAt: Date.now() };
    if (state) {
      await ctx.db.patch(state._id, value);
    } else {
      await ctx.db.insert("pendingUploadCleanupStates", value);
    }
    return null;
  },
});
