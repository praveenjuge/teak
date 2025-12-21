import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export { normalizeUrl } from "./linkMetadata/url";
export * from "./linkMetadata/types";
export * from "./linkMetadata/selectors";
export {
  toSelectorMap,
  findAttributeValue,
  getSelectorValue,
  firstFromSources,
  sanitizeText,
  sanitizeUrl,
  sanitizeImageUrl,
  buildDebugRaw,
  parseLinkPreview,
  buildSuccessPreview,
  buildErrorPreview,
} from "./linkMetadata/parsing";

export const getCardForMetadataHandler = async (ctx: any, { cardId }: any) => {
  return await ctx.db.get("cards", cardId);
};

export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getCardForMetadataHandler,
});

export const updateCardMetadataHandler = async (ctx: any, { cardId, linkPreview, status }: any) => {
  const existingCard = await ctx.db.get("cards", cardId);
  if (!existingCard) {
    console.error(`Card ${cardId} not found for metadata update`);
    return;
  }

  const previousLinkPreview = existingCard.metadata?.linkPreview;
  const nextLinkPreview = linkPreview ? { ...linkPreview } : undefined;

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

  const updateFields: any = {
    metadata: updatedMetadata,
    metadataStatus: status,
    updatedAt: Date.now(),
  };

  const title = nextLinkPreview?.title;
  const description = nextLinkPreview?.description;

  if (title) {
    updateFields.metadataTitle = title;
  }
  if (description) {
    updateFields.metadataDescription = description;
  }

  return await ctx.db.patch("cards", cardId, updateFields);
};

export const updateCardMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    linkPreview: v.optional(v.any()),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: updateCardMetadataHandler,
});

export const updateCardScreenshotHandler = async (ctx: any, { cardId, screenshotStorageId, screenshotUpdatedAt }: any) => {
  const card = await ctx.db.get("cards", cardId);
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

  await ctx.db.patch("cards", cardId, {
    metadata: updatedMetadata,
    updatedAt: Date.now(),
  });
};

export const updateCardScreenshot = internalMutation({
  args: {
    cardId: v.id("cards"),
    screenshotStorageId: v.id("_storage"),
    screenshotUpdatedAt: v.number(),
  },
  handler: updateCardScreenshotHandler,
});
