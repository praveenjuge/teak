import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { cardTypeValidator } from "./schema";
import { FREE_TIER_LIMIT } from "@teak/shared/constants";

export const getCardCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return 0;
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      )
      .collect();

    return cards.length;
  },
});

export const canCreateCard = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return false;
    }

    // Get current card count
    const cardCount = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      )
      .collect();

    // Return true if user has less than FREE_TIER_LIMIT cards (free tier limit)
    return cardCount.length < FREE_TIER_LIMIT;
  },
});

// Helper function to detect file type from MIME type
const getFileCardType = (mimeType: string): "image" | "video" | "audio" | "document" => {
  const normalizedType = mimeType.toLowerCase();

  if (normalizedType.startsWith("image/")) return "image";
  if (normalizedType.startsWith("video/")) return "video";
  if (normalizedType.startsWith("audio/")) return "audio";

  return "document";
};


export const createCard = mutation({
  args: {
    content: v.string(),
    type: v.optional(cardTypeValidator), // Make type optional for auto-detection
    url: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    thumbnailId: v.optional(v.id("_storage")),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
    metadata: v.optional(v.any()), // Allow any metadata from client, we'll process it
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    // Check if user can create a card (respects free tier limits)
    const cardCount = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      )
      .collect();

    // For free users, enforce the FREE_TIER_LIMIT card limit
    if (cardCount.length >= FREE_TIER_LIMIT) {
      // Need to check if user has premium - use the existing userHasPremium query
      const hasPremium = await ctx.runQuery(api.polar.userHasPremium);
      if (!hasPremium) {
        throw new Error("Card limit reached. Please upgrade to Pro for unlimited cards.");
      }
    }

    const now = Date.now();

    // Determine card type if not provided
    let cardType = args.type;
    let processedMetadata = args.metadata || {};

    if (!cardType && args.fileId) {
      // Auto-detect type from file metadata
      const fileMetadata = await ctx.db.system.get(args.fileId);
      if (fileMetadata?.contentType) {
        cardType = getFileCardType(fileMetadata.contentType);

        // Add file metadata
        processedMetadata = {
          ...processedMetadata,
          fileName: processedMetadata.fileName || `file_${now}`,
          fileSize: fileMetadata.size,
          mimeType: fileMetadata.contentType,
        };
      }
    }

    // Fallback to text if no type determined
    if (!cardType) {
      cardType = "text";
    }

    // Set initial metadataStatus for link cards
    const cardData = {
      userId: user.subject,
      content: args.content,
      type: cardType,
      url: args.url,
      fileId: args.fileId,
      thumbnailId: args.thumbnailId,
      tags: args.tags,
      notes: args.notes,
      metadata: Object.keys(processedMetadata).length > 0 ? processedMetadata : undefined,
      createdAt: now,
      updatedAt: now,
      // Set pending status for link cards that need metadata extraction
      ...(cardType === "link" && { metadataStatus: "pending" as const }),
    };

    const cardId = await ctx.db.insert("cards", cardData);

    // Schedule link metadata extraction for link cards (which will trigger AI generation after completion)
    if (cardType === "link") {
      await ctx.scheduler.runAfter(0, internal.linkMetadata.extractLinkMetadata, {
        cardId,
      });
    } else {
      // Schedule AI metadata generation for non-link cards immediately
      await ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, {
        cardId,
      });
    }

    return cardId;
  },
});

export const getCards = query({
  args: {
    type: v.optional(cardTypeValidator),
    favoritesOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", undefined)
      );

    if (args.type) {
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", user.subject).eq("type", args.type!)
        )
        .filter((q) => q.neq(q.field("isDeleted"), true));
    }

    if (args.favoritesOnly) {
      query = ctx.db
        .query("cards")
        .withIndex("by_user_favorites", (q) =>
          q.eq("userId", user.subject).eq("isFavorited", true)
        )
        .filter((q) => q.neq(q.field("isDeleted"), true));
    }

    const cards = await query.order("desc").take(args.limit || 50);

    return cards;
  },
});

