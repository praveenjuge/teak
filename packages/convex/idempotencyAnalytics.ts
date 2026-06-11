import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

const outcomeValidator = v.union(
  v.literal("skipped"),
  v.literal("started"),
  v.literal("replayed"),
  v.literal("conflict"),
  v.literal("in_progress"),
  v.literal("error")
);

export type IdempotencyOutcome =
  | "skipped"
  | "started"
  | "replayed"
  | "conflict"
  | "in_progress"
  | "error";

export const trackIdempotencyOutcome = internalMutation({
  args: {
    endpoint: v.string(),
    outcome: outcomeValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const date = new Date().toISOString().slice(0, 10); // "2026-05-05"

    const existing = await ctx.db
      .query("apiIdempotencyAnalytics")
      .withIndex("by_date_endpoint", (q) =>
        q.eq("date", date).eq("endpoint", args.endpoint)
      )
      .first();

    if (existing) {
      const field = outcomeToField(args.outcome);
      await ctx.db.patch(existing._id, {
        totalRequests: existing.totalRequests + 1,
        withKey: existing.withKey + (args.outcome !== "skipped" ? 1 : 0),
        [field]: existing[field] + 1,
      });
    } else {
      const row = {
        date,
        endpoint: args.endpoint,
        totalRequests: 1,
        withKey: args.outcome !== "skipped" ? 1 : 0,
        skipped: 0,
        started: 0,
        replayed: 0,
        conflicts: 0,
        inProgress: 0,
        errors: 0,
      };
      const field = outcomeToField(args.outcome);
      (row as any)[field] = 1;
      await ctx.db.insert("apiIdempotencyAnalytics", row);
    }

    return null;
  },
});

export const getIdempotencyAnalytics = query({
  args: {
    days: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      date: v.string(),
      endpoint: v.string(),
      totalRequests: v.number(),
      withKey: v.number(),
      skipped: v.number(),
      started: v.number(),
      replayed: v.number(),
      conflicts: v.number(),
      inProgress: v.number(),
      errors: v.number(),
    })
  ),
  handler: async (ctx, args) => {
    const days = args.days ?? 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const rows = await ctx.db
      .query("apiIdempotencyAnalytics")
      .withIndex("by_date_endpoint", (q) => q.gte("date", cutoff))
      .collect();

    return rows.map((row) => ({
      date: row.date,
      endpoint: row.endpoint,
      totalRequests: row.totalRequests,
      withKey: row.withKey,
      skipped: row.skipped,
      started: row.started,
      replayed: row.replayed,
      conflicts: row.conflicts,
      inProgress: row.inProgress,
      errors: row.errors,
    }));
  },
});

type AnalyticsCounterField =
  | "skipped"
  | "started"
  | "replayed"
  | "conflicts"
  | "inProgress"
  | "errors";

function outcomeToField(outcome: IdempotencyOutcome): AnalyticsCounterField {
  switch (outcome) {
    case "skipped":
      return "skipped";
    case "started":
      return "started";
    case "replayed":
      return "replayed";
    case "conflict":
      return "conflicts";
    case "in_progress":
      return "inProgress";
    case "error":
      return "errors";
  }
}
