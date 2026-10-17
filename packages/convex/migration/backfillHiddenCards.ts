import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { HIDDEN_TAG_KEYS, isHiddenTagList, tagKey } from "../shared/tags";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const tagCountsValidator = v.object({
  secret: v.number(),
  hidden: v.number(),
});

const totalsValidator = v.object({
  examined: v.number(),
  /** Cards with a reserved user tag, flagged already or not. */
  hiddenCards: v.number(),
  cardsToUpdate: v.number(),
  searchDocumentsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
  /** Hidden cards carrying each reserved tag (a card can count twice). */
  tags: tagCountsValidator,
  /** Users with at least one hidden card. */
  affectedUsers: v.number(),
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

/**
 * Sets `isHidden` on every card whose user tags hold a reserved tag, and on
 * its search document, and clears it where it no longer belongs (new writes
 * keep it through `patchCardWithSearchSync` and the search sync). Reads hide
 * these cards by their tags from the deploy on, so this only fills in the
 * flag the indexes filter on. A dry run (the default) writes nothing and
 * reports the counts per tag and how many users have hidden cards. Each
 * batch schedules the next until the table is done, and the last one logs
 * the totals.
 *
 *   npx convex run migration/backfillHiddenCards:backfillHiddenCards
 *   npx convex run migration/backfillHiddenCards:backfillHiddenCards '{"dryRun":false}'
 */
export const backfillHiddenCards = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
    once: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
    /** Users counted in `totals.affectedUsers` so far. */
    affectedUserIds: v.optional(v.array(v.string())),
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

    const affectedUserIds = new Set(args.affectedUserIds ?? []);
    const batch = emptyTotals();
    const batchUsers = new Set<string>();
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const card of page.page) {
      batch.examined += 1;
      const isHidden = isHiddenTagList(card.tags) ? (true as const) : undefined;
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
      affectedUserIds.add(userId);
    }

    const previous = args.totals ?? emptyTotals();
    const totals: Totals = {
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
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillHiddenCards"].backfillHiddenCards,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
          affectedUserIds: [...affectedUserIds],
        }
      );
    } else if (isDone) {
      console.log("backfillHiddenCards finished", { dryRun, ...totals });
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
