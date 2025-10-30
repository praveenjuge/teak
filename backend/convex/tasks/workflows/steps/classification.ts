/**
 * Classification Step
 *
 * Workflow step that classifies a card's type using AI.
 * Determines if the card is: text, link, image, video, audio, document, palette, or quote.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../../_generated/server";
import { internal } from "../../../_generated/api";
import { Id } from "../../../_generated/dataModel";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { cardClassificationSchema, paletteExtractionSchema } from "../../ai/schemas";
import type { CardType } from "../../../schema";
import {
  parseColorString,
  extractPaletteColors,
  type Color,
} from "@teak/convex/shared/utils/colorUtils";
import {
  type ProcessingStageStatus,
} from "../../cards/processingStatus";

const CLASSIFY_LOG_PREFIX = "[workflow/classify]";

const MAX_PALETTE_COLORS = 12;

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
 * Build classification prompt from card data
 */
const buildClassificationPrompt = (
  card: any,
  stageStatus?: ProcessingStageStatus
): string => {
  const sections: string[] = [];
  sections.push(`Existing type guess: ${card.type}`);
  sections.push(
    `Heuristic confidence: ${stageStatus?.confidence !== undefined
      ? stageStatus.confidence.toFixed(2)
      : "unknown"
    }`
  );

  if (card.url) {
    sections.push(`URL: ${card.url}`);
  }

  if (card.fileMetadata) {
    const { mimeType, fileSize, duration, width, height } = card.fileMetadata;
    sections.push(
      `File metadata: ${JSON.stringify(
        { mimeType, fileSize, duration, width, height },
        null,
        2
      )}`
    );
  }

  const linkPreview =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;

  if (linkPreview) {
    const { title, description, publisher, author } = linkPreview;
    sections.push(
      `Link metadata: ${JSON.stringify(
        { title, description, publisher, author },
        null,
        2
      )}`
    );
  }

  if (card.colors?.length) {
    sections.push(
      `Palette colors: ${card.colors
        .map((color: any) => `${color.hex}${color.name ? ` (${color.name})` : ""}`)
        .join(", ")}`
    );
  }

  if (card.content) {
    const trimmed =
      card.content.length > 4000
        ? `${card.content.slice(0, 4000)}…`
        : card.content;
    sections.push(`Content Preview:\n${trimmed}`);
  }

  return sections.join("\n\n");
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

/**
 * Extract palette colors using AI
 */
const extractPaletteWithAi = async (card: any, text: string): Promise<Color[]> => {
  if (!text) {
    return [];
  }

  try {
    const result = await generateObject({
      model: openai("gpt-5-nano"),
      system:
        "You extract colour palettes from user notes or CSS snippets. Only return colours that are explicitly present and prefer hex codes.",
      prompt: `Extract up to ${MAX_PALETTE_COLORS} unique colours (with their hex codes) from the following palette card. Preserve any provided names:\n\n${text}`,
      schema: paletteExtractionSchema,
    });

    const colors = result.object.colors ?? [];
    return colors
      .map((entry) => {
        const parsed = parseColorString(entry.hex ?? "");
        if (!parsed) {
          return null;
        }
        if (entry.name) {
          parsed.name = entry.name.trim();
        }
        return parsed;
      })
      .filter((color): color is Color => !!color);
  } catch (error) {
    console.error(`${CLASSIFY_LOG_PREFIX} Palette extraction failed`, {
      cardId: card._id,
      error,
    });
    return [];
  }
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
  const aiColors = await extractPaletteWithAi(card, text);
  const contentColors = extractPaletteColors(card.content ?? "");
  const allColors = [...aiColors, ...contentColors];

  const uniqueColors = allColors.reduce((acc, color) => {
    const existing = acc.find((c) => c.hex.toUpperCase() === color.hex.toUpperCase());
    if (!existing) {
      acc.push(color);
    }
    return acc;
  }, [] as Color[]);

  const dbColors = uniqueColors.slice(0, MAX_PALETTE_COLORS).map(toDbColor);

  if (dbColors.length && !colorsMatch(card.colors, dbColors)) {
    await ctx.runMutation(internal.tasks.ai.mutations.updateCardColors, {
      cardId,
      colors: dbColors,
    });
    console.info(`${CLASSIFY_LOG_PREFIX} Updated palette colours`, {
      cardId,
      count: dbColors.length,
    });
  }
};

/**
 * Workflow Step: Classify card type using AI
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
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`${CLASSIFY_LOG_PREFIX} Card not found`, { cardId });
      throw new Error(`Card ${cardId} not found for classification`);
    }

    // Build prompt and run AI classification
    const prompt = buildClassificationPrompt(card, { confidence: 0.5 } as ProcessingStageStatus);
    const classification = await generateObject({
      model: openai("gpt-5-nano"),
      system:
        "You classify cards into one of: text, link, image, video, audio, document, palette, quote. Use the provided clues and be decisive.",
      prompt,
      schema: cardClassificationSchema,
    });

    const resultType = classification.object.type as CardType;
    const resultConfidence = classification.object.confidence ?? 0.8;
    console.info(`${CLASSIFY_LOG_PREFIX} Model result`, {
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

    const normalizedType = urlOnlyCard && resultType !== "link" ? "link" : resultType;
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
      const now = Date.now();

      // Update card type via mutation
      console.info(`${CLASSIFY_LOG_PREFIX} Updating card type`, {
        cardId,
        previousType: card.type,
        nextType: normalizedType,
        confidence: normalizedConfidence,
      });
      await ctx.runMutation((internal as any)["tasks/workflows/steps/classificationMutations"].updateClassification, {
        cardId,
        type: normalizedType,
        confidence: normalizedConfidence,
      });

      // Update palette colors if needed
      await maybeUpdatePaletteColors(ctx, card, normalizedType, cardId);

      // If it's a link and needs metadata extraction, trigger it
      const needsLinkMetadata = normalizedType === "link" && !card.metadata?.linkPreview;
      if (needsLinkMetadata) {
        console.info(`${CLASSIFY_LOG_PREFIX} Scheduling link metadata extraction`, {
          cardId,
        });
        await ctx.scheduler.runAfter(0, internal.linkMetadata.extractLinkMetadata, {
          cardId,
        });
      }
    }

    // Determine which stages need to run next
    const shouldCategorize = normalizedType === "link";
    const shouldGenerateMetadata = true; // Always generate metadata
    const shouldGenerateRenderables = ["image", "video", "document"].includes(normalizedType);

    const result: ClassificationWorkflowResult = {
      type: normalizedType,
      confidence: normalizedConfidence,
      needsLinkMetadata: normalizedType === "link" && !card.metadata?.linkPreview,
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
