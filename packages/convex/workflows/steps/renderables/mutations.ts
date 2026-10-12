import { v } from "convex/values";
import { internalMutation } from "../../../_generated/server";
import { stageFailed } from "../../../card/processingStatus";
import { patchCardWithSearchSync } from "../../../card/searchDocumentHelpers";
import { filePreviewFactsValidator, imageExifValidator } from "../../../schema";

export const markCardRenderablesFailed = internalMutation({
  args: { cardId: v.id("cards"), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }
    const now = Date.now();
    await patchCardWithSearchSync(ctx, args.cardId, {
      processingStatus: {
        ...(card.processingStatus ?? {}),
        renderables: stageFailed(
          now,
          args.error,
          card.processingStatus?.renderables
        ),
      },
      updatedAt: now,
    });
    return null;
  },
});

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
    exif: v.optional(imageExifValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }

    await patchCardWithSearchSync(ctx, args.cardId, {
      fileMetadata: {
        ...(card.fileMetadata || {}),
        width: args.width,
        height: args.height,
        ...(args.exif ? { exif: args.exif } : {}),
      },
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Store container facts (duration, display size) for audio and video cards.
 * Only fills fields the card does not already have, so upload-time or
 * thumbnail-derived values win.
 */
export const updateCardMediaFacts = internalMutation({
  args: {
    cardId: v.id("cards"),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      return null;
    }
    const current = card.fileMetadata || {};
    const missing = {
      ...(args.duration !== undefined &&
        current.duration === undefined && { duration: args.duration }),
      ...(args.width !== undefined &&
        current.width === undefined && { width: args.width }),
      ...(args.height !== undefined &&
        current.height === undefined && { height: args.height }),
    };
    if (Object.keys(missing).length === 0) {
      return null;
    }
    await patchCardWithSearchSync(ctx, args.cardId, {
      fileMetadata: { ...current, ...missing },
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

    await patchCardWithSearchSync(ctx, args.cardId, {
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

export const updateCardThumbnail = internalMutation({
  args: {
    cardId: v.id("cards"),
    thumbnailKey: v.string(),
    // Original image dimensions to store for aspect ratio calculations
    // even when thumbnail generation is skipped (small files)
    originalWidth: v.optional(v.number()),
    originalHeight: v.optional(v.number()),
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
      fileMetadata?: {
        width?: number;
        height?: number;
      };
    } = {
      thumbnailKey: args.thumbnailKey,
      updatedAt: Date.now(),
    };

    // Also store original dimensions in fileMetadata for aspect ratio
    // This ensures dimensions are available even when thumbnail isn't generated
    const hasDimensions =
      args.originalWidth !== undefined || args.originalHeight !== undefined;
    if (hasDimensions) {
      updates.fileMetadata = {
        ...(card.fileMetadata || {}),
        ...(args.originalWidth !== undefined && { width: args.originalWidth }),
        ...(args.originalHeight !== undefined && {
          height: args.originalHeight,
        }),
      };
    }

    await patchCardWithSearchSync(ctx, args.cardId, updates);
    return null;
  },
});
