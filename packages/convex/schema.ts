import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { cardTypes } from "./shared/constants";
import { FILE_KINDS } from "./shared/fileFormats";
import { FOLDER_COLORS } from "./shared/folders";
import { LINK_CATEGORIES } from "./shared/linkCategories";
import { SEARCH_MODES } from "./shared/search/semantic";
import {
  workosDeletionCompletionValidator,
  workosDeletionTargetValidator,
} from "./workosDeletionCompletion";

export type { CardType } from "./shared/constants";

export const linkCategoryLiterals = [...LINK_CATEGORIES] as const;

export type LinkCategory = (typeof linkCategoryLiterals)[number];

export const linkCategoryValidator = v.union(
  ...linkCategoryLiterals.map((category) => v.literal(category))
);

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
  // A product's price, read from the page; `price:` searches match `amount`.
  price: v.optional(
    v.object({ amount: v.number(), currency: v.optional(v.string()) })
  ),
  // An arXiv paper's PDF (`https://arxiv.org/pdf/<id>`), for Save PDF.
  pdfUrl: v.optional(v.string()),
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
    scrub: v.optional(
      v.object({
        frames: v.number(),
        frameWidth: v.number(),
        frameHeight: v.number(),
      })
    ),
    waveform: v.optional(
      v.object({
        grid: v.array(v.number()),
        detail: v.array(v.number()),
      })
    ),
    processing: v.optional(fileProcessingProvenanceValidator),
    recordingTimestamp: v.optional(v.number()),
  })
);

export const r2KeyValidator = v.string();

/**
 * An image someone chose for a link card in place of its scraped one
 * (card/thumbnailOverride.ts). Width and height are the decoded image's, so
 * grids can reserve its aspect ratio.
 */
export const thumbnailOverrideValidator = v.object({
  storageKey: r2KeyValidator,
  width: v.number(),
  height: v.number(),
  updatedAt: v.number(),
});

