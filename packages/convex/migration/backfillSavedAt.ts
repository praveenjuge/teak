import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { MAX_FOLDERS_PER_CARD } from "../shared/folders";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

const phaseValidator = v.union(v.literal("cards"), v.literal("tagRows"));

const totalsValidator = v.object({
  examined: v.number(),
  cardsToUpdate: v.number(),
  folderRowsToUpdate: v.number(),
  tagRowsExamined: v.number(),
  tagRowsToUpdate: v.number(),
  skippedDeletingAccounts: v.number(),
});

const emptyTotals = () => ({
  examined: 0,
  cardsToUpdate: 0,
  folderRowsToUpdate: 0,
  tagRowsExamined: 0,
  tagRowsToUpdate: 0,
  skippedDeletingAccounts: 0,
});

/**
 * Sets `cards.savedAt` to `createdAt` where it is missing and copies the
 * card's `savedAt` into its folder rows, then walks every tag row (a card
 * can have more than its current tags) and copies it there too, so the
 * `…_saved` indexes hold every card before "Newest first" moves to them.
 * Dry run by default; delete it once it has run in production.
 */
export const backfillSavedAt = internalMutation({
  args: {
    phase: v.optional(phaseValidator),
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    phase: phaseValidator,
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
    const phase = args.phase ?? "cards";
    const batch = emptyTotals();
    const accountDeleting = createAccountDeletionGate(ctx);
    let page: { continueCursor: string; isDone: boolean };

    if (phase === "cards") {
      const cards = await ctx.db
        .query("cards")
        .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
      page = cards;
      for (const card of cards.page) {
        batch.examined += 1;
        const savedAt = card.savedAt ?? card.createdAt;
        const folderRows = card.folderIds?.length
          ? await ctx.db
              .query("folderCards")
              .withIndex("by_cardId_and_folderId", (q) =>
                q.eq("cardId", card._id)
              )
              .take(MAX_FOLDERS_PER_CARD * 2)
          : [];
        const staleFolderRows = folderRows.filter(
          (row) => row.cardSavedAt !== savedAt
        );
        const cardChanges = card.savedAt === undefined;
        if (!(cardChanges || staleFolderRows.length)) {
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
        if (dryRun) {
          continue;
        }
        if (cardChanges) {
          await ctx.db.patch("cards", card._id, { savedAt });
        }
        for (const row of staleFolderRows) {
          await ctx.db.patch("folderCards", row._id, { cardSavedAt: savedAt });
        }
      }
    } else {
      const rows = await ctx.db
        .query("cardSearchTags")
        .paginate({ cursor: args.cursor ?? null, numItems: batchSize });
      page = rows;
      const cards = new Map<Id<"cards">, Doc<"cards"> | null>();
      for (const row of rows.page) {
        batch.tagRowsExamined += 1;
        let card = cards.get(row.cardId);
        if (card === undefined) {
          card = await ctx.db.get("cards", row.cardId);
          cards.set(row.cardId, card);
        }
        // A row whose card is gone is left for the tag cleanup.
        if (!card) {
          continue;
        }
        const savedAt = card.savedAt ?? card.createdAt;
        if (row.cardSavedAt === savedAt) {
          continue;
        }
        if (await accountDeleting(row.userId)) {
          batch.skippedDeletingAccounts += 1;
          continue;
        }
        batch.tagRowsToUpdate += 1;
        if (!dryRun) {
          await ctx.db.patch("cardSearchTags", row._id, {
            cardSavedAt: savedAt,
          });
        }
      }
    }

    const previous = args.totals ?? emptyTotals();
    const totals = {
      examined: previous.examined + batch.examined,
      cardsToUpdate: previous.cardsToUpdate + batch.cardsToUpdate,
      folderRowsToUpdate:
        previous.folderRowsToUpdate + batch.folderRowsToUpdate,
      tagRowsExamined: previous.tagRowsExamined + batch.tagRowsExamined,
      tagRowsToUpdate: previous.tagRowsToUpdate + batch.tagRowsToUpdate,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    // The cards phase hands over to the tag rows phase, which ends the run.
    const isDone = page.isDone && phase === "tagRows";
    const next = page.isDone
      ? { phase: "tagRows" as const, cursor: null }
      : { phase, cursor: page.continueCursor };
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillSavedAt"].backfillSavedAt,
        { ...next, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("backfillSavedAt finished", { dryRun, ...totals });
    }
    return {
      phase: next.phase,
      dryRun,
      isDone,
      continueCursor: isDone ? null : next.cursor,
      continuationScheduled,
      batch,
      totals,
    };
  },
});
