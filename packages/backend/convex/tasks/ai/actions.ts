import { v } from "convex/values";
import { action, internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { Id } from "../../_generated/dataModel";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { generateTextMetadata, generateImageMetadata, generateLinkMetadata } from "./metadata_generators";
import { generateTranscript } from "./transcript";
import {
  buildInitialProcessingStatus,
  shouldRunRenderablesStage,
  stageCompleted,
  stageFailed,
  stageInProgress,
  stagePending,
  withStageStatus,
  type ProcessingStageKey,
  type ProcessingStageStatus,
  type ProcessingStatus,
} from "../cards/processingStatus";
import { cardClassificationSchema } from "./schemas";
import type { CardType } from "../../schema";

const CLASSIFY_RETRY_DELAYS = [5000, 30000, 120000];
const METADATA_RETRY_DELAYS = [5000, 20000, 60000];
const RENDER_RETRY_DELAYS = [5000, 15000];

const stageNeedsWork = (status?: ProcessingStageStatus) =>
  !status || status.status === "pending" || status.status === "failed";

const stageRunning = (status?: ProcessingStageStatus) =>
  status?.status === "in_progress";

const completeStage = (
  previous: ProcessingStageStatus | undefined,
  now: number,
  confidence: number
): ProcessingStageStatus => ({
  ...stageCompleted(now, confidence),
  startedAt: previous?.startedAt ?? previous?.completedAt ?? now,
});

const ensureProcessingStatus = async (
  ctx: any,
  card: any,
  options: { classificationFallback: "pending" | "completed" }
): Promise<ProcessingStatus> => {
  const now = Date.now();
  let processing: ProcessingStatus = card.processingStatus ||
    buildInitialProcessingStatus({
      now,
      cardType: card.type as CardType,
      classificationStatus:
        options.classificationFallback === "pending"
          ? stagePending()
          : stageCompleted(now, 1),
    });

  let mutated = false;

  if (!processing.classify) {
    processing = withStageStatus(
      processing,
      "classify",
      options.classificationFallback === "pending"
        ? stagePending()
        : stageCompleted(now, 1)
    );
    mutated = true;
  }

  if (!processing.metadata) {
    processing = withStageStatus(processing, "metadata", stagePending());
    mutated = true;
  }

  if (!processing.renderables) {
    const shouldRender = shouldRunRenderablesStage(card.type as CardType);
    processing = withStageStatus(
      processing,
      "renderables",
      shouldRender ? stagePending() : stageCompleted(now, 1)
    );
    mutated = true;
  }

  if (mutated) {
    await ctx.runMutation(internal.tasks.ai.mutations.updateCardProcessing, {
      cardId: card._id,
      processingStatus: processing,
      type: card.type as CardType,
    });
  }

  return processing;
};

const scheduleNextStage = async (
  ctx: any,
  cardId: Id<"cards">,
  processing: ProcessingStatus
) => {
  const classifyStatus = processing.classify;
  if (stageNeedsWork(classifyStatus)) {
    if (!stageRunning(classifyStatus)) {
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.runClassificationStage, {
        cardId,
        retryCount: 0,
      });
    }
    return;
  }

  const metadataStatus = processing.metadata;
  if (stageNeedsWork(metadataStatus)) {
    if (!stageRunning(metadataStatus)) {
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.runMetadataStage, {
        cardId,
        retryCount: 0,
      });
    }
    return;
  }

  const renderablesStatus = processing.renderables;
  if (stageNeedsWork(renderablesStatus)) {
    if (!stageRunning(renderablesStatus)) {
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.runRenderablesStage, {
        cardId,
        retryCount: 0,
      });
    }
  }
};

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
  } else if (card.metadata?.microlinkData?.data) {
    const { title, description, publisher, author } =
      card.metadata.microlinkData.data;
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
    const trimmed = card.content.length > 4000
      ? `${card.content.slice(0, 4000)}…`
      : card.content;
    sections.push(`Content Preview:\n${trimmed}`);
  }

  return sections.join("\n\n");
};

