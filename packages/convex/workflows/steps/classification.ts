"use node";

import {
  type Color,
  extractPaletteColors,
  MAX_COLOR_NAME_WORDS,
  parseColorString,
} from "@teak/convex/shared/utils/colorUtils";
import {
  CARD_TYPE_DECISION_TYPES,
  readCardTypeDecision,
} from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { type ActionCtx, internalAction } from "../../_generated/server";
import { runDecision } from "../../ai/decisions";
import { normalizeQuoteContent } from "../../card/quoteFormatting";
import type { CardType } from "../../schema";
import { inferFileFormat } from "../../shared/fileFormats";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import type { Id } from "../../shared/types";
import { withBackendErrorCapture } from "../../telemetry/posthog";

const MAX_PALETTE_COLORS = 12;

const STRONG_CONFIDENCE = 0.97;
const MEDIUM_CONFIDENCE = 0.9;
const PALETTE_CONFIDENCE = 0.88;
const DEFAULT_CONFIDENCE = 0.7;

interface CompletedClassificationWorkflowResult {
  confidence: number;
  mode: "completed";
  needsLinkMetadata: boolean;
  shouldCategorize: boolean;
  shouldGenerateMetadata: boolean;
  shouldGenerateRenderables: boolean;
  type: CardType;
}

interface SkippedClassificationWorkflowResult {
  mode: "skipped";
}

type ClassificationWorkflowResult =
  | CompletedClassificationWorkflowResult
  | SkippedClassificationWorkflowResult;

interface DbColor {
  hex: string;
  hsl?: { h: number; s: number; l: number };
  name?: string;
  rgb?: { r: number; g: number; b: number };
}

const toDbColor = (color: Color): DbColor => ({
  hex: color.hex.toUpperCase(),
  ...(color.name ? { name: color.name } : {}),
  ...(color.rgb ? { rgb: color.rgb } : {}),
  ...(color.hsl ? { hsl: color.hsl } : {}),
});

const colorsMatch = (
  existing: readonly DbColor[] | undefined,
  next: readonly DbColor[]
): boolean => {
  if (!existing) {
    return next.length === 0;
  }

  if (existing.length !== next.length) {
    return false;
  }

  return next.every((color, index) => {
    const candidate = existing[index];
    if (!candidate) {
      return false;
    }

    const hexMatch = candidate.hex?.toUpperCase() === color.hex.toUpperCase();
    const nameMatch = (candidate.name ?? "") === (color.name ?? "");
    const rgbMatch =
      !(candidate.rgb || color.rgb) ||
      (candidate.rgb &&
        color.rgb &&
        candidate.rgb.r === color.rgb.r &&
        candidate.rgb.g === color.rgb.g &&
        candidate.rgb.b === color.rgb.b);
    const hslMatch =
      !(candidate.hsl || color.hsl) ||
      (candidate.hsl &&
        color.hsl &&
        candidate.hsl.h === color.hsl.h &&
        candidate.hsl.s === color.hsl.s &&
        candidate.hsl.l === color.hsl.l);

    return hexMatch && nameMatch && rgbMatch && hslMatch;
  });
};

const buildPaletteAnalysisText = (card: any): string => {
  const sections: string[] = [];

  if (typeof card.content === "string" && card.content.trim()) {
    sections.push(card.content);
  }

  if (typeof card.notes === "string" && card.notes.trim()) {
    sections.push(`Notes: ${card.notes}`);
  }

  if (Array.isArray(card.tags) && card.tags.length > 0) {
    sections.push(`Tags: ${card.tags.join(", ")}`);
  }

  return sections.join("\n").trim();
};

const hasPaletteHint = (card: any): boolean => {
  const text = buildPaletteAnalysisText(card).toLowerCase();
  const paletteHints = [
    "palette",
    "color palette",
    "brand colors",
    "brand palette",
    "swatch",
    "swatches",
    "colorway",
  ];
  const tagHints = (Array.isArray(card.tags) ? card.tags : []).some(
    (tag: string) => typeof tag === "string" && /palette|color/iu.test(tag)
  );
  return paletteHints.some((hint) => text.includes(hint)) || tagHints;
};

// Function arguments are bounded so unclosed "rgb(" text cannot make the
// scan quadratic.
const COLOR_CODE_PATTERN =
  /#(?:[a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})\b|rgba?\([^()]{0,64}\)|hsla?\([^()]{0,64}\)/gi;
