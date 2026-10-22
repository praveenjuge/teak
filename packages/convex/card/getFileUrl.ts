import type { FilesImageRendition } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalQuery, query } from "../_generated/server";
import { requireSessionUser } from "../securitySessions";
import {
  isStorageNamespaceError,
  resolveDownloadUrl,
  tryResolveImageUrl,
  tryResolveObjectUrl,
} from "../storage/fileUrls";

const mediaRenditionValidator = v.union(
  v.literal("tiny"),
  v.literal("compact"),
  v.literal("grid"),
  v.literal("detail")
);

const cardOwnsMediaKey = (
  card: {
    fileKey?: string;
    scrubKey?: string;
    thumbnailKey?: string;
    thumbnailOverride?: { storageKey: string };
    metadata?: {
      linkPreview?: {
        imageStorageKey?: string;
        screenshotStorageKey?: string;
        media?: Array<{ storageKey?: string; posterStorageKey?: string }>;
      };
    };
  },
  key: string
): boolean =>
  card.fileKey === key ||
  card.thumbnailKey === key ||
  card.scrubKey === key ||
  card.thumbnailOverride?.storageKey === key ||
  card.metadata?.linkPreview?.screenshotStorageKey === key ||
  card.metadata?.linkPreview?.imageStorageKey === key ||
  Boolean(
    card.metadata?.linkPreview?.media?.some(
      (item) => item.storageKey === key || item.posterStorageKey === key
    )
  );

export const getFileDownloadUrl = query({
  args: { cardId: v.id("cards") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await requireSessionUser(ctx);
    const card = await ctx.db.get("cards", args.cardId);
    if (!card || card.userId !== user.teakUserId) {
      throw new Error("Card not found");
    }
    const fileName = card.fileMetadata?.fileName;
    if (!(card.fileKey && fileName)) {
      return null;
    }
    try {
      return await resolveDownloadUrl(card.fileKey, fileName);
    } catch (error) {
      if (isStorageNamespaceError(error)) {
        return null;
      }
      throw error;
    }
  },
});

export const getAuthorizedMedia = internalQuery({
  args: { key: v.string(), cardId: v.id("cards") },
  returns: v.union(
    v.object({ fileName: v.union(v.string(), v.null()) }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await requireSessionUser(ctx);
    const card = await ctx.db.get("cards", args.cardId);
    if (!(card && card.userId === user.teakUserId)) {
      return null;
    }
    if (!cardOwnsMediaKey(card, args.key)) {
      throw new Error("File does not belong to the specified card");
    }
    return {
      fileName:
        card.fileKey === args.key
          ? (card.fileMetadata?.fileName ?? null)
          : null,
    };
  },
});

export const refreshCardMediaUrl = action({
  args: {
    key: v.string(),
    cardId: v.id("cards"),
    rendition: v.optional(mediaRenditionValidator),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const media: { fileName: string | null } | null = await ctx.runQuery(
      internal.card.getFileUrl.getAuthorizedMedia,
      { cardId: args.cardId, key: args.key }
    );
    if (!media) {
      throw new Error("Unauthorized media refresh");
    }
    const url: string | null = args.rendition
      ? await tryResolveImageUrl(
          args.key,
          args.rendition as FilesImageRendition
        )
      : await tryResolveObjectUrl(args.key, media.fileName);
    if (!url) {
      throw new Error("Media URL unavailable");
    }
    return { url };
  },
});
