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
  "palette",
  "quote",
] as const;

export type CardType = (typeof cardTypes)[number];

// Reusable validators
export const cardTypeValidator = v.union(
  ...cardTypes.map((type) => v.literal(type))
);

const stageStatusValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("failed")
  ),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  confidence: v.optional(v.number()),
  error: v.optional(v.string()),
});

export const processingStatusObjectValidator = v.object({
  classify: v.optional(stageStatusValidator),
  metadata: v.optional(stageStatusValidator),
  renderables: v.optional(stageStatusValidator),
});

export const processingStatusValidator = v.optional(
  processingStatusObjectValidator
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
    // Legacy Microlink.io metadata (kept for backward compatibility)
    microlinkData: v.optional(v.any()),
    // Cloudflare Browser Rendering metadata for link previews
    linkPreview: v.optional(
      v.object({
        source: v.optional(v.string()),
        status: v.optional(v.union(v.literal("success"), v.literal("error"))),
        fetchedAt: v.optional(v.number()),
        url: v.optional(v.string()),
        finalUrl: v.optional(v.string()),
        canonicalUrl: v.optional(v.string()),
        title: v.optional(v.string()),
        description: v.optional(v.string()),
        imageUrl: v.optional(v.string()),
        faviconUrl: v.optional(v.string()),
        siteName: v.optional(v.string()),
        author: v.optional(v.string()),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.string()),
        screenshotStorageId: v.optional(v.id("_storage")),
        screenshotUpdatedAt: v.optional(v.number()),
        error: v.optional(
          v.object({
            type: v.optional(v.string()),
            message: v.optional(v.string()),
            details: v.optional(v.any()),
          })
        ),
        raw: v.optional(v.any()),
      })
    ),
  })
);

// Color palette validator for palette cards
export const colorValidator = v.object({
  hex: v.string(), // Always normalized to hex format
  name: v.optional(v.string()), // Color name if available
  rgb: v.optional(v.object({
    r: v.number(),
    g: v.number(),
    b: v.number(),
  })),
  hsl: v.optional(v.object({
    h: v.number(),
    s: v.number(),
    l: v.number(),
  })),
});

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
  // Palette-specific fields
  colors: v.optional(v.array(colorValidator)),
  // Pipeline processing status per stage
  processingStatus: processingStatusValidator,
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
