import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchSync";
import { CLEARED_TRANSCRIPT, storeCardTranscript } from "../card/textContents";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
// A transcript is up to 512 KB; the page stops reading here so its rows'
// writes stay as small as its reads.
const MAX_BYTES_READ = 4 * 1024 * 1024;

const totalsValidator = v.object({
  examined: v.number(),
  transcriptsToMove: v.number(),
  emptyTranscriptsToClear: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Moves transcripts saved on cards into `cardTextContents`, leaving the card
 * its length and a preview. Search text is unchanged: it is built from the
 * rows the same way.
 */
export const moveCardTranscripts = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    batch: totalsValidator,
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const page = await ctx.db.query("cards").paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
      maximumBytesRead: MAX_BYTES_READ,
    });

    const batch = {
      examined: 0,
      transcriptsToMove: 0,
      emptyTranscriptsToClear: 0,
      skippedDeletingAccounts: 0,
    };
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const card of page.page) {
      batch.examined += 1;
      if (card.aiTranscript === undefined) {
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (card.aiTranscript === "") {
        batch.emptyTranscriptsToClear += 1;
        if (!dryRun) {
          await patchCardWithSearchSync(ctx, card._id, CLEARED_TRANSCRIPT);
        }
        continue;
      }
      batch.transcriptsToMove += 1;
      if (!dryRun) {
        await ctx.db.patch(
          "cards",
          card._id,
          await storeCardTranscript(ctx, card, card.aiTranscript)
        );
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      transcriptsToMove: 0,
      emptyTranscriptsToClear: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      transcriptsToMove: previous.transcriptsToMove + batch.transcriptsToMove,
      emptyTranscriptsToClear:
        previous.emptyTranscriptsToClear + batch.emptyTranscriptsToClear,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/moveCardTranscripts"].moveCardTranscripts,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("moveCardTranscripts finished", { dryRun, ...totals });
    }
    return {
      dryRun,
      isDone,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      batch,
      totals,
    };
  },
});
