import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { DAY_MS, utcDay } from "./adminStats";

// AI spend per account per UTC day. Written once per AI metadata step; read
// by the console's money and account views.

export const recordAiUsage = internalMutation({
  args: {
    userId: v.string(),
    calls: v.number(),
    errors: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, { userId, ...usage }) => {
    if (usage.calls <= 0) {
      return null;
    }
    const date = utcDay(Date.now());
    const row = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_date_and_userId", (q) =>
        q.eq("date", date).eq("userId", userId)
      )
      .unique();
    if (row) {
      await ctx.db.patch("aiUsageDaily", row._id, {
        calls: row.calls + usage.calls,
        errors: row.errors + usage.errors,
        inputTokens: row.inputTokens + usage.inputTokens,
        outputTokens: row.outputTokens + usage.outputTokens,
        costUsd: row.costUsd + usage.costUsd,
      });
    } else {
      await ctx.db.insert("aiUsageDaily", { date, userId, ...usage });
    }
    return null;
  },
});

// Rows are one per active account per day; this bounds a 30-day read.
const USAGE_READ_LIMIT = 20_000;

export interface UsageByUser {
  calls: number;
  costUsd: number;
  userId: string;
}

/** AI spend per account from `sinceDate` (inclusive, YYYY-MM-DD). */
export const usageByUserSince = internalQuery({
  args: { sinceDate: v.string() },
  handler: async (ctx, { sinceDate }) => {
    const rows = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_date_and_userId", (q) => q.gte("date", sinceDate))
      .take(USAGE_READ_LIMIT);
    const byUser = new Map<string, UsageByUser>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? {
        userId: row.userId,
        calls: 0,
        costUsd: 0,
      };
      entry.calls += row.calls;
      entry.costUsd += row.costUsd;
      byUser.set(row.userId, entry);
    }
    return {
      users: [...byUser.values()],
      isApproximate: rows.length === USAGE_READ_LIMIT,
    };
  },
});

/** One UTC day's AI spend across every account. */
export const usageForDay = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const rows = await ctx.db
      .query("aiUsageDaily")
      .withIndex("by_date_and_userId", (q) => q.eq("date", date))
      .take(USAGE_READ_LIMIT);
    return rows.map((row) => ({
      userId: row.userId,
      calls: row.calls,
      costUsd: row.costUsd,
    }));
  },
});

export const daysAgoDate = (days: number, now = Date.now()) =>
  utcDay(now - days * DAY_MS);
