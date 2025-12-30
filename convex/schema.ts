import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { LINK_CATEGORIES } from "./shared/linkCategories";

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

export const linkCategoryLiterals = [...LINK_CATEGORIES] as const;

export type LinkCategory = (typeof linkCategoryLiterals)[number];

export const linkCategoryValidator = v.union(
  ...linkCategoryLiterals.map((category) => v.literal(category)),
);

// Reusable validators
export const cardTypeValidator = v.union(
  ...cardTypes.map((type) => v.literal(type)),
);

const stageStatusValidator = v.object({
  status: v.union(
    v.literal("pending"),
    v.literal("in_progress"),
    v.literal("completed"),
    v.literal("failed"),
  ),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  confidence: v.optional(v.number()),
  error: v.optional(v.string()),
});

export const processingStatusObjectValidator = v.object({
  classify: v.optional(stageStatusValidator),
  categorize: v.optional(stageStatusValidator),
  metadata: v.optional(stageStatusValidator),
  renderables: v.optional(stageStatusValidator),
});

export const processingStatusValidator = v.optional(
  processingStatusObjectValidator,
);

const linkCategoryFactValidator = v.object({
  label: v.string(),
  value: v.string(),
  icon: v.optional(v.string()),
});

export const linkCategoryMetadataValidator = v.object({
  category: linkCategoryValidator,
  confidence: v.optional(v.number()),
  detectedProvider: v.optional(v.string()),
  fetchedAt: v.number(),
  sourceUrl: v.string(),
  imageUrl: v.optional(v.string()),
  facts: v.optional(v.array(linkCategoryFactValidator)),
  raw: v.optional(v.any()),
});

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
  }),
);

export const metadataValidator = v.optional(
  v.object({
    // Metadata for link previews
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
        imageStorageId: v.optional(v.id("_storage")),
        imageUpdatedAt: v.optional(v.number()),
        imageWidth: v.optional(v.number()),
        imageHeight: v.optional(v.number()),
        faviconUrl: v.optional(v.string()),
        siteName: v.optional(v.string()),
        author: v.optional(v.string()),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.string()),
        screenshotStorageId: v.optional(v.id("_storage")),
        screenshotUpdatedAt: v.optional(v.number()),
        screenshotWidth: v.optional(v.number()),
        screenshotHeight: v.optional(v.number()),
        error: v.optional(
          v.object({
            type: v.optional(v.string()),
            message: v.optional(v.string()),
            details: v.optional(v.any()),
          }),
        ),
        raw: v.optional(v.any()),
      }),
    ),
    linkCategory: v.optional(linkCategoryMetadataValidator),
  }),
);

// Color palette validator for palette cards
export const colorValidator = v.object({
  hex: v.string(), // Always normalized to hex format
  name: v.optional(v.string()), // Color name if available
  rgb: v.optional(
    v.object({
      r: v.number(),
      g: v.number(),
      b: v.number(),
    }),
  ),
  hsl: v.optional(
    v.object({
      h: v.number(),
      s: v.number(),
      l: v.number(),
    }),
  ),
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
  metadataStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  ),
  // Searchable metadata fields (flattened for search indexes)
  metadataTitle: v.optional(v.string()),
  metadataDescription: v.optional(v.string()),
  // AI-generated fields
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  aiTranscript: v.optional(v.string()),
  // Palette-specific fields
  colors: v.optional(v.array(colorValidator)),
  // Pipeline processing status per stage
  processingStatus: processingStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export default defineSchema({
  cards: defineTable(cardValidator)
    // Note: by_user index removed as redundant - by_user_deleted can serve same purpose
    // with partial index matching (just userId) per Convex best practices
    .index("by_user_type", ["userId", "type"])
    // Compound index for type filtering with isDeleted to avoid post-index .filter()
    .index("by_user_type_deleted", ["userId", "type", "isDeleted"])
    .index("by_user_favorites", ["userId", "isFavorited"])
    // Compound index for favorites filtering with isDeleted to avoid post-index .filter()
    .index("by_user_favorites_deleted", ["userId", "isFavorited", "isDeleted"])
    .index("by_user_deleted", ["userId", "isDeleted"])
    .index("by_created", ["userId", "createdAt"])
    // Index for duplicate URL checking
    .index("by_user_url_deleted", ["userId", "url", "isDeleted"])
    // Search indexes for efficient full-text search
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_notes", {
      searchField: "notes",
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
