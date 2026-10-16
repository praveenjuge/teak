import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { isVisualStyle } from "../shared/constants";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
/**
 * Cards per job and the gap between jobs. Changed styles re-embed cards, so
 * this matches the embeddings backfill's pace (Vectorize answers bursts of
 * small writes with 429).
 */
export const STYLE_JOB_SIZE = 16;
export const STYLE_JOB_GAP_MS = 3200;

const totalsValidator = v.object({
  examined: v.number(),
  candidates: v.number(),
  jobsScheduled: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  candidates: 0,
  jobsScheduled: 0,
  skippedDeletingAccounts: 0,
});

/** Images, and videos with a thumbnail, that are not in Trash. */
export const isVisualStyleCandidate = (card: Doc<"cards">): boolean =>
  card.isDeleted !== true &&
  ((card.type === "image" && !!(card.thumbnailKey || card.fileKey)) ||
    (card.type === "video" && !!card.thumbnailKey));

/**
 * Re-runs visual styles with Clef on existing images and video thumbnails. A
 * dry run (the default) counts the candidates and makes no Clef call. A real
 * run queues jobs of 16 cards, one every 3.2 seconds.
 *
 *   npx convex run migration/backfillVisualStyles:backfillVisualStyles
 *   npx convex run migration/backfillVisualStyles:backfillVisualStyles '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillVisualStyles:backfillVisualStyles '{"dryRun":false}'
 */
export const backfillVisualStyles = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
    type: v.optional(v.union(v.literal("image"), v.literal("video"))),
    userId: v.optional(v.string()),
    totals: v.optional(totalsValidator),
  },
  returns: v.object({
    dryRun: v.boolean(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
    continuationScheduled: v.boolean(),
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? true;
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      Math.max(1, Math.floor(args.batchSize ?? DEFAULT_BATCH_SIZE))
    );
    const query =
      args.userId && args.type
        ? ctx.db
            .query("cards")
            .withIndex("by_user_type_deleted", (q) =>
              q
                .eq("userId", args.userId as string)
                .eq("type", args.type as "image" | "video")
            )
        : ctx.db.query("cards");
    const page = await query.paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    const totals = { ...(args.totals ?? emptyTotals()) };
    const accountDeleting = createAccountDeletionGate(ctx);
    const candidates: Id<"cards">[] = [];
    for (const card of page.page) {
      totals.examined += 1;
      if (
        !isVisualStyleCandidate(card) ||
        (args.type && card.type !== args.type) ||
        (args.userId && card.userId !== args.userId)
      ) {
        continue;
      }
      if (await accountDeleting(card.userId)) {
        totals.skippedDeletingAccounts += 1;
        continue;
      }
      totals.candidates += 1;
      candidates.push(card._id);
    }

    if (!dryRun) {
      for (let start = 0; start < candidates.length; start += STYLE_JOB_SIZE) {
        await ctx.scheduler.runAfter(
          totals.jobsScheduled * STYLE_JOB_GAP_MS,
          (internal as any)["migration/backfillVisualStylesJob"].restyleCards,
          { cardIds: candidates.slice(start, start + STYLE_JOB_SIZE) }
        );
        totals.jobsScheduled += 1;
      }
    }

    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillVisualStyles"]
          .backfillVisualStyles,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
          ...(args.type ? { type: args.type } : {}),
          ...(args.userId ? { userId: args.userId } : {}),
        }
      );
    } else if (isDone) {
      console.log("backfillVisualStyles finished", { dryRun, ...totals });
    }
    return {
      dryRun,
      isDone,
      continueCursor: isDone ? null : page.continueCursor,
      continuationScheduled,
      totals,
    };
  },
});

export const getStyleCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    return card && isVisualStyleCandidate(card) ? card : null;
  },
});

/**
 * Writes Clef's styles only if the card still shows the image the job
 * analysed: a replaced file or thumbnail in between wins.
 */
export const applyVisualStyles = internalMutation({
  args: {
    cardId: v.id("cards"),
    expectedSourceKey: v.string(),
    styles: v.array(v.string()),
  },
  returns: v.union(
    v.literal("changed"),
    v.literal("unchanged"),
    v.literal("stale")
  ),
  handler: async (ctx, { cardId, expectedSourceKey, styles }) => {
    const card = await ctx.db.get("cards", cardId);
    if (
      !(card && isVisualStyleCandidate(card)) ||
      (card.thumbnailKey ?? card.fileKey) !== expectedSourceKey ||
      !styles.every(isVisualStyle) ||
      (await createAccountDeletionGate(ctx)(card.userId))
    ) {
      return "stale";
    }
    const next = styles.length ? styles : undefined;
    if (
      JSON.stringify(card.visualStyles ?? null) === JSON.stringify(next ?? null)
    ) {
      return "unchanged";
    }
    await patchCardWithSearchSync(ctx, cardId, { visualStyles: next });
    return "changed";
  },
});