// New server-side search and filter query
export const searchCards = query({
  args: {
    searchQuery: v.optional(v.string()),
    types: v.optional(v.array(cardTypeValidator)),
    favoritesOnly: v.optional(v.boolean()),
    showTrashOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const {
      searchQuery,
      types,
      favoritesOnly,
      showTrashOnly,
      limit = 50,
    } = args;

    // If we have a search query, use search indexes for efficiency
    if (searchQuery && searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();

      // Handle special keywords
      if (["fav", "favs", "favorites", "favourite", "favourites"].includes(query)) {
        return ctx.db
          .query("cards")
          .withIndex("by_user_favorites", (q) =>
            q.eq("userId", user.subject).eq("isFavorited", true)
          )
          .filter((q) => q.neq(q.field("isDeleted"), true))
          .order("desc")
          .take(limit);
      }

      if (["trash", "deleted", "bin", "recycle", "trashed"].includes(query)) {
        return ctx.db
          .query("cards")
          .withIndex("by_user_deleted", (q) =>
            q.eq("userId", user.subject).eq("isDeleted", true)
          )
          .order("desc")
          .take(limit);
      }

      // Search across multiple fields using search indexes
      const searchResults = await Promise.all([
        // Search content
        ctx.db
          .query("cards")
          .withSearchIndex("search_content", (q) =>
            q
              .search("content", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search notes
        ctx.db
          .query("cards")
          .withSearchIndex("search_notes", (q) =>
            q
              .search("notes", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search AI summary
        ctx.db
          .query("cards")
          .withSearchIndex("search_ai_summary", (q) =>
            q
              .search("aiSummary", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search transcript
        ctx.db
          .query("cards")
          .withSearchIndex("search_transcript", (q) =>
            q
              .search("transcript", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search metadata title
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_title", (q) =>
            q
              .search("metadataTitle", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),

        // Search metadata description
        ctx.db
          .query("cards")
          .withSearchIndex("search_metadata_description", (q) =>
            q
              .search("metadataDescription", searchQuery)
              .eq("userId", user.subject)
              .eq("isDeleted", showTrashOnly ? true : undefined)
          )
          .take(limit),
      ]);

      // Combine and deduplicate results
      const allResults = searchResults.flat();
      const uniqueResults = Array.from(
        new Map(allResults.map(card => [card._id, card])).values()
      );

      // Apply additional filters
      let filteredResults = uniqueResults;

      if (types && types.length > 0) {
        filteredResults = filteredResults.filter(card => types.includes(card.type));
      }

      if (favoritesOnly) {
        filteredResults = filteredResults.filter(card => card.isFavorited === true);
      }

      // Sort by creation date (desc) and limit
      return filteredResults
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }

    // No search query - use regular indexes with filters
    let query = ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", showTrashOnly ? true : undefined)
      );

    if (types && types.length === 1) {
      // Optimize for single type filter
      query = ctx.db
        .query("cards")
        .withIndex("by_user_type", (q) =>
          q.eq("userId", user.subject).eq("type", types[0])
        )
        .filter((q) =>
          showTrashOnly
            ? q.eq(q.field("isDeleted"), true)
            : q.neq(q.field("isDeleted"), true)
        );
    } else if (types && types.length > 1) {
      // Filter by multiple types
      query = query.filter((q) => {
        const typeConditions = types.map(type => q.eq(q.field("type"), type));
        return typeConditions.reduce((acc, condition) => q.or(acc, condition));
      });
    }

    if (favoritesOnly) {
      query = query.filter((q) => q.eq(q.field("isFavorited"), true));
    }

    const cards = await query.order("desc").take(limit);
    return cards;
  },
});

export const getCard = query({
  args: {
    id: v.id("cards"),
  },
  handler: async (ctx, { id }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return null;
    }

    const card = await ctx.db.get(id);
    if (!card || card.userId !== user.subject) {
      return null;
    }

    return card;
  },
});

export const getDeletedCards = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return [];
    }

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_user_deleted", (q) =>
        q.eq("userId", user.subject).eq("isDeleted", true)
      )
      .order("desc")
      .take(args.limit || 50);

    return cards;
  },
});

export const updateCard = mutation({
  args: {
    id: v.id("cards"),
    content: v.optional(v.string()),
    url: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    notes: v.optional(v.string()),
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

    const result = await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });

    // If content was updated, regenerate AI metadata
    if (updates.content !== undefined) {
      await ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, {
        cardId: id,
      });
    }

    return result;
  },
});



