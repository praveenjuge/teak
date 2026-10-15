"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { collectAiUsage } from "../../ai/telemetry";
import { storeDocumentText } from "../../card/documentText";
import { stageCompleted } from "../../card/processingStatus";
import type { CardType } from "../../schema";
import { extractVisualStylesFromTags } from "../../shared/constants";
import { inferFileFormat } from "../../shared/fileFormats";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import type { Id } from "../../shared/types";
import { withBackendErrorCapture } from "../../telemetry/posthog";
import {
  FILES_WORKER_NOT_CONFIGURED,
  generateImageMetadataForStoredKey,
  generateLinkMetadata,
  generateTextMetadata,
  isAiMetadataDeferredError,
} from "../aiMetadata/generators";
import { aiMetadataResultValidator } from "../aiMetadata/schemas";
import { extractFileTextForKey } from "../fileProcessing";
import {
  hasKnownTinyImageDimensions,
  hasMinimumImageAnalysisDimensions,
} from "../imageAnalysis";
import { processAudioCard } from "../mediaFacts";

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

export const resolveImageAnalysisKey = (
  card: ImageAnalysisCard
): string | undefined => {
  if (hasKnownTinyImageDimensions(card.fileMetadata)) {
    return;
  }
  if (card.thumbnailKey) {
    return card.thumbnailKey;
  }
  if (card.fileKey && hasMinimumImageAnalysisDimensions(card.fileMetadata)) {
    return card.fileKey;
  }
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
 * Leaves metadata incomplete for the bounded periodic backfill to retry. A
 * workflow retry would multiply one recoverable failure across its retry
 * budget and crowd every other workflow, account deletion included, out of
 * the shared workpool.
 */
const deferToBackfill = () => ({
  aiTagsCount: 0,
  hasSummary: false,
  hasTranscript: false,
  confidence: 0,
  mode: "skipped" as const,
});

export const generate: any = internalAction({
  args: {
    cardId: v.id("cards"),
    cardType: v.string(),
  },
  returns: aiMetadataResultValidator,
  handler: (ctx: any, args: { cardId: Id<"cards">; cardType: string }) =>
    withBackendErrorCapture(
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
  args: { cardId: Id<"cards">; cardType: string }
) {
  let ownerId: string | undefined;
  return await collectAiUsage(
    () =>
      generateForCard(ctx, args, (userId) => {
        ownerId = userId;
      }),
    async (usage) => {
      if (ownerId && usage.calls > 0) {
        await ctx.runMutation(internal.adminUsage.recordAiUsage, {
          userId: ownerId,
          ...usage,
        });
      }
    }
  );
}

async function transcribeVideo(
  ctx: any,
  card: any
): Promise<string | undefined> {
  if (!card.fileKey) {
    return;
  }
  try {
    const { transcript } = await processAudioCard(ctx, card, {
      recordFacts: false,
    });
    return transcript ?? undefined;
  } catch (error) {
    console.warn("[workflow/metadata] video transcript unavailable", {
      cardId: card._id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function keepDocumentText(
  ctx: any,
  card: any,
  extracted: { pageCount?: number; text: string }
): Promise<void> {
  try {
    await storeDocumentText(ctx, card, extracted);
  } catch (error) {
    console.warn("[workflow/metadata] document text not stored", {
      cardId: card._id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function generateForCard(
  ctx: any,
  { cardId, cardType }: { cardId: Id<"cards">; cardType: string },
  onOwner: (userId: string) => void
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });
  if (card) {
    onOwner(card.userId);
  }

  if (!card) {
    return {
      aiTagsCount: 0,
      hasSummary: false,
      hasTranscript: false,
      confidence: 0,
      mode: "skipped" as const,
    };
  }

  const completeWithoutAi = async () => {
    await ctx.runMutation(
      internal.workflows.aiMetadata.mutations.updateCardAI,
      {
        cardId,
        aiTags: [],
        processingStatus: { metadata: stageCompleted(Date.now(), 0) },
      }
    );
    return {
      aiTagsCount: 0,
      hasSummary: false,
      hasTranscript: false,
      confidence: 0,
      mode: "skipped" as const,
    };
  };

  const aiGate = await ctx.runQuery(internal.adminAccess.getAiGate, {
    userId: card.userId,
  });
  if (aiGate === "user_disabled") {
    return await completeWithoutAi();
  }
  if (aiGate === "paused") {
    console.warn("[workflow/metadata] AI paused from the console; deferring", {
      cardId,
    });
    return deferToBackfill();
  }

  let aiTags: string[] = [];
  let aiSummary = "";
  let aiTranscript: string | undefined;
  let visualStyles: string[] | undefined;
  let confidence = 0.9;

  try {
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
          const result = await generateImageMetadataForStoredKey(imageKey);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          visualStyles = extractVisualStylesFromTags(result.aiTags);
          confidence = 0.9;
        }
        break;
      }
      case "video": {
        if (card.thumbnailKey) {
          const title =
            card.fileMetadata?.fileName ||
            (typeof card.content === "string" ? card.content : undefined);
          const result = await generateImageMetadataForStoredKey(
            card.thumbnailKey,
            title
          );
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          confidence = 0.88;
        }
        aiTranscript = await transcribeVideo(ctx, card);
        if (aiTranscript && !card.thumbnailKey) {
          const result = await generateTextMetadata(aiTranscript);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          confidence = 0.85;
        }
        break;
      }
      case "audio": {
        if (card.fileKey) {
          const { transcript: transcriptResult } = await processAudioCard(
            ctx,
            card
          );
          if (transcriptResult) {
            aiTranscript = transcriptResult;
            const result = await generateTextMetadata(transcriptResult);
            aiTags = result.aiTags;
            aiSummary = result.aiSummary;
            confidence = 0.85;
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
          if (format) {
            const extracted = await extractFileTextForKey(
              card.fileKey,
              format,
              card
            );
            if (extracted.text) {
              contentParts.push(extracted.text);
              await keepDocumentText(ctx, card, extracted);
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
  } catch (error) {
    if (!isAiMetadataDeferredError(error)) {
      throw error;
    }
    console.warn("[workflow/metadata] AI metadata unavailable; deferring", {
      cardId,
      cardType,
      ...(error instanceof Error &&
      error.message === FILES_WORKER_NOT_CONFIGURED
        ? { reason: FILES_WORKER_NOT_CONFIGURED }
        : {}),
    });
    return deferToBackfill();
  }

  if (aiTags.length === 0 && !aiSummary && !aiTranscript) {
    return await completeWithoutAi();
  }

  const updatedProcessing = {
    metadata: stageCompleted(Date.now(), confidence),
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
      aiTagsCount: 0,
      hasSummary: false,
      hasTranscript: false,
      confidence: 0,
      mode: "skipped" as const,
    };
  }

  if (cardType === "link") {
    await ctx.scheduler.runAfter(
      0,
      internal.workflows.screenshot.startScreenshotWorkflow,
      { cardId }
    );
  }

  return {
    aiTagsCount: aiTags.length,
    hasSummary: Boolean(aiSummary),
    hasTranscript: Boolean(aiTranscript),
    confidence,
    mode: "completed" as const,
  };
}
