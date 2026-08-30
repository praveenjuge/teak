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

export const IDEMPOTENCY_ANALYTICS_SHARDS = 8;

export const analyticsShardForRequest = (requestKey: string): number => {
  let hash = 0;
  for (const character of requestKey) {
    hash = (hash * 31 + character.charCodeAt(0)) % 2_147_483_647;
  }
  return hash % IDEMPOTENCY_ANALYTICS_SHARDS;
};

export const trackIdempotencyOutcome = internalMutation({
  args: {
    endpoint: v.string(),
    outcome: outcomeValidator,
    requestKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const date = new Date().toISOString().slice(0, 10); // "2026-05-05"
    const shard = analyticsShardForRequest(args.requestKey);

    const existing = await ctx.db
      .query("apiIdempotencyAnalytics")
      .withIndex("by_date_endpoint_shard", (q) =>
        q.eq("date", date).eq("endpoint", args.endpoint).eq("shard", shard)
      )
      .first();

    if (existing) {
      const field = outcomeToField(args.outcome);
      await ctx.db.patch(existing._id, {
        totalRequests: existing.totalRequests + 1,
        withKey: existing.withKey + (args.outcome === "skipped" ? 0 : 1),
        [field]: existing[field] + 1,
      });
    } else {
      const row = {
        date,
        endpoint: args.endpoint,
        shard,
        totalRequests: 1,
        withKey: args.outcome === "skipped" ? 0 : 1,
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
      .take(5000);

    const totals = new Map<
      string,
      Omit<(typeof rows)[number], "_id" | "_creationTime" | "shard">
    >();
    for (const row of rows) {
      const key = `${row.date}\u0000${row.endpoint}`;
      const existing = totals.get(key);
      if (!existing) {
        totals.set(key, {
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
        });
        continue;
      }
      existing.totalRequests += row.totalRequests;
      existing.withKey += row.withKey;
      existing.skipped += row.skipped;
      existing.started += row.started;
      existing.replayed += row.replayed;
      existing.conflicts += row.conflicts;
      existing.inProgress += row.inProgress;
      existing.errors += row.errors;
    }
    return Array.from(totals.values()).sort((left, right) =>
      left.date === right.date
        ? left.endpoint.localeCompare(right.endpoint)
        : right.date.localeCompare(left.date)
    );
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
    default:
      throw new Error(`Unexpected idempotency outcome: ${outcome}`);
  }
}
