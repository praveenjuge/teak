"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { hydrateArchivedMetadata } from "../storage/rawMetadata";
import { reviewLinkCategoryWithClef } from "../workflows/steps/categorization/clef";
import {
  type CategorizationContextCard,
  classifyLinkCategory,
  projectCategorizationSnapshot,
} from "../workflows/steps/categorization/index";

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
      const snapshot = await hydrateArchivedMetadata(
        projectCategorizationSnapshot(card as CategorizationContextCard)
      );
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
      const written = await ctx.runMutation(
        (internal as any)["migration/backfillLinkCategoriesClef"]
          .applyReviewedCategory,
        {
          cardId,
          category: reviewedClassification.category,
          confidence: reviewedClassification.confidence,
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
