/**
 * Workflow Manager
 *
 * Central workflow manager instance for the card processing pipeline.
 * Configured with retry behavior for resilient AI processing.
 */

import {
  vResultValidator,
  vWorkflowId,
  type WorkflowId,
  WorkflowManager,
} from "@convex-dev/workflow";
import type { FunctionArgs, FunctionReference } from "convex/server";
import { v } from "convex/values";
import { components, internal } from "../_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  type MutationCtx,
} from "../_generated/server";
import {
  buildInitialProcessingStatus,
  stagePending,
} from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import type { CardType } from "../schema";
import type { Id } from "../shared/types";

const internalAny: any = internal as any;

/**
 * Workflow manager for card processing pipeline
 */
export const WORKFLOW_MAX_PARALLELISM = 10;
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: WORKFLOW_MAX_PARALLELISM },
});

export const WORKFLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKFLOW_CLEANUP_RETRY_MS = 24 * 60 * 60 * 1000;
export const MAX_WORKFLOW_CLEANUP_BATCH_SIZE = 100;

export const workflowRetentionOptions = (startAsync?: boolean) => ({
  onComplete: internalAny["workflows/manager"].scheduleCompletedWorkflowCleanup,
  context: null,
  ...(startAsync === undefined ? {} : { startAsync }),
});

/**
 * Start a durable workflow with Teak's canonical retention policy attached.
 * Completed workflow journals are kept for seven days, then removed.
 */
export const startWorkflow = <
  F extends FunctionReference<"mutation", "internal">,
>(
  ctx: MutationCtx | ActionCtx,
  workflowRef: F,
  args: FunctionArgs<F>["args"],
  options?: { startAsync?: boolean }
): Promise<WorkflowId> =>
  workflow.start(
    ctx,
    workflowRef,
    args,
    workflowRetentionOptions(options?.startAsync)
  );

export const scheduleCompletedWorkflowCleanupHandler = async (
  ctx: Pick<MutationCtx, "runQuery" | "scheduler">,
  workflowId: WorkflowId
): Promise<null> => {
  const { workflow: workflowRecord } = await ctx.runQuery(
    components.workflow.workflow.getStatus,
    { workflowId }
  );
  await ctx.scheduler.runAfter(
    WORKFLOW_RETENTION_MS,
    internalAny["workflows/manager"].cleanupCompletedWorkflow,
    { generationNumber: workflowRecord.generationNumber, workflowId }
  );
  return null;
};

export const scheduleCompletedWorkflowCleanup = internalMutation({
  args: {
    context: v.null(),
    result: vResultValidator,
    workflowId: vWorkflowId,
  },
  returns: v.null(),
  handler: (ctx, { workflowId }) =>
    scheduleCompletedWorkflowCleanupHandler(ctx, workflowId),
});

export const cleanupCompletedWorkflow = internalMutation({
  args: { generationNumber: v.number(), workflowId: vWorkflowId },
  returns: v.boolean(),
  handler: (ctx, { generationNumber, workflowId }) =>
    cleanupCompletedWorkflowHandler(ctx, workflowId, generationNumber),
});

export const cleanupCompletedWorkflowHandler = async (
  ctx: MutationCtx,
  workflowId: WorkflowId,
  generationNumber: number
): Promise<boolean> => {
  try {
    const { workflow: workflowRecord } = await ctx.runQuery(
      components.workflow.workflow.getStatus,
      { workflowId }
    );
    if (workflowRecord.generationNumber !== generationNumber) {
      return false;
    }
    if (!workflowRecord.runResult) {
      // A workflow still in progress past the retention horizon is stuck:
      // its steps will never finish (for example survivors of past retry
      // storms). Cancel and clean it instead of rescheduling this check
      // forever - stuck workflows keep the workpool loop hot and accumulate
      // journal state without bound.
      if (
        typeof workflowRecord._creationTime === "number" &&
        Date.now() - workflowRecord._creationTime > WORKFLOW_RETENTION_MS
      ) {
        await workflow.cancel(ctx, workflowId);
        return await workflow.cleanup(ctx, workflowId);
      }
      await ctx.scheduler.runAfter(
        WORKFLOW_CLEANUP_RETRY_MS,
        internalAny["workflows/manager"].cleanupCompletedWorkflow,
        { generationNumber, workflowId }
      );
      return false;
    }
    return await workflow.cleanup(ctx, workflowId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Workflow not found")
    ) {
      return false;
    }
    throw error;
  }
};

