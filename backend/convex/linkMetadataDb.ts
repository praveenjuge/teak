import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";

export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: async (ctx, { cardId }) => {
    return await ctx.db.get(cardId);
  },
});

export const updateCardMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    linkPreview: v.optional(v.any()),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, { cardId, linkPreview, status }) => {
    const existingCard = await ctx.db.get(cardId);
    if (!existingCard) {
      console.error(`Card ${cardId} not found for metadata update`);
      return;
    }

    const previousLinkPreview = existingCard.metadata?.linkPreview;
    let nextLinkPreview = linkPreview ? { ...linkPreview } : undefined;

    if (previousLinkPreview?.screenshotStorageId) {
      if (
        nextLinkPreview?.screenshotStorageId &&
        nextLinkPreview.screenshotStorageId !== previousLinkPreview.screenshotStorageId
      ) {
        try {
          await ctx.storage.delete(previousLinkPreview.screenshotStorageId);
        } catch (error) {
          console.error(
            `[linkMetadata] Failed to delete previous screenshot ${previousLinkPreview.screenshotStorageId} for card ${cardId}:`,
            error
          );
        }
      } else if (nextLinkPreview && !nextLinkPreview.screenshotStorageId) {
        nextLinkPreview.screenshotStorageId = previousLinkPreview.screenshotStorageId;
        nextLinkPreview.screenshotUpdatedAt =
          nextLinkPreview.screenshotUpdatedAt ?? previousLinkPreview.screenshotUpdatedAt;
      }
    }

    // For link cards being updated, move to new linkPreview structure
    // For non-link cards, preserve existing metadata while layering the new field
    let updatedMetadata: Record<string, any> = {};

    const existingCategory = existingCard.metadata?.linkCategory;

    if (existingCard.type === "link") {
      updatedMetadata = {
        ...(nextLinkPreview ? { linkPreview: nextLinkPreview } : {}),
        ...(existingCategory ? { linkCategory: existingCategory } : {}),
      };
    } else {
      updatedMetadata = {
        ...existingCard.metadata,
        ...(nextLinkPreview !== undefined ? { linkPreview: nextLinkPreview } : {}),
        ...(existingCategory ? { linkCategory: existingCategory } : {}),
      };
    }

    // Prepare update fields
    const updateFields: any = {
      metadata: updatedMetadata,
      metadataStatus: status,
      updatedAt: Date.now(),
    };

    // Extract title and description for search indexes
    const title = nextLinkPreview?.title;
    const description = nextLinkPreview?.description;

    if (title) {
      updateFields.metadataTitle = title;
    }
    if (description) {
      updateFields.metadataDescription = description;
    }

    return await ctx.db.patch(cardId, updateFields);
  },
});

export const updateCardScreenshot = internalMutation({
  args: {
    cardId: v.id("cards"),
    screenshotStorageId: v.id("_storage"),
    screenshotUpdatedAt: v.number(),
  },
  handler: async (ctx, { cardId, screenshotStorageId, screenshotUpdatedAt }) => {
    const card = await ctx.db.get(cardId);
    if (!card || card.type !== "link") {
      return;
    }

    const existingMetadata = card.metadata || {};
    const existingLinkPreview = existingMetadata.linkPreview || {};

    if (
      existingLinkPreview.screenshotStorageId &&
      existingLinkPreview.screenshotStorageId !== screenshotStorageId
    ) {
      try {
        await ctx.storage.delete(existingLinkPreview.screenshotStorageId);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete previous screenshot ${existingLinkPreview.screenshotStorageId} for card ${cardId}:`,
          error
        );
      }
    }

    const updatedLinkPreview = {
      ...existingLinkPreview,
      screenshotStorageId,
      screenshotUpdatedAt,
    };

    const updatedMetadata = {
      ...existingMetadata,
      linkPreview: updatedLinkPreview,
    };

    await ctx.db.patch(cardId, {
      metadata: updatedMetadata,
      updatedAt: Date.now(),
    });
  },
});