// "Primary: #0F4C81", "--bg-primary: #FF5733" or "Accent - rgb(…)". A dash
// separates only when spaced, so hyphenated labels stay whole.
const COLOR_LABEL_PATTERN =
  /^(?:--[\w-]+\s*[:=]\s*|[a-z][\w\s-]{0,32}?(?:\s*[:=]\s*|\s+[-–]\s+))(.+)$/iu;
const COLOR_WORD_DELIMITER_PATTERN = /\s+/;
const PLAIN_WORD_PATTERN = /^[a-z]+$/iu;
const FUNCTIONAL_COLOR_PATTERN = /^(?:rgba?|hsla?)\([^()]{0,64}\)$/iu;
const NUMERIC_REFERENCE_PATTERN = /^#\d{3,4}$/u;
const REPEATED_DIGIT_PATTERN = /^#(\d)\1+$/u;
const NUMERIC_REFERENCE_IN_TEXT_PATTERN = /#\d{3,4}\b/gu;

// "#123" or "#1234" in a note is far more often an issue or ticket number
// than a colour. Repeated digits ("#000", "#333") stay colours.
const isNumericReference = (token: string): boolean =>
  NUMERIC_REFERENCE_PATTERN.test(token) && !REPEATED_DIGIT_PATTERN.test(token);

// parseColorString finds rgb()/hsl() anywhere in a string, so a token with
// parentheses must be exactly one functional colour.
// extractPaletteColors reads "#123" as #112233, so drop references before
// extracting swatches.
const extractCardColors = (text: string, maxColors?: number): Color[] =>
  extractPaletteColors(
    text.replace(NUMERIC_REFERENCE_IN_TEXT_PATTERN, (match) =>
      isNumericReference(match) ? " " : match
    ),
    maxColors
  );

const isColorToken = (token: string): boolean => {
  if (isNumericReference(token)) {
    return false;
  }
  if (token.includes("(") && !FUNCTIONAL_COLOR_PATTERN.test(token)) {
    return false;
  }
  return parseColorString(token) !== null;
};

const countColorCodes = (text: string): number => {
  const hexes = new Set<string>();
  for (const match of text.matchAll(COLOR_CODE_PATTERN)) {
    if (isNumericReference(match[0])) {
      continue;
    }
    const color = parseColorString(match[0]);
    if (color) {
      hexes.add(color.hex.toUpperCase());
    }
  }
  return hexes.size;
};

// Splits on commas, semicolons and line breaks in one pass. Commas inside
// rgb()/hsl() belong to the value, not the list.
const splitColorList = (content: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth = Math.max(0, depth - 1);
    } else if (
      char === ";" ||
      char === "\n" ||
      char === "\r" ||
      (char === "," && depth === 0)
    ) {
      parts.push(content.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(content.slice(start));
  return parts;
};

const isColorValue = (value: string): boolean => {
  const trimmed = value.trim().replace(/[.!]+$/u, "");
  if (!trimmed) {
    return false;
  }
  if (isColorToken(trimmed)) {
    return true;
  }
  // "red green blue" or "light blue red" lists several colours separated by
  // spaces. Read multi-word names first, as colour extraction does.
  const words = trimmed.split(COLOR_WORD_DELIMITER_PATTERN);
  let index = 0;
  while (index < words.length) {
    const longest = Math.min(MAX_COLOR_NAME_WORDS, words.length - index);
    let length = longest;
    for (; length > 0; length--) {
      const run = words.slice(index, index + length);
      const isNameRun =
        length === 1 || run.every((word) => PLAIN_WORD_PATTERN.test(word));
      if (isNameRun && isColorToken(run.join(""))) {
        break;
      }
    }
    if (length === 0) {
      return false;
    }
    index += length;
  }
  return true;
};

// True when the content is nothing but colours, optionally labelled
// ("Primary: #0F4C81"). Prose that only mentions a colour word, such as
// "dark green cabinets", is not a colour list.
const isColorList = (content: unknown): boolean => {
  if (typeof content !== "string") {
    return false;
  }
  const parts = splitColorList(content)
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    parts.length > 0 &&
    parts.every((part) => {
      if (isColorValue(part)) {
        return true;
      }
      const labelled = COLOR_LABEL_PATTERN.exec(part);
      return labelled ? isColorValue(labelled[1]) : false;
    })
  );
};

