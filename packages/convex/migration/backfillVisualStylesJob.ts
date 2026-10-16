"use node";

import { readVisualStylesDecision } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { runDecision } from "../ai/decisions";
import { isVisualStyle } from "../shared/constants";
import { resolveImageAnalysisKey } from "../shared/imageAnalysis";

/**
 * One job of `backfillVisualStyles`: asks Clef for each card's styles and
 * writes them through a mutation that refuses if the image changed since.
 * A card Clef can't answer for keeps its current styles.
 */
export const restyleCards = internalAction({
  args: { cardIds: v.array(v.id("cards")) },
  returns: v.object({
    changed: v.number(),
    failed: v.number(),
    unchanged: v.number(),
  }),
  handler: async (ctx, { cardIds }) => {
    const counts = { changed: 0, failed: 0, unchanged: 0 };
    for (const cardId of cardIds) {
      const card = await ctx.runQuery(
        (internal as any)["migration/backfillVisualStyles"].getStyleCandidate,
        { cardId }
      );
      const sourceKey =
        card?.type === "video"
          ? card.thumbnailKey
          : card && resolveImageAnalysisKey(card);
      if (!(card && sourceKey)) {
        continue;
      }
      const result = await runDecision(ctx, {
        op: "decide-visual-styles",
        params: { sourceKey },
        read: (data) => readVisualStylesDecision(data, isVisualStyle),
        userId: card.userId,
      });
      if (!result) {
        counts.failed += 1;
        continue;
      }
      const outcome = await ctx.runMutation(
        (internal as any)["migration/backfillVisualStyles"].applyVisualStyles,
        {
          cardId,
          // The mutation compares against the key the card shows today.
          expectedSourceKey: card.thumbnailKey ?? card.fileKey,
          styles: result.styles,
        }
      );
      if (outcome === "changed") {
        counts.changed += 1;
      } else if (outcome === "unchanged") {
        counts.unchanged += 1;
      }
    }
    console.log("backfillVisualStyles job", {
      cards: cardIds.length,
      ...counts,
    });
    return counts;
  },
});
