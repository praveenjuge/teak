import type { FilesImageRendition } from "@teak/files-protocol";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { action, internalQuery, query } from "../_generated/server";
import { resolveImageUrl, resolveObjectUrl } from "../storage/r2";

const mediaRenditionValidator = v.union(
  v.literal("tiny"),
  v.literal("compact"),
  v.literal("grid"),
  v.literal("detail")
);

const cardOwnsMediaKey = (
  card: {
    fileKey?: string;
    thumbnailKey?: string;
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
  card.metadata?.linkPreview?.screenshotStorageKey === key ||
  card.metadata?.linkPreview?.imageStorageKey === key ||
  Boolean(
    card.metadata?.linkPreview?.media?.some(
      (item) => item.storageKey === key || item.posterStorageKey === key
    )
  );

export const getFileUrl = query({
  args: {
    key: v.string(),
    cardId: v.id("cards"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthenticated call to getFileUrl");
    }

    const card = await ctx.db.get("cards", args.cardId);
    if (!card) {
      throw new Error("Card not found");
    }

    if (card.userId !== user.subject) {
      throw new Error("Unauthorized access to file");
    }

    if (!cardOwnsMediaKey(card, args.key)) {
      throw new Error("File does not belong to the specified card");
    }

    return resolveObjectUrl(
      args.key,
      args.key === card.fileKey
        ? (card.fileMetadata?.fileName ?? null)
        : undefined
    );
  },
});

export const getAuthorizedMedia = internalQuery({
  args: { key: v.string(), cardId: v.id("cards") },
  returns: v.union(
    v.object({ fileName: v.union(v.string(), v.null()) }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("Unauthenticated media refresh");
    }
    const card = await ctx.db.get("cards", args.cardId);
    if (!(card && card.userId === user.subject)) {
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

/** Mint a fresh signed URL after a browser-visible media request fails. */
export const refreshCardMediaUrl = action({
  args: {
    key: v.string(),
    cardId: v.id("cards"),
    rendition: v.optional(mediaRenditionValidator),
  },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const media: { fileName: string | null } | null = await ctx.runQuery(
      (internal as any).card.getFileUrl.getAuthorizedMedia,
      { cardId: args.cardId, key: args.key }
    );
    if (!media) {
      throw new Error("Unauthorized media refresh");
    }
    const url: string | null = args.rendition
      ? await resolveImageUrl(args.key, args.rendition as FilesImageRendition)
      : await resolveObjectUrl(args.key, media.fileName);
    if (!url) {
      throw new Error("Media URL unavailable");
    }
    return { url };
  },
});
