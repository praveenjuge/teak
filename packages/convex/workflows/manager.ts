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
import type { CardType } from "../schema";
import type { Id } from "../shared/types";

const internalAny: any = internal as any;

/**
 * Workflow manager for card processing pipeline
 */
export const workflow = new WorkflowManager(components.workflow);

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

type WorkflowCleanupStatus =
  | "cleaned"
  | "eligible"
  | "inProgress"
  | "missing"
  | "oversized"
  | "recent";

type WorkflowCleanupSchedulingStatus =
  | "eligible"
  | "inProgress"
  | "missing"
  | "oversized"
  | "scheduled";

const getWorkflowCompletionTime = (
  workflowRecord: { _creationTime: number },
  journalEntries: Array<{ step: { completedAt?: number } }>
): number => {
  const completionTimes = journalEntries.flatMap((entry) =>
    entry.step.completedAt === undefined ? [] : [entry.step.completedAt]
  );
  return completionTimes.length === 0
    ? workflowRecord._creationTime
    : Math.max(...completionTimes);
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
    const completedAt = getWorkflowCompletionTime(
      workflowRecord,
      journalEntries
    );
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
    const completedAt = getWorkflowCompletionTime(
      workflowRecord,
      journalEntries
    );
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
    inProgress: 0,
    missing: 0,
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
        throw result.reason;
      }
      totals[result.value] += 1;
    }
  }

  return {
    eligibleCount: totals.eligible,
    inProgressCount: totals.inProgress,
    missingCount: totals.missing,
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
    inProgressCount: v.number(),
    missingCount: v.number(),
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

  await ctx.db.patch("cards", cardId, {
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
