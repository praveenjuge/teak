import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export * from "./linkMetadata/instagram";
export {
  buildDebugRaw,
  buildErrorPreview,
  buildSuccessPreview,
  findAttributeValue,
  firstFromSources,
  getSelectorValue,
  parseLinkPreview,
  sanitizeImageUrl,
  sanitizeText,
  sanitizeUrl,
  toSelectorMap,
} from "./linkMetadata/parsing";
export * from "./linkMetadata/selectors";
export * from "./linkMetadata/types";
export { normalizeUrl } from "./linkMetadata/url";

export const getCardForMetadataHandler = async (ctx: any, { cardId }: any) => {
  return await ctx.db.get("cards", cardId);
};

export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getCardForMetadataHandler,
});

export const updateCardMetadataHandler = async (
  ctx: any,
  { cardId, linkPreview, status }: any
) => {
  const existingCard = await ctx.db.get("cards", cardId);
  if (!existingCard) {
    console.error(`Card ${cardId} not found for metadata update`);
    return;
  }

  const previousLinkPreview = existingCard.metadata?.linkPreview;
  const nextLinkPreview = linkPreview ? { ...linkPreview } : undefined;

  if (previousLinkPreview?.imageStorageId) {
    if (
      nextLinkPreview?.imageStorageId &&
      nextLinkPreview.imageStorageId !== previousLinkPreview.imageStorageId
    ) {
      try {
        await ctx.storage.delete(previousLinkPreview.imageStorageId);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete previous OG image ${previousLinkPreview.imageStorageId} for card ${cardId}:`,
          error
        );
      }
    } else if (nextLinkPreview) {
      if (!nextLinkPreview.imageStorageId) {
        nextLinkPreview.imageStorageId = previousLinkPreview.imageStorageId;
        nextLinkPreview.imageUpdatedAt =
          nextLinkPreview.imageUpdatedAt ?? previousLinkPreview.imageUpdatedAt;
      }
      if (
        nextLinkPreview.imageStorageId === previousLinkPreview.imageStorageId
      ) {
        nextLinkPreview.imageWidth =
          nextLinkPreview.imageWidth ?? previousLinkPreview.imageWidth;
        nextLinkPreview.imageHeight =
          nextLinkPreview.imageHeight ?? previousLinkPreview.imageHeight;
      }
    }
  }

  if (previousLinkPreview?.screenshotStorageId) {
    if (
      nextLinkPreview?.screenshotStorageId &&
      nextLinkPreview.screenshotStorageId !==
        previousLinkPreview.screenshotStorageId
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
      nextLinkPreview.screenshotStorageId =
        previousLinkPreview.screenshotStorageId;
      nextLinkPreview.screenshotUpdatedAt =
        nextLinkPreview.screenshotUpdatedAt ??
        previousLinkPreview.screenshotUpdatedAt;
    }
    if (
      nextLinkPreview?.screenshotStorageId ===
      previousLinkPreview.screenshotStorageId
    ) {
      nextLinkPreview.screenshotWidth =
        nextLinkPreview.screenshotWidth ?? previousLinkPreview.screenshotWidth;
      nextLinkPreview.screenshotHeight =
        nextLinkPreview.screenshotHeight ??
        previousLinkPreview.screenshotHeight;
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
      ...(nextLinkPreview !== undefined
        ? { linkPreview: nextLinkPreview }
        : {}),
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

export const updateCardScreenshotHandler = async (
  ctx: any,
  {
    cardId,
    screenshotStorageId,
    screenshotUpdatedAt,
    screenshotWidth,
    screenshotHeight,
  }: any
) => {
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
    ...(typeof screenshotWidth === "number" ? { screenshotWidth } : {}),
    ...(typeof screenshotHeight === "number" ? { screenshotHeight } : {}),
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
    screenshotWidth: v.optional(v.number()),
    screenshotHeight: v.optional(v.number()),
  },
  handler: updateCardScreenshotHandler,
});
