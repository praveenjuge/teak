/**
 * Classification Step
 *
 * Workflow step that classifies a card's type using deterministic heuristics
 * (mime type, file metadata, URL clues, color extraction, quotes).
 * Determines if the card is: text, link, image, video, audio, document, palette, or quote.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { extractPaletteWithAi } from "../aiMetadata/actions";
import type { CardType } from "../../schema";
import {
  extractPaletteColors,
  type Color,
} from "@teak/convex/shared/utils/colorUtils";
import { normalizeQuoteContent } from "../../tasks/cards/quoteFormatting";

const CLASSIFY_LOG_PREFIX = "[workflow/classify]";

const MAX_PALETTE_COLORS = 12;

const STRONG_CONFIDENCE = 0.97;
const MEDIUM_CONFIDENCE = 0.9;
const PALETTE_CONFIDENCE = 0.88;
const DEFAULT_CONFIDENCE = 0.7;

type ClassificationWorkflowResult = {
  type: CardType;
  confidence: number;
  needsLinkMetadata: boolean;
  shouldCategorize: boolean;
  shouldGenerateMetadata: boolean;
  shouldGenerateRenderables: boolean;
};

type DbColor = {
  hex: string;
  name?: string;
  rgb?: { r: number; g: number; b: number };
  hsl?: { h: number; s: number; l: number };
};

const toDbColor = (color: Color): DbColor => ({
  hex: color.hex.toUpperCase(),
  ...(color.name ? { name: color.name } : {}),
  ...(color.rgb ? { rgb: color.rgb } : {}),
  ...(color.hsl ? { hsl: color.hsl } : {}),
});

const colorsMatch = (
  existing: readonly DbColor[] | undefined,
  next: readonly DbColor[],
): boolean => {
  if (!existing) {
    return next.length === 0;
  }

  if (existing.length !== next.length) {
    return false;
  }

  return next.every((color, index) => {
    const candidate = existing[index];
    if (!candidate) return false;

    const hexMatch = candidate.hex?.toUpperCase() === color.hex.toUpperCase();
    const nameMatch = (candidate.name ?? "") === (color.name ?? "");
    const rgbMatch =
      (!candidate.rgb && !color.rgb) ||
      (candidate.rgb &&
        color.rgb &&
        candidate.rgb.r === color.rgb.r &&
        candidate.rgb.g === color.rgb.g &&
        candidate.rgb.b === color.rgb.b);
    const hslMatch =
      (!candidate.hsl && !color.hsl) ||
      (candidate.hsl &&
        color.hsl &&
        candidate.hsl.h === color.hsl.h &&
        candidate.hsl.s === color.hsl.s &&
        candidate.hsl.l === color.hsl.l);

    return hexMatch && nameMatch && rgbMatch && hslMatch;
  });
};

/**
 * Build palette analysis text for AI extraction
 */
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
  const paletteHints = ["palette", "color palette", "brand colors", "brand palette", "swatch", "swatches", "colorway"];
  const tagHints = (Array.isArray(card.tags) ? card.tags : []).some((tag: string) =>
    typeof tag === "string" && /palette|color/iu.test(tag)
  );
  return paletteHints.some((hint) => text.includes(hint)) || tagHints;
};

const isProbablyPalette = (card: any): boolean => {
  const text = buildPaletteAnalysisText(card);
  const colors = extractPaletteColors(text);
  const hint = hasPaletteHint(card);

  // Require stronger evidence: multiple colors, or colors + explicit hint.
  if (colors.length >= 3) return true;
  if (colors.length >= 2 && hint) return true;
  return false;
};

