import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal, api } from "../../_generated/api";
import { cardTypeValidator, colorValidator } from "../../schema";
import { FREE_TIER_LIMIT } from "@teak/shared/constants";
import { detectCardTypeFromContent } from "./contentDetection";
import { getFileCardType } from "./fileUtils";

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
    colors: v.optional(v.array(colorValidator)), // For palette cards
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

    // Determine card type and process content
    let cardType = args.type;
    let finalContent = args.content;
    let finalUrl = args.url;
    let detectedColors = args.colors;
    let originalMetadata = args.metadata || {};
    let fileMetadata: any = undefined;

    // Separate file-related metadata from other metadata
    let processedMetadata = { ...originalMetadata };

    // Move file-related fields to fileMetadata if present
    const fileRelatedFields = ['fileName', 'fileSize', 'mimeType', 'duration', 'width', 'height', 'recordingTimestamp'];
    const extractedFileMetadata: any = {};

    fileRelatedFields.forEach(field => {
      if (processedMetadata[field] !== undefined) {
        extractedFileMetadata[field] = processedMetadata[field];
        delete processedMetadata[field];
      }
    });

    if (!cardType && args.fileId) {
      // Auto-detect type from file metadata
      const systemFileMetadata = await ctx.db.system.get(args.fileId);
      if (systemFileMetadata?.contentType) {
        cardType = getFileCardType(systemFileMetadata.contentType);

        // Create file metadata object, merging extracted fields
        fileMetadata = {
          fileName: extractedFileMetadata.fileName || `file_${now}`,
          fileSize: systemFileMetadata.size,
          mimeType: systemFileMetadata.contentType,
          ...extractedFileMetadata, // Include any other file-related metadata
        };
      }
    } else if (Object.keys(extractedFileMetadata).length > 0) {
      // If we have file metadata but no fileId, still create fileMetadata object
      fileMetadata = extractedFileMetadata;
    }

    // Auto-detect card type from content if not provided and no file
    if (!cardType && !args.fileId && args.content?.trim()) {
      const detection = detectCardTypeFromContent(args.content);
      cardType = detection.type;
      finalContent = detection.processedContent;

      // Use detected URL if no URL was provided
      if (!finalUrl && detection.url) {
        finalUrl = detection.url;
      }

      // Use detected colors if no colors were provided
      if (!detectedColors && detection.colors) {
        detectedColors = detection.colors;
      }
    }

    // Fallback to text if no type determined
    if (!cardType) {
      cardType = "text";
    }

    // Set initial metadataStatus for link cards
    const cardData = {
      userId: user.subject,
      content: finalContent,
      type: cardType,
      url: finalUrl,
      fileId: args.fileId,
      thumbnailId: args.thumbnailId,
      tags: args.tags,
      notes: args.notes,
      metadata: Object.keys(processedMetadata).length > 0 ? processedMetadata : undefined,
      fileMetadata: fileMetadata,
      colors: detectedColors, // Use detected or provided colors
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
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, {
        cardId,
      });
    }

    return cardId;
  },
});