import type { Doc } from "../_generated/dataModel";
import type { CreatedAtRange } from "../shared";

export type CardWithUrls = Doc<"cards"> & {
  fileUrl?: string;
  thumbnailUrl?: string;
  screenshotUrl?: string;
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
  const cardToIds = new Map<
    string,
    {
      fileId?: string;
      thumbnailId?: string;
      screenshotId?: string;
      linkPreviewImageId?: string;
    }
  >();

  for (const card of cards) {
    const ids: Record<string, string | undefined> = {};
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
    if (card.metadata?.linkPreview?.screenshotStorageId) {
      storageIds.add(card.metadata.linkPreview.screenshotStorageId);
      ids.screenshotId = card.metadata.linkPreview.screenshotStorageId;
    }
    cardToIds.set(card._id, ids);
  }

  const urlPromises = Array.from(storageIds).map(async (id) => ({
    id,
    url: await ctx.storage.getUrl(id as any),
  }));
  const urlResults = await Promise.all(urlPromises);
  const urlMap = new Map(urlResults.map((result) => [result.id, result.url]));

  return cards.map((card) => {
    const ids = cardToIds.get(card._id) || {};
    return {
      ...card,
      fileUrl: ids.fileId ? (urlMap.get(ids.fileId) ?? undefined) : undefined,
      thumbnailUrl: ids.thumbnailId
        ? (urlMap.get(ids.thumbnailId) ?? undefined)
        : undefined,
      screenshotUrl: ids.screenshotId
        ? (urlMap.get(ids.screenshotId) ?? undefined)
        : undefined,
      linkPreviewImageUrl: ids.linkPreviewImageId
        ? (urlMap.get(ids.linkPreviewImageId) ?? undefined)
        : undefined,
    };
  });
};
