/**
 * A card's processing runs in the dispatch queue: which one is current, and
 * what follows it.
 */

import { cardProcessingInstanceId } from "@teak/files-protocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pageArchiveSkipReason } from "../shared/pageArchive";
import { mergeProcessingStages, stagePending } from "./processingStatus";
import { patchCardWithSearchSync } from "./searchSync";

/** The card's current run while it still waits to be sent, or null. */
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
 * Background runs waiting or in flight, counted up to `limit`: how busy the
 * dispatcher is, so a backfill can wait instead of crowding out new saves.
 */
export const readDispatchQueueDepth = async (
  ctx: QueryCtx,
  limit: number
): Promise<number> => {
  const pending = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_notBefore", (q) => q.eq("state", "pending"))
    .take(limit);
  if (pending.length >= limit) {
    return pending.length;
  }
  const sent = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_state_and_sentAt", (q) => q.eq("state", "sent"))
    .take(limit - pending.length);
  return pending.length + sent.length;
};

/**
 * A page the extension sent while a run was going gets its saved copy once
 * that run ends, when the run didn't make the copy from it: a metadata-only
 * run never archives, and a full run may have read the card before the page
 * arrived. An archive-only run gets one too when the page came after it was
 * sent, between recording its copy and ending. Returns the card to queue an
 * archive-only run for, with its archive stage set back to pending.
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
  const params = (row.params ?? {}) as Record<string, unknown>;
  if (
    params.archiveOnly === true &&
    (card.pendingPageSnapshotAt ?? 0) <= (row.sentAt ?? row._creationTime)
  ) {
    return null;
  }
  await patchCardWithSearchSync(ctx, card._id, {
    processingStatus: mergeProcessingStages(card.processingStatus, {
      archive: stagePending(),
    }),
  });
  return card._id;
};
