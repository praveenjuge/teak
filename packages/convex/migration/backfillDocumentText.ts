import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 100;
/** Time between two extractions, so the Files Worker sees a steady trickle. */
const DEFAULT_SPACING_MS = 2000;
const MIN_SPACING_MS = 250;

const totalsValidator = v.object({
  examined: v.number(),
  cardsToExtract: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Stores the extracted text of document cards saved before Teak kept it
 * (new documents get theirs when they are processed). It pages through
 * document cards and, for each one in a library without stored text,
 * schedules one extraction (migration/extractDocumentText.ts), spaced
 * `spacingMs` apart; the next page starts once the last one is due, so the
 * Files Worker never sees a burst. Cards in Trash are left alone. A dry run
 * (the default) schedules nothing and reports what a real run would do. A
 * rerun skips cards that already have text, so it resumes where an
 * interrupted run stopped.
 *
 *   npx convex run migration/backfillDocumentText:backfillDocumentText
 *   npx convex run migration/backfillDocumentText:backfillDocumentText '{"dryRun":false}'
 */
export const backfillDocumentText = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    spacingMs: v.optional(v.number()),
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
    const spacingMs = Math.max(
      MIN_SPACING_MS,
      Math.floor(args.spacingMs ?? DEFAULT_SPACING_MS)
    );
    const page = await ctx.db
      .query("cards")
      .withIndex("by_type_derivative_version", (query) =>
        query.eq("type", "document")
      )
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = {
      examined: 0,
      cardsToExtract: 0,
      skippedDeletingAccounts: 0,
    };
    const deletingAccounts = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      if (card.hasExtractedText || card.isDeleted || !card.fileKey) {
        continue;
      }
      // Account deletion owns these rows while it runs.
      let deleting = deletingAccounts.get(card.userId);
      if (deleting === undefined) {
        deleting = Boolean(await getAccountDeletionState(ctx, card.userId));
        deletingAccounts.set(card.userId, deleting);
      }
      if (deleting) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          batch.cardsToExtract * spacingMs,
          (internal as any)["migration/extractDocumentText"]
            .extractDocumentText,
          { cardId: card._id }
        );
      }
      batch.cardsToExtract += 1;
    }

    const previous = args.totals ?? {
      examined: 0,
      cardsToExtract: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      cardsToExtract: previous.cardsToExtract + batch.cardsToExtract,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        dryRun ? 0 : batch.cardsToExtract * spacingMs,
        (internal as any)["migration/backfillDocumentText"]
          .backfillDocumentText,
        { cursor: page.continueCursor, dryRun, batchSize, spacingMs, totals }
      );
    } else if (isDone) {
      console.log("backfillDocumentText finished", { dryRun, ...totals });
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
