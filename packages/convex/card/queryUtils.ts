import type { FilesImageRendition } from "@teak/files-protocol";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import type { CreatedAtRange } from "../shared";
import { codePointLength } from "../shared/utils/codePoints";
import { tryResolveImageUrl, tryResolveObjectUrl } from "../storage/fileUrls";
import { readCardTranscript, transcriptPreview } from "./textContents";

export type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  detailUrl?: string;
  thumbnailUrl?: string;
  compactUrl?: string;
  placeholderUrl?: string;
  screenshotUrl?: string;
  scrubUrl?: string;
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
  hasThumbnailOverride?: true;
  hasOcrText?: true;
};

/**
 * A card without its transcript and image text, which only its detail shows.
 * `aiTranscriptCharCount` and `hasOcrText` say it has them, so a client
 * checking a server match locally knows the server read text it lacks.
 */
export const omitCardText = <T extends Doc<"cards">>(
  card: T
): Omit<T, "aiOcrText" | "aiTranscript"> & {
  hasOcrText?: true;
} => {
  const { aiOcrText, aiTranscript, ...rest } = card;
  return {
    ...rest,
    ...(aiTranscript && rest.aiTranscriptCharCount === undefined
      ? {
          aiTranscriptCharCount: codePointLength(aiTranscript),
          aiTranscriptPreview: transcriptPreview(aiTranscript),
        }
      : {}),
    ...(aiOcrText?.trim() ? { hasOcrText: true as const } : {}),
  };
};

/** A card as its detail shows it: with its transcript and image text. */
export const attachCardDetailUrls = async (
  ctx: Pick<QueryCtx, "db">,
  card: Doc<"cards">
): Promise<CardWithUrls> => {
  const [withUrls] = await attachFileUrls(ctx, [card]);
  if (!withUrls) {
    throw new Error("A card's detail is missing");
  }
  const aiTranscript = await readCardTranscript(ctx, card);
  return {
    ...withUrls,
    ...(aiTranscript === undefined ? {} : { aiTranscript }),
    ...(card.aiOcrText === undefined ? {} : { aiOcrText: card.aiOcrText }),
  };
};

export const linkPreviewImageFields = {
  linkPreviewImageUrl: v.optional(v.string()),
  hasThumbnailOverride: v.optional(v.literal(true)),
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
        [rendition, await tryResolveImageUrl(key, rendition)] as const
    )
  );
  return Object.fromEntries(
    resolved.filter((entry): entry is [FilesImageRendition, string] =>
      Boolean(entry[1])
    )
  );
};

export const attachFileUrls = async (
  _ctx: unknown,
  cards: Doc<"cards">[],
  options: { gridOnly?: boolean } = {}
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
    scrubKey?: string;
    thumbnailKey?: string;
    thumbnailOverrideKey?: string;
  }
  const cardToIds = new Map<string, CardStorageIds>();

  for (const card of cards) {
    const ids: CardStorageIds = {};
    if (card.fileKey) {
      if (!(options.gridOnly && card.type === "image")) {
        storageKeys.add(card.fileKey);
      }
      ids.fileKey = card.fileKey;
    }
    if (card.thumbnailKey) {
      gridImageKeys.add(card.thumbnailKey);
      ids.thumbnailKey = card.thumbnailKey;
    }
    if (card.scrubKey && card.fileMetadata?.scrub) {
      storageKeys.add(card.scrubKey);
      ids.scrubKey = card.scrubKey;
    }
    if (card.metadata?.linkPreview?.imageStorageKey) {
      gridImageKeys.add(card.metadata.linkPreview.imageStorageKey);
      ids.linkPreviewImageKey = card.metadata.linkPreview.imageStorageKey;
    }
    if (card.thumbnailOverride) {
      gridImageKeys.add(card.thumbnailOverride.storageKey);
      ids.thumbnailOverrideKey = card.thumbnailOverride.storageKey;
    }
    const hydratedMedia = (card.metadata?.linkPreview?.media ?? [])
      ?.map((item: LinkPreviewMediaItem) => {
        if (!item.storageKey) {
          return null;
        }
        if (item.type === "video") {
          storageKeys.add(item.storageKey);
        }
        if (item.posterStorageKey) {
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
    url: await tryResolveObjectUrl(key, fileNamesByKey.get(key)),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((result) => [result.key, result.url]));
  const gridUrlMap = new Map(
    await Promise.all(
      Array.from(gridImageKeys).map(
        async (key) => [key, await tryResolveImageUrl(key, "grid")] as const
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
          await resolveImageRenditions(
            fileKey,
            options.gridOnly
              ? ["compact", "grid"]
              : ["compact", "detail", "tiny", "grid"]
          ),
        ] as const;
      })
    )
  );

  return cards.map((storedCard) => {
    const { workflowArtifactKeys: _workflowArtifactKeys, ...card } = storedCard;
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
    const overrideUrl = ids.thumbnailOverrideKey
      ? gridUrlMap.get(ids.thumbnailOverrideKey)
      : undefined;
    const scrapedImageUrl = ids.linkPreviewImageKey
      ? (gridUrlMap.get(ids.linkPreviewImageKey) ?? undefined)
      : fallbackLinkPreviewImageUrl;
    return {
      ...omitCardText(card),
      fileUrl:
        ids.fileKey && !(options.gridOnly && card.type === "image")
          ? (urlMap.get(ids.fileKey) ?? undefined)
          : undefined,
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
      scrubUrl: ids.scrubKey
        ? (urlMap.get(ids.scrubKey) ?? undefined)
        : undefined,
      linkPreviewMedia: linkPreviewMedia?.length ? linkPreviewMedia : undefined,
      linkPreviewImageUrl: overrideUrl ?? scrapedImageUrl,
      ...(overrideUrl ? { hasThumbnailOverride: true as const } : {}),
    };
  });
};

