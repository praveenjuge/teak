import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  cards: defineTable({
    userId: v.string(),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_created", ["userId", "createdAt"]),
});
