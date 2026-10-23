import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { MAX_FOLDERS_PER_CARD } from "../shared/folders";
import { MAX_CARD_TAGS } from "../shared/tags";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
// A card's own tags plus its AI tags, each with one row.
const MAX_TAG_ROWS_PER_CARD = MAX_CARD_TAGS * 2;

const totalsValidator = v.object({
  examined: v.number(),
  cardsToUpdate: v.number(),
  folderRowsToUpdate: v.number(),
  tagRowsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Sets `cards.savedAt` to `createdAt` where it is missing, and copies the
 * card's `savedAt` into its folder rows and tag rows, so the `…_saved`
 * indexes hold every card before "Newest first" moves to them. Dry run by
 * default; delete it once it has run in production.
 */
export const backfillSavedAt = internalMutation({
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
    const page = await ctx.db
      .query("cards")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = {
      examined: 0,
      cardsToUpdate: 0,
      folderRowsToUpdate: 0,
      tagRowsToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const card of page.page) {
      batch.examined += 1;
      const savedAt = card.savedAt ?? card.createdAt;
      const [folderRows, tagRows] = await Promise.all([
        card.folderIds?.length
          ? ctx.db
              .query("folderCards")
              .withIndex("by_cardId_and_folderId", (q) =>
                q.eq("cardId", card._id)
              )
              .take(MAX_FOLDERS_PER_CARD * 2)
          : [],
        ctx.db
          .query("cardSearchTags")
          .withIndex("by_cardId_and_tag", (q) => q.eq("cardId", card._id))
          .take(MAX_TAG_ROWS_PER_CARD),
      ]);
      const staleFolderRows = folderRows.filter(
        (row) => row.cardSavedAt !== savedAt
      );
      const staleTagRows = tagRows.filter((row) => row.cardSavedAt !== savedAt);
      const cardChanges = card.savedAt === undefined;
      if (!(cardChanges || staleFolderRows.length || staleTagRows.length)) {
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (cardChanges) {
        batch.cardsToUpdate += 1;
      }
      batch.folderRowsToUpdate += staleFolderRows.length;
      batch.tagRowsToUpdate += staleTagRows.length;
      if (dryRun) {
        continue;
      }
      if (cardChanges) {
        await ctx.db.patch("cards", card._id, { savedAt });
      }
      for (const row of staleFolderRows) {
        await ctx.db.patch("folderCards", row._id, { cardSavedAt: savedAt });
      }
      for (const row of staleTagRows) {
        await ctx.db.patch("cardSearchTags", row._id, {
          cardSavedAt: savedAt,
        });
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      cardsToUpdate: 0,
      folderRowsToUpdate: 0,
      tagRowsToUpdate: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      cardsToUpdate: previous.cardsToUpdate + batch.cardsToUpdate,
      folderRowsToUpdate:
        previous.folderRowsToUpdate + batch.folderRowsToUpdate,
      tagRowsToUpdate: previous.tagRowsToUpdate + batch.tagRowsToUpdate,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillSavedAt"].backfillSavedAt,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("backfillSavedAt finished", { dryRun, ...totals });
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
