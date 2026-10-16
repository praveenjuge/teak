"use node";

import type { FilesPdfThumbnailResult } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import {
  type FilesWorkerRenderingOutcome,
  runFilesWorkerRendering,
} from "../../../storage/filesWorkerRendering";
import { ensureObjectOwnership } from "../../../storage/ownership";
import { buildR2ObjectKey } from "../../../storage/r2";

/**
 * Render the first page of a PDF card on the Files Worker's media renderer,
 * which reads the document from R2 and writes the PNG there. Encrypted or
 * corrupt documents fail without a retry; a busy or unavailable renderer is
 * retryable.
 */
export const generatePdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailKey: v.optional(v.string()),
    error: v.optional(v.string()),
    retryable: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
      cardId: args.cardId,
    });
    if (!card) {
      return {
        success: false,
        generated: false,
        error: "card_not_found",
        retryable: false,
      };
    }
    if (
      card.type !== "document" ||
      !card.fileKey ||
      card.fileMetadata?.mimeType !== "application/pdf"
    ) {
      return { success: true, generated: false };
    }
    if (card.thumbnailKey) {
      return {
        success: true,
        generated: false,
        thumbnailKey: card.thumbnailKey,
      };
    }

    const thumbnailKey = buildR2ObjectKey({
      userId: card.userId,
      cardId: args.cardId,
      role: "thumbnail",
    });
    await ensureObjectOwnership(ctx, card.userId, thumbnailKey);

    let outcome: FilesWorkerRenderingOutcome<FilesPdfThumbnailResult>;
    try {
      outcome = await runFilesWorkerRendering<FilesPdfThumbnailResult>(
        "render-pdf-thumbnail",
        { destinationKey: thumbnailKey, sourceKey: card.fileKey }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[renderables/pdf] Page render failed for card ${args.cardId}`,
        { error: message }
      );
      return {
        success: false,
        generated: false,
        error: message,
        retryable: true,
      };
    }
    if (outcome.kind === "declined") {
      console.log(
        `[renderables/pdf] Renderer declined card ${args.cardId}: ${outcome.reason}`
      );
      return {
        success: false,
        generated: false,
        error: `pdf_thumbnail_declined:${outcome.reason}`,
        retryable: false,
      };
    }

    await ctx.runMutation(
      internal.workflows.steps.renderables.mutations.updateCardThumbnail,
      {
        cardId: args.cardId,
        thumbnailKey,
        originalWidth: outcome.data.width,
        originalHeight: outcome.data.height,
      }
    );
    return { success: true, generated: true, thumbnailKey };
  },
});

export const manualTriggerPdfThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async (ctx, args) => {
    try {
      const result = await ctx.runAction(
        internal.workflows.steps.renderables.generatePdfThumbnail
          .generatePdfThumbnail,
        {
          cardId: args.cardId,
        }
      );
      if (!result.success) {
        return {
          success: false,
          message: `Failed to generate PDF thumbnail: ${result.error || "Unknown error"}`,
        };
      }
      return {
        success: true,
        message: `PDF thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate PDF thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