export const STUCK_WORKFLOW_SWEEP_PAGE_SIZE = 100;
export const STUCK_WORKFLOW_REAP_LIMIT = 50;
const STUCK_WORKFLOW_SWEEP_FOLLOW_UP_MS = 60 * 1000;

/**
 * Weekly sweep for workflows stuck in progress beyond the retention horizon.
 * Completed workflows are reaped by the per-workflow retention timer, but a
 * workflow that never finishes would otherwise live forever: it keeps the
 * workpool loop hot (the loop cannot go idle while jobs are running) and its
 * journal rows accumulate. Canceling releases the workpool and cleaning
 * deletes the journal.
 */
export const reapStuckWorkflowsHandler = async (
  ctx: ActionCtx,
  cursor: string | null = null
) => {
  const cutoff = Date.now() - WORKFLOW_RETENTION_MS;
  const page = await ctx.runQuery(components.workflow.workflow.list, {
    order: "asc",
    paginationOpts: { cursor, numItems: STUCK_WORKFLOW_SWEEP_PAGE_SIZE },
  });

  let examinedCount = 0;
  let reapedCount = 0;
  for (const entry of page.page) {
    if (reapedCount >= STUCK_WORKFLOW_REAP_LIMIT) {
      break;
    }
    if (entry.runResult !== undefined) {
      continue;
    }
    examinedCount += 1;
    try {
      const { workflow: workflowRecord } = await ctx.runQuery(
        components.workflow.workflow.getStatus,
        { workflowId: entry.workflowId }
      );
      if (
        workflowRecord.runResult !== undefined ||
        typeof workflowRecord._creationTime !== "number" ||
        workflowRecord._creationTime > cutoff
      ) {
        continue;
      }
      const workflowId = entry.workflowId as WorkflowId;
      await workflow.cancel(ctx, workflowId);
      await workflow.cleanup(ctx, workflowId);
      reapedCount += 1;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Workflow not found")
      ) {
        continue;
      }
      throw error;
    }
  }

  // Drain a large backlog in bounded follow-up runs instead of one long
  // action. Reaped workflows are deleted from the list, so when the reap
  // limit stops this run mid-page, re-reading the current page via the same
  // cursor now yields its unprocessed remainder; otherwise continue from the
  // page cursor so eligible workflows on later pages are not skipped until
  // the next weekly cron.
  if (reapedCount >= STUCK_WORKFLOW_REAP_LIMIT) {
    await ctx.scheduler.runAfter(
      STUCK_WORKFLOW_SWEEP_FOLLOW_UP_MS,
      internalAny["workflows/manager"].reapStuckWorkflows,
      cursor === null ? {} : { cursor }
    );
  } else if (!page.isDone) {
    await ctx.scheduler.runAfter(
      STUCK_WORKFLOW_SWEEP_FOLLOW_UP_MS,
      internalAny["workflows/manager"].reapStuckWorkflows,
      { cursor: page.continueCursor }
    );
  }

  return { examinedCount, reapedCount };
};

export const reapStuckWorkflows = internalAction({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({
    examinedCount: v.number(),
    reapedCount: v.number(),
  }),
  handler: async (ctx, args) =>
    await reapStuckWorkflowsHandler(ctx, args.cursor ?? null),
});

type WorkflowCleanupStatus =
  | "cleaned"
  | "eligible"
  | "inProgress"
  | "missing"
  | "noTimestamp"
  | "oversized"
  | "recent";

type WorkflowCleanupSchedulingStatus =
  | "eligible"
  | "failed"
  | "inProgress"
  | "missing"
  | "noTimestamp"
  | "oversized"
  | "scheduled";

const getWorkflowCompletionTime = (
  journalEntries: Array<{ step: { completedAt?: number } }>
): number | null => {
  const completionTimes = journalEntries.flatMap((entry) =>
    entry.step.completedAt === undefined ? [] : [entry.step.completedAt]
  );
  return completionTimes.length === 0 ? null : Math.max(...completionTimes);
};

