import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion/gate";
import { HIDDEN_TAG_KEYS, isHiddenTagList, tagKey } from "../shared/tags";
import { backfillArgs, backfillReturns, runBackfillPage } from "./runner";

/**
 * Most user ids carried from batch to batch to count affected users: a
 * Convex array holds at most 8,192 values. Past it, the count is a floor.
 */
export const MAX_TRACKED_USERS = 4000;

const tagCountsValidator = v.object({
  secret: v.number(),
  hidden: v.number(),
});

const totalsValidator = v.object({
  examined: v.number(),
  hiddenCards: v.number(),
  cardsToUpdate: v.number(),
  searchDocumentsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
  tags: tagCountsValidator,
  affectedUsers: v.number(),
  affectedUsersCapped: v.optional(v.boolean()),
});

type Totals = Infer<typeof totalsValidator>;

const emptyTotals = (): Totals => ({
  examined: 0,
  hiddenCards: 0,
  cardsToUpdate: 0,
  searchDocumentsToUpdate: 0,
  skippedDeletingAccounts: 0,
  tags: { secret: 0, hidden: 0 },
  affectedUsers: 0,
});

const pageReturns = backfillReturns(totalsValidator);

export const backfillHiddenCards = internalMutation({
  args: {
    ...backfillArgs(totalsValidator),
    affectedUserIds: v.optional(v.array(v.string())),
  },
  returns: pageReturns,
  handler: (ctx, args): Promise<typeof pageReturns.type> => {
    const affectedUserIds = new Set(args.affectedUserIds ?? []);
    let affectedUsersCapped = args.totals?.affectedUsersCapped === true;
    return runBackfillPage(ctx, args, {
      // Users are counted by ID across pages, up to MAX_TRACKED_USERS.
      add: (previous: Totals, batch: Totals): Totals => ({
        examined: previous.examined + batch.examined,
        hiddenCards: previous.hiddenCards + batch.hiddenCards,
        cardsToUpdate: previous.cardsToUpdate + batch.cardsToUpdate,
        searchDocumentsToUpdate:
          previous.searchDocumentsToUpdate + batch.searchDocumentsToUpdate,
        skippedDeletingAccounts:
          previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
        tags: {
          secret: previous.tags.secret + batch.tags.secret,
          hidden: previous.tags.hidden + batch.tags.hidden,
        },
        affectedUsers: affectedUserIds.size,
        ...(affectedUsersCapped ? { affectedUsersCapped: true } : {}),
      }),
      empty: emptyTotals,
      name: "backfillHiddenCards",
      read: (cursor, numItems) =>
        ctx.db.query("cards").paginate({ cursor, numItems }),
      self: internal.migration.backfillHiddenCards.backfillHiddenCards,
      visit: async (cards, batch, dryRun) => {
        const batchUsers = new Set<string>();
        const accountDeleting = createAccountDeletionGate(ctx);
        for (const card of cards) {
          batch.examined += 1;
          const isHidden = isHiddenTagList(card.tags)
            ? (true as const)
            : undefined;
          if (isHidden) {
            batch.hiddenCards += 1;
            batchUsers.add(card.userId);
            const keys = new Set((card.tags ?? []).map(tagKey));
            for (const key of HIDDEN_TAG_KEYS) {
              if (keys.has(key)) {
                batch.tags[key] += 1;
              }
            }
          }
          const searchDocument = await ctx.db
            .query("cardSearchDocuments")
            .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
            .unique();
          const cardChanges = card.isHidden !== isHidden;
          const documentChanges =
            searchDocument !== null && searchDocument.isHidden !== isHidden;
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
              await ctx.db.patch("cards", card._id, { isHidden });
            }
          }
          if (documentChanges && searchDocument) {
            batch.searchDocumentsToUpdate += 1;
            if (!dryRun) {
              await ctx.db.patch("cardSearchDocuments", searchDocument._id, {
                isHidden,
              });
            }
          }
        }
        batch.affectedUsers = batchUsers.size;
        for (const userId of batchUsers) {
          if (affectedUserIds.size < MAX_TRACKED_USERS) {
            affectedUserIds.add(userId);
          } else if (!affectedUserIds.has(userId)) {
            affectedUsersCapped = true;
          }
        }
        return { affectedUserIds: [...affectedUserIds] };
      },
    });
  },
});
