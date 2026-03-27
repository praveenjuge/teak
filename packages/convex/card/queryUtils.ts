import type { Doc } from "../_generated/dataModel";
import { getStorageUrl } from "../fileStorage";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import type { CreatedAtRange } from "../shared";

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
  ctx: any,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const storageIds = new Set<string>();
  type CardStorageIds = {
    fileId?: string;
    thumbnailId?: string;
    screenshotId?: string;
    linkPreviewImageId?: string;
    linkPreviewMedia?: Array<{
      contentType?: string;
      height?: number;
      posterContentType?: string;
      posterHeight?: number;
      posterId?: string;
      posterWidth?: number;
      storageId: string;
      type: "image" | "video";
      width?: number;
    }>;
  };
  const cardToIds = new Map<string, CardStorageIds>();

  for (const card of cards) {
    const ids: CardStorageIds = {};
    if (card.fileId) {
      storageIds.add(card.fileId);
      ids.fileId = card.fileId;
    }
    if (card.thumbnailId) {
      storageIds.add(card.thumbnailId);
      ids.thumbnailId = card.thumbnailId;
    }
    if (card.metadata?.linkPreview?.imageStorageId) {
      storageIds.add(card.metadata.linkPreview.imageStorageId);
      ids.linkPreviewImageId = card.metadata.linkPreview.imageStorageId;
    }
    const hydratedMedia = (card.metadata?.linkPreview?.media ?? [])?.map(
      (item: LinkPreviewMediaItem) => {
        storageIds.add(item.storageId);
        if (item.posterStorageId) {
          storageIds.add(item.posterStorageId);
        }
        return {
          type: item.type,
          storageId: item.storageId,
          posterId: item.posterStorageId,
          contentType: item.contentType,
          width: item.width,
          height: item.height,
          posterContentType: item.posterContentType,
          posterWidth: item.posterWidth,
          posterHeight: item.posterHeight,
        };
      }
    );
    if (hydratedMedia?.length) {
      ids.linkPreviewMedia = hydratedMedia;
    }
    if (card.metadata?.linkPreview?.screenshotStorageId) {
      storageIds.add(card.metadata.linkPreview.screenshotStorageId);
      ids.screenshotId = card.metadata.linkPreview.screenshotStorageId;
    }
    cardToIds.set(card._id, ids);
  }

  const urlPromises = Array.from(storageIds).map(async (id) => ({
    id,
    url: await getStorageUrl(ctx, id),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((result) => [result.id, result.url]));

  return cards.map((card) => {
    const ids = cardToIds.get(card._id) || ({} as CardStorageIds);
    const linkPreviewMedia =
      ids.linkPreviewMedia
        ?.map((item) => {
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
            posterUrl: item.posterId
              ? (urlMap.get(item.posterId) ?? undefined)
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
      fileUrl: ids.fileId ? (urlMap.get(ids.fileId) ?? undefined) : undefined,
      thumbnailUrl: ids.thumbnailId
        ? (urlMap.get(ids.thumbnailId) ?? undefined)
        : undefined,
      screenshotUrl: ids.screenshotId
        ? (urlMap.get(ids.screenshotId) ?? undefined)
        : undefined,
      linkPreviewMedia: linkPreviewMedia?.length ? linkPreviewMedia : undefined,
      linkPreviewImageUrl: ids.linkPreviewImageId
        ? (urlMap.get(ids.linkPreviewImageId) ?? undefined)
        : fallbackLinkPreviewImageUrl,
    };
  });
};
