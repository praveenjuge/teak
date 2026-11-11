import { cardTypeStages } from "@teak/files-protocol";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { CardType } from "../shared/constants";
import { pageArchiveSkipReason } from "../shared/pageArchive";
import {
  buildInitialProcessingStatus,
  type ProcessingStageKey,
  type ProcessingStatus,
  stageFailed,
  stagePending,
} from "../shared/processingStatus";
import type { Id } from "../shared/types";
import { queueCardProcessingFailed } from "../telemetry/schedule";
import { patchCard } from "./cardWrites";
import { clearCardTranscript } from "./textContents";

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
  const cardType = card.type;
  const awaitingLinkMetadata =
    cardType === "link" &&
    (options.refresh === true ||
      card.metadata?.linkPreview?.status !== "success");
  await patchCard(ctx, cardId, {
    aiTags: undefined,
    aiSummary: undefined,
    aiLanguage: undefined,
    ...(await clearCardTranscript(ctx, card)),
    aiOcrText: undefined,
    ocrCheckedAt: undefined,
    aiBackfillAttempts: undefined,
    processingStatus: buildInitialProcessingStatus({
      archive: archiveStageAfterReset(card, cardType, options),
      cardType,
      classificationStatus: card.processingStatus?.classify ?? stagePending(),
      now,
    }),
    metadataStatus: awaitingLinkMetadata ? "pending" : "completed",
    updatedAt: now,
  });
  return true;
};

/**
 * A reset keeps the archive and article stages, since a run that has nothing to archive
 * leaves it alone. Refresh details archives the page again, so for a link it
 * starts over as pending, except on a highlighted link, whose copy stays.
 */
const archiveStageAfterReset = (
  card: Doc<"cards">,
  cardType: CardType,
  options: { refresh?: boolean }
): Pick<ProcessingStatus, "archive" | "article"> => {
  // The article is taken from the copy again with it, unless highlights
  // froze them both.
  if (
    options.refresh === true &&
    cardTypeStages(cardType).archive &&
    pageArchiveSkipReason(card, { refresh: true }) !== "frozen"
  ) {
    return { archive: stagePending(), article: stagePending() };
  }
  const { archive, article } = card.processingStatus ?? {};
  return { ...(archive ? { archive } : {}), ...(article ? { article } : {}) };
};

const UNFINISHED_STAGE_STATUSES = new Set(["pending", "in_progress"]);

export const markUnfinishedCardStagesFailed = async (
  ctx: MutationCtx,
  context: { cardId: Id<"cards">; stages: readonly ProcessingStageKey[] },
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
  await patchCard(ctx, context.cardId, {
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
