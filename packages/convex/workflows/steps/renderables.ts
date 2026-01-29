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
import { internalAction } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { stageCompleted, stageFailed } from "../../card/processingStatus";

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

  // Generate thumbnail for image cards (raster images like PNG, JPG, WebP)
  // SVG files are handled separately below
  const isSvgFile =
    card.fileMetadata?.mimeType === "image/svg+xml" ||
    card.fileMetadata?.fileName?.endsWith(".svg") ||
    card.fileMetadata?.fileName?.endsWith(".SVG");

  if (cardType === "image" && card.fileId && !isSvgFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateThumbnail.generateThumbnail,
      { cardId }
    );
    handleResult(result);
  }

  // Generate thumbnail for SVG images (rasterize to PNG using Playwright)
  if (cardType === "image" && card.fileId && isSvgFile) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateSvgThumbnail.generateSvgThumbnail,
      { cardId }
    );
    handleResult(result);
  }

  // Generate thumbnail for video cards using MediaBunny
  if (cardType === "video" && card.fileId) {
    const result = await ctx.runAction(
      (internal as any).workflows.steps.renderables.generateVideoThumbnail
        .generateVideoThumbnail,
      { cardId }
    );
    handleResult(result);
  }

  // Generate thumbnail for PDF documents
  if (
    cardType === "document" &&
    card.fileId &&
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
      : stageFailed(now, failureReason ?? "renderables_failed", processingStatus.renderables),
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
