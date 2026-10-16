import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { DAY_MS, utcDay } from "./adminStats";

/** The Files Worker sends at most this many users per call. */
export const MAX_DAILY_USAGE_ROWS = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * Sets each listed user's AI usage for one UTC day to the totals the Files
 * Worker read from Workers Analytics Engine. The hourly rollup sends a day's
 * absolute totals every time, so a repeated or overlapping run never counts
 * a call twice.
 */
export const replaceDailyUsage = internalMutation({
  args: {
    date: v.string(),
    rows: v.array(
      v.object({
        userId: v.string(),
        calls: v.number(),
        errors: v.number(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        costUsd: v.number(),
      })
    ),
  },
  returns: v.object({ written: v.number() }),
  handler: async (ctx, { date, rows }) => {
    if (!DATE_PATTERN.test(date)) {
      throw new Error("invalid_usage_date");
    }
    if (rows.length > MAX_DAILY_USAGE_ROWS) {
      throw new Error("too_many_usage_rows");
    }
    let written = 0;
    for (const { userId, ...usage } of rows) {
      if (!userId) {
        continue;
      }
      const row = await ctx.db
        .query("aiUsageDaily")
        .withIndex("by_date_and_userId", (q) =>
          q.eq("date", date).eq("userId", userId)
        )
        .unique();
      if (row) {
        await ctx.db.patch("aiUsageDaily", row._id, usage);
      } else if (usage.calls > 0) {
        await ctx.db.insert("aiUsageDaily", { date, userId, ...usage });
      } else {
        continue;
      }
      written += 1;
    }
    return { written };
  },
});

const USAGE_READ_LIMIT = 20_000;

export interface UsageByUser {
  calls: number;
  costUsd: number;
  userId: string;
}

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
