import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { FILE_KINDS } from "./shared/fileFormats";
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
  ...linkCategoryLiterals.map((category) => v.literal(category))
);

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
  categorize: v.optional(stageStatusValidator),
  metadata: v.optional(stageStatusValidator),
  renderables: v.optional(stageStatusValidator),
});

export const processingStatusValidator = v.optional(
  processingStatusObjectValidator
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

export const filePreviewFactsValidator = v.object({
  animated: v.optional(v.boolean()),
  archiveDirectoryCount: v.optional(v.number()),
  archiveFileCount: v.optional(v.number()),
  colorVariableCount: v.optional(v.number()),
  inspectedEntryCount: v.optional(v.number()),
  slideCount: v.optional(v.number()),
});

export const fileMetadataValidator = v.optional(
  v.object({
    // File metadata (for non-link cards)
    fileSize: v.optional(v.number()),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    kind: v.optional(v.union(...FILE_KINDS.map((kind) => v.literal(kind)))),
    language: v.optional(v.string()),
    duration: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    preview: v.optional(filePreviewFactsValidator),
    // Recording-specific metadata
    recordingTimestamp: v.optional(v.number()),
  })
);

export const r2KeyValidator = v.string();

export const metadataValidator = v.optional(
  v.object({
    source: v.optional(v.string()),
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
        media: v.optional(
          v.array(
            v.object({
              type: v.union(v.literal("image"), v.literal("video")),
              storageKey: v.optional(r2KeyValidator),
              updatedAt: v.number(),
              contentType: v.optional(v.string()),
              width: v.optional(v.number()),
              height: v.optional(v.number()),
              posterStorageKey: v.optional(r2KeyValidator),
              posterUpdatedAt: v.optional(v.number()),
              posterContentType: v.optional(v.string()),
              posterWidth: v.optional(v.number()),
              posterHeight: v.optional(v.number()),
            })
          )
        ),
        imageUrl: v.optional(v.string()),
        imageStorageKey: v.optional(r2KeyValidator),
        imageUpdatedAt: v.optional(v.number()),
        imageWidth: v.optional(v.number()),
        imageHeight: v.optional(v.number()),
        faviconUrl: v.optional(v.string()),
        siteName: v.optional(v.string()),
        author: v.optional(v.string()),
        publisher: v.optional(v.string()),
        publishedAt: v.optional(v.string()),
        screenshotStorageKey: v.optional(r2KeyValidator),
        screenshotUpdatedAt: v.optional(v.number()),
        screenshotWidth: v.optional(v.number()),
        screenshotHeight: v.optional(v.number()),
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
    linkCategory: v.optional(linkCategoryMetadataValidator),
  })
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
    })
  ),
  hsl: v.optional(
    v.object({
      h: v.number(),
      s: v.number(),
      l: v.number(),
    })
  ),
});

