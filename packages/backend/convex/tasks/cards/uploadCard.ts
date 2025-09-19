import { ConvexError, v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { ensureCardCreationAllowed } from "./cardLimit";
import { getFileCardType } from "./fileUtils";

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
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      await ensureCardCreationAllowed(ctx, user.subject);

      // Generate upload URL
      const uploadUrl = await ctx.storage.generateUploadUrl();

      return {
        success: true,
        uploadUrl,
        cardId: undefined // Will be set after successful upload
      };
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data) {
        const { code, message } = error.data as { code?: string; message?: string };
        if (code) {
          return {
            success: false,
            errorCode: code,
            error: message,
          };
        }
      }
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
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      return { success: false, error: "User must be authenticated" };
    }

    try {
      const now = Date.now();
      await ensureCardCreationAllowed(ctx, user.subject);

      // Get file metadata from storage
      const fileMetadata = await ctx.db.system.get(args.fileId);
      if (!fileMetadata) {
        return { success: false, error: "File not found in storage" };
      }

      // Auto-detect card type from file
      const cardType = getFileCardType(fileMetadata.contentType || "application/octet-stream");

      // Separate file-related metadata from other metadata
      const additionalMeta = args.additionalMetadata || {};

      // Build comprehensive file metadata (including any file-related fields from additionalMetadata)
      const fileMetadataObj = {
        fileName: args.fileName,
        fileSize: fileMetadata.size,
        mimeType: fileMetadata.contentType,
        // Include file-related fields from additionalMetadata
        ...(additionalMeta.recordingTimestamp && { recordingTimestamp: additionalMeta.recordingTimestamp }),
        ...(additionalMeta.duration && { duration: additionalMeta.duration }),
        ...(additionalMeta.width && { width: additionalMeta.width }),
        ...(additionalMeta.height && { height: additionalMeta.height }),
      };

      // Build non-file metadata (only keep fields that aren't file-related)
      const nonFileMetadata = { ...additionalMeta };
      delete nonFileMetadata.recordingTimestamp;
      delete nonFileMetadata.duration;
      delete nonFileMetadata.width;
      delete nonFileMetadata.height;
      delete nonFileMetadata.fileName;
      delete nonFileMetadata.fileSize;
      delete nonFileMetadata.mimeType;

      const metadata = Object.keys(nonFileMetadata).length > 0 ? nonFileMetadata : undefined;

      // Create the card
      const cardId = await ctx.db.insert("cards", {
        userId: user.subject,
        content: args.content || "",
        type: cardType,
        fileId: args.fileId,
        fileMetadata: fileMetadataObj,
        metadata,
        createdAt: now,
        updatedAt: now,
      });

      // Schedule AI metadata generation
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, {
        cardId,
      });

      // Schedule thumbnail generation for image cards (placeholder implementation)
      if (cardType === "image") {
        await ctx.scheduler.runAfter(0, internal.tasks.thumbnails.generateThumbnail.generateThumbnail, {
          cardId,
        });
      }

      return { success: true, cardId };
    } catch (error) {
      if (error instanceof ConvexError && typeof error.data === "object" && error.data) {
        const { code, message } = error.data as { code?: string; message?: string };
        if (code) {
          return {
            success: false,
            errorCode: code,
            error: message,
          };
        }
      }
      console.error("Failed to finalize uploaded card:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to create card"
      };
    }
  },
});
