import { v } from "convex/values";
import { action, mutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { authComponent } from "./auth";

const STORAGE_PREFIX = "storage:";

const extractStorageId = (image?: string | null): Id<"_storage"> | null => {
  if (!image || !image.startsWith(STORAGE_PREFIX)) return null;
  return image.slice(STORAGE_PREFIX.length) as Id<"_storage">;
};

export const prepareAvatarUpload = mutation({
  args: {
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("User must be authenticated");
    }

    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const finalizeAvatarUpload = action({
  args: {
    fileId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);

    const previousStorageId = extractStorageId(user.image);
    if (previousStorageId && previousStorageId !== args.fileId) {
      try {
        await ctx.storage.delete(previousStorageId);
      } catch (error) {
        console.warn("Failed to delete previous avatar", error);
      }
    }

    await ctx.runMutation(authComponent.component.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: user._id }],
        update: { image: `${STORAGE_PREFIX}${args.fileId}` },
      },
    });

    const imageUrl = await ctx.storage.getUrl(args.fileId);

    return {
      success: true,
      imageUrl,
      fileId: args.fileId,
    };
  },
});

export const removeAvatar = action({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);

    const storageId = extractStorageId(user.image);
    if (storageId) {
      try {
        await ctx.storage.delete(storageId);
      } catch (error) {
        console.warn("Failed to delete avatar file", error);
      }
    }

    await ctx.runMutation(authComponent.component.adapter.updateOne, {
      input: {
        model: "user",
        where: [{ field: "_id", value: user._id }],
        update: { image: null },
      },
    });

    return { success: true };
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("User must be authenticated");
    }

    const userId = identity.subject;

    const authUser = await authComponent.getAuthUser(ctx);
    const avatarStorageId = extractStorageId(authUser.image);
    if (avatarStorageId) {
      try {
        await ctx.storage.delete(avatarStorageId);
      } catch (error) {
        console.warn("Failed to delete avatar during account deletion", error);
      }
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    for (const card of cards) {
      if (card.fileId) {
        await ctx.storage.delete(card.fileId);
      }
      if (card.thumbnailId) {
        await ctx.storage.delete(card.thumbnailId);
      }

      await ctx.db.delete(card._id);
    }

    return { deletedCards: cards.length };
  },
});
