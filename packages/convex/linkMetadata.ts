import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { patchCardWithSearchSync } from "./card/searchSync";
import { queueObjectDeletion } from "./storage/r2";
import { getR2KeyPrefix } from "./storage/r2Keys";
import {
  assertArchivedRawReference,
  serializeArchivableRaw,
} from "./storage/rawMetadata";

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

const commitCardStorageSwap = async (
  ctx: MutationCtx,
  cardId: Id<"cards">,
  patch: Parameters<typeof patchCardWithSearchSync>[2],
  storage: { introduced: string[]; replaced: string[] }
): Promise<boolean> => {
  const committed = await patchCardWithSearchSync(ctx, cardId, patch);
  const orphans = committed ? storage.replaced : storage.introduced;
  await Promise.all(
    orphans.map(async (key) => {
      try {
        await queueObjectDeletion(ctx, key);
      } catch (error) {
        console.error(
          `[linkMetadata] Failed to delete storage ${key} for card ${cardId}:`,
          error
        );
      }
    })
  );
  return committed;
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
    keyPrefix: getR2KeyPrefix(),
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
    // A text-only copy has no styles left to show; the page is better.
    ...(card.pageArchive?.kind === "full"
      ? { archiveKey: card.pageArchive.storageKey }
      : {}),
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

type CardMetadata = NonNullable<Doc<"cards">["metadata"]>;
type StoredLinkPreview = NonNullable<CardMetadata["linkPreview"]>;
type CardPatch = Parameters<typeof patchCardWithSearchSync>[2];

const collectMediaStorageRefs = (
  mediaItems: StoredLinkPreview["media"] | undefined
) => {
  const storageKeys = new Set<string>();
  for (const item of mediaItems ?? []) {
    if (item.storageKey) {
      storageKeys.add(item.storageKey);
    }
    if (item.posterStorageKey) {
      storageKeys.add(item.posterStorageKey);
    }
  }
  return storageKeys;
};

export const updateCardMetadataHandler = async (
  ctx: MutationCtx,
  {
    cardId,
    linkPreview,
    status,
    refresh,
  }: {
    cardId: Id<"cards">;
    linkPreview?: StoredLinkPreview;
    refresh?: boolean;
    status: "completed" | "failed";
  }
) => {
  const existingCard = await ctx.db.get("cards", cardId);
  if (!existingCard) {
    console.error(`Card ${cardId} not found for metadata update`);
    return;
  }

  const previousLinkPreview = existingCard.metadata?.linkPreview;
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
  assertArchivedRawReference(existingCard, "linkPreview", nextLinkPreview);
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

  let updatedMetadata: CardMetadata = {};

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

  const updateFields: CardPatch = {
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

  // A replaced raw archive is never deleted (kept for recovery), but one this
  // write introduces and fails to commit has nothing pointing at it.
  const previousRefs = new Set<string>(
    [
      previousLinkPreview?.imageStorageKey,
      previousLinkPreview?.screenshotStorageKey,
      previousLinkPreview?.rawStorageKey,
      ...collectMediaStorageRefs(previousLinkPreview?.media),
    ].filter((ref): ref is string => Boolean(ref))
  );
  const introducedRefs = [
    nextLinkPreview?.imageStorageKey,
    nextLinkPreview?.screenshotStorageKey,
    nextLinkPreview?.rawStorageKey,
    ...collectMediaStorageRefs(nextLinkPreview?.media),
  ].filter(
    (ref): ref is string =>
      ref !== undefined && ref !== "" && !previousRefs.has(ref)
  );
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
  ctx: MutationCtx,
  {
    cardId,
    screenshotStorageKey,
    screenshotUpdatedAt,
    screenshotWidth,
    screenshotHeight,
  }: {
    cardId: Id<"cards">;
    screenshotHeight?: number;
    screenshotStorageKey: string;
    screenshotUpdatedAt: number;
    screenshotWidth?: number;
  }
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

export const updateCardPreviewImageHandler = async (
  ctx: MutationCtx,
  {
    cardId,
    imageHeight,
    imageStorageKey,
    imageUpdatedAt,
    imageUrl,
    imageWidth,
  }: {
    cardId: Id<"cards">;
    imageHeight: number;
    imageStorageKey: string;
    imageUpdatedAt: number;
    imageUrl: string;
    imageWidth: number;
  }
) => {
  const card = await ctx.db.get("cards", cardId);
  const preview = card?.metadata?.linkPreview;
  if (
    card?.type !== "link" ||
    preview?.status !== "success" ||
    preview.imageUrl !== imageUrl ||
    preview.imageStorageKey
  ) {
    await queueObjectDeletion(ctx, imageStorageKey);
    return false;
  }
  return await commitCardStorageSwap(
    ctx,
    cardId,
    {
      metadata: {
        ...card.metadata,
        linkPreview: {
          ...preview,
          imageHeight,
          imageStorageKey,
          imageUpdatedAt,
          imageWidth,
        },
      },
      updatedAt: Date.now(),
    },
    { introduced: [imageStorageKey], replaced: [] }
  );
};

export const updateCardPreviewImage = internalMutation({
  args: {
    cardId: v.id("cards"),
    imageHeight: v.number(),
    imageStorageKey: v.string(),
    imageUpdatedAt: v.number(),
    imageUrl: v.string(),
    imageWidth: v.number(),
  },
  returns: v.boolean(),
  handler: updateCardPreviewImageHandler,
});
