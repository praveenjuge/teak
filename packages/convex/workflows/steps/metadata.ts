/**
 * Metadata Generation Step
 *
 * Workflow step that generates AI tags and summary for cards.
 * Handles different card types: text, image, video, audio, link, document, quote, palette.
 */

"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { stageCompleted } from "../../card/processingStatus";
import type { CardType } from "../../schema";
import { extractVisualStylesFromTags } from "../../shared/constants";
import { inferFileFormat } from "../../shared/fileFormats";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import type { Id } from "../../shared/types";
import { resolveObjectUrl } from "../../storage/r2";
import { withBackendSpan } from "../../telemetry/sentry";
import {
  generateImageMetadata,
  generateLinkMetadata,
  generateTextMetadata,
} from "../aiMetadata/generators";
import { generateTranscript } from "../aiMetadata/transcript";
import { extractFileTextForAi } from "../fileProcessing";
import { hasMinimumImageAnalysisDimensions } from "../imageAnalysis";

interface LinkPreviewMetadata {
  author?: string;
  description?: string;
  publishedAt?: string;
  publisher?: string;
  status?: string;
  title?: string;
}

interface LinkCardMetadataInput {
  content?: string;
  metadata?: {
    linkPreview?: LinkPreviewMetadata;
  };
  url?: string;
}

interface ImageAnalysisCard {
  fileKey?: string;
  fileMetadata?: { height?: number; width?: number };
  thumbnailKey?: string;
}

const MAX_ORIGINAL_AI_IMAGE_PIXELS = 500 * 500;

export const resolveImageAnalysisKey = (
  card: ImageAnalysisCard
): string | undefined => {
  if (card.thumbnailKey) {
    return card.thumbnailKey;
  }
  const width = card.fileMetadata?.width;
  const height = card.fileMetadata?.height;
  if (
    card.fileKey &&
    typeof width === "number" &&
    typeof height === "number" &&
    hasMinimumImageAnalysisDimensions(card.fileMetadata) &&
    width * height <= MAX_ORIGINAL_AI_IMAGE_PIXELS
  ) {
    return card.fileKey;
  }
  return;
};

export const buildLinkContentParts = (
  card: LinkCardMetadataInput
): string[] => {
  const linkPreviewMetadata =
    card.metadata?.linkPreview?.status === "success"
      ? card.metadata.linkPreview
      : undefined;
  const contentParts: string[] = [];

  const title = linkPreviewMetadata?.title;
  if (title) {
    contentParts.push(`Title: ${title}`);
  }

  const description = linkPreviewMetadata?.description;
  if (description) {
    contentParts.push(`Description: ${description}`);
  }

  const author = linkPreviewMetadata?.author;
  if (author) {
    contentParts.push(`Author: ${author}`);
  }

  const publisher = linkPreviewMetadata?.publisher;
  if (publisher) {
    contentParts.push(`Publisher: ${publisher}`);
  }

  const publishedAt = linkPreviewMetadata?.publishedAt;
  if (publishedAt) {
    contentParts.push(`Published: ${publishedAt}`);
  }

  if (contentParts.length === 0) {
    const urlFallback = card.url || card.content;
    if (urlFallback) {
      contentParts.push(`URL: ${urlFallback}`);
    }
  }

  return contentParts;
};

/**
 * Workflow Step: Generate AI metadata (tags and summary)
 *
 * @returns Metadata generation result
 */
export const generate: any = internalAction({
  args: {
    cardId: v.id("cards"),
    cardType: v.string(),
  },
  returns: v.object({
    aiTags: v.array(v.string()),
    aiSummary: v.optional(v.string()),
    aiTranscript: v.optional(v.string()),
    confidence: v.number(),
    mode: v.union(v.literal("completed"), v.literal("skipped")),
  }),
  handler: (ctx: any, args: { cardId: Id<"cards">; cardType: string }) =>
    withBackendSpan(
      {
        attributes: { "card.type": args.cardType },
        cardId: args.cardId,
        name: "card.ai_metadata",
        operation: TELEMETRY_OPERATIONS.genAiGenerate,
        stage: "ai_metadata",
        surface: "backend",
      },
      () => generateHandler(ctx, args)
    ),
});

