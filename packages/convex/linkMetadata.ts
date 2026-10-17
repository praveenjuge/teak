import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { patchCardWithSearchSync } from "./card/searchDocumentHelpers";
import { deleteObject } from "./storage/r2";
import { serializeArchivableRaw } from "./storage/rawMetadata";

export * from "./linkMetadata/instagram";
export { extractInstagramMediaFromHtml } from "./linkMetadata/instagramHtml";
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

export const getFullCardForMetadataHandler = async (
  ctx: QueryCtx,
  { cardId }: { cardId: Id<"cards"> }
) => await ctx.db.get("cards", cardId);

export const getFullCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getFullCardForMetadataHandler,
});

// Account deletion fences the patch and leaves the card unchanged; then the
// objects this write introduced are the orphans, not the ones it replaced.
const commitCardStorageSwap = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  patch: Parameters<typeof patchCardWithSearchSync>[2],
  storage: { introduced: string[]; replaced: string[] }
): Promise<boolean> => {
  const patched = await patchCardWithSearchSync(ctx, cardId, patch);
  await Promise.all(
    (patched ? storage.replaced : storage.introduced).map(async (key) => {
      try {
        await deleteObject(ctx, key);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete storage ${key} for card ${cardId}:`,
          error
        );
      }
    })
  );
  return patched;
};

export const getCardForLinkFetchHandler = async (
  ctx: QueryCtx,
  { cardId }: { cardId: Id<"cards"> }
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  return {
    type: card.type,
    url: card.url,
    userId: card.userId,
    processingStatus: card.processingStatus?.classify
      ? { classify: { status: card.processingStatus.classify.status } }
      : undefined,
  };
};

export const getCardForScreenshotHandler = async (
  ctx: QueryCtx,
  { cardId }: { cardId: Id<"cards"> }
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  return {
    type: card.type,
    url: card.url,
    userId: card.userId,
    metadata: card.metadata?.linkPreview
      ? {
          linkPreview: {
            status: card.metadata.linkPreview.status,
            screenshotStorageKey:
              card.metadata.linkPreview.screenshotStorageKey,
          },
        }
      : undefined,
  };
};

export const getCardForLinkFetch = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getCardForLinkFetchHandler,
});

export const getCardForScreenshot = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getCardForScreenshotHandler,
});

export const updateCardMetadataHandler = async (
  ctx: any,
  { cardId, linkPreview, status, refresh }: any
) => {
  const existingCard = await ctx.db.get("cards", cardId);
  if (!existingCard) {
    console.error(`Card ${cardId} not found for metadata update`);
    return;
  }

  const previousLinkPreview = existingCard.metadata?.linkPreview;
  // A refresh that can't read the page keeps the preview it already has.
  if (
    refresh &&
    status === "failed" &&
    previousLinkPreview?.status === "success"
  ) {
    console.warn(
      "[linkMetadata] Refresh couldn't read the page; kept the stored preview",
      {
        cardId,
        error: linkPreview?.error,
      }
    );
    return await patchCardWithSearchSync(ctx, cardId, {
      metadataStatus: "completed",
      updatedAt: Date.now(),
    });
  }
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
  const replacedRefs: string[] = [];

  if (previousImageRef) {
    if (nextImageRef && nextImageRef !== previousImageRef) {
      replacedRefs.push(previousImageRef);
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
      replacedRefs.push(previousScreenshotRef);
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

      for (const storageRef of previousMediaStorageIds) {
        if (!nextMediaStorageIds.has(storageRef)) {
          replacedRefs.push(storageRef);
        }
      }
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
      ...(nextLinkPreview === undefined
        ? {}
        : { linkPreview: nextLinkPreview }),
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

  if (title && !existingCard.metadataTitleEdited) {
    updateFields.metadataTitle = title;
  }
  if (description) {
    updateFields.metadataDescription = description;
  }

  const previousRefs = new Set<string>(
    [
      previousLinkPreview?.imageStorageKey,
      previousLinkPreview?.screenshotStorageKey,
      ...collectMediaStorageRefs(previousLinkPreview?.media),
    ].filter((ref): ref is string => Boolean(ref))
  );
  const introducedRefs = [
    nextLinkPreview?.imageStorageKey,
    nextLinkPreview?.screenshotStorageKey,
    ...collectMediaStorageRefs(nextLinkPreview?.media),
  ].filter((ref): ref is string => Boolean(ref) && !previousRefs.has(ref));
  const result = await commitCardStorageSwap(ctx, cardId, updateFields, {
    introduced: introducedRefs,
    replaced: replacedRefs,
  });
  if (result && serializeArchivableRaw(nextLinkPreview?.raw) !== null) {
    await ctx.scheduler.runAfter(
      0,
      internal.storage.rawMetadataMaintenance.archiveCard,
      { cardId }
    );
  }
  return result;
};

export const updateCardMetadata = internalMutation({
  args: {
    cardId: v.id("cards"),
    linkPreview: v.optional(v.any()),
    status: v.union(v.literal("completed"), v.literal("failed")),
    refresh: v.optional(v.boolean()),
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
  const previousScreenshotKey =
    existingLinkPreview.screenshotStorageKey &&
    existingLinkPreview.screenshotStorageKey !== screenshotStorageKey
      ? existingLinkPreview.screenshotStorageKey
      : undefined;

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

  await commitCardStorageSwap(
    ctx,
    cardId,
    { metadata: updatedMetadata, updatedAt: Date.now() },
    {
      introduced:
        screenshotStorageKey === existingLinkPreview.screenshotStorageKey
          ? []
          : [screenshotStorageKey],
      replaced: previousScreenshotKey ? [previousScreenshotKey] : [],
    }
  );
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