const cleanupWorkflowHistoryEntry = async (
  ctx: ActionCtx,
  workflowId: WorkflowId,
  dryRun: boolean,
  cutoffMs: number
): Promise<WorkflowCleanupStatus> => {
  try {
    const {
      journalEntries,
      ok: completeJournalLoaded,
      workflow: workflowRecord,
    } = await ctx.runQuery(components.workflow.journal.load, {
      workflowId,
    });
    if (!workflowRecord.runResult) {
      return "inProgress";
    }
    if (!completeJournalLoaded) {
      return "oversized";
    }
    const completedAt = getWorkflowCompletionTime(journalEntries);
    if (completedAt === null) {
      return "noTimestamp";
    }
    if (completedAt >= cutoffMs) {
      return "recent";
    }
    if (dryRun) {
      return "eligible";
    }
    return (await workflow.cleanup(ctx, workflowId)) ? "cleaned" : "missing";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Workflow not found")
    ) {
      return "missing";
    }
    throw error;
  }
};

const scheduleWorkflowHistoryEntry = async (
  ctx: ActionCtx,
  workflowId: WorkflowId,
  dryRun: boolean
): Promise<WorkflowCleanupSchedulingStatus> => {
  try {
    const {
      journalEntries,
      ok: completeJournalLoaded,
      workflow: workflowRecord,
    } = await ctx.runQuery(components.workflow.journal.load, { workflowId });
    if (!workflowRecord.runResult) {
      return "inProgress";
    }
    if (!completeJournalLoaded) {
      return "oversized";
    }
    const completedAt = getWorkflowCompletionTime(journalEntries);
    if (completedAt === null) {
      return "noTimestamp";
    }
    if (dryRun) {
      return "eligible";
    }
    await ctx.scheduler.runAfter(
      Math.max(0, completedAt + WORKFLOW_RETENTION_MS - Date.now()),
      internalAny["workflows/manager"].cleanupCompletedWorkflow,
      {
        generationNumber: workflowRecord.generationNumber,
        workflowId,
      }
    );
    return "scheduled";
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("Workflow not found")
    ) {
      return "missing";
    }
    throw error;
  }
};

export const scheduleWorkflowHistoryCleanupBatchHandler = async (
  ctx: ActionCtx,
  args: { dryRun: boolean; workflowIds: WorkflowId[] }
) => {
  const workflowIds = [...new Set(args.workflowIds)];
  if (
    workflowIds.length === 0 ||
    workflowIds.length > MAX_WORKFLOW_CLEANUP_BATCH_SIZE
  ) {
    throw new Error(
      `workflowIds must contain 1-${MAX_WORKFLOW_CLEANUP_BATCH_SIZE} unique IDs`
    );
  }

  const totals: Record<WorkflowCleanupSchedulingStatus, number> = {
    eligible: 0,
    failed: 0,
    inProgress: 0,
    missing: 0,
    noTimestamp: 0,
    oversized: 0,
    scheduled: 0,
  };
  const concurrency = 10;
  for (let offset = 0; offset < workflowIds.length; offset += concurrency) {
    const results = await Promise.allSettled(
      workflowIds
        .slice(offset, offset + concurrency)
        .map((workflowId) =>
          scheduleWorkflowHistoryEntry(ctx, workflowId, args.dryRun)
        )
    );
    for (const result of results) {
      if (result.status === "rejected") {
        totals.failed += 1;
        continue;
      }
      totals[result.value] += 1;
    }
  }

  return {
    eligibleCount: totals.eligible,
    failedCount: totals.failed,
    inProgressCount: totals.inProgress,
    missingCount: totals.missing,
    noTimestampCount: totals.noTimestamp,
    oversizedCount: totals.oversized,
    scheduledCount: totals.scheduled,
    uniqueCount: workflowIds.length,
  };
};

