import { v } from "convex/values";
import { mutation } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  buildInitialProcessingStatus,
  stagePending,
  withStageStatus,
  type ProcessingStatus,
} from "./processingStatus";
import { normalizeQuoteContent } from "./quoteFormatting";

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

    const now = Date.now();
    let processingStatus = card.processingStatus as ProcessingStatus | undefined;

    if (updates.content !== undefined) {
      if (card.type === "quote") {
        updates.content = normalizeQuoteContent(updates.content).text;
      }
      processingStatus = processingStatus
        ? withStageStatus(processingStatus, "metadata", stagePending())
        : buildInitialProcessingStatus({
          now,
          cardType: card.type,
          classificationStatus: stagePending(),
        });

      if (card.type === "link" && processingStatus) {
        processingStatus = withStageStatus(processingStatus, "categorize", stagePending());
      }
    }

    const result = await ctx.db.patch(id, {
      ...updates,
      ...(processingStatus ? { processingStatus } : {}),
      updatedAt: now,
    });

    // If content was updated, regenerate AI metadata
    if (updates.content !== undefined) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/manager"].startCardProcessingWorkflow,
        {
          cardId: id,
        }
      );
    }

    return result;
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
    const updateData: any = { updatedAt: now };
    let processingStatus = card.processingStatus as ProcessingStatus | undefined;
    let shouldSchedulePipeline = false;

    switch (field) {
      case "content": {
        let nextContent = typeof value === "string" ? value.trim() : value;
        if (typeof nextContent === "string" && card.type === "quote") {
          nextContent = normalizeQuoteContent(nextContent).text;
        }
        updateData.content = nextContent;
        if (updateData.content !== card.content) {
          processingStatus = processingStatus
            ? withStageStatus(processingStatus, "metadata", stagePending())
            : buildInitialProcessingStatus({
              now,
              cardType: card.type,
              classificationStatus: stagePending(),
            });
          if (card.type === "link" && processingStatus) {
            processingStatus = withStageStatus(processingStatus, "categorize", stagePending());
          }
          shouldSchedulePipeline = true;
        }
        break;
      }

      case "url":
        updateData.url = typeof value === "string" ? value.trim() || undefined : value;
        if (updateData.url !== card.url) {
          const baseStatus = processingStatus
            ? withStageStatus(processingStatus, "classify", stagePending())
            : buildInitialProcessingStatus({
              now,
              cardType: card.type,
              classificationStatus: stagePending(),
            });

          processingStatus = withStageStatus(baseStatus, "metadata", stagePending());
          processingStatus = withStageStatus(processingStatus, "categorize", stagePending());
          shouldSchedulePipeline = true;

          const nextMetadata = { ...(card.metadata ?? {}) };
          if ("linkPreview" in nextMetadata) {
            delete (nextMetadata as Record<string, unknown>).linkPreview;
          }
          if ("linkCategory" in nextMetadata) {
            delete (nextMetadata as Record<string, unknown>).linkCategory;
          }
          updateData.metadata = Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined;
          updateData.metadataStatus = "pending";
        }
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

    if (processingStatus) {
      updateData.processingStatus = processingStatus;
    }

    const result = await ctx.db.patch(cardId, updateData);

    if (shouldSchedulePipeline) {
      await ctx.scheduler.runAfter(
        0,
        (internal as any)["workflows/manager"].startCardProcessingWorkflow,
        {
          cardId,
        }
      );
    }

    return result;
  },
});
