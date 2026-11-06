import {
  CARD_RUN_STAGES,
  type CardProcessingParams,
  cardProcessingInstanceId,
} from "@teak/files-protocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { applyAutoFileRulesToCard } from "../folder/rules";
import { articleSkipReason } from "../shared/article";
import { pageArchiveSkipReason } from "../shared/pageArchive";
import { queueCardProcessing } from "../workflowDispatch";
import { patchCard } from "./cardWrites";
import { markUnfinishedCardStagesFailed } from "./processingLifecycle";
import { mergeProcessingStages, stagePending } from "./processingStatus";

/** What a card-processing dispatch row asked its run to do. */
export const cardRunParams = (
  row: Pick<Doc<"workflowDispatches">, "kind" | "params">
): CardProcessingParams | null =>
  row.kind === "cardProcessing" && row.params && "rev" in row.params
    ? row.params
    : null;

export const pendingRunToTakeOver = async (
  ctx: MutationCtx,
  card: Doc<"cards">
): Promise<Doc<"workflowDispatches"> | null> => {
  const currentRev = card.processingRev;
  if (!currentRev) {
    return null;
  }
  const currentRun = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_instanceId", (q) =>
      q.eq("instanceId", cardProcessingInstanceId(card._id, currentRev))
    )
    .first();
  return currentRun?.state === "pending" ? currentRun : null;
};

/**
 * True while the card's current run has been handed to the Worker and hasn't
 * finished. A new run would replace it and drop the work it hasn't done.
 */
export const isCardRunInFlight = async (
  ctx: MutationCtx,
  card: Doc<"cards">
): Promise<boolean> => {
  const rev = card.processingRev;
  if (!rev) {
    return false;
  }
  const currentRun = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_instanceId", (q) =>
      q.eq("instanceId", cardProcessingInstanceId(card._id, rev))
    )
    .first();
  return currentRun?.state === "sent";
};

/**
 * A page the extension sent while a run was going gets its saved copy once
 * that run ends, when the run didn't make the copy from it: a metadata-only
 * run never archives, and a full run may have read the card before the page
 * arrived. An archive-only run gets one too when the page came after it was
 * sent, between recording its copy and ending. Returns the card to queue an
 * archive-only run for, with its archive and article stages set back to
 * pending.
 */
export const takeSnapshotWaitingAfterRun = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">
): Promise<Id<"cards"> | null> => {
  if (row.kind !== "cardProcessing" || !row.cardId) {
    return null;
  }
  const card = await ctx.db.get("cards", row.cardId);
  if (
    !card ||
    (card.processingRev ?? 0) !== row.rev ||
    card.pendingPageSnapshotKey === undefined ||
    pageArchiveSkipReason(card) !== null
  ) {
    return null;
  }
  // An archive-only run already tried every page that came before it was
  // sent; only one that came later gets another run, so a page that can't
  // be saved isn't retried forever.
  if (
    cardRunParams(row)?.archiveOnly === true &&
    (card.pendingPageSnapshotAt ?? 0) <= (row.sentAt ?? row._creationTime)
  ) {
    return null;
  }
  await patchCard(ctx, card._id, {
    processingStatus: mergeProcessingStages(card.processingStatus, {
      archive: stagePending(),
      article: stagePending(),
    }),
  });
  return card._id;
};

/**
 * A card run that died fails its unfinished stages. A link whose run ended
 * before its last step still gets its saved copy, from a run of its own: a
 * page that can't be fetched then fails only that stage. The same goes for
 * the article in a copy the run didn't reach. A narrowed run that fails
 * just fails its stages.
 */
export const failCardRun = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  params: CardProcessingParams,
  error: string
): Promise<void> => {
  const card = row.cardId ? await ctx.db.get("cards", row.cardId) : null;
  if (!card || (card.processingRev ?? 0) !== row.rev) {
    return;
  }
  const refresh = params.refresh === true;
  const narrowed = params.archiveOnly === true || params.articleOnly === true;
  const archiveSeparately =
    !narrowed && pageArchiveSkipReason(card, { refresh }) === null;
  const articleSeparately =
    !(narrowed || archiveSeparately) &&
    articleSkipReason(card, { refresh }) === null;
  await markUnfinishedCardStagesFailed(
    ctx,
    {
      cardId: card._id,
      stages: [
        ...CARD_RUN_STAGES,
        ...(archiveSeparately ? [] : (["archive"] as const)),
        ...(archiveSeparately || articleSeparately
          ? []
          : (["article"] as const)),
      ],
    },
    error
  );
  if (archiveSeparately || articleSeparately) {
    await queueCardProcessing(ctx, card._id, {
      ...(archiveSeparately ? { archiveOnly: true } : { articleOnly: true }),
      ...(refresh ? { refresh: true } : {}),
    });
  }
};

/**
 * Folder rules run when a card's AI tags are written (`updateCardAI`). A
 * card whose run ended without them, because AI failed or had nothing to
 * say, is filed here with what it has. One waiting on the AI backfill isn't:
 * its tags still come.
 */
export const fileCardWithoutAiTags = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  params: CardProcessingParams
): Promise<void> => {
  if (params.archiveOnly === true || params.articleOnly === true) {
    return;
  }
  const card = row.cardId ? await ctx.db.get("cards", row.cardId) : null;
  if (
    !card ||
    card.isDeleted === true ||
    // A failed run may have queued an archive or article run after it,
    // which moves the revision on but leaves AI as it was.
    (card.processingRev ?? 0) < (row.rev ?? 0) ||
    card.aiTags !== undefined
  ) {
    return;
  }
  const metadata = card.processingStatus?.metadata?.status;
  if (metadata !== "pending" && metadata !== "in_progress") {
    await applyAutoFileRulesToCard(ctx, card._id);
  }
};
