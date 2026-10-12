/**
 * Renderables Generation Step
 *
 * Workflow step that generates thumbnails and other visual assets for cards.
 * Handles thumbnail generation for:
 * - Image cards (dimensions and palette; Cloudflare serves renditions on demand)
 * - Video cards (thumbnail frame and hover scrub sprite)
 * - PDF documents (first page)
 * Video and PDF render on the Files Worker's media renderer. A busy or
 * unavailable renderer throws `renderables_retryable:` so the workflow step
 * retries with backoff; once retries run out the stage is marked failed.
 */

"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { stageCompleted, stageFailed } from "../../card/processingStatus";
import { inferFileFormat } from "../../shared/fileFormats";
import { TELEMETRY_OPERATIONS } from "../../shared/telemetry";
import { withBackendErrorCapture } from "../../telemetry/posthog";
import { recordMediaFacts } from "../mediaFacts";

/**
 * Workflow Step: Generate renderables (thumbnails, etc.)
 *
 * @returns Renderables generation result
 */
export const generate: any = internalAction({
  args: {
    cardId: v.id("cards"),
    cardType: v.string(),
  },
  returns: v.object({
    mode: v.union(v.literal("completed"), v.literal("skipped")),
    success: v.boolean(),
    thumbnailGenerated: v.boolean(),
  }),
  handler: (ctx: any, args: { cardId: any; cardType: string }) =>
    withBackendErrorCapture(
      {
        attributes: { "card.type": args.cardType },
        cardId: args.cardId,
        name: "card.renderables",
        operation: TELEMETRY_OPERATIONS.storageRender,
        stage: "renderables",
        surface: "backend",
      },
      () => generateHandler(ctx, args)
    ),
});

export async function generateHandler(
  ctx: any,
  { cardId, cardType }: { cardId: any; cardType: string }
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });

  if (!card) {
    return {
      mode: "skipped" as const,
      success: true,
      thumbnailGenerated: false,
    };
  }

  let thumbnailGenerated = false;
  let renderablesSucceeded = true;
  let failureReason: string | undefined;

  const handleResult = (result: {
    success: boolean;
    generated: boolean;
    error?: string;
    retryable?: boolean;
  }) => {
    if (!result.success) {
      renderablesSucceeded = false;
      if (!failureReason) {
        failureReason = result.error || "thumbnail_generation_failed";
      }
      return;
    }

    if (result.generated) {
      thumbnailGenerated = true;
    }
  };

  const fileName = card.fileMetadata?.fileName;
  const format = fileName
    ? (inferFileFormat({
        fileName,
        mimeType: card.fileMetadata.mimeType,
      }) ?? inferFileFormat({ fileName }))
    : null;

  const isGifFile = format?.id === "gif";

  if (cardType === "image" && card.fileKey) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.analyzeImage.analyzeImage,
      { cardId }
    );
    handleResult(result);
  }

  const throwIfRetryable = (result: {
    error?: string;
    retryable?: boolean;
    success: boolean;
  }) => {
    if (!result.success && result.retryable) {
      throw new Error(
        `renderables_retryable:${result.error ?? "thumbnail_generation_failed"}`
      );
    }
  };

  // The frame op also reports duration and display size; probe only when it
  // made no frame (an existing thumbnail, or a source it declined).
  if (cardType === "video" && card.fileKey && !isGifFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateVideoThumbnail
        .generateVideoThumbnail,
      { cardId }
    );
    throwIfRetryable(result);
    if (!result.generated) {
      await recordMediaFacts(ctx, card, "video");
    }
    handleResult(result);
  }

  if (cardType === "document" && card.fileKey) {
    await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateFilePreview
        .generateFilePreview,
      { cardId }
    );
  }

  // Generate thumbnail for PDF documents
  if (
    cardType === "document" &&
    card.fileKey &&
    card.fileMetadata?.mimeType === "application/pdf"
  ) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generatePdfThumbnail
        .generatePdfThumbnail,
      { cardId }
    );
    throwIfRetryable(result);
    handleResult(result);
  }

  // Update processing status to mark renderables as complete
  // Only the renderables stage is sent; the mutation merges it into the
  // status it reads, so a parallel metadata write is never reset.
  const now = Date.now();
  const updatedProcessing = {
    renderables: renderablesSucceeded
      ? stageCompleted(now, 0.95)
      : stageFailed(
          now,
          failureReason ?? "renderables_failed",
          card.processingStatus?.renderables
        ),
  };

  const saved = await ctx.runMutation(
    (internal as any).ai.mutations.updateCardProcessing,
    {
      cardId,
      processingStatus: updatedProcessing,
    }
  );

  return {
    mode: saved === false ? ("skipped" as const) : ("completed" as const),
    success: saved === false ? true : renderablesSucceeded,
    thumbnailGenerated,
  };
}
