import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CARD_TYPES } from "../lib/types";

export default defineSchema({
  cards: defineTable({
    userId: v.string(),
    title: v.optional(v.string()),
    content: v.string(),
    type: v.union(...CARD_TYPES.map((type) => v.literal(type))),
    url: v.optional(v.string()),
    fileId: v.optional(v.id("_storage")),
    thumbnailId: v.optional(v.id("_storage")),
    tags: v.optional(v.array(v.string())),
    description: v.optional(v.string()),
    isFavorited: v.optional(v.boolean()),
    metadata: v.optional(
      v.object({
        linkTitle: v.optional(v.string()),
        linkDescription: v.optional(v.string()),
        linkImage: v.optional(v.string()),
        linkFavicon: v.optional(v.string()),
        fileSize: v.optional(v.number()),
        fileName: v.optional(v.string()),
        mimeType: v.optional(v.string()),
        duration: v.optional(v.number()),
      })
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_type", ["userId", "type"])
    .index("by_user_favorites", ["userId", "isFavorited"])
    .index("by_created", ["userId", "createdAt"]),
});