export const apiIdempotencyKeyValidator = v.object({
  userId: v.string(),
  keyHash: v.string(),
  method: v.string(),
  path: v.string(),
  requestHash: v.string(),
  state: v.union(v.literal("pending"), v.literal("completed")),
  responseStatus: v.number(),
  responseBody: v.any(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const apiIdempotencyAnalyticsValidator = v.object({
  date: v.string(),
  endpoint: v.string(),
  totalRequests: v.number(),
  withKey: v.number(),
  skipped: v.number(),
  started: v.number(),
  replayed: v.number(),
  conflicts: v.number(),
  inProgress: v.number(),
  errors: v.number(),
});

export const nativeAuthSurfaceValidator = v.union(
  v.literal("desktop"),
  v.literal("safari-macos"),
  v.literal("safari-ios"),
  v.literal("safari-ipados"),
  v.literal("browser-extension")
);

export const nativeAuthCodeValidator = v.object({
  sessionId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
  codeChallenge: v.string(),
  state: v.string(),
  surface: nativeAuthSurfaceValidator,
  expiresAt: v.number(),
  consumedAt: v.optional(v.number()),
  createdAt: v.number(),
});

export const exportStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("expired")
);

export const exportFailureClassValidator = v.union(
  v.literal("cap_exceeded"),
  v.literal("archive_failed"),
  v.literal("storage_failed"),
  v.literal("canceled"),
  v.literal("unknown")
);

export const importStatusValidator = v.union(
  v.literal("uploading"),
  v.literal("queued"),
  v.literal("parsing"),
  v.literal("importing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("canceled")
);

export const importModeValidator = v.union(
  v.literal("bookmarks"),
  v.literal("archive"),
  v.literal("raindrop")
);

export const importItemStatusValidator = v.union(
  v.literal("pending"),
  v.literal("created"),
  v.literal("skipped"),
  v.literal("failed")
);

// Canonical export job record. No backfill: rows are created on demand.
export const exportJobValidator = v.object({
  userId: v.string(),
  status: exportStatusValidator,
  // Workflow handle for the durable background generation (when running).
  workflowId: v.optional(v.string()),
  // Cooperative cancellation flag checked by the workflow.
  cancelRequested: v.optional(v.boolean()),
  // R2 object key + size of the completed ZIP artifact.
  artifactKey: v.optional(r2KeyValidator),
  artifactBytes: v.optional(v.number()),
  // Operational counts (no card contents or filenames).
  cardCount: v.optional(v.number()),
  filesIncluded: v.optional(v.number()),
  filesOmitted: v.optional(v.number()),
  // Coarse in-flight progress. `processedCount` is the running number of cards
  // snapshotted during phase 1; `stage` distinguishes the numeric snapshot
  // phase from the indeterminate archive-build phase.
  processedCount: v.optional(v.number()),
  stage: v.optional(v.union(v.literal("snapshotting"), v.literal("archiving"))),
  // Failure classification only (no PII).
  failureClass: v.optional(exportFailureClassValidator),
  // Lifecycle timestamps.
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  // Timestamp counted against the weekly quota (set only on success).
  quotaCountedAt: v.optional(v.number()),
  // When the completed artifact expires and is eligible for cleanup.
  expiresAt: v.optional(v.number()),
});

// Per-card snapshot of the start-time card set. Stored as individual rows so a
// large library does not hit Convex array/document size limits.
export const exportJobItemValidator = v.object({
  jobId: v.id("exportJobs"),
  userId: v.string(),
  cardId: v.id("cards"),
  // The original file key captured at start time (if any).
  fileKey: v.optional(r2KeyValidator),
  createdAt: v.number(),
});

// Import state is created on demand. No existing document needs a backfill.
export const importJobValidator = v.object({
  userId: v.string(),
  mode: importModeValidator,
  status: importStatusValidator,
  phase: v.string(),
  fileName: v.string(),
  fileSize: v.number(),
  fileLastModified: v.number(),
  sourceKey: r2KeyValidator,
  uploadId: v.optional(v.string()),
  uploadExpiresAt: v.optional(v.number()),
  workflowId: v.optional(v.string()),
  cancelRequested: v.optional(v.boolean()),
  parsedCount: v.number(),
  processedCount: v.number(),
  createdCount: v.number(),
  skippedCount: v.number(),
  failedCount: v.number(),
  reportKey: v.optional(r2KeyValidator),
  failureClass: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
});

export const importJobItemValidator = v.object({
  jobId: v.id("importJobs"),
  userId: v.string(),
  sourceIndex: v.number(),
  status: importItemStatusValidator,
  type: cardTypeValidator,
  content: v.string(),
  url: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  colors: v.optional(v.array(colorValidator)),
  importedCreatedAt: v.optional(v.number()),
  filePath: v.optional(v.string()),
  fileName: v.optional(v.string()),
  fileSize: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  duration: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  extractedFileKey: v.optional(r2KeyValidator),
  cardId: v.optional(v.id("cards")),
  failureCode: v.optional(v.string()),
  failureReason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const cardValidator = v.object({
  userId: v.string(),
  content: v.string(),
  type: cardTypeValidator,
  url: v.optional(v.string()),
  fileKey: v.optional(r2KeyValidator),
  thumbnailKey: v.optional(r2KeyValidator),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  metadata: metadataValidator,
  fileMetadata: fileMetadataValidator,
  metadataStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
  ),
  // Searchable metadata fields (flattened for search indexes)
  metadataTitle: v.optional(v.string()),
  metadataDescription: v.optional(v.string()),
  // AI-generated fields
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  aiTranscript: v.optional(v.string()),
  visualStyles: v.optional(v.array(v.string())),
  // Palette-specific fields
  colors: v.optional(v.array(colorValidator)),
  colorHexes: v.optional(v.array(v.string())),
  colorHues: v.optional(v.array(v.string())),
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
    .index("by_updated", ["userId", "updatedAt"])
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
    })
    // Search indexes for tag fields - eliminates full table scan for tag searches
    .searchIndex("search_tags", {
      searchField: "tags",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_ai_tags", {
      searchField: "aiTags",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_visual_styles", {
      searchField: "visualStyles",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_color_hexes", {
      searchField: "colorHexes",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    })
    .searchIndex("search_color_hues", {
      searchField: "colorHues",
      filterFields: ["userId", "isDeleted", "type", "isFavorited"],
    }),
  apiIdempotencyKeys: defineTable(apiIdempotencyKeyValidator)
    .index("by_user_key_hash", ["userId", "keyHash"])
    .index("by_expires_at", ["expiresAt"]),
  apiIdempotencyAnalytics: defineTable(apiIdempotencyAnalyticsValidator).index(
    "by_date_endpoint",
    ["date", "endpoint"]
  ),
  nativeAuthCodes: defineTable(nativeAuthCodeValidator)
    .index("by_expires_at", ["expiresAt"])
    .index("by_device_state_consumed", ["deviceId", "state", "consumedAt"])
    .index("by_surface", ["surface"])
    .index("by_user", ["userId"]),
  exportJobs: defineTable(exportJobValidator)
    // Latest job per user + active-job lookups.
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"])
    // Cleanup scans of ready artifacts by expiry.
    .index("by_status_expires", ["status", "expiresAt"]),
  exportJobItems: defineTable(exportJobItemValidator)
    .index("by_job", ["jobId"])
    .index("by_user", ["userId"]),
  importJobs: defineTable(importJobValidator)
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"])
    .index("by_status_upload_expires", ["status", "uploadExpiresAt"]),
  importJobItems: defineTable(importJobItemValidator)
    .index("by_job_source", ["jobId", "sourceIndex"])
    .index("by_job_status_source", ["jobId", "status", "sourceIndex"])
    .index("by_user", ["userId"]),
});