export const cleanupWorkflowHistoryBatchHandler = async (
  ctx: ActionCtx,
  args: { cutoffMs: number; dryRun: boolean; workflowIds: WorkflowId[] }
) => {
  const workflowIds = [...new Set(args.workflowIds)];
  if (
    workflowIds.length === 0 ||
    workflowIds.length > MAX_WORKFLOW_CLEANUP_BATCH_SIZE
  ) {
    throw new Error(
      `workflowIds must contain 1-${MAX_WORKFLOW_CLEANUP_BATCH_SIZE} unique IDs`
    );
  }
  const latestAllowedCutoff = Date.now() - WORKFLOW_RETENTION_MS;
  if (
    !Number.isFinite(args.cutoffMs) ||
    args.cutoffMs < 0 ||
    args.cutoffMs > latestAllowedCutoff
  ) {
    throw new Error("cutoffMs must preserve at least seven days of history");
  }

  const totals: Record<WorkflowCleanupStatus, number> = {
    cleaned: 0,
    eligible: 0,
    inProgress: 0,
    missing: 0,
    noTimestamp: 0,
    oversized: 0,
    recent: 0,
  };
  const concurrency = 10;
  for (let offset = 0; offset < workflowIds.length; offset += concurrency) {
    const results = await Promise.allSettled(
      workflowIds
        .slice(offset, offset + concurrency)
        .map((workflowId) =>
          cleanupWorkflowHistoryEntry(
            ctx,
            workflowId,
            args.dryRun,
            args.cutoffMs
          )
        )
    );
    for (const result of results) {
      if (result.status === "rejected") {
        throw result.reason;
      }
      totals[result.value] += 1;
    }
  }

  return {
    cleanedCount: totals.cleaned,
    eligibleCount: totals.eligible,
    inProgressCount: totals.inProgress,
    missingCount: totals.missing,
    noTimestampCount: totals.noTimestamp,
    oversizedCount: totals.oversized,
    recentCount: totals.recent,
    uniqueCount: workflowIds.length,
  };
};

/**
 * Guarded maintenance endpoint for bounded, explicit workflow-history cleanup.
 * Production callers must first select IDs older than the retention cutoff and
 * validate the same batch with dryRun before deleting it.
 */
export const cleanupWorkflowHistoryBatch = internalAction({
  args: {
    cutoffMs: v.number(),
    dryRun: v.boolean(),
    workflowIds: v.array(vWorkflowId),
  },
  returns: v.object({
    cleanedCount: v.number(),
    eligibleCount: v.number(),
    inProgressCount: v.number(),
    missingCount: v.number(),
    noTimestampCount: v.number(),
    oversizedCount: v.number(),
    recentCount: v.number(),
    uniqueCount: v.number(),
  }),
  handler: cleanupWorkflowHistoryBatchHandler,
});

/**
 * Guarded transition endpoint for workflows completed before retention existed.
 * It schedules cleanup at each workflow's original seven-day deadline.
 */
export const scheduleWorkflowHistoryCleanupBatch = internalAction({
  args: { dryRun: v.boolean(), workflowIds: v.array(vWorkflowId) },
  returns: v.object({
    eligibleCount: v.number(),
    failedCount: v.number(),
    inProgressCount: v.number(),
    missingCount: v.number(),
    noTimestampCount: v.number(),
    oversizedCount: v.number(),
    scheduledCount: v.number(),
    uniqueCount: v.number(),
  }),
  handler: scheduleWorkflowHistoryCleanupBatchHandler,
});

interface CardIdentifier {
  cardId: Id<"cards">;
}

export const initializeCardProcessingStateHandler = async (
  ctx: any,
  { cardId }: any
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    throw new Error(`Card ${cardId} not found`);
  }

  const now = Date.now();
  const cardType = (card.type ?? "text") as CardType;
  const linkPreviewStatus = card.metadata?.linkPreview?.status;
  const awaitingLinkMetadata =
    cardType === "link" && linkPreviewStatus !== "success";
  const initialProcessingStatus = buildInitialProcessingStatus({
    now,
    cardType,
    classificationStatus: card.processingStatus?.classify ?? stagePending(),
  });

  await patchCardWithSearchSync(ctx, cardId, {
    aiTags: undefined,
    aiSummary: undefined,
    aiTranscript: undefined,
    processingStatus: initialProcessingStatus,
    metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
    updatedAt: now,
  });
};

/**
 * Internal mutation used to reset a card's AI fields and mark processing as pending
 * before the workflow begins executing.
 */
export const initializeCardProcessingState = internalMutation({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.null(),
  handler: initializeCardProcessingStateHandler,
});

export const startCardProcessingWorkflowHandler = async (
  ctx: any,
  { cardId }: CardIdentifier
) => {
  const workflowRef =
    internalAny["workflows/cardProcessing"].cardProcessingWorkflow;
  const workflowId = await startWorkflow(
    ctx,
    workflowRef,
    { cardId },
    { startAsync: true }
  );

  await ctx.runMutation(
    internalAny["workflows/manager"].initializeCardProcessingState,
    { cardId }
  );

  return { workflowId };
};

/**
 * Action that prepares the card and kicks off the card processing workflow.
 * Returning the workflowId allows callers to track progress if needed.
 */
export const startCardProcessingWorkflow = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: startCardProcessingWorkflowHandler,
});
