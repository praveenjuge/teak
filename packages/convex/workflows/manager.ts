import {
  vResultValidator,
  vWorkflowId,
  type WorkflowId,
  WorkflowManager,
} from "@convex-dev/workflow";
import {
  type FunctionArgs,
  type FunctionReference,
  getFunctionName,
} from "convex/server";
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
  type ProcessingStageKey,
  type ProcessingStatus,
  stageFailed,
  stagePending,
} from "../card/processingStatus";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import type { CardType } from "../schema";
import type { Id } from "../shared/types";
import { collectWorkflowArtifacts } from "../storage/workflowArtifacts";
import { scheduleCardProcessingFailed } from "../telemetry/schedule";

const internalAny: any = internal as any;

export const WORKFLOW_MAX_PARALLELISM = 10;
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: { maxParallelism: WORKFLOW_MAX_PARALLELISM },
});

export const WORKFLOW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKFLOW_CLEANUP_RETRY_MS = 24 * 60 * 60 * 1000;
export const MAX_WORKFLOW_CLEANUP_BATCH_SIZE = 100;

const processingStageKeyValidator = v.union(
  v.literal("classify"),
  v.literal("categorize"),
  v.literal("metadata"),
  v.literal("renderables")
);

// Workflows started before card-stage contexts existed complete with `null`.
const workflowCompletionContextValidator = v.union(
  v.null(),
  v.object({
    cardId: v.id("cards"),
    stages: v.array(processingStageKeyValidator),
  })
);

interface CardStageCompletionContext {
  cardId: Id<"cards">;
  stages: ProcessingStageKey[];
}

const CARD_STAGES_BY_WORKFLOW: Record<string, ProcessingStageKey[]> = {
  "workflows/cardProcessing:cardProcessingWorkflow": [
    "classify",
    "categorize",
    "metadata",
    "renderables",
  ],
  "workflows/aiMetadata/index:aiMetadataWorkflow": ["metadata"],
};

export const resolveWorkflowCompletionContext = (
  workflowRef: FunctionReference<"mutation", "internal">,
  args: unknown
): CardStageCompletionContext | null => {
  let name: string;
  try {
    name = getFunctionName(workflowRef);
  } catch {
    return null;
  }
  const stages = CARD_STAGES_BY_WORKFLOW[name];
  const cardId =
    args && typeof args === "object"
      ? (args as { cardId?: unknown }).cardId
      : undefined;
  return stages && typeof cardId === "string"
    ? { cardId: cardId as Id<"cards">, stages }
    : null;
};

