import { v } from "convex/values";
import { query } from "../_generated/server";
import { getStorageUrl } from "../fileStorage";
import { storageRefValidator } from "../storageRefs";

export const getFileUrl = query({
  args: {
    fileId: storageRefValidator,
    cardId: v.id("cards"),
    urlRefreshToken: v.optional(v.string()),
  },
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

    const matchesFile =
      card.fileId === args.fileId ||
      card.thumbnailId === args.fileId ||
      card.metadata?.linkPreview?.screenshotStorageId === args.fileId ||
      card.metadata?.linkPreview?.imageStorageId === args.fileId;

    if (!matchesFile) {
      throw new Error("File does not belong to the specified card");
    }

    return await getStorageUrl(ctx, args.fileId);
  },
});
