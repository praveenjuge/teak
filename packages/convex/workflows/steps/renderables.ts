/**
 * Renderables Generation Step
 *
 * Workflow step that generates thumbnails and other visual assets for cards.
 * Handles thumbnail generation for:
 * - Image cards (using @cf-wasm/photon for resizing)
 * - SVG images (using @onkernel/sdk with Playwright to rasterize SVG to PNG)
 * - Video cards (using @onkernel/sdk with native HTML5 video + canvas APIs)
 * - PDF documents (using @onkernel/sdk with pdf.js for rendering)
 */

"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { stageCompleted, stageFailed } from "../../card/processingStatus";
import { inferFileFormat } from "../../shared/fileFormats";

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
    success: v.boolean(),
    thumbnailGenerated: v.boolean(),
  }),
  handler: generateHandler,
});

export async function generateHandler(
  ctx: any,
  { cardId, cardType }: { cardId: any; cardType: string }
) {
  const card = await ctx.runQuery(internal.ai.queries.getCardForAI, {
    cardId,
  });

  if (!card) {
    throw new Error(`Card ${cardId} not found for renderables generation`);
  }

  let thumbnailGenerated = false;
  let renderablesSucceeded = true;
  let failureReason: string | undefined;

  const handleResult = (result: {
    success: boolean;
    generated: boolean;
    error?: string;
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

  const handleOptionalResult = (result: {
    generated: boolean;
    success: boolean;
  }) => {
    if (result.generated) {
      thumbnailGenerated = true;
    }
  };

  const format = card.fileMetadata?.fileName
    ? inferFileFormat({
        fileName: card.fileMetadata.fileName,
        mimeType: card.fileMetadata.mimeType,
      })
    : null;

  // Generate thumbnail for image cards (raster images like PNG, JPG, WebP)
  // SVG files are handled separately below
  const isSvgFile = format?.id === "svg";
  const isHeicFile = format?.id === "heic";
  const isGifFile = format?.id === "gif";

  if (cardType === "image" && card.fileKey && !(isSvgFile || isHeicFile)) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateThumbnail
        .generateThumbnail,
      { cardId }
    );
    handleResult(result);
  }

  if (cardType === "image" && card.fileKey && isHeicFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateHeicThumbnail
        .generateHeicThumbnail,
      { cardId }
    );
    handleOptionalResult(result);
  }

  // Generate thumbnail for SVG images (rasterize to PNG using Playwright)
  if (cardType === "image" && card.fileKey && isSvgFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateSvgThumbnail
        .generateSvgThumbnail,
      { cardId }
    );
    handleResult(result);
  }

  // Generate thumbnail for video cards using MediaBunny
  if (cardType === "video" && card.fileKey && !isGifFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateVideoThumbnail
        .generateVideoThumbnail,
      { cardId }
    );
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
    handleResult(result);
  }

  // Update processing status to mark renderables as complete
  const now = Date.now();
  const processingStatus = card.processingStatus || {};
  const updatedProcessing = {
    ...processingStatus,
    renderables: renderablesSucceeded
      ? stageCompleted(now, 0.95)
      : stageFailed(
          now,
          failureReason ?? "renderables_failed",
          processingStatus.renderables
        ),
  };

  await ctx.runMutation((internal as any).ai.mutations.updateCardProcessing, {
    cardId,
    processingStatus: updatedProcessing,
  });

  return {
    success: renderablesSucceeded,
    thumbnailGenerated,
  };
}
