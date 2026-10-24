import type { MutationCtx } from "../_generated/server";
import type { CardType } from "../schema";
import type { Id } from "../shared/types";
import { queueCardProcessingFailed } from "../telemetry/schedule";
import {
  buildInitialProcessingStatus,
  type ProcessingStageKey,
  type ProcessingStatus,
  shouldRunArchiveStage,
  stageFailed,
  stagePending,
} from "./processingStatus";
import { patchCardWithSearchSync } from "./searchSync";
import { clearCardTranscript } from "./textContents";

export const CARD_PROCESSING_STAGES: ProcessingStageKey[] = [
  "classify",
  "categorize",
  "metadata",
  "renderables",
  "screenshot",
];

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
  const awaitingLinkMetadata =
    cardType === "link" &&
    (options.refresh === true ||
      card.metadata?.linkPreview?.status !== "success");
  await patchCardWithSearchSync(ctx, cardId, {
    aiTags: undefined,
    aiSummary: undefined,
    aiLanguage: undefined,
    ...(await clearCardTranscript(ctx, card)),
    aiOcrText: undefined,
    ocrCheckedAt: undefined,
    aiBackfillAttempts: undefined,
    processingStatus: {
      ...buildInitialProcessingStatus({
        now,
        cardType,
        classificationStatus: card.processingStatus?.classify ?? stagePending(),
      }),
      ...archiveStageAfterReset(card, cardType, options),
    },
    metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
    updatedAt: now,
  });
  return true;
};

/**
 * A reset keeps the archive and article stages, since a run that has nothing to archive
 * leaves it alone. Refresh details archives the page again, so for a link it
 * starts over as pending.
 */
const archiveStageAfterReset = (
  card: { processingStatus?: ProcessingStatus },
  cardType: CardType,
  options: { refresh?: boolean }
): Pick<ProcessingStatus, "archive" | "article"> => {
  // The article is taken from the copy again with it.
  if (options.refresh === true && shouldRunArchiveStage(cardType)) {
    return { archive: stagePending(), article: stagePending() };
  }
  const { archive, article } = card.processingStatus ?? {};
  return { ...(archive ? { archive } : {}), ...(article ? { article } : {}) };
};

const UNFINISHED_STAGE_STATUSES = new Set(["pending", "in_progress"]);

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
  await queueCardProcessingFailed(ctx, {
    cardType: card.type,
    errorClass: error,
    stage: Object.keys(failedStages)[0] ?? "unknown",
    userId: card.userId,
  });
  return true;
};
