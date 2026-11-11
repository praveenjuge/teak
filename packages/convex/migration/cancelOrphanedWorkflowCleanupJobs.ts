import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

// workflows/manager.ts was removed in #726 when background work moved to
// Cloudflare Workers. Its per-workflow cleanup jobs remain in
// _scheduled_functions and fail with "Couldn't find JavaScript module
// 'workflows/manager.js'" as each one comes due. Cancel them here.
export const ORPHANED_WORKFLOW_FUNCTION_PREFIX = "workflows/manager:";

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

const pageReturns = v.object({
  ...backfillReturns(totalsValidator).fields,
  pendingByFunction: v.record(v.string(), v.number()),
});

export const cancelOrphanedWorkflowCleanupJobs = internalMutation({
  args: {
    ...backfillArgs(totalsValidator),
    pendingByFunction: v.optional(v.record(v.string(), v.number())),
  },
  returns: pageReturns,
  handler: async (ctx, args): Promise<typeof pageReturns.type> => {
    const pendingByFunction: Record<string, number> = {
      ...(args.pendingByFunction ?? {}),
    };
    const result = await runBackfillPage(ctx, args, {
      batchSize: { default: 200, max: 500 },
      empty: emptyTotals,
      finish: () => {
        console.log("cancelOrphanedWorkflowCleanupJobs pending jobs", {
          pendingByFunction,
        });
        return Promise.resolve();
      },
      name: "cancelOrphanedWorkflowCleanupJobs",
      read: (cursor, numItems) =>
        ctx.db.system
          .query("_scheduled_functions")
          .paginate({ cursor, numItems }),
      self: internal.migration.cancelOrphanedWorkflowCleanupJobs
        .cancelOrphanedWorkflowCleanupJobs,
      visit: async (jobs, batch, dryRun) => {
        for (const job of jobs) {
          batch.examined += 1;
          if (job.state.kind !== "pending") {
            continue;
          }
          batch.pending += 1;
          pendingByFunction[job.name] =
            (job.name in pendingByFunction ? pendingByFunction[job.name] : 0) +
            1;
          if (!job.name.startsWith(ORPHANED_WORKFLOW_FUNCTION_PREFIX)) {
            continue;
          }
          batch.orphaned += 1;
          if (!dryRun) {
            await ctx.scheduler.cancel(job._id);
            batch.canceled += 1;
          }
        }
        return { pendingByFunction };
      },
    });
    return { ...result, pendingByFunction };
  },
});
