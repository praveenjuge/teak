import { v } from "convex/values";
import { mutation } from "../../_generated/server";
import { internal } from "../../_generated/api";

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
      await ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, {
        cardId: id,
      });
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
    let updateData: any = { updatedAt: now };

    switch (field) {
      case "content":
        updateData.content = typeof value === "string" ? value.trim() : value;
        // Trigger AI metadata regeneration if content changed
        if (updateData.content !== card.content) {
          ctx.scheduler.runAfter(0, internal.tasks.ai.actions.generateAiMetadata, { cardId });
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