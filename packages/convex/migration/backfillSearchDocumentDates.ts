import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const totalsValidator = v.object({
  examined: v.number(),
  searchDocumentsToUpdate: v.number(),
  missingCards: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Copies each card's `createdAt` and `_creationTime` onto its search
 * document, so text search orders matches without loading their cards.
 */
export const backfillSearchDocumentDates = internalMutation({
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
      .query("cardSearchDocuments")
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = {
      examined: 0,
      searchDocumentsToUpdate: 0,
      missingCards: 0,
      skippedDeletingAccounts: 0,
    };
    const accountDeleting = createAccountDeletionGate(ctx);
    const cards = await Promise.all(
      page.page.map((document) => ctx.db.get("cards", document.cardId))
    );
    for (const [index, document] of page.page.entries()) {
      batch.examined += 1;
      const card = cards[index];
      if (!card) {
        batch.missingCards += 1;
        continue;
      }
      if (
        document.cardCreatedAt === card.createdAt &&
        document.cardCreationTime === card._creationTime
      ) {
        continue;
      }
      if (await accountDeleting(document.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.searchDocumentsToUpdate += 1;
      if (!dryRun) {
        await ctx.db.patch("cardSearchDocuments", document._id, {
          cardCreatedAt: card.createdAt,
          cardCreationTime: card._creationTime,
        });
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      searchDocumentsToUpdate: 0,
      missingCards: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      searchDocumentsToUpdate:
        previous.searchDocumentsToUpdate + batch.searchDocumentsToUpdate,
      missingCards: previous.missingCards + batch.missingCards,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillSearchDocumentDates"]
          .backfillSearchDocumentDates,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillSearchDocumentDates finished", {
        dryRun,
        ...totals,
      });
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