const extensionFromUrl = (url?: string): string | undefined => {
  if (!url) return undefined;
  try {
    const pathname = new URL(url).pathname;
    const match = /\.([a-zA-Z0-9]+)(?:$|[?#])/u.exec(pathname);
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
};

const classifyByMime = (
  mimeType?: string,
): { type: CardType; confidence: number } | null => {
  if (!mimeType) return null;
  const mime = mimeType.toLowerCase();

  if (mime.startsWith("image/")) {
    return { type: "image", confidence: STRONG_CONFIDENCE };
  }
  if (mime.startsWith("video/")) {
    return { type: "video", confidence: STRONG_CONFIDENCE };
  }
  if (mime.startsWith("audio/")) {
    return { type: "audio", confidence: STRONG_CONFIDENCE };
  }

  const documentMimes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/markdown",
    "text/csv",
    "application/rtf",
  ];

  if (documentMimes.some((candidate) => mime.includes(candidate))) {
    return { type: "document", confidence: STRONG_CONFIDENCE };
  }

  if (mime.startsWith("text/")) {
    return { type: "text", confidence: MEDIUM_CONFIDENCE };
  }

  return null;
};

const classifyByExtension = (
  extension?: string,
): { type: CardType; confidence: number } | null => {
  if (!extension) return null;
  const ext = extension.toLowerCase();

  const imageExt = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "tiff", "avif", "heic"];
  const videoExt = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpeg", "mpg", "wmv"];
  const audioExt = ["mp3", "wav", "flac", "m4a", "aac", "ogg", "oga", "opus"];
  const documentExt = [
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "csv",
    "rtf",
    "md",
    "txt",
    "pages",
    "key",
    "numbers",
  ];

  if (imageExt.includes(ext)) return { type: "image", confidence: MEDIUM_CONFIDENCE };
  if (videoExt.includes(ext)) return { type: "video", confidence: MEDIUM_CONFIDENCE };
  if (audioExt.includes(ext)) return { type: "audio", confidence: MEDIUM_CONFIDENCE };
  if (documentExt.includes(ext)) return { type: "document", confidence: MEDIUM_CONFIDENCE };

  return null;
};

const classifyByFileMetadata = (
  metadata: any,
): { type: CardType; confidence: number } | null => {
  if (!metadata) return null;

  const mimeClassification = classifyByMime(metadata.mimeType);
  if (mimeClassification) return mimeClassification;

  if (typeof metadata.duration === "number" && metadata.duration > 0) {
    // Prefer video when dimensions exist, otherwise audio.
    if (metadata.width || metadata.height) {
      return { type: "video", confidence: MEDIUM_CONFIDENCE };
    }
    return { type: "audio", confidence: MEDIUM_CONFIDENCE };
  }

  if (metadata.width || metadata.height) {
    return { type: "image", confidence: MEDIUM_CONFIDENCE };
  }

  // Any other uploaded file defaults to document
  return { type: "document", confidence: MEDIUM_CONFIDENCE };
};

const deterministicClassify = (
  card: any,
): { type: CardType; confidence: number } => {
  // 1) File metadata (strongest signal)
  const fileMetaResult = classifyByFileMetadata(card.fileMetadata);
  if (fileMetaResult) return fileMetaResult;

  // 2) URL extension cues
  const extensionResult = classifyByExtension(extensionFromUrl(card.url));
  if (extensionResult) return extensionResult;

  // 2b) If a file exists but metadata/extension gave no match, treat as document
  if (card.fileId) {
    return { type: "document", confidence: MEDIUM_CONFIDENCE };
  }

  // 3) Link fallback if a URL exists
  if (card.url) {
    return { type: "link", confidence: MEDIUM_CONFIDENCE };
  }

  // 4) Palette detection (text-driven, only when no link)
  if (isProbablyPalette(card)) {
    return { type: "palette", confidence: PALETTE_CONFIDENCE };
  }

  // 5) Default to text
  return { type: "text", confidence: DEFAULT_CONFIDENCE };
};



/**
 * Update palette colors if card is a palette type
 */
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
  let colors = extractPaletteColors(text).slice(0, MAX_PALETTE_COLORS);

  // Only use AI extraction as fallback if regex parsing found no colors
  if (colors.length === 0) {
    colors = await extractPaletteWithAi(card, text);
  }

  if (colors.length === 0) {
    return;
  }

  const dbColors = colors.map(toDbColor);

  if (dbColors.length && !colorsMatch(card.colors, dbColors)) {
    await ctx.runMutation(
      //@ts-ignore
      internal.workflows.aiMetadata.mutations.updateCardColors,
      {
        cardId,
        colors: dbColors,
      },
    );
    console.info(`${CLASSIFY_LOG_PREFIX} Updated palette colours`, {
      cardId,
      count: dbColors.length,
    });
  }
};

/**
 * Workflow Step: Classify card type using deterministic heuristics
 *
 * @returns Classification result with type and confidence
 */
