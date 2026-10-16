"use node";

import {
  LINK_CATEGORIES,
  type LinkCategory,
} from "@teak/convex/shared/linkCategories";
import {
  DECISION_TEXT_LIMITS,
  readLinkCategoryDecision,
} from "@teak/files-protocol";
import type { ActionCtx } from "../../../_generated/server";
import { runDecision } from "../../../ai/decisions";
import type {
  CategorizationContextCard,
  CategoryClassificationResult,
} from "./index";
import { providerSupportsCategory } from "./providers";

/** Rule tiers Clef may overrule; domain and path rules are final. */
const CLEF_REVIEWED_REASONS = new Set([
  "provider_mapping",
  "heuristic",
  "fallback",
]);

const isLinkCategory = (value: string): value is LinkCategory =>
  (LINK_CATEGORIES as readonly string[]).includes(value);

const collectJsonLdTypes = (value: unknown, types: Set<string>, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 3) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdTypes(item, types, depth + 1);
    }
    return;
  }
  const record = value as Record<string, unknown>;
  for (const type of [record["@type"]].flat()) {
    if (typeof type === "string" && type.trim()) {
      types.add(type.trim().slice(0, 80));
    }
  }
  if (record["@graph"]) {
    collectJsonLdTypes(record["@graph"], types, depth + 1);
  }
};

export const jsonLdTypesFrom = (...sources: unknown[]): string[] => {
  const types = new Set<string>();
  for (const source of sources) {
    collectJsonLdTypes(source, types);
  }
  return [...types].slice(0, DECISION_TEXT_LIMITS.linkJsonLdTypes);
};

/**
 * Lets Clef pick the category when the resolver only guessed it (provider
 * mapping, keyword or the `other` fallback). The Files Worker returns a
 * decision only when Clef is confident and disagrees; otherwise, or when the
 * call fails, the rules' classification is returned unchanged. A provider
 * whose facts need the rules' category keeps it, so its facts survive.
 */
export const reviewLinkCategoryWithClef = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  card: CategorizationContextCard,
  classification: CategoryClassificationResult,
  sourceUrl: string,
  structuredEntities: unknown
): Promise<CategoryClassificationResult> => {
  if (
    !(
      classification.reason &&
      CLEF_REVIEWED_REASONS.has(classification.reason) &&
      sourceUrl
    )
  ) {
    return classification;
  }
  const preview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const result = await runDecision(ctx, {
    op: "decide-link-category",
    params: {
      url: sourceUrl.slice(0, DECISION_TEXT_LIMITS.linkUrl),
      rulesCategory: classification.category,
      ...(preview?.title ? { title: preview.title } : {}),
      ...(preview?.description ? { description: preview.description } : {}),
      ...(preview?.siteName ? { siteName: preview.siteName } : {}),
      jsonLdTypes: jsonLdTypesFrom(
        structuredEntities,
        card.metadata?.linkCategory?.raw?.structured
      ),
    },
    read: (data) => readLinkCategoryDecision(data, isLinkCategory),
    userId: card.userId,
  });
  const decision = result?.decision;
  if (!(decision && isLinkCategory(decision.category))) {
    return classification;
  }
  if (
    classification.reason === "provider_mapping" &&
    !providerSupportsCategory(classification.providerHint, decision.category)
  ) {
    return classification;
  }
  return {
    ...classification,
    category: decision.category,
    confidence: decision.confidence,
    reason: "clef",
  };
};
