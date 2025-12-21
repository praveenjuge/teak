/**
 * Metadata Generation Step
 *
 * Workflow step that generates AI tags and summary for cards.
 * Handles different card types: text, image, audio, link, document, quote, palette.
 */

"use node";

import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { CardType } from "../../schema";
import {
  generateTextMetadata,
  generateImageMetadata,
  generateLinkMetadata,
} from "../aiMetadata/generators";
import { generateTranscript } from "../aiMetadata/transcript";
import { stageCompleted } from "../../card/processingStatus";
import type { Id } from "../../shared/types";

type LinkPreviewMetadata = {
  status?: string;
  title?: string;
  description?: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
};

type LinkCardMetadataInput = {
  content?: string;
  url?: string;
  metadata?: {
    linkPreview?: LinkPreviewMetadata;
  };
};

export const buildLinkContentParts = (card: LinkCardMetadataInput): string[] => {
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
  }),
  handler: generateHandler,
});

export async function generateHandler(
  ctx: any,
  { cardId, cardType }: { cardId: Id<"cards">; cardType: string }
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });

  if (!card) {
    throw new Error(`Card ${cardId} not found for metadata generation`);
  }

  // For link cards, ensure metadata extraction finished first
  if (
    cardType === "link" &&
    !card.metadata?.linkPreview &&
    card.metadataStatus === "pending"
  ) {
    // Wait a bit and retry
    throw new Error(
      `Link metadata extraction not yet complete for card ${cardId}`
    );
  }

  let aiTags: string[] = [];
  let aiSummary = "";
  let aiTranscript: string | undefined;
  let confidence = 0.9;
  let generationSource: string = "unknown";

  switch (cardType as CardType) {
    case "text": {
      const result = await generateTextMetadata(card.content);
      aiTags = result.aiTags;
      aiSummary = result.aiSummary;
      confidence = 0.95;
      generationSource = "text";
      break;
    }
    case "image": {
      if (card.fileId) {
        const imageUrl = await ctx.storage.getUrl(card.fileId);
        if (imageUrl) {
          const result = await generateImageMetadata(imageUrl);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          confidence = 0.9;
          generationSource = "image";
        }
      }
      break;
    }
    case "audio": {
      if (card.fileId) {
        const audioUrl = await ctx.storage.getUrl(card.fileId);
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
            generationSource = "audio";
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
        generationSource = "link";
      }
      break;
    }
    case "document": {
      let contentToAnalyze = card.content;
      if (card.fileMetadata?.fileName) {
        contentToAnalyze = `${card.fileMetadata.fileName}\n${contentToAnalyze}`;
      }
      if (contentToAnalyze.trim()) {
        const result = await generateTextMetadata(contentToAnalyze);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.85;
        generationSource = "document";
      }
      break;
    }
    case "quote": {
      if (card.content?.trim()) {
        const result = await generateTextMetadata(card.content);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.95;
        generationSource = "quote";
      }
      break;
    }
    case "palette": {
      let contentToAnalyze = card.content || "";
      if (card.colors && card.colors.length > 0) {
        const colorInfo = card.colors
          .map((color: any) => `${color.hex}${color.name ? ` (${color.name})` : ""}`)
          .join(", ");
        contentToAnalyze = `Colors: ${colorInfo}\n${contentToAnalyze}`;
      }
      if (contentToAnalyze.trim()) {
        const result = await generateTextMetadata(contentToAnalyze);
        aiTags = result.aiTags;
        aiSummary = result.aiSummary;
        confidence = 0.9;
        generationSource = "palette";
      }
      break;
    }
    default:
      break;
  }

  if (aiTags.length === 0 && !aiSummary && !aiTranscript) {
    throw new Error("No AI metadata generated for card");
  }

  // Update card with AI metadata
  const now = Date.now();
  const processingStatus = card.processingStatus || {};
  const updatedProcessing = {
    ...processingStatus,
    metadata: stageCompleted(now, confidence),
  };

  await ctx.runMutation(internal.workflows.aiMetadata.mutations.updateCardAI, {
    cardId,
    aiTags: aiTags.length > 0 ? aiTags : undefined,
    aiSummary: aiSummary || undefined,
    aiTranscript,
    processingStatus: updatedProcessing,
  });

  // Trigger link screenshot generation if it's a link
  if (cardType === "link") {
    await ctx.scheduler.runAfter(
      0,
      internal.workflows.screenshot.startScreenshotWorkflow,
      { cardId },
    );
  }

  return {
    aiTags,
    aiSummary,
    aiTranscript,
    confidence,
  };
}