export const classify = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    type: v.string(),
    confidence: v.number(),
    needsLinkMetadata: v.boolean(),
    shouldCategorize: v.boolean(),
    shouldGenerateMetadata: v.boolean(),
    shouldGenerateRenderables: v.boolean(),
  }),
  handler: async (ctx, { cardId }): Promise<ClassificationWorkflowResult> => {
    console.info(`${CLASSIFY_LOG_PREFIX} Running`, { cardId });
    //@ts-ignore
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`${CLASSIFY_LOG_PREFIX} Card not found`, { cardId });
      throw new Error(`Card ${cardId} not found for classification`);
    }

    // If previously classified as quote and no conflicting signals, keep it sticky
    if (card.type === "quote" && !card.url && !card.fileId) {
      const confidence = card.processingStatus?.classify?.confidence ?? 0.95;
      const stickyResult: ClassificationWorkflowResult = {
        type: "quote",
        confidence,
        needsLinkMetadata: false,
        shouldCategorize: false,
        shouldGenerateMetadata: true,
        shouldGenerateRenderables: false,
      };

      console.info(`${CLASSIFY_LOG_PREFIX} Sticky quote classification`, {
        cardId,
        confidence,
      });

      return stickyResult;
    }

    const quoteNormalization = normalizeQuoteContent(card.content ?? "");
    const heuristicQuote =
      quoteNormalization.removedQuotes &&
      !card.url &&
      !card.fileId;

    if (heuristicQuote) {
      console.info(`${CLASSIFY_LOG_PREFIX} Heuristic quote classification`, {
        cardId,
      });
      await ctx.runMutation(
        (internal as any)["workflows/steps/classificationMutations"].updateClassification,
        {
          cardId,
          type: "quote",
          confidence: 0.95,
        }
      );

      const heuristicResult: ClassificationWorkflowResult = {
        type: "quote",
        confidence: 0.95,
        needsLinkMetadata: false,
        shouldCategorize: false,
        shouldGenerateMetadata: true,
        shouldGenerateRenderables: false,
      };

      return heuristicResult;
    }

    // Deterministic classification (no external AI call)
    const { type: resultType, confidence: resultConfidence } = deterministicClassify(card);
    console.info(`${CLASSIFY_LOG_PREFIX} Heuristic result`, {
      cardId,
      resultType,
      resultConfidence,
    });

    // Normalize type for URL-only cards
    const trimmedContent = typeof card.content === "string" ? card.content.trim() : "";
    const urlOnlyCard =
      !!card.url &&
      !card.fileId &&
      (trimmedContent.length === 0 || trimmedContent === card.url);

    const normalizedType =
      urlOnlyCard && resultType !== "link" ? "link" : resultType;
    const normalizedConfidence = Math.max(0, Math.min(resultConfidence, 1));
    console.info(`${CLASSIFY_LOG_PREFIX} Normalized result`, {
      cardId,
      normalizedType,
      normalizedConfidence,
      urlOnlyCard,
    });

    // Determine if type should be updated
    const shouldForceLink = urlOnlyCard && card.type !== "link";
    const shouldUpdateType =
      shouldForceLink || (normalizedType !== card.type && normalizedConfidence >= 0.6);

    if (shouldUpdateType) {
      // Update card type via mutation
      console.info(`${CLASSIFY_LOG_PREFIX} Updating card type`, {
        cardId,
        previousType: card.type,
        nextType: normalizedType,
        confidence: normalizedConfidence,
      });
      await ctx.runMutation(
        (internal as any)["workflows/steps/classificationMutations"]
          .updateClassification,
        {
          cardId,
          type: normalizedType,
          confidence: normalizedConfidence,
        }
      );

      // Update palette colors if needed
      await maybeUpdatePaletteColors(ctx, card, normalizedType, cardId);
    }

    const needsLinkMetadata =
      normalizedType === "link" &&
      card.metadata?.linkPreview?.status !== "success";

    if (needsLinkMetadata) {
      console.info(`${CLASSIFY_LOG_PREFIX} Scheduling link metadata extraction`, {
        cardId,
      });
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/linkMetadata"].startLinkMetadataWorkflow,
        { cardId, startAsync: true }
      );
    }

    // Determine which stages need to run next
    const shouldCategorize = normalizedType === "link";
    const shouldGenerateMetadata = true; // Always generate metadata
    const shouldGenerateRenderables = ["image", "video", "document"].includes(normalizedType);

    const result: ClassificationWorkflowResult = {
      type: normalizedType,
      confidence: normalizedConfidence,
      needsLinkMetadata,
      shouldCategorize,
      shouldGenerateMetadata,
      shouldGenerateRenderables,
    };

    console.info(`${CLASSIFY_LOG_PREFIX} Completed`, {
      cardId,
      result,
    });

    return result;
  },
});
