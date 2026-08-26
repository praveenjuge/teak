import type { FilesImageRendition } from "@teak/files-protocol";
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

const resolveImageRenditions = async (
  key: string,
  renditions: readonly FilesImageRendition[]
): Promise<Partial<Record<FilesImageRendition, string>>> => {
  const resolved = await Promise.all(
    renditions.map(
      async (rendition) =>
        [rendition, await resolveImageUrl(key, rendition)] as const
    )
  );
  return Object.fromEntries(
    resolved.filter((entry): entry is [FilesImageRendition, string] =>
      Boolean(entry[1])
    )
  );
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
      imageCards.map(async (card) => {
        const fileKey = card.fileKey;
        if (!fileKey) {
          throw new Error("Image card is missing its file key");
        }
        return [
          card._id,
          await resolveImageRenditions(fileKey, [
            "compact",
            "detail",
            "tiny",
            "grid",
          ]),
        ] as const;
      })
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
      detailUrl: imageUrls?.detail ?? undefined,
      thumbnailUrl:
        imageUrls?.grid ??
        (ids.thumbnailKey
          ? (gridUrlMap.get(ids.thumbnailKey) ?? undefined)
          : undefined),
      compactUrl: imageUrls?.compact ?? undefined,
      placeholderUrl: imageUrls?.tiny ?? undefined,
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
  const thumbnailKeys = new Set<string>();
  const screenshotKeys = new Set<string>();

  for (const card of cards) {
    if (card.thumbnailKey) {
      thumbnailKeys.add(card.thumbnailKey);
    }
    if (card.metadata?.linkPreview?.screenshotStorageKey) {
      screenshotKeys.add(card.metadata.linkPreview.screenshotStorageKey);
    }
  }

  const resolvedRenditions = await Promise.all(
    Array.from(thumbnailKeys).map(
      async (key) =>
        [
          key,
          await resolveImageRenditions(key, ["grid", "compact", "tiny"]),
        ] as const
    )
  );
  const renditionMap = new Map(resolvedRenditions);
  const screenshotUrlMap = new Map(
    await Promise.all(
      Array.from(screenshotKeys).map(
        async (key) => [key, await resolveImageUrl(key, "grid")] as const
      )
    )
  );

  const imageCardUrls = new Map(
    await Promise.all(
      cards.flatMap((card) => {
        const fileKey = card.fileKey;
        return card.type === "image" && fileKey
          ? [
              (async () =>
                [
                  card._id,
                  await resolveImageRenditions(fileKey, [
                    "compact",
                    "tiny",
                    "grid",
                  ]),
                ] as const)(),
            ]
          : [];
      })
    )
  );

  return cards.map((card) => ({
    ...card,
    thumbnailUrl:
      imageCardUrls.get(card._id)?.grid ??
      (card.thumbnailKey
        ? (renditionMap.get(card.thumbnailKey)?.grid ?? undefined)
        : undefined),
    compactUrl:
      imageCardUrls.get(card._id)?.compact ??
      (card.thumbnailKey
        ? (renditionMap.get(card.thumbnailKey)?.compact ?? undefined)
        : undefined),
    placeholderUrl:
      imageCardUrls.get(card._id)?.tiny ??
      (card.thumbnailKey
        ? (renditionMap.get(card.thumbnailKey)?.tiny ?? undefined)
        : undefined),
    screenshotUrl: card.metadata?.linkPreview?.screenshotStorageKey
      ? (screenshotUrlMap.get(card.metadata.linkPreview.screenshotStorageKey) ??
        undefined)
      : undefined,
  }));
};