export const attachGridFileUrls = (
  ctx: unknown,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const gridCards = cards.map((card) => {
    if (!card.metadata) {
      return card;
    }
    const metadata = { ...card.metadata };
    if (metadata.linkPreview) {
      const { raw: _previewRaw, ...preview } = metadata.linkPreview;
      metadata.linkPreview = preview;
    }
    if (metadata.linkCategory) {
      const { raw: _categoryRaw, ...category } = metadata.linkCategory;
      metadata.linkCategory = category;
    }
    return { ...card, metadata };
  });
  return attachFileUrls(ctx, gridCards, { gridOnly: true });
};

export const attachCardSummaryUrls = async (
  _ctx: unknown,
  cards: Doc<"cards">[]
): Promise<CardWithUrls[]> => {
  const thumbnailKeys = new Set<string>();
  const screenshotKeys = new Set<string>();
  const linkImageKeys = new Set<string>();

  for (const card of cards) {
    if (card.thumbnailKey) {
      thumbnailKeys.add(card.thumbnailKey);
    }
    if (card.metadata?.linkPreview?.screenshotStorageKey) {
      screenshotKeys.add(card.metadata.linkPreview.screenshotStorageKey);
    }
    if (card.metadata?.linkPreview?.imageStorageKey) {
      linkImageKeys.add(card.metadata.linkPreview.imageStorageKey);
    }
    if (card.thumbnailOverride) {
      linkImageKeys.add(card.thumbnailOverride.storageKey);
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
        async (key) => [key, await tryResolveImageUrl(key, "grid")] as const
      )
    )
  );
  const linkImageUrlMap = new Map(
    await Promise.all(
      Array.from(linkImageKeys).map(
        async (key) => [key, await tryResolveImageUrl(key, "grid")] as const
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

  return cards.map(
    ({ workflowArtifactKeys: _workflowArtifactKeys, ...card }) => {
      const overrideUrl = card.thumbnailOverride
        ? linkImageUrlMap.get(card.thumbnailOverride.storageKey)
        : undefined;
      return {
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
          ? (screenshotUrlMap.get(
              card.metadata.linkPreview.screenshotStorageKey
            ) ?? undefined)
          : undefined,
        linkPreviewImageUrl:
          overrideUrl ??
          (card.metadata?.linkPreview?.imageStorageKey
            ? (linkImageUrlMap.get(card.metadata.linkPreview.imageStorageKey) ??
              undefined)
            : undefined),
        ...(overrideUrl ? { hasThumbnailOverride: true as const } : {}),
      };
    }
  );
};
