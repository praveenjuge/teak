import { v } from "convex/values";
import { internal } from "./_generated/api";
import { env, internalMutation } from "./_generated/server";

export const AUTH_CODE_RETENTION_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_BATCHES = 20;
export const RETENTION_SCAN_LEASE_MS = 15 * 60 * 1000;
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
    runId: v.optional(v.id("operationalRetentionStates")),
  },
  returns: v.object({
    cutoff: v.number(),
    skipped: v.boolean(),
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
    let cutoff = args.cutoff ?? latestCutoff;
    let cursor = args.cursor ?? null;
    let runId = args.runId;
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
    if (!dryRun) {
      const state = await ctx.db
        .query("operationalRetentionStates")
        .withIndex("by_kind", (q) => q.eq("kind", args.kind))
        .unique();
      // Run IDs fence old scheduled work after recovery. Only one transactional
      // cursor owner may scan each table; cron/manual requests never overlap it.
      if (
        (runId && state?._id !== runId) ||
        (!runId &&
          state &&
          Date.now() - state.updatedAt < RETENTION_SCAN_LEASE_MS)
      ) {
        return {
          cutoff: state?.cutoff ?? cutoff,
          skipped: true,
          examined: 0,
          eligible: 0,
          deleted: 0,
          preservedPending: 0,
          isDone: false,
          continueCursor: state?.cursor ?? null,
          continuationScheduled: false,
        };
      }
      if (state) {
        cutoff = state.cutoff;
        cursor = state.cursor;
        if (!runId) {
          await ctx.db.delete("operationalRetentionStates", state._id);
        }
      }
      if (!runId) {
        runId = await ctx.db.insert("operationalRetentionStates", {
          kind: args.kind,
          cutoff,
          cursor,
          updatedAt: Date.now(),
        });
      }
    }
    const options = {
      cursor,
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
    if (runId && !dryRun) {
      if (isDone) {
        await ctx.db.delete("operationalRetentionStates", runId);
      } else {
        await ctx.db.patch("operationalRetentionStates", runId, {
          cursor: continueCursor,
          updatedAt: Date.now(),
        });
      }
    }
    const continuationScheduled = !(dryRun || isDone);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        remainingBatches > 1 ? 1000 : 5 * 60 * 1000,
        internal.operationalRetention.cleanupExpiredRecords,
        {
          kind: args.kind,
          runId,
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
      skipped: false,
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
