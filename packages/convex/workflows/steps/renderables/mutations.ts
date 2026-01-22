import { internalMutation } from "../../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../../_generated/dataModel";

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

export const updateCardThumbnail = internalMutation({
  args: {
    cardId: v.id("cards"),
    thumbnailId: v.id("_storage"),
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
      thumbnailId: Id<"_storage">;
      updatedAt: number;
      fileMetadata?: { width?: number; height?: number };
    } = {
      thumbnailId: args.thumbnailId,
      updatedAt: Date.now(),
    };

    // Also store original dimensions in fileMetadata for aspect ratio
    // This ensures dimensions are available even when thumbnail isn't generated
    if (args.originalWidth !== undefined || args.originalHeight !== undefined) {
      updates.fileMetadata = {
        ...(card.fileMetadata || {}),
        ...(args.originalWidth !== undefined && { width: args.originalWidth }),
        ...(args.originalHeight !== undefined && { height: args.originalHeight }),
      };
    }

    await ctx.db.patch("cards", args.cardId, updates);
    return null;
  },
});
