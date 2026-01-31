import { extractPaletteColors } from "@teak/convex/shared/utils/colorUtils";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { ensureCardCreationAllowed } from "../auth";
import { cardTypeValidator, colorValidator } from "../schema";
import { workflow } from "../workflows/manager";
import {
  buildInitialProcessingStatus,
  stageCompleted,
  stagePending,
} from "./processingStatus";
import { normalizeQuoteContent } from "./quoteFormatting";
import { extractUrlFromContent } from "./validationUtils";

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
  returns: v.id("cards"),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    // Check rate limit and card count limit
    await ensureCardCreationAllowed(ctx, user.subject);

    const now = Date.now();

    const providedType = args.type;
    let cardType = providedType ?? "text";
    let finalContent = args.content;
    let finalUrl = args.url;
    const originalMetadata = args.metadata || {};
    let fileMetadata: any;
    const classificationRequired = !providedType;
    const classificationStatus = classificationRequired
      ? stagePending()
      : stageCompleted(now, 1);

    // Separate file-related metadata from other metadata
    const processedMetadata = { ...originalMetadata };

    // Move file-related fields to fileMetadata if present
    const fileRelatedFields = [
      "fileName",
      "fileSize",
      "mimeType",
      "duration",
      "width",
      "height",
      "recordingTimestamp",
    ];
    const extractedFileMetadata: any = {};

    for (const field of fileRelatedFields) {
      if (processedMetadata[field] !== undefined) {
        extractedFileMetadata[field] = processedMetadata[field];
        delete processedMetadata[field];
      }
    }

    if (args.fileId) {
      const systemFileMetadata = await ctx.db.system.get(
        "_storage",
        args.fileId
      );
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

    const quoteNormalization = normalizeQuoteContent(finalContent);
    const shouldDefaultToQuote =
      !providedType && quoteNormalization.removedQuotes;

    if (shouldDefaultToQuote) {
      cardType = "quote";
    }

    if (cardType === "quote" && quoteNormalization.removedQuotes) {
      finalContent = quoteNormalization.text;
    }

    // Pre-populate palette colours when explicitly creating a palette card without provided colours
    let resolvedColors = args.colors;
    if (!resolvedColors && cardType === "palette") {
      const paletteText = [
        finalContent ?? "",
        args.notes ?? "",
        Array.isArray(args.tags) ? args.tags.join(" ") : "",
      ]
        .filter(Boolean)
        .join("\n");

      const parsedColors = extractPaletteColors(paletteText, 12);
      resolvedColors = parsedColors.length > 0 ? parsedColors : undefined;
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
      metadata:
        Object.keys(processedMetadata).length > 0
          ? processedMetadata
          : undefined,
      fileMetadata,
      colors: resolvedColors,
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

    // Start the card processing workflow
    await workflow.start(
      ctx,
      (internal as any)["workflows/cardProcessing"].cardProcessingWorkflow,
      { cardId }
    );

    return cardId;
  },
});