const isProbablyPalette = (card: any): boolean => {
  // A list such as "mint cream" parses as a colour name but yields no
  // swatches, so a colour list must also produce at least one colour.
  if (isColorList(card.content) && extractCardColors(card.content).length > 0) {
    return true;
  }

  // Colour names in prose are ordinary words, so outside a colour list only
  // explicit colour codes (hex, rgb, hsl) count, unless the card says it is
  // a palette.
  const text = buildPaletteAnalysisText(card);
  const codeCount = countColorCodes(text);
  if (codeCount >= 2) {
    return true;
  }
  if (!hasPaletteHint(card)) {
    return false;
  }
  return codeCount === 1 || extractCardColors(text).length > 0;
};

const fileNameFromUrl = (url?: string): string | undefined => {
  if (!url) {
    return;
  }
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).pop();
  } catch {}
};

const classifyFile = (
  fileName: string | undefined,
  mimeType: string | undefined,
  confidence: number
): { type: CardType; confidence: number } | null => {
  const format = inferFileFormat({
    fileName: fileName || "file",
    mimeType,
  });
  return format ? { type: format.cardType, confidence } : null;
};

const classifyByFileMetadata = (
  metadata: any
): { type: CardType; confidence: number } | null => {
  if (!metadata) {
    return null;
  }

  const mimeClassification = classifyFile(
    metadata.fileName,
    metadata.mimeType,
    STRONG_CONFIDENCE
  );
  if (mimeClassification) {
    return mimeClassification;
  }

  if (typeof metadata.duration === "number" && metadata.duration > 0) {
    if (metadata.width || metadata.height) {
      return { type: "video", confidence: MEDIUM_CONFIDENCE };
    }
    return { type: "audio", confidence: MEDIUM_CONFIDENCE };
  }

  if (metadata.width || metadata.height) {
    return { type: "image", confidence: MEDIUM_CONFIDENCE };
  }

  return { type: "document", confidence: MEDIUM_CONFIDENCE };
};

const deterministicClassify = (
  card: any
): { type: CardType; confidence: number } => {
  const fileMetaResult = classifyByFileMetadata(card.fileMetadata);
  if (fileMetaResult) {
    return fileMetaResult;
  }

  const extensionResult = classifyFile(
    fileNameFromUrl(card.url),
    undefined,
    MEDIUM_CONFIDENCE
  );
  if (extensionResult) {
    return extensionResult;
  }

  if (card.fileKey) {
    return { type: "document", confidence: MEDIUM_CONFIDENCE };
  }

  if (card.url) {
    return { type: "link", confidence: MEDIUM_CONFIDENCE };
  }

  if (isProbablyPalette(card)) {
    return { type: "palette", confidence: PALETTE_CONFIDENCE };
  }

  return { type: "text", confidence: DEFAULT_CONFIDENCE };
};

/** The rules' answer for a note with no URL or file; scripts/clef-eval uses it. */
export const textCardRulesType = (card: { content?: string }): CardType =>
  normalizeQuoteContent(card.content ?? "").removedQuotes
    ? "quote"
    : deterministicClassify(card).type;

/**
 * The rules' text, quote or palette answer for a card with no URL or file,
 * reviewed by Clef in the Files Worker. Clef's answer replaces the rules only
 * when it is confident, and a palette must still yield a colour.
 */
