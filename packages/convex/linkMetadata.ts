import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { deleteObject } from "./storage/r2";

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
  const collectMediaStorageRefs = (mediaItems: any[] | undefined) => {
    const storageKeys = new Set<string>();

    for (const item of mediaItems ?? []) {
      if (item?.storageKey) {
        storageKeys.add(item.storageKey);
      }
      if (item?.posterStorageKey) {
        storageKeys.add(item.posterStorageKey);
      }
    }

    return storageKeys;
  };

  const previousImageRef = previousLinkPreview?.imageStorageKey;
  const nextImageRef = nextLinkPreview?.imageStorageKey;

  if (previousImageRef) {
    if (nextImageRef && nextImageRef !== previousImageRef) {
      try {
        await deleteObject(ctx, previousImageRef);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete previous OG image for card ${cardId}:`,
          error
        );
      }
    } else if (nextLinkPreview) {
      if (!nextLinkPreview.imageStorageKey) {
        nextLinkPreview.imageStorageKey = previousLinkPreview.imageStorageKey;
        nextLinkPreview.imageUpdatedAt =
          nextLinkPreview.imageUpdatedAt ?? previousLinkPreview.imageUpdatedAt;
      }
      if (nextLinkPreview.imageStorageKey === previousImageRef) {
        nextLinkPreview.imageWidth =
          nextLinkPreview.imageWidth ?? previousLinkPreview.imageWidth;
        nextLinkPreview.imageHeight =
          nextLinkPreview.imageHeight ?? previousLinkPreview.imageHeight;
      }
    }
  }

  const previousScreenshotRef = previousLinkPreview?.screenshotStorageKey;
  const nextScreenshotRef = nextLinkPreview?.screenshotStorageKey;

  if (previousScreenshotRef) {
    if (nextScreenshotRef && nextScreenshotRef !== previousScreenshotRef) {
      try {
        await deleteObject(ctx, previousScreenshotRef);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete previous screenshot for card ${cardId}:`,
          error
        );
      }
    } else if (nextLinkPreview && !nextLinkPreview.screenshotStorageKey) {
      nextLinkPreview.screenshotStorageKey =
        previousLinkPreview.screenshotStorageKey;
      nextLinkPreview.screenshotUpdatedAt =
        nextLinkPreview.screenshotUpdatedAt ??
        previousLinkPreview.screenshotUpdatedAt;
    }
    if (nextLinkPreview?.screenshotStorageKey === previousScreenshotRef) {
      nextLinkPreview.screenshotWidth =
        nextLinkPreview.screenshotWidth ?? previousLinkPreview.screenshotWidth;
      nextLinkPreview.screenshotHeight =
        nextLinkPreview.screenshotHeight ??
        previousLinkPreview.screenshotHeight;
    }
  }

  if (previousLinkPreview?.media?.length) {
    if (nextLinkPreview?.media) {
      const nextMediaStorageIds = collectMediaStorageRefs(
        nextLinkPreview.media
      );
      const previousMediaStorageIds = collectMediaStorageRefs(
        previousLinkPreview.media
      );

      await Promise.all(
        Array.from(previousMediaStorageIds).map(async (storageRef) => {
          if (nextMediaStorageIds.has(storageRef)) {
            return;
          }

          try {
            await deleteObject(ctx, storageRef);
          } catch (error) {
            console.error(
              `[linkMetadata] Failed to delete previous media ${storageRef} for card ${cardId}:`,
              error
            );
          }
        })
      );
    } else if (nextLinkPreview) {
      nextLinkPreview.media = previousLinkPreview.media;
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
    screenshotStorageKey,
    screenshotUpdatedAt,
    screenshotWidth,
    screenshotHeight,
  }: any
) => {
  const card = await ctx.db.get("cards", cardId);
  if (card?.type !== "link") {
    return;
  }

  const existingMetadata = card.metadata || {};
  const existingLinkPreview = existingMetadata.linkPreview || {};

  if (
    existingLinkPreview.screenshotStorageKey &&
    existingLinkPreview.screenshotStorageKey !== screenshotStorageKey
  ) {
    try {
      await deleteObject(ctx, existingLinkPreview.screenshotStorageKey);
    } catch (error) {
      console.error(
        `[linkMetadata] Failed to delete previous screenshot for card ${cardId}:`,
        error
      );
    }
  }

  const updatedLinkPreview = {
    ...existingLinkPreview,
    screenshotStorageKey,
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
    screenshotStorageKey: v.string(),
    screenshotUpdatedAt: v.number(),
    screenshotWidth: v.optional(v.number()),
    screenshotHeight: v.optional(v.number()),
  },
  handler: updateCardScreenshotHandler,
});
