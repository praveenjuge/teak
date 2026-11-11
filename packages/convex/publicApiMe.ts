import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { readCardAllowance } from "./card/quota";
import { readAccountLocale } from "./settings/preferences";

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
    if (
      !mirror ||
      mirror.deletedAt !== undefined ||
      !mirror.workosUserId ||
      !mirror.emailVerified
    ) {
      return null;
    }
    const allowance = includeUsage
      ? await readCardAllowance(ctx, teakUserId)
      : null;
    const usage = allowance
      ? {
          cardCount: allowance.cardCount,
          cardLimit: allowance.cardLimit,
          plan: allowance.hasPremium ? ("pro" as const) : ("free" as const),
        }
      : {};
    return {
      id: teakUserId,
      email: mirror.email,
      ...(mirror.name ? { name: mirror.name } : {}),
      ...usage,
      locale: await readAccountLocale(ctx, teakUserId),
    };
  },
});