const reviewTextCardType = async (
  ctx: Pick<ActionCtx, "runMutation" | "runQuery">,
  card: any,
  heuristicQuote: boolean
): Promise<{ type: CardType; confidence: number }> => {
  const rules: { type: CardType; confidence: number } = heuristicQuote
    ? { type: "quote", confidence: 0.95 }
    : deterministicClassify(card);
  if (!(CARD_TYPE_DECISION_TYPES as readonly string[]).includes(rules.type)) {
    return rules;
  }
  const result = await runDecision(ctx, {
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
  ctx: any,
  card: any,
  normalizedType: CardType,
  cardId: Id<"cards">
) => {
  if (normalizedType !== "palette") {
    return;
  }

  const text = buildPaletteAnalysisText(card);
  const colors = extractCardColors(text, MAX_PALETTE_COLORS);

  if (colors.length === 0) {
    return;
  }

  const dbColors = colors.map(toDbColor);

  if (dbColors.length && !colorsMatch(card.colors, dbColors)) {
    await ctx.runMutation(
      internal.workflows.aiMetadata.mutations.updateCardColors,
      {
        cardId,
        colors: dbColors,
      }
    );
  }
};

const recordClassification = (
  ctx: Pick<ActionCtx, "runMutation">,
  args: { cardId: Id<"cards">; confidence: number; type?: CardType }
) =>
  ctx.runMutation(
    internal.workflows.steps.classificationMutations.recordClassification,
    args
  );

export const classify = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.union(
    v.object({
      mode: v.literal("completed"),
      type: v.string(),
      confidence: v.number(),
      needsLinkMetadata: v.boolean(),
      shouldCategorize: v.boolean(),
      shouldGenerateMetadata: v.boolean(),
      shouldGenerateRenderables: v.boolean(),
    }),
    v.object({
      mode: v.literal("skipped"),
    })
  ),
  handler: async (ctx, { cardId }): Promise<ClassificationWorkflowResult> =>
    withBackendErrorCapture(
      {
        cardId,
        name: "card.classification",
        operation: TELEMETRY_OPERATIONS.workflowStep,
        stage: "classification",
        surface: "backend",
      },
      async () => {
        const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
          cardId,
        });

        if (!card) {
          return { mode: "skipped" };
        }

        if (card.type === "quote" && !card.url && !card.fileKey) {
          const confidence =
            card.processingStatus?.classify?.confidence ?? 0.95;

          if (card.processingStatus?.classify?.status !== "completed") {
            await recordClassification(ctx, { cardId, confidence });
          }

          const stickyResult: ClassificationWorkflowResult = {
            mode: "completed",
            type: "quote",
            confidence,
            needsLinkMetadata: false,
            shouldCategorize: false,
            shouldGenerateMetadata: true,
            shouldGenerateRenderables: false,
          };

          return stickyResult;
        }

        const quoteNormalization = normalizeQuoteContent(card.content ?? "");
        const heuristicQuote =
          quoteNormalization.removedQuotes && !card.url && !card.fileKey;
        const reviewed =
          !(card.url || card.fileKey) && card.content?.trim()
            ? await reviewTextCardType(ctx, card, heuristicQuote)
            : null;

        if (reviewed ? reviewed.type === "quote" : heuristicQuote) {
          const quoteConfidence = reviewed?.confidence ?? 0.95;
          await recordClassification(ctx, {
            cardId,
            type: "quote",
            confidence: quoteConfidence,
          });

          const heuristicResult: ClassificationWorkflowResult = {
            mode: "completed",
            type: "quote",
            confidence: quoteConfidence,
            needsLinkMetadata: false,
            shouldCategorize: false,
            shouldGenerateMetadata: true,
            shouldGenerateRenderables: false,
          };

          return heuristicResult;
        }

        const { type: resultType, confidence: resultConfidence } =
          reviewed ?? deterministicClassify(card);

        const trimmedContent =
          typeof card.content === "string" ? card.content.trim() : "";
        const urlOnlyCard =
          !!card.url &&
          !card.fileKey &&
          (trimmedContent.length === 0 || trimmedContent === card.url);

        const normalizedType =
          urlOnlyCard && resultType !== "link" ? "link" : resultType;
        const normalizedConfidence = Math.max(0, Math.min(resultConfidence, 1));

        const shouldForceLink = urlOnlyCard && card.type !== "link";
        const shouldUpdateType =
          shouldForceLink ||
          (normalizedType !== card.type && normalizedConfidence >= 0.6);

        if (shouldUpdateType) {
          await recordClassification(ctx, {
            cardId,
            type: normalizedType,
            confidence: normalizedConfidence,
          });

          await maybeUpdatePaletteColors(ctx, card, normalizedType, cardId);
        } else if (card.processingStatus?.classify?.status !== "completed") {
          await recordClassification(ctx, {
            cardId,
            confidence: normalizedConfidence,
          });
        }

        const needsLinkMetadata =
          normalizedType === "link" &&
          card.metadata?.linkPreview?.status !== "success";

        const shouldCategorize = normalizedType === "link";
        const shouldGenerateMetadata = true;
        const shouldGenerateRenderables = [
          "image",
          "video",
          "document",
        ].includes(normalizedType);

        const result: ClassificationWorkflowResult = {
          mode: "completed",
          type: normalizedType,
          confidence: normalizedConfidence,
          needsLinkMetadata,
          shouldCategorize,
          shouldGenerateMetadata,
          shouldGenerateRenderables,
        };

        return result;
      }
    ),
});