export const permanentDeleteCard = mutation({
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
      throw new Error("Not authorized to permanently delete this card");
    }

    // Delete associated files if they exist
    if (card.fileId) {
      await ctx.storage.delete(card.fileId);
    }
    if (card.thumbnailId) {
      await ctx.storage.delete(card.thumbnailId);
    }

    // Permanently remove from database
    return await ctx.db.delete(args.id);
  },
});


// Unified upload mutation that handles the complete upload-to-card pipeline
export const uploadAndCreateCard = mutation({
  args: {
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    content: v.optional(v.string()),
    additionalMetadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    cardId: v.optional(v.id("cards")),
    uploadUrl: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      // Check if user can create a card (respects free tier limits)
      const cardCount = await ctx.db
        .query("cards")
        .withIndex("by_user_deleted", (q) =>
          q.eq("userId", user.subject).eq("isDeleted", undefined)
        )
        .collect();

      // For free users, enforce the FREE_TIER_LIMIT card limit
      if (cardCount.length >= FREE_TIER_LIMIT) {
        const hasPremium = await ctx.runQuery(api.polar.userHasPremium);
        if (!hasPremium) {
          return { success: false, error: "Card limit reached. Please upgrade to Pro for unlimited cards." };
        }
      }

      // Generate upload URL
      const uploadUrl = await ctx.storage.generateUploadUrl();

      return {
        success: true,
        uploadUrl,
        cardId: undefined // Will be set after successful upload
      };
    } catch (error) {
      console.error("Failed to prepare upload:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to prepare upload"
      };
    }
  },
});

// Mutation to finalize card creation after successful upload
export const finalizeUploadedCard = mutation({
  args: {
    fileId: v.id("_storage"),
    fileName: v.string(),
    content: v.optional(v.string()),
    additionalMetadata: v.optional(v.any()),
  },
  returns: v.object({
    success: v.boolean(),
    cardId: v.optional(v.id("cards")),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      const now = Date.now();

      // Get file metadata from storage
      const fileMetadata = await ctx.db.system.get(args.fileId);
      if (!fileMetadata) {
        return { success: false, error: "File not found in storage" };
      }

      // Auto-detect card type from file
      const cardType = getFileCardType(fileMetadata.contentType || "application/octet-stream");

      // Build comprehensive metadata
      const metadata = {
        fileName: args.fileName,
        fileSize: fileMetadata.size,
        mimeType: fileMetadata.contentType,
        ...args.additionalMetadata,
      };

      // Create the card
      const cardId = await ctx.db.insert("cards", {
        userId: user.subject,
        content: args.content || "",
        type: cardType,
        fileId: args.fileId,
        metadata,
        createdAt: now,
        updatedAt: now,
      });

      // Schedule AI metadata generation
      await ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, {
        cardId,
      });

      return { success: true, cardId };
    } catch (error) {
      console.error("Failed to finalize uploaded card:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card"
      };
    }
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
    console.log(
      `User ${user.subject} uploading file: ${args.fileName || "unknown"} (${args.fileType || "unknown type"})`
    );

    return uploadUrl;
  },
});


