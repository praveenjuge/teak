import { internal } from "@teak/convex/_generated/api";
import {
  buildPaletteAnalysisText,
  colorsMatch,
  deterministicClassify,
  extractCardColors,
  toDbColor,
} from "@teak/convex/card/classificationRules";
import { normalizeQuoteContent } from "@teak/convex/card/quoteFormatting";
import type { CardType } from "@teak/convex/shared/constants";
import {
  CARD_TYPE_DECISION_TYPES,
  readCardTypeDecision,
} from "@teak/files-protocol";
import {
  type CardDoc,
  type CardJob,
  guardOf,
  loadCard,
  markInProgress,
} from "./context";
import { runDecision } from "./decisions";

// Classification: the card's type from its file, URL and text (the rules in
// @teak/convex/card/classificationRules). Clef reviews the rules' answer for
// a note with no URL or file.

const MAX_PALETTE_COLORS = 12;

export interface CompletedClassification {
  confidence: number;
  mode: "completed";
  needsLinkMetadata: boolean;
  shouldCategorize: boolean;
  shouldGenerateMetadata: boolean;
  shouldGenerateRenderables: boolean;
  type: CardType;
}

export type ClassificationResult =
  | CompletedClassification
  | { mode: "skipped" };

/**
 * The rules' text, quote or palette answer for a card with no URL or file,
 * reviewed by Clef in the Files Worker. Clef's answer replaces the rules only
 * when it is confident, and a palette must still yield a colour.
 */
const reviewTextCardType = async (
  job: CardJob,
  card: CardDoc,
  heuristicQuote: boolean
): Promise<{ type: CardType; confidence: number }> => {
  const rules: { type: CardType; confidence: number } = heuristicQuote
    ? { type: "quote", confidence: 0.95 }
    : deterministicClassify(card);
  if (!(CARD_TYPE_DECISION_TYPES as readonly string[]).includes(rules.type)) {
    return rules;
  }
  const result = await runDecision(job, {
    op: "decide-card-type",
    params: {
      content: card.content,
      rulesType: rules.type,
    },
    read: readCardTypeDecision,
    userId: card.userId,
  });
  const decision = result?.decision;
  if (!decision) {
    return rules;
  }
  if (
    decision.type === "palette" &&
    extractCardColors(buildPaletteAnalysisText(card)).length === 0
  ) {
    return rules;
  }
  return { type: decision.type, confidence: decision.confidence };
};

const maybeUpdatePaletteColors = async (
  job: CardJob,
  card: CardDoc,
  normalizedType: CardType
) => {
  if (normalizedType !== "palette") {
    return;
  }
  const colors = extractCardColors(
    buildPaletteAnalysisText(card),
    MAX_PALETTE_COLORS
  );
  if (colors.length === 0) {
    return;
  }
  const dbColors = colors.map(toDbColor);
  if (!colorsMatch(card.colors, dbColors)) {
    await job.deps.convex.mutation(
      internal.workflows.aiMetadata.mutations.updateCardColors,
      { cardId: job.cardId, colors: dbColors },
      guardOf(job)
    );
  }
};

const recordClassification = (
  job: CardJob,
  args: { confidence: number; type?: CardType }
) =>
  job.deps.convex.mutation(
    internal.workflows.steps.classificationMutations.recordClassification,
    { cardId: job.cardId, ...args },
    guardOf(job)
  );

const completed = (
  type: CardType,
  confidence: number,
  needsLinkMetadata = false
): CompletedClassification => ({
  confidence,
  mode: "completed",
  needsLinkMetadata,
  shouldCategorize: type === "link",
  shouldGenerateMetadata: true,
  shouldGenerateRenderables: ["image", "video", "document"].includes(type),
  type,
});

/**
 * Classifies a card and records the result. Every exit records the classify
 * stage, because steps gated on it (link metadata) wait while it is pending.
 */
export const classifyCard = async (
  job: CardJob
): Promise<ClassificationResult> => {
  const loaded = await loadCard(job);
  if (!loaded) {
    return { mode: "skipped" };
  }
  await markInProgress(job, ["classify"]);
  const { card } = loaded;

  if (card.type === "quote" && !card.url && !card.fileKey) {
    const confidence = card.processingStatus?.classify?.confidence ?? 0.95;
    await recordClassification(job, { confidence });
    return completed("quote", confidence);
  }

  const quoteNormalization = normalizeQuoteContent(card.content ?? "");
  const heuristicQuote =
    quoteNormalization.removedQuotes && !card.url && !card.fileKey;
  const reviewed =
    !(card.url || card.fileKey) && card.content?.trim()
      ? await reviewTextCardType(job, card, heuristicQuote)
      : null;
  if (reviewed ? reviewed.type === "quote" : heuristicQuote) {
    const quoteConfidence = reviewed?.confidence ?? 0.95;
    await recordClassification(job, {
      confidence: quoteConfidence,
      type: "quote",
    });
    return completed("quote", quoteConfidence);
  }

  const { type: resultType, confidence: resultConfidence } =
    reviewed ?? deterministicClassify(card);

  const trimmedContent =
    typeof card.content === "string" ? card.content.trim() : "";
  const urlOnlyCard =
    !!card.url &&
    !card.fileKey &&
    (trimmedContent.length === 0 || trimmedContent === card.url);

  const normalizedType: CardType =
    urlOnlyCard && resultType !== "link" ? "link" : resultType;
  const normalizedConfidence = Math.max(0, Math.min(resultConfidence, 1));

  const shouldForceLink = urlOnlyCard && card.type !== "link";
  const shouldUpdateType =
    shouldForceLink ||
    (normalizedType !== card.type && normalizedConfidence >= 0.6);

  if (shouldUpdateType) {
    await recordClassification(job, {
      confidence: normalizedConfidence,
      type: normalizedType,
    });
    await maybeUpdatePaletteColors(job, card, normalizedType);
  } else {
    // The stage was marked in progress, so it is always recorded.
    await recordClassification(job, { confidence: normalizedConfidence });
  }

  return completed(
    normalizedType,
    normalizedConfidence,
    normalizedType === "link" &&
      card.metadata?.linkPreview?.status !== "success"
  );
};
