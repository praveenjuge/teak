import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery } from "../_generated/server";

export type AssetRef = {
  legacyStorageId: Id<"_storage">;
  keyPath: string;
  role: string;
};

const collectLegacyAssetRefs = (card: Doc<"cards">): AssetRef[] => {
  const refs: AssetRef[] = [];
  if (card.fileId && !card.fileKey) {
    refs.push({ legacyStorageId: card.fileId, keyPath: "fileKey", role: "file" });
  }
  if (card.thumbnailId && !card.thumbnailKey) {
    refs.push({
      legacyStorageId: card.thumbnailId,
      keyPath: "thumbnailKey",
      role: "thumbnail",
    });
  }
  const preview = card.metadata?.linkPreview;
  if (preview?.imageStorageId && !preview.imageStorageKey) {
    refs.push({
      legacyStorageId: preview.imageStorageId,
      keyPath: "metadata.linkPreview.imageStorageKey",
      role: "link-preview-image",
    });
  }
  if (preview?.screenshotStorageId && !preview.screenshotStorageKey) {
    refs.push({
      legacyStorageId: preview.screenshotStorageId,
      keyPath: "metadata.linkPreview.screenshotStorageKey",
      role: "screenshot",
    });
  }
  preview?.media?.forEach((item, index) => {
    if (item.storageId && !item.storageKey) {
      refs.push({
        legacyStorageId: item.storageId,
        keyPath: `metadata.linkPreview.media.${index}.storageKey`,
        role: `link-media-${item.type}`,
      });
    }
    if (item.posterStorageId && !item.posterStorageKey) {
      refs.push({
        legacyStorageId: item.posterStorageId,
        keyPath: `metadata.linkPreview.media.${index}.posterStorageKey`,
        role: "link-media-poster",
      });
    }
  });
  return refs;
};

export const getLegacyStorageCards = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    page: v.array(v.any()),
    cardsScanned: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { cursor, numItems }) => {
    const result = await ctx.db.query("cards").paginate({ cursor, numItems });
    return {
      page: result.page
        .map((card) => ({
          card,
          refs: collectLegacyAssetRefs(card),
        }))
        .filter((item) => item.refs.length > 0),
      cardsScanned: result.page.length,
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

export const patchMigratedStorageRefs = internalMutation({
  args: {
    cardId: v.id("cards"),
    migrated: v.array(
      v.object({
        keyPath: v.string(),
        r2Key: v.string(),
      })
    ),
  },
  returns: v.null(),
  handler: async (ctx, { cardId, migrated }) => {
    const card = await ctx.db.get(cardId);
    if (!card) {
      return null;
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    const metadata = card.metadata ? { ...card.metadata } : undefined;
    const linkPreview = metadata?.linkPreview
      ? { ...metadata.linkPreview }
      : undefined;
    const media = linkPreview?.media?.map((item) => ({ ...item }));

    for (const item of migrated) {
      if (item.keyPath === "fileKey" || item.keyPath === "thumbnailKey") {
        patch[item.keyPath] = item.r2Key;
        continue;
      }
      if (!linkPreview) {
        continue;
      }
      if (item.keyPath === "metadata.linkPreview.imageStorageKey") {
        linkPreview.imageStorageKey = item.r2Key;
        continue;
      }
      if (item.keyPath === "metadata.linkPreview.screenshotStorageKey") {
        linkPreview.screenshotStorageKey = item.r2Key;
        continue;
      }
      const match = /^metadata\.linkPreview\.media\.(\d+)\.(storageKey|posterStorageKey)$/u.exec(
        item.keyPath
      );
      if (match && media?.[Number(match[1])]) {
        media[Number(match[1])]![match[2] as "storageKey" | "posterStorageKey"] =
          item.r2Key;
      }
    }

    if (metadata && linkPreview) {
      patch.metadata = {
        ...metadata,
        linkPreview: {
          ...linkPreview,
          ...(media ? { media } : {}),
        },
      };
    }

    await ctx.db.patch(cardId, patch);
    return null;
  },
});