// Unified mutation for updating any card field
export const updateCardField = mutation({
  args: {
    cardId: v.id("cards"),
    field: v.union(
      v.literal("content"),
      v.literal("url"),
      v.literal("notes"),
      v.literal("tags"),
      v.literal("aiSummary"),
      v.literal("isFavorited"),
      v.literal("removeAiTag"),
      v.literal("delete"),
      v.literal("restore")
    ),
    value: v.optional(v.any()),
    tagToRemove: v.optional(v.string()), // For removeAiTag operation
  },
  handler: async (ctx, { cardId, field, value, tagToRemove }) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new Error("Card not found");
    }

    if (card.userId !== user.subject) {
      throw new Error("Not authorized to modify this card");
    }

    const now = Date.now();
    let updateData: any = { updatedAt: now };

    switch (field) {
      case "content":
        updateData.content = typeof value === "string" ? value.trim() : value;
        // Trigger AI metadata regeneration if content changed
        if (updateData.content !== card.content) {
          ctx.scheduler.runAfter(0, internal.ai.generateAiMetadata, { cardId });
        }
        break;

      case "url":
        updateData.url = typeof value === "string" ? value.trim() || undefined : value;
        break;

      case "notes":
        updateData.notes = typeof value === "string" ? value.trim() || undefined : value;
        break;

      case "tags":
        updateData.tags = Array.isArray(value) && value.length > 0 ? value : undefined;
        break;

      case "aiSummary":
        updateData.aiSummary = typeof value === "string" ? value.trim() || undefined : value;
        break;

      case "isFavorited":
        updateData.isFavorited = !card.isFavorited;
        break;

      case "removeAiTag":
        if (!tagToRemove || !card.aiTags) {
          return card; // No-op if no tag to remove or no AI tags
        }
        const updatedAiTags = card.aiTags.filter((tag) => tag !== tagToRemove);
        updateData.aiTags = updatedAiTags.length > 0 ? updatedAiTags : undefined;
        break;

      case "delete":
        updateData.isDeleted = true;
        updateData.deletedAt = now;
        break;

      case "restore":
        if (!card.isDeleted) {
          throw new Error("Card is not deleted");
        }
        updateData.isDeleted = undefined;
        updateData.deletedAt = undefined;
        break;

      default:
        throw new Error(`Unsupported field: ${field}`);
    }

    return await ctx.db.patch(cardId, updateData);
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

// Internal mutation for scheduled cleanup
export const cleanupOldDeletedCards = internalMutation({
  args: {},
  handler: async (ctx) => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

    // Find cards that were soft-deleted more than 30 days ago
    const cardsToCleanup = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.eq(q.field("isDeleted"), true),
          q.lt(q.field("deletedAt"), thirtyDaysAgo)
        )
      )
      .collect();

    let cleanedCount = 0;

    for (const card of cardsToCleanup) {
      try {
        // Delete associated files if they exist
        if (card.fileId) {
          await ctx.storage.delete(card.fileId);
        }
        if (card.thumbnailId) {
          await ctx.storage.delete(card.thumbnailId);
        }

        // Permanently delete from database
        await ctx.db.delete(card._id);
        cleanedCount++;
      } catch (error) {
        console.error(`Failed to cleanup card ${card._id}:`, error);
      }
    }

    console.log(
      `Cleaned up ${cleanedCount} cards that were deleted more than 30 days ago`
    );
    return { cleanedCount };
  },
});

// Migration function to backfill metadata search fields for existing cards
export const backfillMetadataSearchFields = internalMutation({
  args: {
    batchSize: v.optional(v.number()),
  },
  handler: async (ctx, { batchSize = 100 }) => {
    // Get cards that have metadata but don't have metadataTitle/metadataDescription
    const cards = await ctx.db
      .query("cards")
      .filter((q) =>
        q.and(
          q.neq(q.field("metadata"), undefined),
          q.or(
            q.eq(q.field("metadataTitle"), undefined),
            q.eq(q.field("metadataDescription"), undefined)
          )
        )
      )
      .take(batchSize);

    let updatedCount = 0;

    for (const card of cards) {
      if (card.metadata) {
        const updateFields: any = { updatedAt: Date.now() };

        // Populate metadataTitle if missing
        if (!card.metadataTitle && card.metadata.microlinkData?.data?.title) {
          updateFields.metadataTitle = card.metadata.microlinkData.data.title;
        }

        // Populate metadataDescription if missing
        if (!card.metadataDescription && card.metadata.microlinkData?.data?.description) {
          updateFields.metadataDescription = card.metadata.microlinkData.data.description;
        }

        // Only update if we have fields to update
        if (Object.keys(updateFields).length > 1) {
          await ctx.db.patch(card._id, updateFields);
          updatedCount++;
        }
      }
    }

    console.log(`Backfilled metadata search fields for ${updatedCount} cards`);
    return { updatedCount, hasMore: cards.length === batchSize };
  },
});
