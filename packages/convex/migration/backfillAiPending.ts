import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { cardNeedsAiMetadata } from "../ai/queries";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const totalsValidator = v.object({
  examined: v.number(),
  cardsToFlag: v.number(),
  skippedDeletingAccounts: v.number(),
});

/**
 * Sets `aiPending` on cards saved before it existed that still have no AI
 * summary, tags or transcript, so the AI backfill
 * (`by_aiPending_and_isDeleted_and_createdAt`) finds them. Reads the index it
 * replaces, which holds exactly those cards.
 */
export const backfillAiPending = internalMutation({
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
      .withIndex("by_aiSummary_aiTags_aiTranscript_isDeleted_createdAt", (q) =>
        q
          .eq("aiSummary", undefined)
          .eq("aiTags", undefined)
          .eq("aiTranscript", undefined)
      )
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    const batch = { examined: 0, cardsToFlag: 0, skippedDeletingAccounts: 0 };
    const accountDeleting = createAccountDeletionGate(ctx);
    for (const card of page.page) {
      batch.examined += 1;
      if (card.aiPending === true || !cardNeedsAiMetadata(card)) {
        continue;
      }
      if (await accountDeleting(card.userId)) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.cardsToFlag += 1;
      if (!dryRun) {
        await ctx.db.patch("cards", card._id, { aiPending: true });
      }
    }

    const previous = args.totals ?? {
      examined: 0,
      cardsToFlag: 0,
      skippedDeletingAccounts: 0,
    };
    const totals = {
      examined: previous.examined + batch.examined,
      cardsToFlag: previous.cardsToFlag + batch.cardsToFlag,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        internal["migration/backfillAiPending"].backfillAiPending,
        { cursor: page.continueCursor, dryRun, batchSize, totals }
      );
    } else if (isDone) {
      console.log("backfillAiPending finished", { dryRun, ...totals });
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
