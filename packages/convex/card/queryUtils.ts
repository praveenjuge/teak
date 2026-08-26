import type { Doc } from "../_generated/dataModel";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import type { CreatedAtRange } from "../shared";
import { resolveImageUrl, resolveObjectUrl } from "../storage/r2";

export type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  detailUrl?: string;
  thumbnailUrl?: string;
  /** 256px rendition for small/mobile cards. */
  compactUrl?: string;
  /** 48px loading placeholder rendition. */
  placeholderUrl?: string;
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
  if (!range) {
    return;
  }
  if (range.start >= range.end) {
    throw new Error("Invalid createdAtRange");
  }
};

export const attachFileUrls = async (
  _ctx: any,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const storageKeys = new Set<string>();
  const gridImageKeys = new Set<string>();
  interface CardStorageIds {
    fileKey?: string;
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
    screenshotKey?: string;
    thumbnailKey?: string;
  }
  const cardToIds = new Map<string, CardStorageIds>();

  for (const card of cards) {
    const ids: CardStorageIds = {};
    if (card.fileKey) {
      storageKeys.add(card.fileKey);
      ids.fileKey = card.fileKey;
    }
    if (card.thumbnailKey) {
      storageKeys.add(card.thumbnailKey);
      gridImageKeys.add(card.thumbnailKey);
      ids.thumbnailKey = card.thumbnailKey;
    }
    if (card.metadata?.linkPreview?.imageStorageKey) {
      storageKeys.add(card.metadata.linkPreview.imageStorageKey);
      gridImageKeys.add(card.metadata.linkPreview.imageStorageKey);
      ids.linkPreviewImageKey = card.metadata.linkPreview.imageStorageKey;
    }
    const hydratedMedia = (card.metadata?.linkPreview?.media ?? [])
      ?.map((item: LinkPreviewMediaItem) => {
        if (!item.storageKey) {
          return null;
        }
        storageKeys.add(item.storageKey);
        if (item.posterStorageKey) {
          storageKeys.add(item.posterStorageKey);
          gridImageKeys.add(item.posterStorageKey);
        }
        if (item.type === "image") {
          gridImageKeys.add(item.storageKey);
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
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (hydratedMedia?.length) {
      ids.linkPreviewMedia = hydratedMedia;
    }
    if (card.metadata?.linkPreview?.screenshotStorageKey) {
      storageKeys.add(card.metadata.linkPreview.screenshotStorageKey);
      gridImageKeys.add(card.metadata.linkPreview.screenshotStorageKey);
      ids.screenshotKey = card.metadata.linkPreview.screenshotStorageKey;
    }
    cardToIds.set(card._id, ids);
  }

  const fileNamesByKey = new Map(
    cards.flatMap((card) =>
      card.fileKey
        ? [[card.fileKey, card.fileMetadata?.fileName ?? null] as const]
        : []
    )
  );
  const urlPromises = Array.from(storageKeys).map(async (key) => ({
    key,
    url: await resolveObjectUrl(key, fileNamesByKey.get(key)),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((result) => [result.key, result.url]));
  const gridUrlMap = new Map(
    await Promise.all(
      Array.from(gridImageKeys).map(
        async (key) => [key, await resolveImageUrl(key, "grid")] as const
      )
    )
  );

  const imageCards = cards.filter(
    (card) => card.type === "image" && card.fileKey
  );
  const imageRenditions = new Map(
    await Promise.all(
      imageCards.map(
        async (card) =>
          [
            card._id,
            {
              compactUrl: await resolveImageUrl(card.fileKey, "compact"),
              detailUrl: await resolveImageUrl(card.fileKey, "detail"),
              placeholderUrl: await resolveImageUrl(card.fileKey, "tiny"),
              thumbnailUrl: await resolveImageUrl(card.fileKey, "grid"),
            },
          ] as const
      )
    )
  );

  return cards.map((card) => {
    const ids = cardToIds.get(card._id) || ({} as CardStorageIds);
    const linkPreviewMedia =
      ids.linkPreviewMedia
        ?.map((item) => {
          const url =
            item.type === "image"
              ? gridUrlMap.get(item.storageKey)
              : urlMap.get(item.storageKey);
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
              ? (gridUrlMap.get(item.posterKey) ?? undefined)
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

    const imageUrls = imageRenditions.get(card._id);
    return {
      ...card,
      fileUrl: ids.fileKey ? (urlMap.get(ids.fileKey) ?? undefined) : undefined,
      detailUrl: imageUrls?.detailUrl ?? undefined,
      thumbnailUrl:
        imageUrls?.thumbnailUrl ??
        (ids.thumbnailKey
          ? (gridUrlMap.get(ids.thumbnailKey) ?? undefined)
          : undefined),
      compactUrl: imageUrls?.compactUrl ?? undefined,
      placeholderUrl: imageUrls?.placeholderUrl ?? undefined,
      screenshotUrl: ids.screenshotKey
        ? (gridUrlMap.get(ids.screenshotKey) ?? undefined)
        : undefined,
      linkPreviewMedia: linkPreviewMedia?.length ? linkPreviewMedia : undefined,
      linkPreviewImageUrl: ids.linkPreviewImageKey
        ? (gridUrlMap.get(ids.linkPreviewImageKey) ?? undefined)
        : fallbackLinkPreviewImageUrl,
    };
  });
};

export const attachCardSummaryUrls = async (
  _ctx: unknown,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const storageKeys = new Set<string>();

  for (const card of cards) {
    if (card.thumbnailKey) {
      storageKeys.add(card.thumbnailKey);
    }
    if (card.metadata?.linkPreview?.screenshotStorageKey) {
      storageKeys.add(card.metadata.linkPreview.screenshotStorageKey);
    }
  }

  const resolvedUrls = await Promise.all(
    Array.from(storageKeys).map(
      async (key) => [key, await resolveImageUrl(key, "grid")] as const
    )
  );
  const urlMap = new Map(resolvedUrls);
  const compactUrlMap = new Map(
    await Promise.all(
      Array.from(storageKeys).map(
        async (key) => [key, await resolveImageUrl(key, "compact")] as const
      )
    )
  );

  const imageCardUrls = new Map(
    await Promise.all(
      cards.flatMap((card) =>
        card.type === "image" && card.fileKey
          ? [
              (async () =>
                [
                  card._id,
                  {
                    compactUrl:
                      (await resolveImageUrl(card.fileKey, "compact")) ??
                      undefined,
                    thumbnailUrl:
                      (await resolveImageUrl(card.fileKey, "grid")) ??
                      undefined,
                  },
                ] as const)(),
            ]
          : []
      )
    )
  );

  return cards.map((card) => ({
    ...card,
    thumbnailUrl:
      imageCardUrls.get(card._id)?.thumbnailUrl ??
      (card.thumbnailKey
        ? (urlMap.get(card.thumbnailKey) ?? undefined)
        : undefined),
    compactUrl:
      imageCardUrls.get(card._id)?.compactUrl ??
      (card.thumbnailKey
        ? (compactUrlMap.get(card.thumbnailKey) ?? undefined)
        : undefined),
    screenshotUrl: card.metadata?.linkPreview?.screenshotStorageKey
      ? (urlMap.get(card.metadata.linkPreview.screenshotStorageKey) ??
        undefined)
      : undefined,
  }));
};
