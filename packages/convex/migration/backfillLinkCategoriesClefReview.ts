"use node";

import { gunzipSync } from "node:zlib";
import type { FilesLinkPageResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { SCRAPE_ELEMENTS } from "../linkMetadata/selectors";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { hydrateArchivedMetadata } from "../storage/rawMetadata";
import { reviewLinkCategoryWithClef } from "../workflows/steps/categorization/clef";
import {
  type CategorizationContextCard,
  classifyLinkCategory,
  enrichLinkCategory,
  parseStructuredData,
  projectCategorizationSnapshot,
  type StructuredDataResult,
} from "../workflows/steps/categorization/rules";

const MAX_STRUCTURED_HTML = 250_000;

/**
 * The page's JSON-LD, read through the Files Worker's link fetcher (the same
 * `fetch-link-page` result card processing uses, kept for a day there).
 * Null when the page can't be read.
 */
const fetchStructuredData = async (
  url: string
): Promise<StructuredDataResult | null> => {
  try {
    const outcome = await callFilesWorkerJson<FilesLinkPageResult>({
      op: "fetch-link-page",
      params: {
        selectors: SCRAPE_ELEMENTS.map(({ selector }) => selector),
        url,
      },
    });
    if (outcome.kind !== "ok" || !outcome.data.fetched) {
      return null;
    }
    const html = gunzipSync(
      Buffer.from(outcome.data.htmlGzipBase64, "base64")
    ).toString("utf8");
    const parsed = parseStructuredData(html.slice(0, MAX_STRUCTURED_HTML));
    parsed.meta = { fetchedAt: Date.now() };
    return parsed;
  } catch {
    return null;
  }
};

/**
 * One review job of `backfillLinkCategoriesClef`: asks Clef about each card
 * and writes only a confident change, through a mutation that refuses if the
 * card moved on since it was read.
 */
export const reviewLinkCategories = internalAction({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.object({ changed: v.number(), reviewed: v.number() }),
  handler: async (ctx, { cardIds }) => {
    let changed = 0;
    let reviewed = 0;
    for (const cardId of cardIds) {
      const card = await ctx.runQuery(
        (internal as any)["migration/backfillLinkCategoriesClef"]
          .getReviewCandidate,
        { cardId }
      );
      if (!card?.url) {
        continue;
      }
      const projected = projectCategorizationSnapshot(
        card as CategorizationContextCard
      );
      const snapshot: CategorizationContextCard = {
        ...projected,
        ...(await hydrateArchivedMetadata({
          _id: cardId,
          metadata: projected.metadata,
          userId: card.userId,
        })),
      };
      const rules = classifyLinkCategory(snapshot, card.url);
      if (!rules) {
        continue;
      }
      reviewed += 1;
      const reviewedClassification = await reviewLinkCategoryWithClef(
        ctx,
        { ...snapshot, userId: card.userId },
        rules,
        card.url,
        snapshot.metadata?.linkCategory?.raw?.structured
      );
      if (reviewedClassification === rules) {
        continue;
      }
      // Enrich again for the new category, as categorization would: drop the
      // old category's structured facts and read the page's JSON-LD again.
      const { structured: _structured, ...raw } =
        snapshot.metadata?.linkCategory?.raw ?? {};
      const metadata = enrichLinkCategory(
        {
          ...snapshot,
          metadata: {
            ...snapshot.metadata,
            linkCategory: { ...snapshot.metadata?.linkCategory, raw },
          },
        },
        reviewedClassification,
        { structuredData: await fetchStructuredData(card.url) }
      );
      const written = await ctx.runMutation(
        (internal as any)["migration/backfillLinkCategoriesClef"]
          .applyReviewedCategory,
        {
          cardId,
          metadata,
          expectedCategory: card.metadata.linkCategory.category,
          expectedFetchedAt: card.metadata.linkCategory.fetchedAt,
          expectedUrl: card.url,
        }
      );
      changed += written ? 1 : 0;
    }
    console.log("backfillLinkCategoriesClef review", {
      changed,
      cards: cardIds.length,
      reviewed,
    });
    return { changed, reviewed };
  },
});
