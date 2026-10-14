import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { newShuffleKey } from "../card/shuffle";

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

const totalsValidator = v.object({
  examined: v.number(),
  cardsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Gives every card saved before Shuffle its random `shuffleKey` (new cards
 * get one when saved, and the key never changes). Cards that already have
 * one are left alone, so a rerun changes nothing. A dry run (the default)
 * writes nothing and reports what a real run would change. Each batch
 * schedules the next until the table is done, and the last one logs the
 * totals. Until it finishes, Shuffle reads cards without a key as if their
 * key were the lowest, so none are missed.
 *
 *   npx convex run migration/backfillShuffleKey:backfillShuffleKey
 *   npx convex run migration/backfillShuffleKey:backfillShuffleKey '{"dryRun":false}'
 */
export const backfillShuffleKey = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
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
    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = { examined: 0, cardsToUpdate: 0, skippedDeletingAccounts: 0 };
    const deletingAccounts = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      if (card.shuffleKey !== undefined) {
        continue;
      }
      // Account deletion owns these rows while it runs; writing would race
      // its batches.
      let deleting = deletingAccounts.get(card.userId);
      if (deleting === undefined) {
        deleting = Boolean(await getAccountDeletionState(ctx, card.userId));
        deletingAccounts.set(card.userId, deleting);
      }
      if (deleting) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.cardsToUpdate += 1;
      if (!dryRun) {
        await ctx.db.patch("cards", card._id, { shuffleKey: newShuffleKey() });
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      cardsToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      cardsToUpdate: previous.cardsToUpdate + batch.cardsToUpdate,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillShuffleKey"].backfillShuffleKey,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillShuffleKey finished", { dryRun, ...totals });
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
