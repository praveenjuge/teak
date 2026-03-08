import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, query } from "../_generated/server";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import { cardValidator } from "../schema";
import {
  applyQuoteDisplayFormatting,
  applyQuoteFormattingToList,
} from "./quoteFormatting";

type HydratedLinkPreviewMedia = {
  contentType?: string;
  height?: number;
  posterContentType?: string;
  posterHeight?: number;
  posterUrl?: string;
  posterWidth?: number;
  type: "image" | "video";
  url: string;
  width?: number;
};

// Return validator for single card - includes _id and _creationTime from Convex
const cardReturnValidator = v.object({
  ...cardValidator.fields,
  _id: v.id("cards"),
  _creationTime: v.number(),
  fileUrl: v.optional(v.string()),
  thumbnailUrl: v.optional(v.string()),
  screenshotUrl: v.optional(v.string()),
  linkPreviewMedia: v.optional(
    v.array(
      v.object({
        type: v.union(v.literal("image"), v.literal("video")),
        url: v.string(),
        contentType: v.optional(v.string()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        posterUrl: v.optional(v.string()),
        posterContentType: v.optional(v.string()),
        posterWidth: v.optional(v.number()),
        posterHeight: v.optional(v.number()),
      })
    )
  ),
  linkPreviewImageUrl: v.optional(v.string()),
});

export const getCardForUserHandler = async (
  ctx: any,
  userId: string,
  cardId: Id<"cards">
) => {
  const card = await ctx.db.get("cards", cardId);
  if (!card || card.userId !== userId) {
    return null;
  }

  const storageIds = new Set<string>();
  if (card.fileId) {
    storageIds.add(card.fileId);
  }
  if (card.thumbnailId) {
    storageIds.add(card.thumbnailId);
  }
  if (card.metadata?.linkPreview?.screenshotStorageId) {
    storageIds.add(card.metadata.linkPreview.screenshotStorageId);
  }
  if (card.metadata?.linkPreview?.imageStorageId) {
    storageIds.add(card.metadata.linkPreview.imageStorageId);
  }
  for (const item of (card.metadata?.linkPreview?.media ??
    []) as LinkPreviewMediaItem[]) {
    storageIds.add(item.storageId);
    if (item.posterStorageId) {
      storageIds.add(item.posterStorageId);
    }
  }

  const resolvedUrls = await Promise.all(
    Array.from(storageIds).map(
      async (id) => [id, await ctx.storage.getUrl(id)] as const
    )
  );
  const urlMap = new Map(resolvedUrls);

  const linkPreviewMedia =
    (card.metadata?.linkPreview?.media ?? [])
      .map((item: LinkPreviewMediaItem) => {
        const url = urlMap.get(item.storageId);
        if (!url) {
          return null;
        }
        return {
          type: item.type,
          url,
          contentType: item.contentType,
          width: item.width,
          height: item.height,
          posterUrl: item.posterStorageId
            ? (urlMap.get(item.posterStorageId) ?? undefined)
            : undefined,
          posterContentType: item.posterContentType,
          posterWidth: item.posterWidth,
          posterHeight: item.posterHeight,
        };
      })
      .filter(
        (
          item: HydratedLinkPreviewMedia | null
        ): item is HydratedLinkPreviewMedia => Boolean(item)
      ) || undefined;

  const linkPreviewImageUrl =
    (card.metadata?.linkPreview?.imageStorageId
      ? (urlMap.get(card.metadata.linkPreview.imageStorageId) ?? undefined)
      : undefined) ??
    linkPreviewMedia?.find(
      (item: NonNullable<(typeof linkPreviewMedia)[number]>) =>
        item.type === "image"
    )?.url ??
    linkPreviewMedia?.find(
      (item: NonNullable<(typeof linkPreviewMedia)[number]>) =>
        item.type === "video"
    )?.posterUrl;

  return applyQuoteDisplayFormatting({
    ...card,
    fileUrl: card.fileId ? (urlMap.get(card.fileId) ?? undefined) : undefined,
    thumbnailUrl: card.thumbnailId
      ? (urlMap.get(card.thumbnailId) ?? undefined)
      : undefined,
    screenshotUrl: card.metadata?.linkPreview?.screenshotStorageId
      ? (urlMap.get(card.metadata.linkPreview.screenshotStorageId) ?? undefined)
      : undefined,
    linkPreviewMedia: linkPreviewMedia?.length ? linkPreviewMedia : undefined,
    linkPreviewImageUrl,
  });
};

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    return getCardForUserHandler(ctx, user.subject, id);
  },
});

export const getDeletedCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(cardReturnValidator),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", true)
      )
      .order("desc")
      .take(args.limit || 50);

    return applyQuoteFormattingToList(cards);
  },
});

/**
 * Internal query to get card details for background tasks
 * Used by thumbnail generation and similar internal processes
 */
export const getCardInternal = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const card = await ctx.db.get("cards", args.cardId);
    return card;
  },
});

export const getCardForUser = internalQuery({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) => {
    return getCardForUserHandler(ctx, args.userId, args.cardId);
  },
});
