import type { MutationCtx } from "../_generated/server";
import type { CardType } from "../schema";
import type { Id } from "../shared/types";
import { scheduleCardProcessingFailed } from "../telemetry/schedule";
import {
  buildInitialProcessingStatus,
  type ProcessingStageKey,
  type ProcessingStatus,
  stageFailed,
  stagePending,
} from "./processingStatus";
import { patchCardWithSearchSync } from "./searchDocumentHelpers";

/** Every stage a card-processing run can leave unfinished. */
export const CARD_PROCESSING_STAGES: ProcessingStageKey[] = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
  "screenshot",
];

/**
 * Clears a card's AI output and resets its stages before a new processing
 * run, keeping a classification that already completed.
 */
export const initializeCardProcessingState = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  options: { refresh?: boolean } = {}
): Promise<boolean> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return false;
  }
  const now = Date.now();
  const cardType = (card.type ?? "text") as CardType;
  // A refresh fetches the link preview again even when the stored one worked.
  const awaitingLinkMetadata =
    cardType === "link" &&
    (options.refresh === true ||
      card.metadata?.linkPreview?.status !== "success");
  await patchCardWithSearchSync(ctx, cardId, {
    aiTags: undefined,
    aiSummary: undefined,
    aiTranscript: undefined,
    aiOcrText: undefined,
    ocrCheckedAt: undefined,
    aiBackfillAttempts: undefined,
    processingStatus: buildInitialProcessingStatus({
      now,
      cardType,
      classificationStatus: card.processingStatus?.classify ?? stagePending(),
    }),
    metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
    updatedAt: now,
  });
  return true;
};

const UNFINISHED_STAGE_STATUSES = new Set(["pending", "in_progress"]);

/**
 * Marks the stages a failed or stopped run still owned as failed. Stages
 * that already finished, completed or failed, are left as they are.
 */
export const markUnfinishedCardStagesFailed = async (
  ctx: MutationCtx,
  context: { cardId: Id<"cards">; stages: ProcessingStageKey[] },
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
