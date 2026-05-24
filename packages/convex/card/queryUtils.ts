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
  ctx: any,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const storageIds = new Set<string>();
  const storageRefs = new Map<
    string,
    { key?: string; legacyStorageId?: string; field: string }
  >();
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
    if (card.fileKey || card.fileId) {
      const id = card.fileKey ?? card.fileId!;
      storageIds.add(id);
      storageRefs.set(id, {
        key: card.fileKey,
        legacyStorageId: card.fileId,
        field: "card.file",
      });
      ids.fileId = id;
    }
    if (card.thumbnailKey || card.thumbnailId) {
      const id = card.thumbnailKey ?? card.thumbnailId!;
      storageIds.add(id);
      storageRefs.set(id, {
        key: card.thumbnailKey,
        legacyStorageId: card.thumbnailId,
        field: "card.thumbnail",
      });
      ids.thumbnailId = id;
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
      ids.linkPreviewImageId = id;
    }
    const hydratedMedia = (card.metadata?.linkPreview?.media ?? [])?.map(
      (item: LinkPreviewMediaItem) => {
        const id = item.storageKey ?? item.storageId;
        if (!id) {
          return null;
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
        return {
          type: item.type,
          storageId: id,
          posterId,
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
      ids.screenshotId = id;
    }
    cardToIds.set(card._id, ids);
  }

  const urlPromises = Array.from(storageIds).map(async (id) => ({
    id,
    url: await resolveObjectUrl(ctx, {
      ...(storageRefs.get(id) ?? { key: id, field: "unknown" }),
    }),
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
