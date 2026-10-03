import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { patchCardWithSearchSync } from "./card/searchDocumentHelpers";
import { deleteObject } from "./storage/r2";
import { serializeArchivableRaw } from "./storage/rawMetadata";

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

export const getFullCardForMetadataHandler = async (
  ctx: QueryCtx,
  { cardId }: { cardId: Id<"cards"> }
) => await ctx.db.get("cards", cardId);

// Keep this workflow step's identity and arguments stable for journal replay.
export const projectCardProcessingState = (card: Doc<"cards">) => ({
  workflowPayloadVersion: 1 as const,
  _id: card._id,
  _creationTime: card._creationTime,
  type: card.type,
  url: card.url,
  metadataStatus: card.metadataStatus,
  processingStatus: card.processingStatus?.classify
    ? {
        classify: {
          status: card.processingStatus.classify.status,
          confidence: card.processingStatus.classify.confidence,
        },
      }
    : undefined,
  metadata: card.metadata?.linkPreview
    ? { linkPreview: { status: card.metadata.linkPreview.status } }
    : undefined,
});

export const getCardForMetadataHandler = async (
  ctx: QueryCtx,
  args: { cardId: Id<"cards"> }
) => {
  const card = await getFullCardForMetadataHandler(ctx, args);
  return card ? projectCardProcessingState(card) : null;
};

export const getFullCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getFullCardForMetadataHandler,
});

export const getCardForMetadata = internalQuery({
  args: { cardId: v.id("cards") },
  handler: getCardForMetadataHandler,
});

// Actions need only their own gate and storage ownership fields. Keep large
// content, transcripts and raw previews out of their query response.
export const getCardForLinkFetchHandler = async (
  ctx: QueryCtx,
  { cardId }: { cardId: Id<"cards"> }
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card) {
    return null;
  }
  const category = card.metadata?.linkCategory;
  // Older category payloads may carry the classification gate; current cards
  // use processingStatus. Preserve the legacy gate without copying the payload.
  const categoryStatus =
    category &&
    typeof category === "object" &&
    "status" in category &&
    typeof category.status === "string"
      ? category.status
      : undefined;
  return {
    type: card.type,
    url: card.url,
    userId: card.userId,
    processingStatus: card.processingStatus?.classify
      ? { classify: { status: card.processingStatus.classify.status } }
      : undefined,
    metadata: card.metadata?.linkCategory
      ? { linkCategory: { status: categoryStatus } }
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
  // Obsolete storage objects are deleted only after the card patch below
  // succeeds. patchCardWithSearchSync stands down during account deletion
  // (returns false), and deleting first would leave the unchanged card
  // referencing removed objects.
  const pendingStorageDeletes: string[] = [];

  if (previousImageRef) {
    if (nextImageRef && nextImageRef !== previousImageRef) {
      pendingStorageDeletes.push(previousImageRef);
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
      pendingStorageDeletes.push(previousScreenshotRef);
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
          pendingStorageDeletes.push(storageRef);
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

  const result = await patchCardWithSearchSync(ctx, cardId, updateFields);
  if (result) {
    await Promise.all(
      pendingStorageDeletes.map(async (storageRef) => {
        try {
          await deleteObject(ctx, storageRef);
        } catch (error) {
          console.error(
            `[linkMetadata] Failed to delete previous storage ${storageRef} for card ${cardId}:`,
            error
          );
        }
      })
    );
    if (serializeArchivableRaw(nextLinkPreview?.raw) !== null) {
      await ctx.scheduler.runAfter(
        0,
        internal.storage.rawMetadataMaintenance.archiveCard,
        { cardId }
      );
    }
  } else {
    // The patch was fenced by account deletion: the unchanged card keeps
    // its current references, so objects this call introduced (new OG
    // image, screenshot, media) would otherwise be orphaned - account
    // deletion only removes keys collected from card rows.
    const previousRefs = new Set<string>(
      [
        previousLinkPreview?.imageStorageKey,
        previousLinkPreview?.screenshotStorageKey,
        ...collectMediaStorageRefs(previousLinkPreview?.media),
      ].filter((ref): ref is string => Boolean(ref))
    );
    const orphanedRefs = [
      nextLinkPreview?.imageStorageKey,
      nextLinkPreview?.screenshotStorageKey,
      ...collectMediaStorageRefs(nextLinkPreview?.media),
    ].filter(
      (ref): ref is string => Boolean(ref) && !previousRefs.has(ref as string)
    );
    await Promise.all(
      orphanedRefs.map(async (storageRef) => {
        try {
          await deleteObject(ctx, storageRef);
        } catch (error) {
          console.error(
            `[linkMetadata] Failed to delete orphaned storage ${storageRef} for card ${cardId}:`,
            error
          );
        }
      })
    );
  }
  return result;
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

  // Delete the replaced screenshot only after the patch succeeds; a
  // fenced patch (account deletion) leaves the card referencing it. On a
  // fenced patch the freshly uploaded screenshot is the orphan instead:
  // the card never references it, so remove it.
  const patched = await patchCardWithSearchSync(ctx, cardId, {
    metadata: updatedMetadata,
    updatedAt: Date.now(),
  });
  if (patched && previousScreenshotKey) {
    try {
      await deleteObject(ctx, previousScreenshotKey);
    } catch (error) {
      console.error(
        `[linkMetadata] Failed to delete previous screenshot for card ${cardId}:`,
        error
      );
    }
  } else if (
    !patched &&
    screenshotStorageKey !== existingLinkPreview.screenshotStorageKey
  ) {
    try {
      await deleteObject(ctx, screenshotStorageKey);
    } catch (error) {
      console.error(
        `[linkMetadata] Failed to delete orphaned screenshot for card ${cardId}:`,
        error
      );
    }
  }
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
