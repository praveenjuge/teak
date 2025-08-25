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

export const fileMetadataValidator = v.optional(
  v.object({
    // File metadata (for non-link cards)
    fileSize: v.optional(v.number()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    // Recording-specific metadata
    recordingTimestamp: v.optional(v.number()),
  })
);

export const metadataValidator = v.optional(
  v.object({
    // Microlink.io metadata (full response stored as JSON - using v.any() for flexibility)
    microlinkData: v.optional(v.any()),
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
  fileMetadata: fileMetadataValidator,
  metadataStatus: v.optional(v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))),
  // Searchable metadata fields (flattened for search indexes)
  metadataTitle: v.optional(v.string()),
  metadataDescription: v.optional(v.string()),
  // AI-generated fields
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  aiTranscript: v.optional(v.string()),
  aiModelMeta: v.optional(
    v.object({
      provider: v.string(),
      model: v.string(),
      version: v.optional(v.string()),
      generatedAt: v.optional(v.number()),
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
    .index("by_created", ["userId", "createdAt"])
    // Search indexes for efficient full-text search
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_notes", {
      searchField: "notes",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_tags", {
      searchField: "tags",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_ai_tags", {
      searchField: "aiTags",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_ai_summary", {
      searchField: "aiSummary",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_ai_transcript", {
      searchField: "aiTranscript",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_metadata_title", {
      searchField: "metadataTitle",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_metadata_description", {
      searchField: "metadataDescription",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    }),
});
