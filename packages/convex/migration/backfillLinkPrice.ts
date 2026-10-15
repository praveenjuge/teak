import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { getAccountDeletionState } from "../accountDeletion";
import { patchCardWithSearchSync } from "../card/searchDocumentHelpers";
import {
  type LinkPrice,
  parsePrice,
  parseStructuredPrice,
} from "../shared/price";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 200;

const totalsValidator = v.object({
  examined: v.number(),
  priced: v.number(),
  skippedArchivedRaw: v.number(),
  unparsable: v.number(),
  skippedDeletingAccounts: v.number(),
});

type Totals = typeof totalsValidator.type;

const emptyTotals = (): Totals => ({
  examined: 0,
  priced: 0,
  skippedArchivedRaw: 0,
  unparsable: 0,
  skippedDeletingAccounts: 0,
});

type LinkCategory = NonNullable<
  NonNullable<Doc<"cards">["metadata"]>["linkCategory"]
>;

export type BackfillPriceSource = "structured" | "provider" | "fact";

/**
 * The price a link card's stored category data states, from the first
 * source that has one: inline JSON-LD offers, then the provider's inline
 * price and currency, then the "Price" fact. Never reads archived raw.
 * `hasSource` says whether any source held something that looked like a
 * price, so a miss can be told apart from a page that never had one.
 */
export const readStoredLinkPrice = (
  linkCategory: Pick<LinkCategory, "facts" | "raw">
): {
  hasSource: boolean;
  price: LinkPrice | null;
  source?: BackfillPriceSource;
} => {
  const raw =
    linkCategory.raw && typeof linkCategory.raw === "object"
      ? (linkCategory.raw as Record<string, unknown>)
      : undefined;
  const structured = raw?.structured as Record<string, unknown> | undefined;
  const provider = raw?.provider as Record<string, unknown> | undefined;
  const fact = linkCategory.facts?.find((entry) => entry.label === "Price");
  let hasSource = false;

  if (structured && typeof structured === "object") {
    const hasOffers =
      structured.offers !== undefined ||
      structured.price !== undefined ||
      structured.lowPrice !== undefined;
    hasSource ||= hasOffers;
    const price = hasOffers ? parseStructuredPrice(structured) : null;
    if (price) {
      return { hasSource, price, source: "structured" };
    }
  }
  if (
    provider &&
    typeof provider === "object" &&
    provider.price !== null &&
    provider.price !== undefined
  ) {
    hasSource = true;
    const price = parsePrice(provider.price, provider.currency);
    if (price) {
      return { hasSource, price, source: "provider" };
    }
  }
  if (fact) {
    hasSource = true;
    const price = parsePrice(fact.value);
    if (price) {
      return { hasSource, price, source: "fact" };
    }
  }
  return { hasSource, price: null };
};

/** Raw moved to R2: only a storage key is left on the card. */
const hasArchivedRaw = (linkCategory: LinkCategory) =>
  linkCategory.raw === undefined && Boolean(linkCategory.rawStorageKey);

/**
 * Writes one card's backfilled price. It reads the card again here, so a
 * price a refresh wrote after the batch read it is kept, and the price is
 * merged into the card's metadata as it is now, not into an older copy.
 */
export const writeLinkPrice = internalMutation({
  args: {
    cardId: v.id("cards"),
    price: v.object({ amount: v.number(), currency: v.optional(v.string()) }),
  },
  returns: v.union(
    v.literal("written"),
    v.literal("already_priced"),
    v.literal("missing"),
    v.literal("skipped")
  ),
  handler: async (ctx, { cardId, price }) => {
    const card = await ctx.db.get("cards", cardId);
    const linkCategory = card?.metadata?.linkCategory;
    if (!(card && linkCategory) || card.type !== "link") {
      return "missing";
    }
    if (linkCategory.price) {
      return "already_priced";
    }
    const written = await patchCardWithSearchSync(ctx, cardId, {
      metadata: {
        ...card.metadata,
        linkCategory: { ...linkCategory, price },
      },
      // Clients refresh a cached card when its updatedAt moves.
      updatedAt: Date.now(),
    });
    return written ? "written" : "skipped";
  },
});

/**
 * Sets `metadata.linkCategory.price` on link cards saved before prices
 * were structured, from what each card already stores inline (JSON-LD
 * offers, the provider's price, then the "Price" fact). It never reads raw
 * archived to R2: product cards whose only source is there are counted in
 * `skippedArchivedRaw` and get a price on Refresh details. A dry run (the
 * default) writes nothing and reports what a real run would change. Each
 * batch schedules the next until the table is done, and the last one logs
 * the totals.
 *
 *   npx convex run migration/backfillLinkPrice:backfillLinkPrice
 *   npx convex run migration/backfillLinkPrice:backfillLinkPrice '{"dryRun":false,"userId":"teak_…"}'
 *   npx convex run migration/backfillLinkPrice:backfillLinkPrice '{"dryRun":false}'
 */
export const backfillLinkPrice = internalMutation({
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
      const linkCategory = card.metadata?.linkCategory;
      if (card.type !== "link" || !linkCategory || linkCategory.price) {
        continue;
      }
      const { price, hasSource } = readStoredLinkPrice(linkCategory);
      if (!price) {
        const isProduct =
          linkCategory.category === "product" ||
          linkCategory.detectedProvider === "amazon";
        if (hasArchivedRaw(linkCategory) && (isProduct || hasSource)) {
          batch.skippedArchivedRaw += 1;
        } else if (hasSource) {
          batch.unparsable += 1;
        }
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
      batch.priced += 1;
      if (!dryRun) {
        await ctx.scheduler.runAfter(
          0,
          (internal as any)["migration/backfillLinkPrice"].writeLinkPrice,
          { cardId: card._id, price }
        );
      }
    }

    const previous = args.totals ?? emptyTotals();
    const totals: Totals = {
      examined: previous.examined + batch.examined,
      priced: previous.priced + batch.priced,
      skippedArchivedRaw:
        previous.skippedArchivedRaw + batch.skippedArchivedRaw,
      unparsable: previous.unparsable + batch.unparsable,
      skippedDeletingAccounts:
        previous.skippedDeletingAccounts + batch.skippedDeletingAccounts,
    };
    const isDone = page.isDone;
    const continuationScheduled = !(isDone || args.once);
    if (continuationScheduled) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["migration/backfillLinkPrice"].backfillLinkPrice,
        {
          cursor: page.continueCursor,
          dryRun,
          batchSize,
          ...(userId ? { userId } : {}),
          totals,
        }
      );
    } else if (isDone) {
      console.log("backfillLinkPrice finished", { dryRun, ...totals });
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
