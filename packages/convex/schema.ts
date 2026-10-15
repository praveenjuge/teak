import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { FILE_KINDS } from "./shared/fileFormats";
import { FOLDER_COLORS } from "./shared/folders";
import { LINK_CATEGORIES } from "./shared/linkCategories";
import { SEARCH_MODES } from "./shared/search/semantic";
import {
  workosDeletionCompletionValidator,
  workosDeletionTargetValidator,
} from "./workosDeletionCompletion";

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

/** How a search finds cards (shared/search/semantic.ts). */
export const searchModeValidator = v.union(
  ...SEARCH_MODES.map((mode) => v.literal(mode))
);

export const folderColorValidator = v.union(
  ...FOLDER_COLORS.map((color) => v.literal(color))
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
  // Link screenshots run in their own workflow after metadata.
  screenshot: v.optional(stageStatusValidator),
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
  rawStorageKey: v.optional(v.string()),
  rawSha256: v.optional(v.string()),
  rawHasStructured: v.optional(v.boolean()),
  rawStructuredFetchedAt: v.optional(v.number()),
});

export const filePreviewFactsValidator = v.object({
  animated: v.optional(v.boolean()),
  archiveDirectoryCount: v.optional(v.number()),
  archiveFileCount: v.optional(v.number()),
  characterCount: v.optional(v.number()),
  colorVariableCount: v.optional(v.number()),
  compressedBytes: v.optional(v.number()),
  headingCount: v.optional(v.number()),
  inspectedEntryCount: v.optional(v.number()),
  lineCount: v.optional(v.number()),
  slideCount: v.optional(v.number()),
  uncompressedBytes: v.optional(v.number()),
  wordCount: v.optional(v.number()),
});

export const fileProcessingProvenanceValidator = v.object({
  generatedAt: v.number(),
  processorVersion: v.string(),
  sourceEtag: v.string(),
  transformVersion: v.string(),
});

