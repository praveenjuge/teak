import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, query } from "../_generated/server";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import { cardValidator } from "../schema";
import { resolveObjectUrl } from "../storage/r2";
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
  const storageRefs = new Map<
    string,
    { key?: string; legacyStorageId?: string; field: string }
  >();
  if (card.fileKey || card.fileId) {
    const id = card.fileKey ?? card.fileId!;
    storageIds.add(id);
    storageRefs.set(id, {
      key: card.fileKey,
      legacyStorageId: card.fileId,
      field: "card.file",
    });
  }
  if (card.thumbnailKey || card.thumbnailId) {
    const id = card.thumbnailKey ?? card.thumbnailId!;
    storageIds.add(id);
    storageRefs.set(id, {
      key: card.thumbnailKey,
      legacyStorageId: card.thumbnailId,
      field: "card.thumbnail",
    });
  }
  if (
    card.metadata?.linkPreview?.screenshotStorageKey ||
    card.metadata?.linkPreview?.screenshotStorageId
  ) {
    const id =
      card.metadata.linkPreview.screenshotStorageKey ??
      card.metadata.linkPreview.screenshotStorageId!;
    storageIds.add(id);
    storageRefs.set(id, {
      key: card.metadata.linkPreview.screenshotStorageKey,
      legacyStorageId: card.metadata.linkPreview.screenshotStorageId,
      field: "linkPreview.screenshot",
    });
  }
  if (
    card.metadata?.linkPreview?.imageStorageKey ||
    card.metadata?.linkPreview?.imageStorageId
  ) {
    const id =
      card.metadata.linkPreview.imageStorageKey ??
      card.metadata.linkPreview.imageStorageId!;
    storageIds.add(id);
    storageRefs.set(id, {
      key: card.metadata.linkPreview.imageStorageKey,
      legacyStorageId: card.metadata.linkPreview.imageStorageId,
      field: "linkPreview.image",
    });
  }
  for (const item of (card.metadata?.linkPreview?.media ??
    []) as LinkPreviewMediaItem[]) {
    const id = item.storageKey ?? item.storageId;
    if (!id) {
      continue;
    }
    storageIds.add(id);
    storageRefs.set(id, {
      key: item.storageKey,
      legacyStorageId: item.storageId,
      field: `linkPreview.media.${item.type}`,
    });
    const posterId = item.posterStorageKey ?? item.posterStorageId;
    if (posterId) {
      storageIds.add(posterId);
      storageRefs.set(posterId, {
        key: item.posterStorageKey,
        legacyStorageId: item.posterStorageId,
        field: "linkPreview.media.poster",
      });
    }
  }

  const resolvedUrls = await Promise.all(
    Array.from(storageIds).map(
      async (id) =>
        [
          id,
          await resolveObjectUrl(ctx, {
            ...(storageRefs.get(id) ?? { key: id, field: "unknown" }),
            cardId,
          }),
        ] as const
    )
  );
  const urlMap = new Map(resolvedUrls);

  const linkPreviewMedia = (card.metadata?.linkPreview?.media ?? [])
    .map((item: LinkPreviewMediaItem) => {
      const storageKey = item.storageKey ?? item.storageId;
      if (!storageKey) {
        return null;
      }
      const url = urlMap.get(storageKey);
      if (!url) {
        return null;
      }
      return {
        type: item.type,
        url,
        contentType: item.contentType,
        width: item.width,
        height: item.height,
        posterUrl: (item.posterStorageKey ?? item.posterStorageId)
          ? (urlMap.get(item.posterStorageKey ?? item.posterStorageId!) ??
            undefined)
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
    );

  const linkPreviewOgImageUrl: string | undefined = card.metadata?.linkPreview
    ?.imageStorageKey || card.metadata?.linkPreview?.imageStorageId
    ? (urlMap.get(
        card.metadata.linkPreview.imageStorageKey ??
          card.metadata.linkPreview.imageStorageId!
      ) ?? undefined)
    : undefined;

  const linkPreviewImageUrl =
    linkPreviewOgImageUrl ??
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
    fileUrl: card.fileKey || card.fileId
      ? (urlMap.get(card.fileKey ?? card.fileId!) ?? undefined)
      : undefined,
    thumbnailUrl: card.thumbnailKey || card.thumbnailId
      ? (urlMap.get(card.thumbnailKey ?? card.thumbnailId!) ?? undefined)
      : undefined,
    screenshotUrl:
      card.metadata?.linkPreview?.screenshotStorageKey ||
      card.metadata?.linkPreview?.screenshotStorageId
        ? (urlMap.get(
            card.metadata.linkPreview.screenshotStorageKey ??
              card.metadata.linkPreview.screenshotStorageId!
          ) ?? undefined)
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

export const getCardByUrlId = query({
  args: {
    id: v.string(),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const normalizedId = id.trim();
    if (!normalizedId) {
      return null;
    }

    try {
      return await getCardForUserHandler(
        ctx,
        user.subject,
        normalizedId as Id<"cards">
      );
    } catch {
      return null;
    }
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

// Internal query to get card details for background tasks (thumbnail generation, etc.)
export const getCardInternal = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  returns: v.any(),
  handler: (ctx, args) => ctx.db.get("cards", args.cardId),
});

export const getCardForUser = internalQuery({
  args: {
    userId: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.null(), cardReturnValidator),
  handler: async (ctx, args) =>
    getCardForUserHandler(ctx, args.userId, args.cardId),
});
