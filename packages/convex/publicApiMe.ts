import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { readCardEntitlement } from "./billing/polar";
import { getActiveCardCount } from "./card/cardUsage";
import { readAccountLocale } from "./settings/preferences";
import { FREE_TIER_LIMIT } from "./shared/constants";

export const profileForUser = internalQuery({
  args: { teakUserId: v.string(), includeUsage: v.optional(v.boolean()) },
  returns: v.union(
    v.object({
      id: v.string(),
      email: v.string(),
      name: v.optional(v.string()),
      cardCount: v.optional(v.number()),
      cardLimit: v.optional(v.union(v.number(), v.null())),
      plan: v.optional(v.union(v.literal("free"), v.literal("pro"))),
      locale: v.string(),
    }),
    v.null()
  ),
  handler: async (ctx, { teakUserId, includeUsage }) => {
    const mirror = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", teakUserId))
      .unique();
    if (mirror?.deletedAt !== undefined) {
      return null;
    }
    const hasPremium =
      includeUsage && (await readCardEntitlement(ctx, teakUserId));
    const usage = includeUsage
      ? {
          cardCount: await getActiveCardCount(ctx, teakUserId),
          cardLimit: hasPremium ? null : FREE_TIER_LIMIT,
          plan: hasPremium ? ("pro" as const) : ("free" as const),
        }
      : {};
    if (!mirror?.workosUserId) {
      return null;
    }
    if (!mirror.emailVerified) {
      return null;
    }
    return {
      id: teakUserId,
      email: mirror.email,
      ...(mirror.name ? { name: mirror.name } : {}),
      ...usage,
      locale: await readAccountLocale(ctx, teakUserId),
    };
  },
});
