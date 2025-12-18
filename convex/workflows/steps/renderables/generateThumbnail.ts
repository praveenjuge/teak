"use node";

import { PhotonImage, SamplingFilter, resize } from "@cf-wasm/photon";
import { internal } from "../../../_generated/api";
import { internalAction } from "../../../_generated/server";
import { v } from "convex/values";

// Maximum thumbnail dimensions
const THUMBNAIL_MAX_WIDTH = 500;
const THUMBNAIL_MAX_HEIGHT = 500;

/**
 * Determine output quality and format based on file size
 * Use aggressive compression to ensure thumbnails are smaller than originals
 */
function getOutputSettings(fileSizeBytes: number): {
  quality: number;
  useJpeg: boolean;
  skipThumbnail: boolean;
} {
  // Skip thumbnail generation for very small files (< 500KB) - they're already optimized
  if (fileSizeBytes < 500_000) {
    return { quality: 100, useJpeg: false, skipThumbnail: true };
  }

  if (fileSizeBytes < 1_000_000) {
    // < 1MB - good WebP compression
    return { quality: 80, useJpeg: false, skipThumbnail: false };
  } else if (fileSizeBytes < 2_000_000) {
    // < 2MB - more WebP compression
    return { quality: 70, useJpeg: false, skipThumbnail: false };
  } else if (fileSizeBytes < 5_000_000) {
    // < 5MB - higher WebP compression
    return { quality: 65, useJpeg: false, skipThumbnail: false };
  } else if (fileSizeBytes < 10_000_000) {
    // < 10MB - strong WebP compression
    return { quality: 60, useJpeg: false, skipThumbnail: false };
  } else if (fileSizeBytes < 20_000_000) {
    // < 20MB - very strong WebP compression
    return { quality: 60, useJpeg: false, skipThumbnail: false };
  } else {
    // >= 20MB - maximum WebP compression
    return { quality: 50, useJpeg: false, skipThumbnail: false };
  }
}

/**
 * Workflow-native thumbnail generation action.
 * Mirrors the previous tasks-based implementation so the renderables step owns its orchestration.
 */
export const generateThumbnail = internalAction({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.object({
    success: v.boolean(),
    generated: v.boolean(),
    thumbnailId: v.optional(v.id("_storage")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // Get the card to verify it exists and is an image
      const card = await ctx.runQuery(internal.card.getCard.getCardInternal, {
        cardId: args.cardId,
      });

      if (!card) {
        return {
          success: false,
          generated: false,
          error: "card_not_found",
        };
      }

      // Only generate thumbnails for image cards
      if (card.type !== "image" || !card.fileId) {
        return {
          success: true,
          generated: false,
        };
      }

      // Skip if thumbnail already exists
      if (card.thumbnailId) {
        return {
          success: true,
          generated: false,
          thumbnailId: card.thumbnailId,
        };
      }

      // Get the original image URL from storage
      const originalImageUrl = await ctx.storage.getUrl(card.fileId);
      if (!originalImageUrl) {
        return {
          success: false,
          generated: false,
          error: "missing_storage_url",
        };
      }

      const inputBytes = await fetch(originalImageUrl)
        .then((res) => res.arrayBuffer())
        .then((buffer) => new Uint8Array(buffer));

      const inputImage = PhotonImage.new_from_byteslice(inputBytes);

      // Get original dimensions and file size
      const originalWidth = inputImage.get_width();
      const originalHeight = inputImage.get_height();
      const fileSizeBytes = inputBytes.byteLength;

      // Get output settings based on file size (primary logic for thumbnail optimization)
      const { quality, useJpeg, skipThumbnail } = getOutputSettings(fileSizeBytes);

      // Skip thumbnail generation for very small files
      if (skipThumbnail) {
        return {
          success: true,
          generated: false,
        };
      }

      // Calculate thumbnail dimensions - always resize to max dimensions with aspect ratio preserved
      const aspectRatio = originalWidth / originalHeight;
      let targetWidth: number;
      let targetHeight: number;

      if (aspectRatio > 1) {
        // Landscape: width is the limiting factor
        targetWidth = Math.min(originalWidth, THUMBNAIL_MAX_WIDTH);
        targetHeight = Math.round(targetWidth / aspectRatio);
      } else {
        // Portrait or square: height is the limiting factor
        targetHeight = Math.min(originalHeight, THUMBNAIL_MAX_HEIGHT);
        targetWidth = Math.round(targetHeight * aspectRatio);
      }

      // Ensure we don't exceed max dimensions
      if (targetWidth > THUMBNAIL_MAX_WIDTH) {
        targetWidth = THUMBNAIL_MAX_WIDTH;
        targetHeight = Math.round(targetWidth / aspectRatio);
      }
      if (targetHeight > THUMBNAIL_MAX_HEIGHT) {
        targetHeight = THUMBNAIL_MAX_HEIGHT;
        targetWidth = Math.round(targetHeight * aspectRatio);
      }

      // Always resize to thumbnail dimensions (let compression do the heavy lifting for size reduction)
      const outputImage = resize(inputImage, targetWidth, targetHeight, SamplingFilter.Nearest);

      // Generate output bytes with appropriate format and quality
      const outputBytes = useJpeg ? outputImage.get_bytes_jpeg(quality) : outputImage.get_bytes_webp();

      // Ensure we provide a standard ArrayBuffer to Blob (avoids TS generic Uint8Array<ArrayBufferLike> incompatibility)
      const outputArrayBuffer =
        outputBytes.buffer instanceof ArrayBuffer
          ? outputBytes.byteOffset === 0 && outputBytes.byteLength === outputBytes.buffer.byteLength
            ? outputBytes.buffer
            : outputBytes.buffer.slice(outputBytes.byteOffset, outputBytes.byteOffset + outputBytes.byteLength)
          : outputBytes.slice().buffer;

      const thumbnailBlob = new Blob([outputArrayBuffer], {
        type: useJpeg ? "image/jpeg" : "image/webp",
      });

      // Store the thumbnail in Convex storage
      const thumbnailId = await ctx.storage.store(thumbnailBlob);

      // Update the card with the thumbnail via internal mutation to ensure DB access
      await ctx.runMutation(
        internal.workflows.steps.renderables.mutations.updateCardThumbnail,
        {
          cardId: args.cardId,
          thumbnailId,
        }
      );

      return {
        success: true,
        generated: true,
        thumbnailId,
      };
    } catch (error) {
      console.error(`Failed to generate thumbnail for card ${args.cardId}:`, error);
      // Don't throw - thumbnail generation failure shouldn't break the card creation flow
      return {
        success: false,
        generated: false,
        error: error instanceof Error ? error.message : "unknown_error",
      };
    }
  },
});

/**
 * Manual trigger for thumbnail generation (useful for testing)
 */
export const manualTriggerThumbnail = internalAction({
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
        internal.workflows.steps.renderables.generateThumbnail.generateThumbnail,
        {
          cardId: args.cardId,
        }
      );
      if (!result.success) {
        return {
          success: false,
          message: `Failed to generate thumbnail: ${result.error || "Unknown error"}`,
        };
      }
      return {
        success: true,
        message: `Thumbnail generation initiated for card ${args.cardId}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to generate thumbnail: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