export const workflowRetentionOptions = (
  startAsync?: boolean,
  context: CardStageCompletionContext | null = null
) => ({
  onComplete: internalAny["workflows/manager"].scheduleCompletedWorkflowCleanup,
  context,
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
    workflowRetentionOptions(
      options?.startAsync,
      resolveWorkflowCompletionContext(workflowRef, args)
    )
  );

export const scheduleCompletedWorkflowCleanupHandler = async (
  ctx:
    | Pick<MutationCtx, "runQuery" | "scheduler">
    | Pick<ActionCtx, "runQuery" | "scheduler">,
  workflowId: WorkflowId
): Promise<null> => {
  const { workflow: workflowRecord } = await ctx.runQuery(
    components.workflow.workflow.getStatus,
    { workflowId }
  );
  await ctx.scheduler.runAfter(
    WORKFLOW_RETENTION_MS,
    internalAny["workflows/manager"].cleanupCompletedWorkflow,
    {
      generationNumber: workflowRecord.generationNumber,
      workflowId,
      ...(workflowRecord.runResult ? { terminalObservedAt: Date.now() } : {}),
    }
  );
  return null;
};

const UNFINISHED_STAGE_STATUSES = new Set(["pending", "in_progress"]);

/**
 * Mark the stages a failed or canceled card workflow still owned as failed.
 * Stages another run already finished (completed or failed) are left as-is.
 */
export const markUnfinishedCardStagesFailed = async (
  ctx: MutationCtx,
  context: CardStageCompletionContext,
  error: string
): Promise<boolean> => {
  const card = await ctx.db.get("cards", context.cardId);
  if (!card) {
    return false;
  }
  const now = Date.now();
  const current: ProcessingStatus = card.processingStatus ?? {};
  const failedStages: ProcessingStatus = {};
  for (const stage of context.stages) {
    const status = current[stage];
    if (status && UNFINISHED_STAGE_STATUSES.has(status.status)) {
      failedStages[stage] = stageFailed(now, error, status);
    }
  }
  if (Object.keys(failedStages).length === 0) {
    return false;
  }
  await patchCardWithSearchSync(ctx, context.cardId, {
    processingStatus: { ...current, ...failedStages },
    updatedAt: now,
  });
  await scheduleCardProcessingFailed(ctx, {
    cardType: card.type,
    errorClass: error,
    stage: Object.keys(failedStages)[0] ?? "unknown",
    userId: card.userId,
  });
  return true;
};

export const scheduleCompletedWorkflowCleanup = internalMutation({
  args: {
    context: workflowCompletionContextValidator,
    result: vResultValidator,
    workflowId: vWorkflowId,
  },
  returns: v.null(),
  handler: async (ctx, { context, result, workflowId }) => {
    if (context && result.kind !== "success") {
      await markUnfinishedCardStagesFailed(
        ctx,
        context,
        result.kind === "canceled" ? "workflow_canceled" : "workflow_failed"
      );
    }
    return await scheduleCompletedWorkflowCleanupHandler(ctx, workflowId);
  },
});

export const cleanupCompletedWorkflow = internalMutation({
  args: {
    generationNumber: v.number(),
    workflowId: vWorkflowId,
    terminalObservedAt: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: (ctx, { generationNumber, workflowId, terminalObservedAt }) =>
    cleanupCompletedWorkflowHandler(
      ctx,
      workflowId,
      generationNumber,
      terminalObservedAt
    ),
});

export const cleanupCompletedWorkflowHandler = async (
  ctx: MutationCtx,
  workflowId: WorkflowId,
  generationNumber: number,
  terminalObservedAt?: number
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
      if (
        typeof workflowRecord._creationTime === "number" &&
        Date.now() - workflowRecord._creationTime > WORKFLOW_RETENTION_MS
      ) {
        await workflow.cancel(ctx, workflowId);
        await scheduleCompletedWorkflowCleanupHandler(ctx, workflowId);
        return false;
      }
      await ctx.scheduler.runAfter(
        WORKFLOW_CLEANUP_RETRY_MS,
        internalAny["workflows/manager"].cleanupCompletedWorkflow,
        { generationNumber, workflowId }
      );
      return false;
    }
    const journal = await ctx.runQuery(components.workflow.journal.load, {
      workflowId,
    });
    if (
      journal.workflow.generationNumber !== generationNumber ||
      !journal.workflow.runResult ||
      journal.workflow.args?.cardId !== workflowRecord.args?.cardId
    ) {
      return false;
    }
    // Old scheduled jobs have no terminal timestamp. Canceled or failed workflows may
    // have no completed steps, and their last step can predate termination.
    // Oversized journals likewise need an observation-based grace period.
    const completedAt =
      journal.ok && workflowRecord.runResult.kind === "success"
        ? getWorkflowCompletionTime(journal.journalEntries)
        : null;
    const observedAt =
      terminalObservedAt !== undefined &&
      Number.isFinite(terminalObservedAt) &&
      terminalObservedAt >= 0 &&
      terminalObservedAt <= Date.now()
        ? terminalObservedAt
        : undefined;
    const retentionStart = Math.max(
      observedAt ?? completedAt ?? Date.now(),
      completedAt ?? 0
    );
    if (Date.now() - retentionStart < WORKFLOW_RETENTION_MS) {
      await ctx.scheduler.runAfter(
        retentionStart + WORKFLOW_RETENTION_MS - Date.now(),
        internalAny["workflows/manager"].cleanupCompletedWorkflow,
        { generationNumber, workflowId, terminalObservedAt: retentionStart }
      );
      return false;
    }
    const references = journal.ok
      ? collectWorkflowArtifacts(journal.journalEntries, {
          cardId: workflowRecord.args?.cardId ?? "",
          workflowId,
          generationNumber,
        })
      : [];
    const cleaned = await workflow.cleanup(ctx, workflowId);
    if (cleaned && workflowRecord.args?.cardId) {
      await ctx.scheduler.runAfter(
        0,
        internalAny.storage.workflowArtifacts.deleteRetainedArtifacts,
        {
          references,
          cardId: workflowRecord.args.cardId,
          workflowId,
          generationNumber,
        }
      );
    }
    return cleaned;
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
      await scheduleCompletedWorkflowCleanupHandler(ctx, workflowId);
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
    return (await ctx.runMutation(
      internalAny["workflows/manager"].cleanupCompletedWorkflow,
      { workflowId, generationNumber: workflowRecord.generationNumber }
    ))
      ? "cleaned"
      : "missing";
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
    const completedAt =
      completeJournalLoaded && workflowRecord.runResult.kind === "success"
        ? getWorkflowCompletionTime(journalEntries)
        : null;
    if (dryRun) {
      return "eligible";
    }
    const terminalObservedAt = completedAt ?? Date.now();
    await ctx.scheduler.runAfter(
      Math.max(0, terminalObservedAt + WORKFLOW_RETENTION_MS - Date.now()),
      internalAny["workflows/manager"].cleanupCompletedWorkflow,
      {
        generationNumber: workflowRecord.generationNumber,
        workflowId,
        terminalObservedAt,
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

interface CardProcessingStart {
  cardId: Id<"cards">;
  // A person asked to refresh the card, so cached link details are re-read.
  refresh?: boolean;
}

export const initializeCardProcessingStateHandler = async (
  ctx: any,
  { cardId, refresh }: any
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    throw new Error(`Card ${cardId} not found`);
  }

  const now = Date.now();
  const cardType = (card.type ?? "text") as CardType;
  const linkPreviewStatus = card.metadata?.linkPreview?.status;
  // A refresh fetches the link preview again even when the stored one worked.
  const awaitingLinkMetadata =
    cardType === "link" && (refresh || linkPreviewStatus !== "success");
  const initialProcessingStatus = buildInitialProcessingStatus({
    now,
    cardType,
    classificationStatus: card.processingStatus?.classify ?? stagePending(),
  });

  await patchCardWithSearchSync(ctx, cardId, {
    aiTags: undefined,
    aiSummary: undefined,
    aiTranscript: undefined,
    aiBackfillAttempts: undefined,
    processingStatus: initialProcessingStatus,
    metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
    updatedAt: now,
  });
};

export const initializeCardProcessingState = internalMutation({
  args: {
    cardId: v.id("cards"),
    refresh: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: initializeCardProcessingStateHandler,
});

export const startCardProcessingWorkflowHandler = async (
  ctx: any,
  { cardId, refresh }: CardProcessingStart
) => {
  const workflowRef =
    internalAny["workflows/cardProcessing"].cardProcessingWorkflow;
  const workflowId = await startWorkflow(
    ctx,
    workflowRef,
    refresh ? { cardId, refresh } : { cardId },
    { startAsync: true }
  );

  await ctx.runMutation(
    internalAny["workflows/manager"].initializeCardProcessingState,
    refresh ? { cardId, refresh } : { cardId }
  );

  return { workflowId };
};

export const startCardProcessingWorkflow = internalAction({
  args: {
    cardId: v.id("cards"),
    refresh: v.optional(v.boolean()),
  },
  returns: v.object({
    workflowId: v.string(),
  }),
  handler: startCardProcessingWorkflowHandler,
});
