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
import {
  mergeProcessingStages,
  stagePending,
} from "../shared/processingStatus";
import {
  asDispatchRow,
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { patchCard } from "./cardWrites";
import {
  initializeCardProcessingState,
  markUnfinishedCardStagesFailed,
} from "./processingLifecycle";

/** What a card-processing dispatch row asked its run to do. */
export const cardRunParams = (
  row: Doc<"workflowDispatches">
): CardProcessingParams | null => {
  const run = asDispatchRow(row);
  return run?.kind === "cardProcessing" ? run.params : null;
};

const pendingRunToTakeOver = async (
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
const takeSnapshotWaitingAfterRun = async (
  ctx: MutationCtx,
  row: DispatchRow<"cardProcessing">
): Promise<Id<"cards"> | null> => {
  if (!row.cardId) {
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
    row.params.archiveOnly === true &&
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
const failCardRun = async (
  ctx: MutationCtx,
  row: DispatchRow<"cardProcessing">,
  error: string
): Promise<void> => {
  const { params } = row;
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
const fileCardWithoutAiTags = async (
  ctx: MutationCtx,
  row: DispatchRow<"cardProcessing">
): Promise<void> => {
  if (row.params.archiveOnly === true || row.params.articleOnly === true) {
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

export const queueCardProcessing = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  options: {
    /**
     * Only "load card", "archive page" and the article steps run: a link's
     * saved copy and the article in it.
     */
    archiveOnly?: boolean;
    /** Only "load card" and the article steps run: a link's article. */
    articleOnly?: boolean;
    delayMs?: number;
    metadataOnly?: boolean;
    refresh?: boolean;
    reset?: boolean;
  } = {}
): Promise<{ instanceId: string; rev: number } | null> => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  const replacedRow = await pendingRunToTakeOver(ctx, card);
  const replaced = replacedRow ? cardRunParams(replacedRow) : null;
  const reset = options.reset === true || replacedRow?.reset === true;
  const refresh = options.refresh === true || replaced?.refresh === true;
  const metadataOnly =
    !refresh &&
    options.metadataOnly === true &&
    (!replaced || replaced.metadataOnly === true);
  // A run that takes over a whole pending run keeps its work: it narrows to
  // the archive or the article only when the run it replaces did too, and
  // to the article alone only when neither asks for the archive.
  const narrowed = (params?: {
    archiveOnly?: boolean;
    articleOnly?: boolean;
  }) => params?.archiveOnly === true || params?.articleOnly === true;
  const narrow =
    !(reset || metadataOnly) &&
    narrowed(options) &&
    (!replaced || narrowed(replaced));
  const archiveOnly =
    narrow && (options.archiveOnly === true || replaced?.archiveOnly === true);
  const articleOnly = narrow && !archiveOnly;
  const rev = (card.processingRev ?? 0) + 1;
  await ctx.db.patch("cards", cardId, { processingRev: rev });
  const instanceId = cardProcessingInstanceId(cardId, rev);
  await insertDispatch(ctx, {
    cardId,
    delayMs: options.delayMs,
    instanceId,
    key: `card:${cardId}`,
    kind: "cardProcessing",
    params: {
      cardId,
      rev,
      ...(archiveOnly ? { archiveOnly: true as const } : {}),
      ...(articleOnly ? { articleOnly: true as const } : {}),
      ...(metadataOnly ? { metadataOnly: true as const } : {}),
      ...(refresh ? { refresh: true as const } : {}),
    },
    rev,
    ...(reset ? { reset: true as const } : {}),
  });
  return { instanceId, rev };
};

/** Earlier runs of the same card the Worker may still be running. */
const previousSentInstances = async (
  ctx: MutationCtx,
  row: DispatchRow<"cardProcessing">
): Promise<string[]> => {
  const earlier = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) =>
      q.eq("key", row.key).lt("createdAt", row.createdAt + 1)
    )
    .order("desc")
    .take(20);
  return earlier
    .filter(
      (other) =>
        other._id !== row._id &&
        other.state === "sent" &&
        other.instanceId !== undefined
    )
    .map((other) => other.instanceId as string);
};

export const cardProcessingDispatch: DispatchKindSpec<"cardProcessing"> = {
  delivery: "workflow",
  onFailure: failCardRun,
  onRunEnded: async (ctx, row, status) => {
    if (status === "complete") {
      const waiting = await takeSnapshotWaitingAfterRun(ctx, row);
      if (waiting) {
        await queueCardProcessing(ctx, waiting, { archiveOnly: true });
      }
    }
    await fileCardWithoutAiTags(ctx, row);
  },
  // A run a newer save superseded, or whose card is gone, never starts.
  prepare: async (ctx, row) => {
    const card = await ctx.db.get("cards", row.params.cardId);
    if (!card || (card.processingRev ?? 0) !== row.rev) {
      return { skip: card ? "superseded" : "card_missing" };
    }
    if (row.reset) {
      await initializeCardProcessingState(ctx, card._id, {
        refresh: row.params.refresh === true,
      });
    }
    return { terminate: await previousSentInstances(ctx, row) };
  },
  staleAfterMs: 60 * 60 * 1000,
  workflow: "card-processing",
};
