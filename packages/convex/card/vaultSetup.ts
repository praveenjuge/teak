import { v } from "convex/values";
import { query } from "../_generated/server";
import { getSessionUser } from "../securitySessions";

export const getVaultSetup = query({
  args: {},
  returns: v.union(v.null(), v.object({ startedAt: v.number() })),
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const row = await ctx.db
      .query("vaultSetups")
      .withIndex("by_userId", (q) => q.eq("userId", user.teakUserId))
      .first();
    return row ? { startedAt: row.startedAt } : null;
  },
});
