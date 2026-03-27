import { v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { getStorageUrl } from "../fileStorage";
import type { LinkPreviewMediaItem } from "../linkMetadata";
import { cardReturnValidator } from "./getCards";

export const findDuplicateCardForUserHandler = async (
  ctx: any,
  userId: string,
  url: string
) => {
  // Find the most recent non-deleted card with the same URL
  const duplicate = await ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q: any) =>
      q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
    )
    .order("desc")
    .first();

  if (!duplicate) {
    return null;
  }

  // Attach file URLs like getCards does
  const linkPreviewMedia = await Promise.all(
    (
      (duplicate.metadata?.linkPreview?.media ?? []) as LinkPreviewMediaItem[]
    ).map(async (item) => {
      const url = await getStorageUrl(ctx, item.storageId);
      if (!url) {
        return null;
      }

      return {
        type: item.type,
        url,
        contentType: item.contentType,
        width: item.width,
        height: item.height,
        posterUrl: item.posterStorageId
          ? ((await getStorageUrl(ctx, item.posterStorageId)) ?? undefined)
          : undefined,
        posterContentType: item.posterContentType,
        posterWidth: item.posterWidth,
        posterHeight: item.posterHeight,
      };
    })
  );
  const fileUrl = duplicate.fileId
    ? await getStorageUrl(ctx, duplicate.fileId)
    : null;
  const thumbnailUrl = duplicate.thumbnailId
    ? await getStorageUrl(ctx, duplicate.thumbnailId)
    : null;
  const screenshotUrl = duplicate.metadata?.linkPreview?.screenshotStorageId
    ? await getStorageUrl(
        ctx,
        duplicate.metadata.linkPreview.screenshotStorageId
      )
    : null;
  const linkPreviewImageUrl =
    (duplicate.metadata?.linkPreview?.imageStorageId
      ? await getStorageUrl(ctx, duplicate.metadata.linkPreview.imageStorageId)
      : null) ??
    linkPreviewMedia.find((item) => item?.type === "image")?.url ??
    linkPreviewMedia.find((item) => item?.type === "video")?.posterUrl ??
    undefined;
  const resolvedLinkPreviewMedia = linkPreviewMedia.filter(Boolean);

  return {
    ...duplicate,
    fileUrl: fileUrl || undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    screenshotUrl: screenshotUrl || undefined,
    ...(resolvedLinkPreviewMedia.length > 0
      ? { linkPreviewMedia: resolvedLinkPreviewMedia }
      : {}),
    linkPreviewImageUrl: linkPreviewImageUrl || undefined,
  };
};

// Check if a card with the given URL already exists for the current user
export const findDuplicateCard = query({
  args: {
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    return findDuplicateCardForUserHandler(ctx, user.subject, args.url);
  },
});

export const findDuplicateCardForUser = internalQuery({
  args: {
    userId: v.string(),
    url: v.string(),
  },
  returns: v.union(cardReturnValidator, v.null()),
  handler: async (ctx, args) => {
    return findDuplicateCardForUserHandler(ctx, args.userId, args.url);
  },
});
