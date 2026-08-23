import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { filePreviewFactsValidator, imageExifValidator } from "../../../schema";

/**
 * Update only the fileMetadata dimensions (width/height) for a card.
 * Used when thumbnail generation is skipped but we still want to store dimensions.
 * Merges with existing fileMetadata instead of replacing it.
 */
export const updateCardFileMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    width: v.number(),
    height: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await ctx.db.patch("cards", args.cardId, {
      fileMetadata: {
        ...(card.fileMetadata || {}),
        width: args.width,
        height: args.height,
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateCardFilePreview = internalMutation({
  args: {
    cardId: v.id("cards"),
    preview: filePreviewFactsValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await ctx.db.patch("cards", args.cardId, {
      fileMetadata: {
        ...(card.fileMetadata || {}),
        preview: {
          ...(card.fileMetadata?.preview || {}),
          ...args.preview,
        },
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Update renderable extras (preview derivative, placeholder hash, EXIF) for
 * cards whose thumbnail generation was skipped but whose worker pass still
 * produced artifacts.
 */
export const updateCardRenderableExtras = internalMutation({
  args: {
    cardId: v.id("cards"),
    previewKey: v.optional(v.string()),
    placeholderHash: v.optional(v.string()),
    exif: v.optional(imageExifValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await ctx.db.patch("cards", args.cardId, {
      ...(args.previewKey !== undefined && { previewKey: args.previewKey }),
      ...(args.placeholderHash !== undefined && {
        placeholderHash: args.placeholderHash,
      }),
      ...(args.exif !== undefined &&
        args.exif !== null && {
          fileMetadata: { ...(card.fileMetadata || {}), exif: args.exif },
        }),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const updateCardThumbnail = internalMutation({
  args: {
    cardId: v.id("cards"),
    thumbnailKey: v.string(),
    // Original image dimensions to store for aspect ratio calculations
    // even when thumbnail generation is skipped (small files)
    originalWidth: v.optional(v.number()),
    originalHeight: v.optional(v.number()),
    // Bounded preview derivative for large originals
    previewKey: v.optional(v.string()),
    // Thumbhash placeholder (base64) for instant grid placeholders
    placeholderHash: v.optional(v.string()),
    // Camera/capture facts extracted at the edge
    exif: v.optional(imageExifValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    const updates: {
      thumbnailKey: string;
      updatedAt: number;
      previewKey?: string;
      placeholderHash?: string;
      fileMetadata?: {
        width?: number;
        height?: number;
        exif?: typeof imageExifValidator.type;
      };
    } = {
      thumbnailKey: args.thumbnailKey,
      updatedAt: Date.now(),
    };

    if (args.previewKey !== undefined) {
      updates.previewKey = args.previewKey;
    }
    if (args.placeholderHash !== undefined) {
      updates.placeholderHash = args.placeholderHash;
    }

    // Also store original dimensions in fileMetadata for aspect ratio
    // This ensures dimensions are available even when thumbnail isn't generated
    const hasDimensions =
      args.originalWidth !== undefined || args.originalHeight !== undefined;
    if (hasDimensions || args.exif !== undefined) {
      updates.fileMetadata = {
        ...(card.fileMetadata || {}),
        ...(args.originalWidth !== undefined && { width: args.originalWidth }),
        ...(args.originalHeight !== undefined && {
          height: args.originalHeight,
        }),
        ...(args.exif !== undefined &&
          args.exif !== null && { exif: args.exif }),
      };
    }

    await ctx.db.patch("cards", args.cardId, updates);
    return null;
  },
});
