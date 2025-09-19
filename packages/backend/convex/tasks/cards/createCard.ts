import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import { cardTypeValidator, colorValidator } from "../../schema";
import { extractUrlFromContent } from "./validationUtils";
import { ensureCardCreationAllowed } from "./cardLimit";
import {
  buildInitialProcessingStatus,
  stageCompleted,
  stagePending,
} from "./processingStatus";

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

    await ensureCardCreationAllowed(ctx, user.subject);

    const now = Date.now();

    const providedType = args.type;
    let cardType = providedType ?? "text";
    let finalContent = args.content;
    let finalUrl = args.url;
    let originalMetadata = args.metadata || {};
    let fileMetadata: any = undefined;
    const classificationRequired = !providedType;
    const classificationStatus = classificationRequired
      ? stagePending()
      : stageCompleted(now, 1);

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

    if (args.fileId) {
      const systemFileMetadata = await ctx.db.system.get(args.fileId);
      if (systemFileMetadata?.contentType) {
        fileMetadata = {
          fileName: extractedFileMetadata.fileName || `file_${now}`,
          fileSize: systemFileMetadata.size,
          mimeType: systemFileMetadata.contentType,
          ...extractedFileMetadata,
        };
      }
    } else if (Object.keys(extractedFileMetadata).length > 0) {
      // If we have file metadata but no fileId, still create fileMetadata object
      fileMetadata = extractedFileMetadata;
    }

    if (!finalUrl && args.content?.trim()) {
      const urlExtraction = extractUrlFromContent(args.content);
      finalUrl = urlExtraction.url ?? finalUrl;
      finalContent = urlExtraction.cleanedContent;
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
      colors: args.colors,
      processingStatus: buildInitialProcessingStatus({
        now,
        cardType,
        classificationStatus,
      }),
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
    }

    await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.startProcessingPipeline, {
      cardId,
      classificationRequired,
    });

    return cardId;
  },
});
