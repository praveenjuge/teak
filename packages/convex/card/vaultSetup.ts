import { v } from "convex/values";
import { query } from "../_generated/server";
import { getSessionUser } from "../securitySessions";

/**
 * When the signed-in account's getting-started cards started on their way, or
 * null once they have landed (or for an account that never had any coming).
 * Clients show "Setting up your vault" instead of an empty library meanwhile.
 */
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
