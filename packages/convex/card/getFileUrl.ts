import { v } from "convex/values";
import { query } from "../_generated/server";
import { resolveObjectUrl } from "../storage/r2";

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

    const matchesFile =
      card.fileKey === args.key ||
      card.thumbnailKey === args.key ||
      card.metadata?.linkPreview?.screenshotStorageKey === args.key ||
      card.metadata?.linkPreview?.imageStorageKey === args.key ||
      card.metadata?.linkPreview?.media?.some(
        (item) =>
          item.storageKey === args.key || item.posterStorageKey === args.key
      );

    if (!matchesFile) {
      throw new Error("File does not belong to the specified card");
    }

    return resolveObjectUrl(args.key);
  },
});
