import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";

export const AUTH_CODE_RETENTION_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 20;
const kindValidator = v.union(
  v.literal("idempotency"),
  v.literal("nativeAuthCodes")
);

// A frozen cutoff and indexed cursor keep pending rows from blocking later
// expired completed rows. Every batch rechecks current state transactionally.
export const cleanupExpiredRecords = internalMutation({
  args: {
    kind: kindValidator,
    cutoff: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    remainingBatches: v.optional(v.number()),
  },
  returns: v.object({
    cutoff: v.number(),
    examined: v.number(),
    eligible: v.number(),
    deleted: v.number(),
    preservedPending: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    if (!dryRun && env.OPERATIONAL_RETENTION_ENABLED !== "true") {
      throw new Error("Operational retention is not enabled");
    }
    const latestCutoff =
      Date.now() -
      (args.kind === "nativeAuthCodes" ? AUTH_CODE_RETENTION_GRACE_MS : 0);
    const cutoff = args.cutoff ?? latestCutoff;
    if (!Number.isFinite(cutoff) || cutoff > latestCutoff) {
      throw new Error("Retention cutoff cannot include unexpired records");
    }
    const remainingBatches = args.remainingBatches ?? MAX_BATCHES;
    if (
      !Number.isInteger(remainingBatches) ||
      remainingBatches < 1 ||
      remainingBatches > MAX_BATCHES
    ) {
      throw new Error("Invalid retention batch budget");
    }
    const options = {
      cursor: args.cursor ?? null,
      numItems: 100,
      maximumBytesRead: 2 * 1024 * 1024,
    };
    let examined = 0;
    let eligible = 0;
    let preservedPending = 0;
    let isDone: boolean;
    let continueCursor: string;
    if (args.kind === "idempotency") {
      const result = await ctx.db
        .query("apiIdempotencyKeys")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", cutoff))
        .paginate(options);
      examined = result.page.length;
      for (const row of result.page) {
        if (row.state !== "completed") {
          preservedPending++;
          continue;
        }
        eligible++;
        if (!dryRun) {
          await ctx.db.delete("apiIdempotencyKeys", row._id);
        }
      }
      isDone = result.isDone;
      continueCursor = result.continueCursor;
    } else {
      const result = await ctx.db
        .query("nativeAuthCodes")
        .withIndex("by_expires_at", (q) => q.lt("expiresAt", cutoff))
        .paginate(options);
      examined = result.page.length;
      eligible = examined;
      for (const row of result.page) {
        if (!dryRun) {
          await ctx.db.delete("nativeAuthCodes", row._id);
        }
      }
      isDone = result.isDone;
      continueCursor = result.continueCursor;
    }
    // Yield between bounded bursts while retaining the cursor. Restarting at the
    // first page would let expired pending reservations starve later responses.
    const continuationScheduled = !(dryRun || isDone);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        remainingBatches > 1 ? 1000 : 5 * 60 * 1000,
        internal.operationalRetention.cleanupExpiredRecords,
        {
          kind: args.kind,
          cutoff,
          cursor: continueCursor,
          dryRun: false,
          remainingBatches:
            remainingBatches > 1 ? remainingBatches - 1 : MAX_BATCHES,
        }
      );
    }
    return {
      cutoff,
      examined,
      eligible,
      deleted: dryRun ? 0 : eligible,
      preservedPending,
      isDone,
      continueCursor: isDone ? null : continueCursor,
      continuationScheduled,
    };
  },
});