export async function generateHandler(
  ctx: any,
  { cardId, cardType }: { cardId: Id<"cards">; cardType: string }
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });

  if (!card) {
    return {
      aiTags: [],
      aiSummary: undefined,
      aiTranscript: undefined,
      confidence: 0,
      mode: "skipped" as const,
    };
  }

  let aiTags: string[] = [];
  let aiSummary = "";
  let aiTranscript: string | undefined;
  let visualStyles: string[] | undefined;
  let confidence = 0.9;

  switch (cardType as CardType) {
    case "text": {
      const result = await generateTextMetadata(card.content);
      aiTags = result.aiTags;
      aiSummary = result.aiSummary;
      confidence = 0.95;
      break;
    }
    case "image": {
      const imageKey = resolveImageAnalysisKey(card);

      if (imageKey) {
        const imageUrl = await resolveObjectUrl(imageKey);
        if (imageUrl) {
          const result = await generateImageMetadata(imageUrl);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          visualStyles = extractVisualStylesFromTags(result.aiTags);
          confidence = 0.9;
        }
      }
      break;
    }
    case "video": {
      if (card.thumbnailKey) {
        const thumbnailUrl = await resolveObjectUrl(card.thumbnailKey);
        if (thumbnailUrl) {
          const title =
            card.fileMetadata?.fileName ||
            (typeof card.content === "string" ? card.content : undefined);
          const result = await generateImageMetadata(thumbnailUrl, title);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          confidence = 0.88;
        }
      }
      break;
    }
    case "audio": {
      if (card.fileKey) {
        const audioUrl = await resolveObjectUrl(card.fileKey);
        if (audioUrl) {
          const transcriptResult = await generateTranscript(
            audioUrl,
            card.fileMetadata?.mimeType
          );
          if (transcriptResult) {
            aiTranscript = transcriptResult;
            const result = await generateTextMetadata(transcriptResult);
            aiTags = result.aiTags;
            aiSummary = result.aiSummary;
            confidence = 0.85;
          }
        }
      }
      break;
    }
    case "link": {
      const contentParts = buildLinkContentParts(card);

      const contentToAnalyze = contentParts.join("\n");
      if (contentToAnalyze.trim()) {
        const result = await generateLinkMetadata(
          contentToAnalyze,
          card.url || card.content
        );
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.9;
      }
      break;
    }
    case "document": {
      const contentParts: string[] = [];
      if (card.fileMetadata?.fileName) {
        contentParts.push(card.fileMetadata.fileName);
      }
      if (card.fileKey && card.fileMetadata?.fileName) {
        const format = inferFileFormat({
          fileName: card.fileMetadata.fileName,
          mimeType: card.fileMetadata.mimeType,
        });
        const fileUrl = await resolveObjectUrl(card.fileKey);
        if (format && fileUrl) {
          const extractedText = await extractFileTextForAi(
            fileUrl,
            format,
            card
          );
          if (extractedText) {
            contentParts.push(extractedText);
          }
        }
      }
      if (card.content?.trim()) {
        contentParts.push(card.content);
      }
      const contentToAnalyze = contentParts.join("\n");
      if (contentToAnalyze.trim()) {
        const result = await generateTextMetadata(contentToAnalyze);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.85;
      }
      break;
    }
    case "quote": {
      if (card.content?.trim()) {
        const result = await generateTextMetadata(card.content);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.95;
      }
      break;
    }
    case "palette": {
      let contentToAnalyze = card.content || "";
      if (card.colors && card.colors.length > 0) {
        const colorInfo = card.colors
          .map(
            (color: any) =>
              `${color.hex}${color.name ? ` (${color.name})` : ""}`
          )
          .join(", ");
        contentToAnalyze = `Colors: ${colorInfo}\n${contentToAnalyze}`;
      }
      if (contentToAnalyze.trim()) {
        const result = await generateTextMetadata(contentToAnalyze);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.9;
      }
      break;
    }
    default:
      break;
  }

  if (aiTags.length === 0 && !aiSummary && !aiTranscript) {
    const now = Date.now();
    const processingStatus = card.processingStatus || {};
    await ctx.runMutation((internal as any).ai.mutations.updateCardProcessing, {
      cardId,
      metadataStatus: "completed",
      processingStatus: {
        ...processingStatus,
        metadata: stageCompleted(now, 0),
      },
    });
    return {
      aiTags: [],
      aiSummary: undefined,
      aiTranscript: undefined,
      confidence: 0,
      mode: "skipped" as const,
    };
  }

  // Update card with AI metadata
  const now = Date.now();
  const processingStatus = card.processingStatus || {};
  const updatedProcessing = {
    ...processingStatus,
    metadata: stageCompleted(now, confidence),
  };

  const saved = await ctx.runMutation(
    internal.workflows.aiMetadata.mutations.updateCardAI,
    {
      cardId,
      aiTags: aiTags.length > 0 ? aiTags : undefined,
      aiSummary: aiSummary || undefined,
      aiTranscript,
      visualStyles:
        cardType === "image" && visualStyles?.length ? visualStyles : undefined,
      processingStatus: updatedProcessing,
    }
  );

  if (saved === false) {
    return {
      aiTags: [],
      aiSummary: undefined,
      aiTranscript: undefined,
      confidence: 0,
      mode: "skipped" as const,
    };
  }

  // Trigger link screenshot generation if it's a link
  if (cardType === "link") {
    await ctx.scheduler.runAfter(
      0,
      internal.workflows.screenshot.startScreenshotWorkflow,
      { cardId }
    );
  }

  return {
    aiTags,
    aiSummary,
    aiTranscript,
    confidence,
    mode: "completed" as const,
  };
}
