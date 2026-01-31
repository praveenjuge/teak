import { v } from "convex/values";
import { query } from "../_generated/server";
import { cardReturnValidator } from "./getCards";

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

    // Find the most recent non-deleted card with the same URL
    const duplicate = await ctx.db
      .query("cards")
      .withIndex("by_user_url_deleted", (q) =>
        q
          .eq("userId", user.subject)
          .eq("url", args.url)
          .eq("isDeleted", undefined)
      )
      .order("desc")
      .first();

    if (!duplicate) {
      return null;
    }

    // Attach file URLs like getCards does
    const [fileUrl, thumbnailUrl, screenshotUrl, linkPreviewImageUrl] =
      await Promise.all([
        duplicate.fileId ? ctx.storage.getUrl(duplicate.fileId) : null,
        duplicate.thumbnailId
          ? ctx.storage.getUrl(duplicate.thumbnailId)
          : null,
        duplicate.metadata?.linkPreview?.screenshotStorageId
          ? ctx.storage.getUrl(
              duplicate.metadata.linkPreview.screenshotStorageId
            )
          : null,
        duplicate.metadata?.linkPreview?.imageStorageId
          ? ctx.storage.getUrl(duplicate.metadata.linkPreview.imageStorageId)
          : null,
      ]);

    return {
      ...duplicate,
      fileUrl: fileUrl || undefined,
      thumbnailUrl: thumbnailUrl || undefined,
      screenshotUrl: screenshotUrl || undefined,
      linkPreviewImageUrl: linkPreviewImageUrl || undefined,
    };
  },
});