const upsertStageStatus = async (
  ctx: any,
  cardId: Id<"cards">,
  processing: ProcessingStatus,
  stage: ProcessingStageKey,
  status: ProcessingStageStatus,
  extra: { type?: CardType; metadataStatus?: string; metadata?: any } = {}
) => {
  const updated = withStageStatus(processing, stage, status);
  await ctx.runMutation(internal.tasks.ai.mutations.updateCardProcessing, {
    cardId,
    processingStatus: updated,
    ...(extra.type ? { type: extra.type } : {}),
    ...(extra.metadataStatus ? { metadataStatus: extra.metadataStatus } : {}),
    ...(extra.metadata !== undefined ? { metadata: extra.metadata } : {}),
  });
  return updated;
};

export const startProcessingPipeline = internalAction({
  args: {
    cardId: v.id("cards"),
    classificationRequired: v.optional(v.boolean()),
  },
  handler: async (ctx, { cardId, classificationRequired }) => {
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`[pipeline] Card ${cardId} not found when starting pipeline`);
      return;
    }

    let processing = card.processingStatus as ProcessingStatus | undefined;
    if (!processing) {
      processing = await ensureProcessingStatus(ctx, card, {
        classificationFallback: classificationRequired ? "pending" : "completed",
      });
    }

    await scheduleNextStage(ctx, cardId, processing);
  },
});

export const runClassificationStage = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`[pipeline] Card ${cardId} missing for classification`);
      return;
    }

    let processing = await ensureProcessingStatus(ctx, card, {
      classificationFallback: "pending",
    });

    const stageStatus = processing.classify;
    if (!stageNeedsWork(stageStatus)) {
      await scheduleNextStage(ctx, cardId, processing);
      return;
    }

    if (stageRunning(stageStatus)) {
      return;
    }

    const now = Date.now();
    processing = await upsertStageStatus(
      ctx,
      cardId,
      processing,
      "classify",
      stageInProgress(now, stageStatus)
    );

    try {
      const prompt = buildClassificationPrompt(card, stageStatus);
      const classification = await generateObject({
        model: openai("gpt-5-nano"),
        system:
          "You classify cards into one of: text, link, image, video, audio, document, palette, quote. Use the provided clues and be decisive.",
        prompt,
        schema: cardClassificationSchema,
      });

      const resultType = classification.object.type as CardType;
      const resultConfidence = classification.object.confidence ?? 0.8;
      const trimmedContent = typeof card.content === "string" ? card.content.trim() : "";
      const urlOnlyCard =
        !!card.url &&
        !card.fileId &&
        (trimmedContent.length === 0 || trimmedContent === card.url);

      const normalizedType = urlOnlyCard && resultType !== "link" ? "link" : resultType;
      const normalizedConfidence = Math.max(0, Math.min(resultConfidence, 1));
      const shouldForceLink = urlOnlyCard && card.type !== "link";
      const shouldUpdateType =
        shouldForceLink ||
        (normalizedType !== card.type && normalizedConfidence >= 0.6);

      let processingForUpdate = processing;
      const stageUpdateTimestamp = Date.now();
      const extraUpdates: {
        type?: CardType;
        metadataStatus?: "pending" | "completed" | "failed";
      } = {};

      if (shouldUpdateType) {
        extraUpdates.type = normalizedType;
        processingForUpdate = withStageStatus(
          processingForUpdate,
          "metadata",
          stagePending()
        );

        const requiresRenderables = shouldRunRenderablesStage(normalizedType);
        processingForUpdate = withStageStatus(
          processingForUpdate,
          "renderables",
          requiresRenderables
            ? stagePending()
            : stageCompleted(stageUpdateTimestamp, 1)
        );

        if (normalizedType === "link") {
          extraUpdates.metadataStatus = "pending";
        }
      }

      processing = await upsertStageStatus(
        ctx,
        cardId,
        processingForUpdate,
        "classify",
        completeStage(stageStatus, stageUpdateTimestamp, normalizedConfidence),
        extraUpdates
      );

      if (shouldUpdateType && normalizedType === "link") {
        await ctx.scheduler.runAfter(
          0,
          internal.linkMetadata.extractLinkMetadata,
          { cardId }
        );
      }

      await scheduleNextStage(ctx, cardId, processing);
    } catch (error) {
      console.error(`[pipeline] Classification failed for ${cardId}:`, error);
      processing = await upsertStageStatus(
        ctx,
        cardId,
        processing,
        "classify",
        stageFailed(Date.now(), error instanceof Error ? error.message : String(error), stageStatus),
        { type: card.type as CardType }
      );

      if (retryCount < CLASSIFY_RETRY_DELAYS.length) {
        const delay = CLASSIFY_RETRY_DELAYS[retryCount];
        await ctx.scheduler.runAfter(delay, internal.tasks.ai.actions.runClassificationStage, {
          cardId,
          retryCount: retryCount + 1,
        });
      }
    }
  },
});