export const imageExifValidator = v.object({
  exposureTime: v.optional(v.number()),
  fNumber: v.optional(v.number()),
  focalLength: v.optional(v.number()),
  iso: v.optional(v.number()),
  latitude: v.optional(v.number()),
  longitude: v.optional(v.number()),
  make: v.optional(v.string()),
  model: v.optional(v.string()),
  takenAt: v.optional(v.number()),
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
    exif: v.optional(imageExifValidator),
    // Video hover scrub sprite (`scrubKey`): `frames * frameWidth` wide.
    scrub: v.optional(
      v.object({
        frames: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
      })
    ),
    // Audio waveform bar heights 0-100: 45 for grid cards, 200 for the player.
    waveform: v.optional(
      v.object({
        grid: v.array(v.number()),
        detail: v.array(v.number()),
      })
    ),
    processing: v.optional(fileProcessingProvenanceValidator),
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
        rawStorageKey: v.optional(v.string()),
        rawSha256: v.optional(v.string()),
        // Set when a site's own API confirmed what the link is (a social
        // post); categorization prefers it to the URL rules.
        categoryHint: v.optional(linkCategoryValidator),
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
  shard: v.optional(v.number()),
  totalRequests: v.number(),
  withKey: v.number(),
  skipped: v.number(),
  started: v.number(),
  replayed: v.number(),
  conflicts: v.number(),
  inProgress: v.number(),
  errors: v.number(),
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

// Every source in shared/importSources.ts IMPORT_MODES.
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
  // Existing provider-keyed sessions expire through normal cleanup.
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
  // Bound on first processing attempt; optional for jobs created before rollout.
  sourceEtag: v.optional(v.string()),
  uploadId: v.optional(v.string()),
  uploadExpiresAt: v.optional(v.number()),
  // Parts the client reported after each signed PUT. Completion hands these
  // to the files worker, which R2 verifies, so Convex never lists parts.
  uploadedParts: v.optional(
    v.array(
      v.object({ partNumber: v.number(), etag: v.string(), size: v.number() })
    )
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
  // Archive schema v2: restored on the created card. Folders are names,
  // matched to the user's folders (or created) when the card is made.
  isArchived: v.optional(v.boolean()),
  metadataTitle: v.optional(v.string()),
  folders: v.optional(v.array(v.string())),
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
  /**
   * The `url`'s site as `site:` matches it (shared/utils/urlHost.ts), kept
   * by the search sync. Absent when the card has no web URL.
   */
  urlHost: v.optional(v.string()),
  /**
   * A random number in [0, 1), set once when the card is saved and never
   * changed: the Shuffle order walks cards by it (card/shuffle.ts). Absent
   * on cards saved before Shuffle until the backfill sets it.
   */
  shuffleKey: v.optional(v.number()),
  fileKey: v.optional(r2KeyValidator),
  thumbnailKey: v.optional(r2KeyValidator),
  scrubKey: v.optional(r2KeyValidator),
  workflowArtifactKeys: v.optional(v.array(r2KeyValidator)),
  /** Bounded ~1600px preview derivative for large originals. */
  previewKey: v.optional(r2KeyValidator),
  /** Thumbhash placeholder bytes (base64) decoded into a blurry stand-in. */
  placeholderHash: v.optional(v.string()),
  derivativeVersion: v.optional(v.string()),
  derivativeCheckedAt: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  // Archived cards leave the library but stay searchable in Archive. Absent
  // (never false) on active cards, so index equality on `undefined` works.
  isArchived: v.optional(v.literal(true)),
  archivedAt: v.optional(v.number()),
  // Folders the card belongs to (at most MAX_FOLDERS_PER_CARD). The source of
  // truth; folderCards is an index of it kept in step by the card search sync.
  folderIds: v.optional(v.array(v.id("folders"))),
  metadata: metadataValidator,
  fileMetadata: fileMetadataValidator,
  metadataStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
  ),
  // Searchable metadata fields (flattened for search indexes)
  metadataTitle: v.optional(v.string()),
  // Preserve manual titles, including clears, through link-preview refreshes.
  metadataTitleEdited: v.optional(v.boolean()),
  metadataDescription: v.optional(v.string()),
  // AI-generated fields
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  aiTranscript: v.optional(v.string()),
  /**
   * The document's extracted text in R2 (card/documentText.ts). Its first
   * 32 KiB, in cardTextContents, is part of search.
   */
  documentTextKey: v.optional(r2KeyValidator),
  /** Set with documentTextKey; absent on cards without stored text. */
  hasExtractedText: v.optional(v.literal(true)),
  /** Characters in the stored text, for the card's details. */
  extractedTextCharCount: v.optional(v.number()),
  visualStyles: v.optional(v.array(v.string())),
  // Times the periodic AI backfill has retried this card. After the limit the
  // backfill stops picking it, so cards that always fail can't starve others.
  aiBackfillAttempts: v.optional(v.number()),
  // Palette-specific fields
  colors: v.optional(v.array(colorValidator)),
  colorHexes: v.optional(v.array(v.string())),
  colorHues: v.optional(v.array(v.string())),
  // Pipeline processing status per stage
  processingStatus: processingStatusValidator,
  // The getting-started card this is (card/defaultCards.ts). Absent on cards
  // people save, and on the first onboarding cards, which predate it.
  onboarding: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const disconnectRecoveryReceipt = v.object({
  operationId: v.string(),
  snapshotDigest: v.string(),
  approvalReference: v.string(),
  evidenceKind: v.union(
    v.literal("preserved-204"),
    v.literal("provider-written-confirmation")
  ),
  evidenceReference: v.string(),
  originalRequestId: v.string(),
  cloudUrl: v.string(),
  siteUrl: v.string(),
  environmentId: v.string(),
  authKitClientId: v.string(),
  authKitDomain: v.string(),
  credentialFingerprint: v.string(),
  applicationId: v.string(),
  recordedAt: v.number(),
});

export default defineSchema({
  users: defineTable({
    teakUserId: v.string(),
    identityOrigin: v.optional(v.literal("workos")),
    email: v.string(),
    emailVerified: v.boolean(),
    workosUserId: v.optional(v.string()),
    workosDeletedAt: v.optional(v.number()),
    workosDeletionCompletion: v.optional(workosDeletionCompletionValidator),
    role: v.optional(v.literal("admin")),
    deletedAt: v.optional(v.number()),
  })
    .index("by_teakUserId", ["teakUserId"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_email", ["email"]),
  migrationQuarantine: defineTable({
    workosUserId: v.optional(v.string()),
    teakUserId: v.optional(v.string()),
    email: v.string(),
    reason: v.string(),
    source: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    workosDeletionEventAt: v.optional(v.number()),
    workosDeletionTarget: v.optional(workosDeletionTargetValidator),
  })
    .index("by_unresolved", ["resolvedAt"])
    .index("by_workosUserId_and_reason_and_resolvedAt", [
      "workosUserId",
      "reason",
      "resolvedAt",
    ]),
  // Signed WorkOS webhooks Teak can never apply (malformed provider data).
  // Kept for an operator to inspect; holds no provider payload.
  workosWebhookDeadLetters: defineTable({
    eventId: v.string(),
    event: v.string(),
    reason: v.string(),
    receivedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
  // Which checkout pushes backend code to the shared dev deployment
  // (devPushLease.ts). Empty everywhere else.
  devPushLeases: defineTable({
    name: v.string(),
    holderId: v.optional(v.string()),
    holderLabel: v.optional(v.string()),
    expiresAt: v.number(),
    lastPush: v.optional(
      v.object({ label: v.string(), commit: v.string(), at: v.number() })
    ),
  }).index("by_name", ["name"]),
  // Where the WorkOS Events API catch-up continues from.
  workosEventCursors: defineTable({
    name: v.string(),
    after: v.string(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
  workosEvents: defineTable({
    eventId: v.string(),
    workosUserId: v.optional(v.string()),
    type: v.string(),
    createdAt: v.number(),
    email: v.optional(v.string()),
    emailVerified: v.optional(v.boolean()),
    externalId: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_eventId", ["eventId"])
    .index("by_workosUserId_and_type", ["workosUserId", "type"])
    .index("by_workosUserId_and_createdAt", ["workosUserId", "createdAt"]),
  workosApplicationDisconnects: defineTable({
    recoveryReceipt: v.optional(disconnectRecoveryReceipt),
    operationId: v.string(),
    userId: v.string(),
    workosUserId: v.string(),
    clientId: v.string(),
    triggerConsentId: v.string(),
    tokenExpiresAt: v.optional(v.number()),
    environmentId: v.string(),
    authKitClientId: v.string(),
    authKitDomain: v.string(),
    credentialFingerprint: v.string(),
    applicationId: v.optional(v.string()),
    state: v.union(
      v.literal("prepared"),
      v.literal("dispatched"),
      v.literal("acknowledged"),
      v.literal("unknown"),
      v.literal("completed")
    ),
    startedAt: v.number(),
    dispatchedAt: v.optional(v.number()),
    providerAcknowledgedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    releaseAfter: v.optional(v.number()),
  }).index("by_workosUserId_and_clientId", ["workosUserId", "clientId"]),
  workosConsents: defineTable({
    recoveryReceipt: v.optional(disconnectRecoveryReceipt),
    consentId: v.string(),
    userId: v.string(),
    workosUserId: v.string(),
    clientId: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    revokedAt: v.optional(v.number()),
    disconnectCompletedAt: v.optional(v.number()),
  })
    .index("by_consentId", ["consentId"])
    .index("by_workosUserId_and_clientId_and_revokedAt", [
      "workosUserId",
      "clientId",
      "revokedAt",
    ])
    .index("by_workosUserId_and_clientId_and_disconnectCompletedAt", [
      "workosUserId",
      "clientId",
      "disconnectCompletedAt",
    ])
    .index("by_userId_and_firstSeenAt", ["userId", "firstSeenAt"]),
  cards: defineTable(cardValidator)
    // Note: by_user index removed as redundant - by_user_deleted can serve same purpose
    // with partial index matching (just userId) per Convex best practices
    .index("by_type_derivative_version", ["type", "derivativeVersion"])
    .index("by_type_derivative_checked", ["type", "derivativeCheckedAt"])
    // Compound index for type filtering with isDeleted to avoid post-index .filter()
    .index("by_user_type_deleted", ["userId", "type", "isDeleted"])
    // Compound index for favorites filtering with isDeleted to avoid post-index .filter()
    .index("by_user_favorites_deleted", ["userId", "isFavorited", "isDeleted"])
    .index("by_user_deleted", ["userId", "isDeleted"])
    .index("by_created", ["userId", "createdAt"])
    // Library listings order by the card's saved date (`createdAt`), so an
    // imported card lands where it was originally saved. See card/listQuery.ts.
    .index("by_user_deleted_archived_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "createdAt",
    ])
    .index("by_user_deleted_archived_type_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "type",
      "createdAt",
    ])
    .index("by_user_deleted_archived_favorited_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "createdAt",
    ])
    // `site:` searches read one host's cards in date order.
    .index("by_user_deleted_archived_host_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "urlHost",
      "createdAt",
    ])
    // Shuffle walks one archive state's cards by their random key.
    .index("by_user_deleted_archived_shuffle", [
      "userId",
      "isDeleted",
      "isArchived",
      "shuffleKey",
    ])
    // Trash lists every trashed card, archived or not.
    .index("by_user_deleted_created", ["userId", "isDeleted", "createdAt"])
    // Bounded maintenance scans: soft-deleted cards pending cleanup and cards
    // missing AI summaries are small subsets, so these indexes keep the
    // cleanup/backfill queries proportional to the result set instead of
    // scanning the whole table.
    .index("by_isDeleted_deletedAt", ["isDeleted", "deletedAt"])
    .index("by_aiSummary_aiTags_aiTranscript_isDeleted_createdAt", [
      "aiSummary",
      "aiTags",
      "aiTranscript",
      "isDeleted",
      "createdAt",
    ])
    .index("by_updated", ["userId", "updatedAt"])
    // No search index covers colors or styles: they are arrays, which
    // search indexes skip, so color and style searches read the library in
    // date order (card/visualFilters.ts). Text search uses
    // cardSearchDocuments.
    // Index for duplicate URL checking
    .index("by_user_url_deleted", ["userId", "url", "isDeleted"]),
  // A new account's getting-started cards on their way (card/defaultCards.ts).
  // Set when the account is created and cleared in the transaction that
  // inserts the cards, so clients show "Setting up your vault", not an empty
  // library, until they land.
  vaultSetups: defineTable({
    userId: v.string(),
    startedAt: v.number(),
  }).index("by_userId", ["userId"]),
  // One row per card with (or due for) a vector in Vectorize; the ledger every
  // delete path works from (embedding/state.ts). Kept off `cards` so embedding
  // never rewrites a card or wakes its reactive queries.
  cardEmbeddings: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    /** Where the vector is; set by the first successful embed. */
    shard: v.optional(v.number()),
    namespace: v.optional(v.string()),
    /** Hash of the text and embedding version the vector was made from. */
    hash: v.optional(v.string()),
    embeddedAt: v.optional(v.number()),
    /** When the next embed is due; also the fence against stale writes. */
    dueAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    /** Set when the card is gone and its vector still has to be deleted. */
    pendingVectorDeleteAt: v.optional(v.number()),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .index("by_dueAt", ["dueAt"])
    .index("by_pendingVectorDeleteAt", ["pendingVectorDeleteAt"]),
  // Which Vectorize shard holds a user's card embeddings (vectorShards.ts).
  vectorShards: defineTable({
    userId: v.string(),
    shard: v.number(),
  }).index("by_userId", ["userId"]),
  // A search's meaning matches, briefly (search/semanticCache.ts). Actions
  // write them; search queries read them, so a reactive grid merges them in
  // when they land. `key` hashes the embedded text, never stores it.
  semanticSearchResults: defineTable({
    userId: v.string(),
    key: v.string(),
    ranking: v.array(v.object({ cardId: v.id("cards"), score: v.number() })),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_expiresAt", ["expiresAt"]),
  // Folders group cards by hand ("manual"); "smart" folders save a search.
  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    // The trimmed, lowercased name: unique per user.
    nameKey: v.string(),
    color: v.optional(folderColorValidator),
    kind: v.union(v.literal("manual"), v.literal("smart")),
    query: v.optional(v.string()),
    // Cards in the folder that are neither in Trash nor archived.
    activeCardCount: v.number(),
    // Set when deletion starts: the folder is hidden while its cards are
    // detached in batches, then the row is removed.
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_nameKey", ["userId", "nameKey"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  // One row per card in a folder, derived from cards.folderIds by
  // syncCardFolderRows so a folder lists its cards from an index.
  folderCards: defineTable({
    folderId: v.id("folders"),
    cardId: v.id("cards"),
    userId: v.string(),
    // Absent (never false) on active cards, like the card fields they copy.
    isDeleted: v.optional(v.literal(true)),
    isArchived: v.optional(v.literal(true)),
    type: cardTypeValidator,
    cardCreatedAt: v.number(),
    addedAt: v.number(),
  })
    .index("by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt", [
      "folderId",
      "isDeleted",
      "isArchived",
      "cardCreatedAt",
    ])
    // Trash and "archived: include" list archived and active rows together,
    // so they need the date right after the Trash flag to stay in order.
    .index("by_folderId_and_isDeleted_and_cardCreatedAt", [
      "folderId",
      "isDeleted",
      "cardCreatedAt",
    ])
    .index("by_cardId_and_folderId", ["cardId", "folderId"])
    .index("by_userId", ["userId"]),
  // The sidebar's tag list: a snapshot of tag counts on cards outside Trash
  // and Archive, recomputed in the background shortly after tags change so
  // the sidebar never scans the tag index reactively.
  userTagSummaries: defineTable({
    userId: v.string(),
    // Bounded by MAX_TAG_SUMMARY_ITEMS, most-used first.
    items: v.array(v.object({ name: v.string(), count: v.number() })),
    // False when the snapshot stopped at its row or item bound.
    isComplete: v.boolean(),
    // When the recompute that wrote it started: the counts are as of then.
    computedAt: v.number(),
  }).index("by_userId", ["userId"]),
  // Exists only while a snapshot recompute is scheduled, so a burst of tag
  // changes schedules one recompute. Kept apart from the snapshot so tag
  // syncs never read the large snapshot row.
  tagSummaryRefreshes: defineTable({
    userId: v.string(),
    dueAt: v.number(),
  }).index("by_userId", ["userId"]),
  // Library-wide tag renames, merges and deletes, processed in batches.
  tagOperations: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("rename"), v.literal("merge"), v.literal("delete")),
    // The tag being changed, lowercased like the tag index.
    from: v.string(),
    // The new name (rename) or the tag merged into (merge), as given.
    to: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    // Cards carrying the tag when the operation started (at most
    // TAG_OPERATION_COUNT_LIMIT), cards looked at, and cards rewritten.
    total: v.number(),
    processed: v.number(),
    changed: v.number(),
    // Where the next batch resumes in the tag index.
    cursor: v.optional(v.string()),
    // The pass over the tag index (from 1) and cards it has changed so far.
    pass: v.optional(v.number()),
    passChanged: v.optional(v.number()),
    // Sweeps made while the user's tag syncs were still running.
    syncWaits: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  userCardUsage: defineTable({
    userId: v.string(),
    activeCardCount: v.number(),
    isCountExact: v.optional(v.boolean()),
    isSaturated: v.boolean(),
    shardVersion: v.optional(v.number()),
    shardedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  userCardUsageShards: defineTable({
    userId: v.string(),
    shard: v.number(),
    activeCardCount: v.number(),
    updatedAt: v.number(),
  }).index("by_userId_and_shard", ["userId", "shard"]),
  accountDeletionStates: defineTable({
    userId: v.string(),
    startedAt: v.number(),
    initiationProvider: v.optional(
      v.union(v.literal("betterauth"), v.literal("workos"))
    ),
    betterAuthUserId: v.optional(v.string()),
    workosUserId: v.optional(v.string()),
    workosTarget: v.optional(
      v.object({
        environmentId: v.string(),
        clientId: v.string(),
        issuer: v.string(),
        credentialFingerprint: v.string(),
      })
    ),
    stage: v.optional(v.number()),
    providerSessionCursor: v.optional(v.string()),
    localConsentCursor: v.optional(v.string()),
    deletionReceiptCursor: v.optional(v.string()),
    writerTable: v.optional(
      v.union(v.literal("importJobs"), v.literal("exportJobs"))
    ),
    writerCursor: v.optional(v.string()),
    writersPrepared: v.optional(v.boolean()),
    storageProgress: v.optional(
      v.object({
        kind: v.union(
          v.literal("cards"),
          v.literal("imports"),
          v.literal("exports"),
          v.literal("uploads"),
          v.literal("objects")
        ),
        fingerprint: v.string(),
        offset: v.number(),
      })
    ),
    workflowId: v.optional(v.string()),
    generation: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    failureCode: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_nextAttemptAt", ["nextAttemptAt"]),
  accountStorageObjects: defineTable({
    userId: v.string(),
    key: v.string(),
    exportJobId: v.optional(v.id("exportJobs")),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_key", ["key"])
    .index("by_exportJobId", ["exportJobId"]),
  cardSearchDocuments: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    searchableText: v.string(),
    isDeleted: v.optional(v.boolean()),
    type: cardTypeValidator,
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    urlHost: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .searchIndex("search_searchableText", {
      searchField: "searchableText",
      filterFields: [
        "userId",
        "isDeleted",
        "isArchived",
        "type",
        "isFavorited",
        "urlHost",
      ],
    }),
  // Text extracted from a card's file. `text` is the searchable prefix (at
  // most 32 KiB of UTF-8); the full text is the R2 object at `sourceKey`,
  // which is also the card's documentTextKey. One row per card.
  cardTextContents: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    kind: v.union(v.literal("document"), v.literal("transcript")),
    text: v.string(),
    sourceKey: r2KeyValidator,
    charCount: v.number(),
    truncated: v.boolean(),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    // Searched apart from cardSearchDocuments, a bounded number of rows a
    // request (card/searchDocumentHelpers.ts), as each row is large.
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["userId"],
    }),
  cardSearchTags: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    tag: v.string(),
    isDeleted: v.optional(v.boolean()),
    type: cardTypeValidator,
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    cardCreatedAt: v.number(),
    sourceUpdatedAt: v.number(),
    syncGeneration: v.number(),
  })
    .index("by_cardId", ["cardId"])
    .index("by_cardId_and_tag", ["cardId", "tag"])
    .index("by_cardId_and_generation", ["cardId", "syncGeneration"])
    .index("by_user_tag_deleted_created", [
      "userId",
      "tag",
      "isDeleted",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_type", [
      "userId",
      "tag",
      "isDeleted",
      "type",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_favorited", [
      "userId",
      "tag",
      "isDeleted",
      "isFavorited",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_type_favorited", [
      "userId",
      "tag",
      "isDeleted",
      "type",
      "isFavorited",
      "cardCreatedAt",
      "cardId",
    ])
    // Library and Archive tag reads. Trash and "archived and not" reads keep
    // the indexes above, which ignore isArchived; those are dropped once the
    // readers move here (roadmap Phase 19).
    .index("by_user_tag_deleted_archived_created_v2", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_archived_type_v2", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "type",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_archived_favorited_v2", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_archived_type_favorited_v2", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "type",
      "isFavorited",
      "cardCreatedAt",
      "cardId",
    ]),
  cardSearchTagSyncStates: defineTable({
    cardId: v.id("cards"),
    phase: v.union(
      v.literal("tags"),
      v.literal("aiTags"),
      v.literal("pruneOld"),
      v.literal("complete")
    ),
    generation: v.number(),
    offset: v.number(),
    pending: v.boolean(),
    sourceUpdatedAt: v.optional(v.number()),
    // Snapshot of the card fields the tag sync needs, written by restarts so
    // batch invocations sync from the state row instead of reading the cards
    // table (a write-conflict hotspot while card writes land mid-chain).
    userId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    aiTags: v.optional(v.array(v.string())),
    isDeleted: v.optional(v.boolean()),
    type: v.optional(cardTypeValidator),
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    cardCreatedAt: v.optional(v.number()),
    // False when this chain cannot change the sidebar's tag counts (the
    // card's tags and Trash and Archive state are as before), so finishing
    // it skips the tag summary recompute. Missing on older rows: recompute.
    tagCountsChanged: v.optional(v.boolean()),
  })
    .index("by_cardId", ["cardId"])
    .index("by_pending", ["pending"])
    .index("by_userId_and_pending", ["userId", "pending"]),
  operationalRetentionStates: defineTable({
    kind: v.literal("idempotency"),
    cutoff: v.number(),
    cursor: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  }).index("by_kind", ["kind"]),
  apiIdempotencyKeys: defineTable(apiIdempotencyKeyValidator)
    .index("by_user_key_hash", ["userId", "keyHash"])
    .index("by_expires_at", ["expiresAt"]),
  // Ids of hard-deleted cards, so /v1/cards/changes can report them. Rows
  // expire after CARD_TOMBSTONE_RETENTION_MS (publicApiTombstones.ts).
  cardTombstones: defineTable({
    userId: v.string(),
    cardId: v.id("cards"),
    deletedAt: v.number(),
  })
    .index("by_userId_and_deletedAt", ["userId", "deletedAt"])
    .index("by_deletedAt", ["deletedAt"]),
  // Short-lived record that an API key validated, so concurrent requests skip
  // the key component's hot usage-counter write. Revoking a key deletes it.
  apiKeyAuthCache: defineTable({
    tokenHash: v.string(),
    keyId: v.string(),
    userId: v.string(),
    rateLimitKey: v.string(),
    verifiedAt: v.number(),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_keyId", ["keyId"]),
  apiIdempotencyAnalytics: defineTable(apiIdempotencyAnalyticsValidator)
    .index("by_date_endpoint", ["date", "endpoint"])
    .index("by_date_endpoint_shard", ["date", "endpoint", "shard"]),
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
    .index("by_jobId_and_url", ["jobId", "url"])
    .index("by_job_source", ["jobId", "sourceIndex"])
    .index("by_job_status_source", ["jobId", "status", "sourceIndex"])
    .index("by_user", ["userId"]),
  pendingUploadCleanupStates: defineTable({
    cursor: v.union(v.string(), v.null()),
    name: v.string(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
  fileUploadSessions: defineTable(fileUploadSessionValidator)
    .index("by_teak_user_file", [
      "teakUserId",
      "fileName",
      "fileSize",
      "fileLastModified",
    ])
    .index("by_identity_file", [
      "identityKey",
      "fileName",
      "fileSize",
      "fileLastModified",
    ])
    .index("by_identity_status", ["identityKey", "status"])
    .index("by_source_key", ["sourceKey"])
    .index("by_expires_at", ["expiresAt"]),
  // Superadmin console. Append-only record of every admin action.
  adminAuditLog: defineTable({
    actorTeakUserId: v.string(),
    actorEmail: v.string(),
    action: v.string(),
    targetTeakUserId: v.optional(v.string()),
    targetCardId: v.optional(v.string()),
    reason: v.optional(v.string()),
    // Small JSON-safe before/after values, never card content.
    details: v.optional(v.record(v.string(), v.any())),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_targetTeakUserId_and_at", ["targetTeakUserId", "at"]),
  // One row (key "global"): kill switches and goals set from the console.
  adminSettings: defineTable({
    key: v.literal("global"),
    signupsPaused: v.boolean(),
    aiPaused: v.boolean(),
    linkFetchPaused: v.boolean(),
    weeklyGrowthTargetPct: v.number(),
    primaryMetric: v.union(v.literal("mrr"), v.literal("weeklyActiveSavers")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  // Per-account admin flags, kept off the identity table.
  adminUserFlags: defineTable({
    teakUserId: v.string(),
    internal: v.boolean(),
    aiDisabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_teakUserId", ["teakUserId"])
    .index("by_internal", ["internal"]),
  // The founder's running "what's blocking growth" list.
  adminNotes: defineTable({
    body: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_createdAt", ["createdAt"]),
  // One row per UTC day, written by the daily snapshot cron. Counts exclude
  // internal and test accounts. Billing fields describe the moment of capture
  // and are only present for the day the snapshot ran.
  adminDailyMetrics: defineTable({
    date: v.string(),
    capturedAt: v.number(),
    accounts: v.number(),
    signups: v.number(),
    cardsSaved: v.number(),
    totalCards: v.number(),
    activeSavers1d: v.number(),
    activeSavers7d: v.number(),
    activeSavers28d: v.number(),
    storageBytes: v.number(),
    storageBytesAdded: v.number(),
    aiCostUsd: v.number(),
    aiCalls: v.number(),
    billing: v.optional(
      v.object({
        currency: v.string(),
        mrr: v.number(),
        mrrAtRisk: v.number(),
        netMrr: v.number(),
        paying: v.number(),
        trialing: v.number(),
        pastDue: v.number(),
        canceling: v.number(),
      })
    ),
    topStorage: v.array(
      v.object({ teakUserId: v.string(), bytes: v.number() })
    ),
    isApproximate: v.boolean(),
  }).index("by_date", ["date"]),
  // AI spend per account per UTC day, from every model call.
  aiUsageDaily: defineTable({
    date: v.string(),
    userId: v.string(),
    calls: v.number(),
    errors: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
  })
    .index("by_date_and_userId", ["date", "userId"])
    .index("by_userId_and_date", ["userId", "date"]),
  // Last run of each cron job, for the console's health view.
  cronHeartbeats: defineTable({
    name: v.string(),
    lastStartedAt: v.number(),
    lastFinishedAt: v.optional(v.number()),
    lastSucceededAt: v.optional(v.number()),
    lastStatus: v.union(
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed")
    ),
    lastError: v.optional(v.string()),
    consecutiveFailures: v.number(),
  }).index("by_name", ["name"]),
});
