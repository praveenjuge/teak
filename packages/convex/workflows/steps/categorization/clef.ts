"use node";

import type { ActionCtx } from "../../../_generated/server";
import { runDecision } from "../../../ai/decisions";
import {
  applyLinkCategoryDecision,
  type CategorizationContextCard,
  type CategoryClassificationResult,
  linkCategoryDecisionParams,
  readLinkCategoryReply,
} from "./rules";

export { jsonLdTypesFrom } from "./rules";

/**
 * Lets Clef pick the category when the resolver only guessed it (provider
 * mapping, keyword or the `other` fallback), from a Convex action (the Clef
 * backfill). The Files Worker returns a decision only when Clef is confident
 * and disagrees; otherwise, or when the call fails, the rules'
 * classification is returned unchanged. Card processing runs the same review
 * in the Worker's categorization step.
 */
export const reviewLinkCategoryWithClef = async (
  ctx: Pick<ActionCtx, "runQuery">,
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  sourceUrl: string,
  structuredEntities: unknown
): Promise<CategoryClassificationResult> => {
  const params = linkCategoryDecisionParams(
    card,
    classification,
    sourceUrl,
    structuredEntities
  );
  if (!params) {
    return classification;
  }
  const result = await runDecision(ctx, {
    op: "decide-link-category",
    params,
    read: readLinkCategoryReply,
    userId: card.userId,
  });
  return applyLinkCategoryDecision(classification, result);
};