export const runMetadataStage = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`[pipeline] Card ${cardId} missing for metadata stage`);
      return;
    }

    let processing = await ensureProcessingStatus(ctx, card, {
      classificationFallback: "completed",
    });

    if (stageNeedsWork(processing.classify)) {
      await scheduleNextStage(ctx, cardId, processing);
      return;
    }

    const stageStatus = processing.metadata;
    if (!stageNeedsWork(stageStatus)) {
      await scheduleNextStage(ctx, cardId, processing);
      return;
    }

    if (stageRunning(stageStatus)) {
      return;
    }

    // For link cards, ensure metadata extraction finished first
    if (
      card.type === "link" &&
      !card.metadata?.linkPreview &&
      !card.metadata?.microlinkData &&
      card.metadataStatus === "pending"
    ) {
      if (retryCount < METADATA_RETRY_DELAYS.length) {
        const delay = METADATA_RETRY_DELAYS[Math.min(retryCount, METADATA_RETRY_DELAYS.length - 1)];
        await ctx.scheduler.runAfter(delay, internal.tasks.ai.actions.runMetadataStage, {
          cardId,
          retryCount: retryCount + 1,
        });
      }
      return;
    }

    const now = Date.now();
    processing = await upsertStageStatus(
      ctx,
      cardId,
      processing,
      "metadata",
      stageInProgress(now, stageStatus)
    );

    try {
      let aiTags: string[] = [];
      let aiSummary = "";
      let aiTranscript: string | undefined;
      let confidence = 0.9;

      switch (card.type as CardType) {
        case "text": {
          const result = await generateTextMetadata(card.content);
          aiTags = result.aiTags;
          aiSummary = result.aiSummary;
          confidence = 0.95;
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
              }
            }
          }
          break;
        }
        case "link": {
          const linkPreviewMetadata =
            card.metadata?.linkPreview?.status === "success"
              ? card.metadata.linkPreview
              : undefined;
          const legacyLinkMetadata = card.metadata?.microlinkData?.data;
          const contentParts: string[] = [];

          const title = linkPreviewMetadata?.title || legacyLinkMetadata?.title;
          if (title) {
            contentParts.push(`Title: ${title}`);
          }

          const description =
            linkPreviewMetadata?.description || legacyLinkMetadata?.description;
          if (description) {
            contentParts.push(`Description: ${description}`);
          }

          const author = linkPreviewMetadata?.author || legacyLinkMetadata?.author;
          if (author) {
            contentParts.push(`Author: ${author}`);
          }

          const publisher =
            linkPreviewMetadata?.publisher || legacyLinkMetadata?.publisher;
          if (publisher) {
            contentParts.push(`Publisher: ${publisher}`);
          }

          const publishedAt =
            linkPreviewMetadata?.publishedAt || legacyLinkMetadata?.date;
          if (publishedAt) {
            contentParts.push(`Published: ${publishedAt}`);
          }

          if (contentParts.length === 0 && card.content) {
            contentParts.push(`URL: ${card.content}`);
          }

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
          let contentToAnalyze = card.content;
          if (card.fileMetadata?.fileName) {
            contentToAnalyze = `${card.fileMetadata.fileName}\n${contentToAnalyze}`;
          }
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
              .map((color: any) => `${color.hex}${color.name ? ` (${color.name})` : ""}`)
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
        // Nothing generated, mark as failed so we can inspect later
        throw new Error("No AI metadata generated for card");
      }

      const updatedProcessing = withStageStatus(
        processing,
        "metadata",
        completeStage(stageStatus, Date.now(), confidence)
      );

      await ctx.runMutation(internal.tasks.ai.mutations.updateCardAI, {
        cardId,
        aiTags: aiTags.length > 0 ? aiTags : undefined,
        aiSummary: aiSummary || undefined,
        aiTranscript,
        aiModelMeta: {
          provider: "openai",
          model: card.type === "image" ? "gpt-5-nano" : "gpt-5-nano",
          version: "2024-08-06",
          generatedAt: Date.now(),
        },
        processingStatus: updatedProcessing,
      });

      if (card.type === "link") {
        await ctx.scheduler.runAfter(0, internal.linkMetadata.generateLinkScreenshot, {
          cardId,
        });
      }

      await scheduleNextStage(ctx, cardId, updatedProcessing);
    } catch (error) {
      console.error(`[pipeline] Metadata stage failed for ${cardId}:`, error);
      const failedProcessing = await upsertStageStatus(
        ctx,
        cardId,
        processing,
        "metadata",
        stageFailed(Date.now(), error instanceof Error ? error.message : String(error), stageStatus)
      );

      if (retryCount < METADATA_RETRY_DELAYS.length) {
        const delay = METADATA_RETRY_DELAYS[retryCount];
        await ctx.scheduler.runAfter(delay, internal.tasks.ai.actions.runMetadataStage, {
          cardId,
          retryCount: retryCount + 1,
        });
      }
    }
  },
});

