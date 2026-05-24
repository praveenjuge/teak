import type { Doc } from "../_generated/dataModel";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import type { CreatedAtRange } from "../shared";
import { resolveObjectUrl } from "../storage/r2";

export type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
  linkPreviewMedia?: Array<{
    contentType?: string;
    height?: number;
    posterContentType?: string;
    posterHeight?: number;
    posterUrl?: string;
    posterWidth?: number;
    type: "image" | "video";
    url: string;
    width?: number;
  }>;
  linkPreviewImageUrl?: string;
};

export const isCreatedAtInRange = (
  createdAt: number,
  range?: CreatedAtRange
): boolean => !range || (createdAt >= range.start && createdAt < range.end);

export const ensureValidRange = (range?: CreatedAtRange) => {
  if (!range) return;
  if (range.start >= range.end) {
    throw new Error("Invalid createdAtRange");
  }
};

export const attachFileUrls = async (
  _ctx: any,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const storageKeys = new Set<string>();
  type CardStorageIds = {
    fileKey?: string;
    thumbnailKey?: string;
    screenshotKey?: string;
    linkPreviewImageKey?: string;
    linkPreviewMedia?: Array<{
      contentType?: string;
      height?: number;
      posterContentType?: string;
      posterHeight?: number;
      posterKey?: string;
      posterWidth?: number;
      storageKey: string;
      type: "image" | "video";
      width?: number;
    }>;
  };
  const cardToIds = new Map<string, CardStorageIds>();

  for (const card of cards) {
    const ids: CardStorageIds = {};
    if (card.fileKey) {
      storageKeys.add(card.fileKey);
      ids.fileKey = card.fileKey;
    }
    if (card.thumbnailKey) {
      storageKeys.add(card.thumbnailKey);
      ids.thumbnailKey = card.thumbnailKey;
    }
    if (card.metadata?.linkPreview?.imageStorageKey) {
      storageKeys.add(card.metadata.linkPreview.imageStorageKey);
      ids.linkPreviewImageKey = card.metadata.linkPreview.imageStorageKey;
    }
    const hydratedMedia = (card.metadata?.linkPreview?.media ?? [])?.map(
      (item: LinkPreviewMediaItem) => {
        if (!item.storageKey) {
          return null;
        }
        storageKeys.add(item.storageKey);
        if (item.posterStorageKey) {
          storageKeys.add(item.posterStorageKey);
        }
        return {
          type: item.type,
          storageKey: item.storageKey,
          posterKey: item.posterStorageKey,
          contentType: item.contentType,
          width: item.width,
          height: item.height,
          posterContentType: item.posterContentType,
          posterWidth: item.posterWidth,
          posterHeight: item.posterHeight,
        };
      }
    ).filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (hydratedMedia?.length) {
      ids.linkPreviewMedia = hydratedMedia;
    }
    if (card.metadata?.linkPreview?.screenshotStorageKey) {
      storageKeys.add(card.metadata.linkPreview.screenshotStorageKey);
      ids.screenshotKey = card.metadata.linkPreview.screenshotStorageKey;
    }
    cardToIds.set(card._id, ids);
  }

  const urlPromises = Array.from(storageKeys).map(async (key) => ({
    key,
    url: await resolveObjectUrl(key),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((result) => [result.key, result.url]));

  return cards.map((card) => {
    const ids = cardToIds.get(card._id) || ({} as CardStorageIds);
    const linkPreviewMedia =
      ids.linkPreviewMedia
        ?.map((item) => {
          const url = urlMap.get(item.storageKey);
          if (!url) {
            return null;
          }

          return {
            type: item.type,
            url,
            contentType: item.contentType,
            width: item.width,
            height: item.height,
            posterUrl: item.posterKey
              ? (urlMap.get(item.posterKey) ?? undefined)
              : undefined,
            posterContentType: item.posterContentType,
            posterWidth: item.posterWidth,
            posterHeight: item.posterHeight,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)) ??
      undefined;
    const fallbackLinkPreviewImageUrl =
      linkPreviewMedia?.find((item) => item.type === "image")?.url ??
      linkPreviewMedia?.find((item) => item.type === "video")?.posterUrl;

    return {
      ...card,
      fileUrl: ids.fileKey ? (urlMap.get(ids.fileKey) ?? undefined) : undefined,
      thumbnailUrl: ids.thumbnailKey
        ? (urlMap.get(ids.thumbnailKey) ?? undefined)
        : undefined,
      screenshotUrl: ids.screenshotKey
        ? (urlMap.get(ids.screenshotKey) ?? undefined)
        : undefined,
      linkPreviewMedia: linkPreviewMedia?.length ? linkPreviewMedia : undefined,
      linkPreviewImageUrl: ids.linkPreviewImageKey
        ? (urlMap.get(ids.linkPreviewImageKey) ?? undefined)
        : fallbackLinkPreviewImageUrl,
    };
  });
};
