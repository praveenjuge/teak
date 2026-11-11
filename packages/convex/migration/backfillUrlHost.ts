import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import { cardSiteHost } from "../shared/utils/urlHost";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

const totalsValidator = v.object({
  examined: v.number(),
  cardsToUpdate: v.number(),
  searchDocumentsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

const pageReturns = backfillReturns(totalsValidator);

export const backfillUrlHost = internalMutation({
  args: backfillArgs(totalsValidator),
  returns: pageReturns,
  handler: (ctx, args): Promise<typeof pageReturns.type> =>
    runBackfillPage(ctx, args, {
      empty: () => ({
        examined: 0,
        cardsToUpdate: 0,
        searchDocumentsToUpdate: 0,
        skippedDeletingAccounts: 0,
      }),
      name: "backfillUrlHost",
      read: (cursor, numItems) =>
        ctx.db.query("cards").paginate({ cursor, numItems }),
      self: internal.migration.backfillUrlHost.backfillUrlHost,
      visit: async (cards, batch, dryRun) => {
        const accountDeleting = createAccountDeletionGate(ctx);
        for (const card of cards) {
          batch.examined += 1;
          const urlHost = cardSiteHost(card) ?? undefined;
          const searchDocument = await ctx.db
            .query("cardSearchDocuments")
            .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
            .unique();
          const cardChanges = card.urlHost !== urlHost;
          const documentChanges =
            searchDocument !== null && searchDocument.urlHost !== urlHost;
          if (!(cardChanges || documentChanges)) {
            continue;
          }
          if (await accountDeleting(card.userId)) {
            batch.skippedDeletingAccounts += 1;
            continue;
          }
          if (cardChanges) {
            batch.cardsToUpdate += 1;
            if (!dryRun) {
              await ctx.db.patch("cards", card._id, { urlHost });
            }
          }
          if (documentChanges && searchDocument) {
            batch.searchDocumentsToUpdate += 1;
            if (!dryRun) {
              await ctx.db.patch("cardSearchDocuments", searchDocument._id, {
                urlHost,
              });
            }
          }
        }
      },
    }),
});
