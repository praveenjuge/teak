import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { ACTIVE_EXPORT_STATUSES } from "../export/constants";
import {
  queueAccountDeletionWorkflow,
  queueCardProcessing,
  queueExportWorkflow,
  queueImportWorkflow,
} from "../workflowDispatch";

// One-time cutover from @convex-dev/workflow to Cloudflare Workflows. Runs
// the old engine started have no Cloudflare instance, and the old component
// (and its journals) is gone, so after the deploy these mutations queue a
// Cloudflare run for every piece of work that was still in flight. Each
// skips subjects that already have a run queued or sent, so running either
// twice is harmless. A dry run (the default) only counts.
//
//   npx convex run --prod migration/cutoverWorkflows:requeueJobs
//   npx convex run --prod migration/cutoverWorkflows:requeueJobs '{"dryRun":false}'
//   npx convex run --prod migration/cutoverWorkflows:requeueUnfinishedCards
//   npx convex run --prod migration/cutoverWorkflows:requeueUnfinishedCards '{"dryRun":false}'

const UNFINISHED = new Set(["pending", "in_progress"]);
const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
const JOB_LIMIT = 500;

/** Whether the subject already has a run that is queued or running. */
const hasOpenRun = async (ctx: MutationCtx, key: string): Promise<boolean> => {
  const rows = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
    .order("desc")
    .take(20);
  return rows.some((row) => row.state === "pending" || row.state === "sent");
};

export const hasUnfinishedStage = (card: Doc<"cards">): boolean =>
  Object.values(card.processingStatus ?? {}).some(
    (stage) => stage !== undefined && UNFINISHED.has(stage.status)
  );

const cardTotalsValidator = v.object({
  examined: v.number(),
  queued: v.number(),
  skippedOpenRun: v.number(),
});

/**
 * Queues a processing run for every card, saved or changed within the
 * lookback, that still has a stage pending or in progress.
 */
export const requeueUnfinishedCards = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    lookbackDays: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
    once: v.optional(v.boolean()),
    totals: v.optional(cardTotalsValidator),
  },
  returns: v.object({
    batch: cardTotalsValidator,
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    dryRun: v.boolean(),
    isDone: v.boolean(),
    totals: cardTotalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const lookbackDays = args.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const since = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
    const batch = { examined: 0, queued: 0, skippedOpenRun: 0 };
    for (const card of page.page) {
      batch.examined += 1;
      if (
        card.isDeleted ||
        card.updatedAt < since ||
        !hasUnfinishedStage(card)
      ) {
        continue;
      }
      if (await hasOpenRun(ctx, `card:${card._id}`)) {
        batch.skippedOpenRun += 1;
        continue;
      }
      batch.queued += 1;
      if (!dryRun) {
        await queueCardProcessing(ctx, card._id);
      }
    }
    const previous = args.totals ?? {
      examined: 0,
      queued: 0,
      skippedOpenRun: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      queued: previous.queued + batch.queued,
      skippedOpenRun: previous.skippedOpenRun + batch.skippedOpenRun,
    };
    const continuationScheduled = !(page.isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal.migration.cutoverWorkflows.requeueUnfinishedCards,
        {
          batchSize,
          cursor: page.continueCursor,
          dryRun,
          lookbackDays,
          totals,
        }
      );
    } else {
      console.log("[cutoverWorkflows] cards", { dryRun, totals });
    }
    return {
      batch,
      continueCursor: page.isDone ? null : page.continueCursor,
      continuationScheduled,
      dryRun,
      isDone: page.isDone,
      totals,
    };
  },
});

const jobCountsValidator = v.object({
  queued: v.number(),
  skippedOpenRun: v.number(),
});

/**
 * Queues a run for every export, import and account deletion that was
 * still in progress. Each resumes from its job row.
 */
export const requeueJobs = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  returns: v.object({
    accountDeletions: jobCountsValidator,
    dryRun: v.boolean(),
    exports: jobCountsValidator,
    imports: jobCountsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const exports = { queued: 0, skippedOpenRun: 0 };
    for (const status of ACTIVE_EXPORT_STATUSES) {
      const jobs = await ctx.db
        .query("exportJobs")
        .withIndex("by_status_expires", (q) => q.eq("status", status))
        .take(JOB_LIMIT);
      for (const job of jobs) {
        if (await hasOpenRun(ctx, `export:${job._id}`)) {
          exports.skippedOpenRun += 1;
          continue;
        }
        exports.queued += 1;
        if (!dryRun) {
          const workflowId = await queueExportWorkflow(
            ctx,
            job._id,
            job.userId
          );
          await ctx.db.patch("exportJobs", job._id, { workflowId });
        }
      }
    }

    // An import still uploading has no run yet; completing the upload
    // queues one.
    const imports = { queued: 0, skippedOpenRun: 0 };
    for (const status of ["queued", "parsing", "importing"] as const) {
      const jobs = await ctx.db
        .query("importJobs")
        .withIndex("by_status_upload_expires", (q) => q.eq("status", status))
        .take(JOB_LIMIT);
      for (const job of jobs) {
        if (await hasOpenRun(ctx, `import:${job._id}`)) {
          imports.skippedOpenRun += 1;
          continue;
        }
        imports.queued += 1;
        if (!dryRun) {
          const workflowId = await queueImportWorkflow(ctx, job._id);
          await ctx.db.patch("importJobs", job._id, { workflowId });
        }
      }
    }

    // Only deletions the old engine ran: a state without a workflow ID or
    // generation is a bare marker, not a deletion in flight.
    const accountDeletions = { queued: 0, skippedOpenRun: 0 };
    const states = await ctx.db.query("accountDeletionStates").take(JOB_LIMIT);
    for (const state of states) {
      const { generation } = state;
      if (!(state.workflowId && typeof generation === "number")) {
        continue;
      }
      if (await hasOpenRun(ctx, `accountDeletion:${state._id}:${generation}`)) {
        accountDeletions.skippedOpenRun += 1;
        continue;
      }
      accountDeletions.queued += 1;
      if (!dryRun) {
        const workflowId = await queueAccountDeletionWorkflow(ctx, {
          generation,
          stateId: state._id,
        });
        await ctx.db.patch("accountDeletionStates", state._id, { workflowId });
      }
    }

    const result = { accountDeletions, dryRun, exports, imports };
    console.log("[cutoverWorkflows] jobs", result);
    return result;
  },
});
