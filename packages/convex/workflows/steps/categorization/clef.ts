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
