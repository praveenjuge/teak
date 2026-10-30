import { type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

const MAX_BATCHES = 20;
export const RETENTION_SCAN_LEASE_MS = 15 * 60 * 1000;
const kindValidator = v.literal("idempotency");

const cleanupArgs = v.object({
  kind: kindValidator,
  cutoff: v.optional(v.number()),
  cursor: v.optional(v.union(v.string(), v.null())),
  dryRun: v.optional(v.boolean()),
  remainingBatches: v.optional(v.number()),
  runId: v.optional(v.id("operationalRetentionStates")),
});

const cleanupReport = v.object({
  cutoff: v.number(),
  skipped: v.boolean(),
  examined: v.number(),
  eligible: v.number(),
  deleted: v.number(),
  expiredPending: v.number(),
  isDone: v.boolean(),
  continueCursor: v.union(v.string(), v.null()),
  continuationScheduled: v.boolean(),
});

export const cleanupExpiredRecords = internalMutation({
  args: cleanupArgs,
  returns: cleanupReport,
  handler: (ctx, args) => cleanUpExpiredRecords(ctx, args),
});

/**
 * The Core Worker's hourly Cron Trigger calls this. It starts a scan, which
 * continues itself in bursts, or skips while another scan holds the lease.
 */
export const startIdempotencyCleanup = internalMutation({
  args: {},
  returns: cleanupReport,
  handler: (ctx) =>
    cleanUpExpiredRecords(ctx, { kind: "idempotency", dryRun: false }),
});

const cleanUpExpiredRecords = async (
  ctx: MutationCtx,
  args: Infer<typeof cleanupArgs>
): Promise<Infer<typeof cleanupReport>> => {
  const dryRun = args.dryRun ?? true;
  const latestCutoff = Date.now();
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
        expiredPending: 0,
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
  let eligible = 0;
  let expiredPending = 0;
  const result = await ctx.db
    .query("apiIdempotencyKeys")
    .withIndex("by_expires_at", (q) => q.lt("expiresAt", cutoff))
    .paginate(options);
  const examined = result.page.length;
  // A pending row past `expiresAt` outlived its lease, so its handler is gone.
  for (const row of result.page) {
    if (row.state !== "completed") {
      expiredPending++;
    }
    eligible++;
    if (!dryRun) {
      await ctx.db.delete("apiIdempotencyKeys", row._id);
    }
  }
  const { isDone, continueCursor } = result;
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
    expiredPending,
    isDone,
    continueCursor: isDone ? null : continueCursor,
    continuationScheduled,
  };
};
