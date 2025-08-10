import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createCard = mutation({
  args: {
    title: v.optional(v.string()),
    content: v.string(),
    type: v.union(
      v.literal("text"),
      v.literal("link"),
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("document")
    ),
    url: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    thumbnailId: v.optional(v.id("_storage")),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    metadata: v.optional(v.object({
      linkTitle: v.optional(v.string()),
      linkDescription: v.optional(v.string()),
      linkImage: v.optional(v.string()),
      linkFavicon: v.optional(v.string()),
      fileSize: v.optional(v.number()),
      fileName: v.optional(v.string()),
      mimeType: v.optional(v.string()),
      duration: v.optional(v.number()),
    })),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const now = Date.now();
    
    return await ctx.db.insert("cards", {
      userId: user.subject,
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getCards = query({
  args: {
    type: v.optional(v.union(
      v.literal("text"),
      v.literal("link"),
      v.literal("image"),
      v.literal("video"),
      v.literal("audio"),
      v.literal("document")
    )),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    let query = ctx.db
      .query("cards")
      .withIndex("by_user", (q) => q.eq("userId", user.subject));

    if (args.type) {
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type", (q) => 
          q.eq("userId", user.subject).eq("type", args.type!)
        );
    }

    const cards = await query
      .order("desc")
      .take(args.limit || 50);

    return cards;
  },
});

export const updateCard = mutation({
  args: {
    id: v.id("cards"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const { id, ...updates } = args;
    const card = await ctx.db.get(id);
    
    if (!card) {
      throw new Error("Card not found");
    }
    
    if (card.userId !== user.subject) {
      throw new Error("Not authorized to update this card");
    }

    return await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

export const deleteCard = mutation({
  args: {
    id: v.id("cards"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const card = await ctx.db.get(args.id);
    
    if (!card) {
      throw new Error("Card not found");
    }
    
    if (card.userId !== user.subject) {
      throw new Error("Not authorized to delete this card");
    }

    // Delete associated files if they exist
    if (card.fileId) {
      await ctx.storage.delete(card.fileId);
    }
    if (card.thumbnailId) {
      await ctx.storage.delete(card.thumbnailId);
    }

    return await ctx.db.delete(args.id);
  },
});

export const generateUploadUrl = mutation({
  args: {
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }
    
    // Generate upload URL - Convex handles storage internally
    // File organization is managed through the cards table with userId
    const uploadUrl = await ctx.storage.generateUploadUrl();
    
    // Log upload request for debugging/monitoring (optional)
    console.log(`User ${user.subject} uploading file: ${args.fileName || 'unknown'} (${args.fileType || 'unknown type'})`);
    
    return uploadUrl;
  },
});

export const getFileUrl = query({
  args: {
    fileId: v.id("_storage"),
    cardId: v.optional(v.id("cards")), // Optional: for additional security verification
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    
    // If cardId is provided, verify the user owns the card that references this file
    if (args.cardId && user) {
      const card = await ctx.db.get(args.cardId);
      if (!card || card.userId !== user.subject) {
        throw new Error("Unauthorized access to file");
      }
    }
    
    return await ctx.storage.getUrl(args.fileId);
  },
});