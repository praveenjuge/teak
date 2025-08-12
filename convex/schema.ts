import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Card types as literals for validator
export const cardTypes = [
  "text",
  "link",
  "image",
  "video",
  "audio",
  "document",
] as const;

// Reusable validators
export const cardTypeValidator = v.union(
  ...cardTypes.map((type) => v.literal(type))
);

export const metadataValidator = v.optional(
  v.object({
    linkTitle: v.optional(v.string()),
    linkDescription: v.optional(v.string()),
    linkImage: v.optional(v.string()),
    linkFavicon: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  })
);

export const cardValidator = v.object({
  userId: v.string(),
  content: v.string(),
  type: cardTypeValidator,
  url: v.optional(v.string()),
  fileId: v.optional(v.id("_storage")),
  thumbnailId: v.optional(v.id("_storage")),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  metadata: metadataValidator,
  metadataStatus: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))),
  // AI-generated fields
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  transcript: v.optional(v.string()),
  aiGeneratedAt: v.optional(v.number()),
  aiModelMeta: v.optional(
    v.object({
      provider: v.string(),
      model: v.string(),
      version: v.optional(v.string()),
    })
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export default defineSchema({
  cards: defineTable(cardValidator)
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_user_favorites", ["userId", "isFavorited"])
    .index("by_user_deleted", ["userId", "isDeleted"])
    .index("by_created", ["userId", "createdAt"]),
});