export const runRenderablesStage = internalAction({
  args: {
    cardId: v.id("cards"),
    retryCount: v.optional(v.number()),
  },
  handler: async (ctx, { cardId, retryCount = 0 }) => {
    const card = await ctx.runQuery(internal.tasks.ai.queries.getCardForAI, {
      cardId,
    });

    if (!card) {
      console.warn(`[pipeline] Card ${cardId} missing for renderables stage`);
      return;
    }

    let processing = await ensureProcessingStatus(ctx, card, {
      classificationFallback: "completed",
    });

    const stageStatus = processing.renderables;
    if (!stageNeedsWork(stageStatus)) {
      await scheduleNextStage(ctx, cardId, processing);
      return;
    }

    if (!shouldRunRenderablesStage(card.type as CardType)) {
      processing = await upsertStageStatus(
        ctx,
        cardId,
        processing,
        "renderables",
        completeStage(stageStatus, Date.now(), 1)
      );
      await scheduleNextStage(ctx, cardId, processing);
      return;
    }

    if (stageRunning(stageStatus)) {
      return;
    }

    const now = Date.now();
    processing = await upsertStageStatus(
      ctx,
      cardId,
      processing,
      "renderables",
      stageInProgress(now, stageStatus)
    );

    try {
      if (card.type === "image" && card.fileId) {
        await ctx.runAction(
          internal.tasks.thumbnails.generateThumbnail.generateThumbnail,
          { cardId }
        );
      }

      const completedProcessing = await upsertStageStatus(
        ctx,
        cardId,
        processing,
        "renderables",
        completeStage(stageStatus, Date.now(), 0.95)
      );

      await scheduleNextStage(ctx, cardId, completedProcessing);
    } catch (error) {
      console.error(`[pipeline] Renderables stage failed for ${cardId}:`, error);
      const failedProcessing = await upsertStageStatus(
        ctx,
        cardId,
        processing,
        "renderables",
        stageFailed(Date.now(), error instanceof Error ? error.message : String(error), stageStatus)
      );

      if (retryCount < RENDER_RETRY_DELAYS.length) {
        const delay = RENDER_RETRY_DELAYS[retryCount];
        await ctx.scheduler.runAfter(delay, internal.tasks.ai.actions.runRenderablesStage, {
          cardId,
          retryCount: retryCount + 1,
        });
      }
    }
  },
});

export const enqueueMissingAiGeneration = internalAction({
  args: {},
  handler: async (ctx): Promise<{ enqueuedCount: number; error?: string }> => {
    try {
      const cardsToProcess: { cardId: Id<"cards"> }[] = await ctx.runQuery(
        internal.tasks.ai.queries.findCardsMissingAi,
        {}
      );

      for (const { cardId } of cardsToProcess) {
        await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.startProcessingPipeline, {
          cardId,
        });
      }

      return { enqueuedCount: cardsToProcess.length };
    } catch (error) {
      console.error("[pipeline] Error enqueueing AI metadata backfill:", error);
      return { enqueuedCount: 0, error: String(error) };
    }
  },
});

export const manuallyGenerateAI = action({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Authentication required");
    }

    const verification = await ctx.runQuery(
      internal.tasks.ai.queries.getCardForVerification,
      {
        cardId,
        userId: user.subject,
      }
    );

    if (!verification) {
      throw new Error("Card not found or access denied");
    }

    await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.startProcessingPipeline, {
      cardId,
    });

    return { success: true };
  },
});