export const metadataValidator = v.optional(
  v.object({
    source: v.optional(v.string()),
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

export const colorValidator = v.object({
  hex: v.string(),
  name: v.optional(v.string()),
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

export const cardValidator = v.object({
  userId: v.string(),
  content: v.string(),
  type: cardTypeValidator,
  url: v.optional(v.string()),
  urlHost: v.optional(v.string()),
  /**
   * The page a text card was saved from (the extension's Save Text, or
   * `sourceUrl` on `POST /v1/cards`). Set only at create; `urlHost` falls back
   * to it, but the duplicate-URL check reads `url` alone.
   */
  sourceUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  shuffleKey: v.optional(v.number()),
  fileKey: v.optional(r2KeyValidator),
  thumbnailKey: v.optional(r2KeyValidator),
  scrubKey: v.optional(r2KeyValidator),
  workflowArtifactKeys: v.optional(v.array(r2KeyValidator)),
  previewKey: v.optional(r2KeyValidator),
  placeholderHash: v.optional(v.string()),
  derivativeVersion: v.optional(v.string()),
  derivativeCheckedAt: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  isFavorited: v.optional(v.boolean()),
  isDeleted: v.optional(v.boolean()),
  deletedAt: v.optional(v.number()),
  isArchived: v.optional(v.literal(true)),
  archivedAt: v.optional(v.number()),
  /**
   * When the person marked this link read, watched, bought or otherwise
   * done (`is:done`). Not the processing stages' `completedAt`.
   */
  completedAt: v.optional(v.number()),
  /**
   * Derived from `tags` (shared/tags.ts `isHiddenTagList`): the card carries
   * a reserved tag and is left out of lists until a search names that tag.
   */
  isHidden: v.optional(v.literal(true)),
  folderIds: v.optional(v.array(v.id("folders"))),
  metadata: metadataValidator,
  fileMetadata: fileMetadataValidator,
  metadataStatus: v.optional(
    v.union(v.literal("pending"), v.literal("completed"), v.literal("failed"))
  ),
  metadataTitle: v.optional(v.string()),
  metadataTitleEdited: v.optional(v.boolean()),
  /**
   * A link's chosen image. It lives outside metadata.linkPreview so Refresh
   * details, screenshots and new link media never replace it.
   */
  thumbnailOverride: v.optional(thumbnailOverrideValidator),
  /**
   * What the last replace or reset changed from, kept for the undo window:
   * `override: null` means the card showed its original image. Its object is
   * deleted after `deleteAfter` unless an undo puts it back.
   */
  previousThumbnailOverride: v.optional(
    v.object({
      override: v.union(thumbnailOverrideValidator, v.null()),
      changeId: v.string(),
      deleteAfter: v.number(),
      deletionJobId: v.optional(v.id("_scheduled_functions")),
    })
  ),
  /** Minted by every replace or reset; an undo must name the current one. */
  thumbnailChangeId: v.optional(v.string()),
  metadataDescription: v.optional(v.string()),
  aiTags: v.optional(v.array(v.string())),
  aiSummary: v.optional(v.string()),
  aiTranscript: v.optional(v.string()),
  /** Text read from an image or video thumbnail, up to MAX_IMAGE_OCR_CHARS. */
  aiOcrText: v.optional(v.string()),
  /** When the image op last read the card for text, found or not. */
  ocrCheckedAt: v.optional(v.number()),
  documentTextKey: v.optional(r2KeyValidator),
  hasExtractedText: v.optional(v.literal(true)),
  extractedTextCharCount: v.optional(v.number()),
  visualStyles: v.optional(v.array(v.string())),
  aiBackfillAttempts: v.optional(v.number()),
  colors: v.optional(v.array(colorValidator)),
  colorHexes: v.optional(v.array(v.string())),
  colorHues: v.optional(v.array(v.string())),
  processingStatus: processingStatusValidator,
  // Bumped whenever a card-processing run starts. A run only writes while the
  // card is still on its revision, so a replaced run can't overwrite newer
  // output (workflowDispatch.ts).
  processingRev: v.optional(v.number()),
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
  workosWebhookDeadLetters: defineTable({
    eventId: v.string(),
    event: v.string(),
    reason: v.string(),
    receivedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
  devPushLeases: defineTable({
    name: v.string(),
    holderId: v.optional(v.string()),
    holderLabel: v.optional(v.string()),
    expiresAt: v.number(),
    lastPush: v.optional(
      v.object({ label: v.string(), commit: v.string(), at: v.number() })
    ),
  }).index("by_name", ["name"]),
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
    .index("by_workosUserId_and_type", ["workosUserId", "type"]),
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
    .index("by_workosUserId_and_clientId_and_disconnectCompletedAt", [
      "workosUserId",
      "clientId",
      "disconnectCompletedAt",
    ])
    .index("by_userId_and_firstSeenAt", ["userId", "firstSeenAt"]),
  cards: defineTable(cardValidator)
    .index("by_user_type_deleted", ["userId", "type", "isDeleted"])
    .index("by_user_deleted", ["userId", "isDeleted"])
    .index("by_created", ["userId", "createdAt"])
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
    .index("by_user_deleted_archived_host_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "urlHost",
      "createdAt",
    ])
    .index("by_user_deleted_archived_shuffle", [
      "userId",
      "isDeleted",
      "isArchived",
      "shuffleKey",
    ])
    .index("by_user_deleted_created", ["userId", "isDeleted", "createdAt"])
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
  // Background work handed to the Files Worker: Cloudflare Workflow starts
  // and object deletions, sent by workflowDispatch.flush.
  workflowDispatches: defineTable({
    kind: v.union(
      v.literal("cardProcessing"),
      v.literal("export"),
      v.literal("import"),
      v.literal("accountDeletion"),
      v.literal("maintenance"),
      v.literal("deleteObjects")
    ),
    // Groups the runs of one subject, e.g. `card:<cardId>`.
    key: v.string(),
    instanceId: v.optional(v.string()),
    params: v.optional(v.any()),
    keys: v.optional(v.array(v.string())),
    state: v.union(
      v.literal("pending"),
      v.literal("sent"),
      v.literal("done"),
      v.literal("failed")
    ),
    notBefore: v.number(),
    createdAt: v.number(),
    sentAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    cardId: v.optional(v.id("cards")),
    rev: v.optional(v.number()),
    // Reset the card's AI fields and stages when the run is sent.
    reset: v.optional(v.literal(true)),
    error: v.optional(v.string()),
  })
    .index("by_state_and_notBefore", ["state", "notBefore"])
    .index("by_state_and_sentAt", ["state", "sentAt"])
    .index("by_state_and_finishedAt", ["state", "finishedAt"])
    .index("by_key_and_createdAt", ["key", "createdAt"])
    .index("by_instanceId", ["instanceId"]),
  vaultSetups: defineTable({
    userId: v.string(),
    startedAt: v.number(),
  }).index("by_userId", ["userId"]),
  cardEmbeddings: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    shard: v.optional(v.number()),
    namespace: v.optional(v.string()),
    hash: v.optional(v.string()),
    embeddedAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    lastError: v.optional(v.string()),
    pendingVectorDeleteAt: v.optional(v.number()),
    /** Until then the `embedDue` job that claimed the card owns it. */
    leaseUntil: v.optional(v.number()),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_dueAt", ["userId", "dueAt"]),
  vectorShards: defineTable({
    userId: v.string(),
    shard: v.number(),
  }).index("by_userId", ["userId"]),
  // `key` hashes the embedded text; the query itself is never stored.
  semanticSearchResults: defineTable({
    userId: v.string(),
    key: v.string(),
    /**
     * `pending`: a `like:` card with no vector yet, kept briefly so retries
     * stay cheap. Missing means `ok`.
     */
    status: v.optional(v.literal("pending")),
    ranking: v.array(v.object({ cardId: v.id("cards"), score: v.number() })),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_expiresAt", ["expiresAt"]),
  // Best match scores for one search text, per card; see search/relevance.
  searchRelevanceResults: defineTable({
    userId: v.string(),
    key: v.string(),
    scores: v.array(
      v.object({
        cardId: v.id("cards"),
        score: v.number(),
        cardUpdatedAt: v.number(),
      })
    ),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_expiresAt", ["expiresAt"]),
  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    nameKey: v.string(),
    color: v.optional(folderColorValidator),
    kind: v.union(v.literal("manual"), v.literal("smart")),
    query: v.optional(v.string()),
    activeCardCount: v.number(),
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_nameKey", ["userId", "nameKey"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
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
    .index("by_folderId_and_isDeleted_and_cardCreatedAt", [
      "folderId",
      "isDeleted",
      "cardCreatedAt",
    ])
    .index("by_cardId_and_folderId", ["cardId", "folderId"])
    .index("by_userId", ["userId"]),
  userTagSummaries: defineTable({
    userId: v.string(),
    items: v.array(v.object({ name: v.string(), count: v.number() })),
    isComplete: v.boolean(),
    computedAt: v.number(),
  }).index("by_userId", ["userId"]),
  tagSummaryRefreshes: defineTable({
    userId: v.string(),
    dueAt: v.number(),
  }).index("by_userId", ["userId"]),
  tagOperations: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("rename"), v.literal("merge"), v.literal("delete")),
    from: v.string(),
    to: v.optional(v.string()),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    total: v.number(),
    processed: v.number(),
    changed: v.number(),
    cursor: v.optional(v.string()),
    pass: v.optional(v.number()),
    passChanged: v.optional(v.number()),
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
  }).index("by_userId", ["userId"]),
  accountStorageObjects: defineTable({
    userId: v.string(),
    key: v.string(),
    exportJobId: v.optional(v.id("exportJobs")),
  })
    .index("by_userId_and_key", ["userId", "key"])
    .index("by_key", ["key"]),
  cardSearchDocuments: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    searchableText: v.string(),
    /** The card's aiOcrText, for `text:` searches. */
    ocrText: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
    type: cardTypeValidator,
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    isHidden: v.optional(v.literal(true)),
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
        "isHidden",
      ],
    })
    .searchIndex("search_ocrText", {
      searchField: "ocrText",
      filterFields: [
        "userId",
        "isDeleted",
        "isArchived",
        "type",
        "isFavorited",
        "urlHost",
        "isHidden",
      ],
    }),
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
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["userId"],
    }),
  // Save PDF provenance: the document card made from a link card's arXiv
  // PDF (card/linkedPdfs.ts). A row is claimed `pending` while the PDF
  // downloads, so concurrent saves make one document; it goes with either
  // card, so a deleted document can be saved again.
  linkedPdfs: defineTable({
    userId: v.string(),
    sourceCardId: v.id("cards"),
    pdfUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed")
    ),
    /** Where the PDF is stored; kept across retries so one object is written. */
    fileKey: r2KeyValidator,
    claimToken: v.string(),
    cardId: v.optional(v.id("cards")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sourceCardId", ["sourceCardId"])
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .index("by_status", ["status"]),
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
    userId: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    aiTags: v.optional(v.array(v.string())),
    isDeleted: v.optional(v.boolean()),
    type: v.optional(cardTypeValidator),
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    cardCreatedAt: v.optional(v.number()),
    tagCountsChanged: v.optional(v.boolean()),
  })
    .index("by_cardId", ["cardId"])
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
  cardTombstones: defineTable({
    userId: v.string(),
    cardId: v.id("cards"),
    deletedAt: v.number(),
  })
    .index("by_userId_and_deletedAt", ["userId", "deletedAt"])
    .index("by_deletedAt", ["deletedAt"]),
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
    .index("by_user_created", ["userId", "createdAt"])
    .index("by_user_status", ["userId", "status"])
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
    .index("by_source_key", ["sourceKey"])
    .index("by_expires_at", ["expiresAt"]),
  adminAuditLog: defineTable({
    actorTeakUserId: v.string(),
    actorEmail: v.string(),
    action: v.string(),
    targetTeakUserId: v.optional(v.string()),
    targetCardId: v.optional(v.string()),
    reason: v.optional(v.string()),
    details: v.optional(v.record(v.string(), v.any())),
    at: v.number(),
  })
    .index("by_at", ["at"])
    .index("by_targetTeakUserId_and_at", ["targetTeakUserId", "at"]),
  adminSettings: defineTable({
    key: v.literal("global"),
    signupsPaused: v.boolean(),
    aiPaused: v.boolean(),
    linkFetchPaused: v.boolean(),
    weeklyGrowthTargetPct: v.number(),
    primaryMetric: v.union(v.literal("mrr"), v.literal("weeklyActiveSavers")),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
  adminUserFlags: defineTable({
    teakUserId: v.string(),
    internal: v.boolean(),
    aiDisabled: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_teakUserId", ["teakUserId"])
    .index("by_internal", ["internal"]),
  adminNotes: defineTable({
    body: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  }).index("by_createdAt", ["createdAt"]),
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
