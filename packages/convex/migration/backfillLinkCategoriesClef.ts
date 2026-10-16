import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";
import { createAccountDeletionGate } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import { LINK_CATEGORIES, type LinkCategory } from "../shared/linkCategories";
import { resolveLinkCategory } from "../shared/utils/linkCategoryResolver";
import { serializeArchivableRaw } from "../storage/rawMetadata";

const isLinkCategory = (value: string): value is LinkCategory =>
  (LINK_CATEGORIES as readonly string[]).includes(value);

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;
/** Cards per review job, and the gap between jobs, to stay under Clef's limits. */
export const REVIEW_JOB_SIZE = 8;
export const REVIEW_JOB_GAP_MS = 2000;

/** Rule tiers Clef reviews; domain and path matches are skipped. */
const REVIEWED_REASONS = new Set(["provider_mapping", "heuristic", "fallback"]);

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

/**
 * A link whose stored category still matches a guess from the resolver
 * (provider mapping, keyword or the `other` fallback) and was not moved since
 * by Clef or by hand.
 */
export const isClefReviewCandidate = (card: Doc<"cards">): boolean => {
  const stored = card.metadata?.linkCategory;
  if (
    card.type !== "link" ||
    card.isDeleted === true ||
    !card.url ||
    !stored?.category
  ) {
    return false;
  }
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const rules = resolveLinkCategory(card.url, {
    siteName: preview?.siteName,
    title: preview?.title || preview?.description,
  });
  return (
    REVIEWED_REASONS.has(rules.reason) && rules.category === stored.category
  );
};

/**
 * Asks Clef to recategorize links the resolver only guessed. A dry run (the
 * default) counts the candidates and makes no Clef call. A real run queues
 * review jobs of 8 cards, one every 2 seconds; each job writes only a
 * category Clef is confident about, and never `other`.
 *
 *   npx convex run migration/backfillLinkCategoriesClef:backfillLinkCategoriesClef
 *   npx convex run migration/backfillLinkCategoriesClef:backfillLinkCategoriesClef '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillLinkCategoriesClef:backfillLinkCategoriesClef '{"dryRun":false}'
 */
export const backfillLinkCategoriesClef = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    once: v.optional(v.boolean()),
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
    const query = args.userId
      ? ctx.db
          .query("cards")
          .withIndex("by_user_type_deleted", (q) =>
            q.eq("userId", args.userId as string).eq("type", "link")
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
      if (!isClefReviewCandidate(card)) {
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
      for (let start = 0; start < candidates.length; start += REVIEW_JOB_SIZE) {
        await ctx.scheduler.runAfter(
          totals.jobsScheduled * REVIEW_JOB_GAP_MS,
          (internal as any)["migration/backfillLinkCategoriesClefReview"]
            .reviewLinkCategories,
          { cardIds: candidates.slice(start, start + REVIEW_JOB_SIZE) }
        );
        totals.jobsScheduled += 1;
      }
    }

    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillLinkCategoriesClef"]
          .backfillLinkCategoriesClef,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          totals,
          ...(args.userId ? { userId: args.userId } : {}),
        }
      );
    } else if (isDone) {
      console.log("backfillLinkCategoriesClef finished", { dryRun, ...totals });
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

export const getReviewCandidate = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const card = await ctx.db.get("cards", cardId);
    return card && isClefReviewCandidate(card) ? card : null;
  },
});

/**
 * Writes a reviewed category's metadata, enriched again for the new category,
 * only if the card still holds the category the review read: a refresh, an
 * edit or a new URL in between wins.
 */
export const applyReviewedCategory = internalMutation({
  args: {
    cardId: v.id("cards"),
    /** The whole `linkCategory` metadata, from `enrichLinkCategory`. */
    metadata: v.any(),
    expectedCategory: v.string(),
    expectedFetchedAt: v.optional(v.number()),
    expectedUrl: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const category = args.metadata?.category;
    if (
      typeof category !== "string" ||
      !isLinkCategory(category) ||
      category === "other"
    ) {
      return false;
    }
    const card = await ctx.db.get("cards", args.cardId);
    const stored = card?.metadata?.linkCategory;
    if (
      !card ||
      card.isDeleted === true ||
      card.url !== args.expectedUrl ||
      stored?.category !== args.expectedCategory ||
      stored?.fetchedAt !== args.expectedFetchedAt ||
      (await createAccountDeletionGate(ctx)(card.userId))
    ) {
      return false;
    }
    await patchCardWithSearchSync(ctx, card._id, {
      metadata: { ...card.metadata, linkCategory: args.metadata },
    });
    if (serializeArchivableRaw(args.metadata.raw) !== null) {
      await ctx.scheduler.runAfter(
        0,
        internal.storage.rawMetadataMaintenance.archiveCard,
        { cardId: card._id }
      );
    }
    return true;
  },
});
