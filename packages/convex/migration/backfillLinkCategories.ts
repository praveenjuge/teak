import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import type { LinkCategory } from "../shared/linkCategories";
import { resolveLinkCategory } from "../shared/utils/linkCategoryResolver";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const moveValidator = v.object({
  from: v.string(),
  to: v.string(),
  count: v.number(),
});

const totalsValidator = v.object({
  examined: v.number(),
  cardsToMove: v.number(),
  skippedDeletingAccounts: v.number(),
  moves: v.array(moveValidator),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  cardsToMove: 0,
  skippedDeletingAccounts: 0,
  moves: [],
});

const addMove = (moves: Totals["moves"], from: string, to: string) => {
  const existing = moves.find((move) => move.from === from && move.to === to);
  if (existing) {
    existing.count += 1;
  } else {
    moves.push({ from, to, count: 1 });
  }
};

const mergeTotals = (previous: Totals, batch: Totals): Totals => {
  const moves = previous.moves.map((move) => ({ ...move }));
  for (const move of batch.moves) {
    const existing = moves.find(
      (entry) => entry.from === move.from && entry.to === move.to
    );
    if (existing) {
      existing.count += move.count;
    } else {
      moves.push({ ...move });
    }
  }
  return {
    examined: previous.examined + batch.examined,
    cardsToMove: previous.cardsToMove + batch.cardsToMove,
    skippedDeletingAccounts:
      previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    moves,
  };
};

/**
 * The category a link card's URL now gets from a domain or path rule, when
 * that differs from the one it has. Heuristics and the `other` fallback never
 * move a card, and a category a site's API confirmed (`categoryHint`) stays.
 */
export const pickRecategorizedLinkCategory = (card: {
  type: string;
  url?: string;
  metadata?: {
    linkCategory?: { category: string };
    linkPreview?: { categoryHint?: string };
  };
}): LinkCategory | null => {
  const current = card.metadata?.linkCategory?.category;
  if (!(card.type === "link" && card.url && current)) {
    return null;
  }
  if (card.metadata?.linkPreview?.categoryHint) {
    return null;
  }
  const resolution = resolveLinkCategory(card.url);
  if (
    !(resolution.reason === "domain_rule" || resolution.reason === "path_rule")
  ) {
    return null;
  }
  if (resolution.category === "other" || resolution.category === current) {
    return null;
  }
  return resolution.category;
};

/**
 * Moves existing link cards into the categories added since they were
 * categorized (place, typeface, social_post, app, game and repo), using the
 * same URL rules as new saves. Only the category changes; facts, raw data and
 * confidence stay. A dry run (the default) writes nothing and reports what a
 * real run would move, counted per from→to pair. Each batch schedules the
 * next until the table is done, and the last one logs the totals.
 *
 *   npx convex run migration/backfillLinkCategories:backfillLinkCategories
 *   npx convex run migration/backfillLinkCategories:backfillLinkCategories '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillLinkCategories:backfillLinkCategories '{"dryRun":false}'
 */
export const backfillLinkCategories = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    batchSize: v.optional(v.number()),
    /** Stop after this batch instead of scheduling the next. */
    once: v.optional(v.boolean()),
    /** Only this account's cards: a canary before the whole table. */
    userId: v.optional(v.string()),
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
    const { userId } = args;
    const cards = userId
      ? ctx.db
          .query("cards")
          .withIndex("by_created", (q) => q.eq("userId", userId))
      : ctx.db.query("cards");
    const page = await cards.paginate({
      cursor: args.cursor ?? null,
      numItems: batchSize,
    });

    const batch = emptyTotals();
    const deletingAccounts = new Map<string, boolean>();
    for (const card of page.page) {
      batch.examined += 1;
      const category = pickRecategorizedLinkCategory(card);
      const linkCategory = card.metadata?.linkCategory;
      if (!(category && linkCategory)) {
        continue;
      }
      // Account deletion owns these rows while it runs; writing would race
      // its batches.
      let deleting = deletingAccounts.get(card.userId);
      if (deleting === undefined) {
        deleting = Boolean(await getAccountDeletionState(ctx, card.userId));
        deletingAccounts.set(card.userId, deleting);
      }
      if (deleting) {
        batch.skippedDeletingAccounts += 1;
        continue;
      }
      batch.cardsToMove += 1;
      addMove(batch.moves, linkCategory.category, category);
      if (!dryRun) {
        await patchCardWithSearchSync(ctx, card._id, {
          metadata: {
            ...card.metadata,
            linkCategory: { ...linkCategory, category },
          },
        });
      }
    }

    const totals = mergeTotals(args.totals ?? emptyTotals(), batch);
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillLinkCategories"]
          .backfillLinkCategories,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillLinkCategories finished", { dryRun, ...totals });
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
