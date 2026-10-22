import { v } from "convex/values";
import { cardTypeValidator, colorValidator, r2KeyValidator } from "./cards";

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
  v.literal("raindrop"),
  v.literal("pocket"),
  v.literal("instapaper"),
  v.literal("readwise"),
  v.literal("omnivore"),
  v.literal("linkwarden"),
  v.literal("mymind"),
  v.literal("onetab")
);

export const importItemStatusValidator = v.union(
  v.literal("pending"),
  v.literal("created"),
  v.literal("skipped"),
  v.literal("failed")
);

export const fileUploadSessionValidator = v.object({
  userId: v.string(),
  identityKey: v.optional(v.string()),
  teakUserId: v.optional(v.string()),
  sourceKey: r2KeyValidator,
  uploadId: v.string(),
  fileName: v.string(),
  fileSize: v.number(),
  fileType: v.string(),
  fileLastModified: v.number(),
  partSize: v.number(),
  parts: v.array(
    v.object({
      etag: v.string(),
      partNumber: v.number(),
      size: v.number(),
    })
  ),
  completedEtag: v.optional(v.string()),
  completedSize: v.optional(v.number()),
  status: v.union(
    v.literal("uploading"),
    v.literal("completed"),
    v.literal("aborted")
  ),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const exportJobValidator = v.object({
  userId: v.string(),
  status: exportStatusValidator,
  workflowId: v.optional(v.string()),
  cancelRequested: v.optional(v.boolean()),
  artifactKey: v.optional(r2KeyValidator),
  artifactBytes: v.optional(v.number()),
  cardCount: v.optional(v.number()),
  filesIncluded: v.optional(v.number()),
  filesOmitted: v.optional(v.number()),
  processedCount: v.optional(v.number()),
  stage: v.optional(v.union(v.literal("snapshotting"), v.literal("archiving"))),
  failureClass: v.optional(exportFailureClassValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  quotaCountedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
});

// Per-card snapshot of the start-time card set. Stored as individual rows so a
// large library does not hit Convex array/document size limits.
export const exportJobItemValidator = v.object({
  jobId: v.id("exportJobs"),
  userId: v.string(),
  cardId: v.id("cards"),
  fileKey: v.optional(r2KeyValidator),
  createdAt: v.number(),
});

export const stagedItemsValidator = v.object({
  pages: v.number(),
  parts: v.number(),
  cursor: v.union(v.number(), v.null()),
  part: v.number(),
  offset: v.number(),
});

export const importJobValidator = v.object({
  userId: v.string(),
  mode: importModeValidator,
  status: importStatusValidator,
  phase: v.string(),
  fileName: v.string(),
  fileSize: v.number(),
  fileLastModified: v.number(),
  sourceKey: r2KeyValidator,
  sourceEtag: v.optional(v.string()),
  uploadId: v.optional(v.string()),
  uploadExpiresAt: v.optional(v.number()),
  uploadedParts: v.optional(
    v.array(
      v.object({ partNumber: v.number(), etag: v.string(), size: v.number() })
    )
  ),
  /**
   * Held by the `completeImportUpload` call that is finishing the multipart
   * upload, so a concurrent call cannot queue the job twice or delete the
   * source under it. Lapses at `expiresAt` if that call dies.
   */
  completionClaim: v.optional(
    v.object({ token: v.string(), expiresAt: v.number() })
  ),
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
  /**
   * Set when the job is queued: the import Workflow stages its items in R2
   * (`importStagedPartKey`) instead of `importJobItems` rows. `pages` source
   * pages and `parts` staged objects are recorded, and indexing resumes at
   * `cursor` (null once the source is read). Cards are created from staged
   * part `part`, item `offset`. Jobs without it use the rows.
   */
  stagedItems: v.optional(stagedItemsValidator),
});

// A job with `stagedItems` keeps only its failed items here, for the failure
// samples and the report. Older jobs staged every item.
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
  isArchived: v.optional(v.boolean()),
  metadataTitle: v.optional(v.string()),
  folders: v.optional(v.array(v.string())),
  colors: v.optional(v.array(colorValidator)),
  importedCreatedAt: v.optional(v.number()),
  importedCompletedAt: v.optional(v.number()),
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
