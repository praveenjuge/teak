import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";

// workflows/manager.ts was removed in #726 when background work moved to
// Cloudflare Workers. Its per-workflow cleanup jobs remain in
// _scheduled_functions and fail with "Couldn't find JavaScript module
// 'workflows/manager.js'" as each one comes due. Cancel them here.
export const ORPHANED_WORKFLOW_FUNCTION_PREFIX = "workflows/manager:";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

const totalsValidator = v.object({
  examined: v.number(),
  pending: v.number(),
  orphaned: v.number(),
  canceled: v.number(),
});

const emptyTotals = () => ({
  examined: 0,
  pending: 0,
  orphaned: 0,
  canceled: 0,
});

export const cancelOrphanedWorkflowCleanupJobs = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
    pendingByFunction: v.optional(v.record(v.string(), v.number())),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totalsValidator,
    totals: totalsValidator,
    pendingByFunction: v.record(v.string(), v.number()),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const page = await ctx.db.system
      .query("_scheduled_functions")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = emptyTotals();
    const pendingByFunction: Record<string, number> = {
      ...(args.pendingByFunction ?? {}),
    };
    for (const job of page.page) {
      batch.examined += 1;
      if (job.state.kind !== "pending") {
        continue;
      }
      batch.pending += 1;
      pendingByFunction[job.name] =
        (job.name in pendingByFunction ? pendingByFunction[job.name] : 0) + 1;
      if (!job.name.startsWith(ORPHANED_WORKFLOW_FUNCTION_PREFIX)) {
        continue;
      }
      batch.orphaned += 1;
      if (!dryRun) {
        await ctx.scheduler.cancel(job._id);
        batch.canceled += 1;
      }
    }

    const previous = args.totals ?? emptyTotals();
    const totals = {
      examined: previous.examined + batch.examined,
      pending: previous.pending + batch.pending,
      orphaned: previous.orphaned + batch.orphaned,
      canceled: previous.canceled + batch.canceled,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/cancelOrphanedWorkflowCleanupJobs"]
          .cancelOrphanedWorkflowCleanupJobs,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
          pendingByFunction,
        }
      );
    } else if (isDone) {
      console.log("cancelOrphanedWorkflowCleanupJobs finished", {
        dryRun,
        ...totals,
        pendingByFunction,
      });
    }
    return {
      dryRun,
      isDone,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      batch,
      totals,
      pendingByFunction,
    };
  },
});
