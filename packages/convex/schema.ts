import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { adminOverviewFields } from "./schema/validators/admin";
import {
  apiIdempotencyAnalyticsValidator,
  apiIdempotencyKeyValidator,
} from "./schema/validators/apiIdempotency";
import {
  cardTypeValidator,
  cardValidator,
  folderColorValidator,
  r2KeyValidator,
} from "./schema/validators/cards";
import {
  exportJobItemValidator,
  exportJobValidator,
  fileUploadSessionValidator,
  importJobItemValidator,
  importJobValidator,
} from "./schema/validators/jobs";
import { disconnectRecoveryReceipt } from "./schema/validators/workos";
import {
  workosDeletionCompletionValidator,
  workosDeletionTargetValidator,
} from "./workos/deletionCompletion";

export * from "./schema/validators/admin";
export * from "./schema/validators/apiIdempotency";
export * from "./schema/validators/cards";
export * from "./schema/validators/jobs";
export * from "./schema/validators/workos";
export type { CardType } from "./shared/constants";

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
    // Missing until the first event is applied.
    after: v.optional(v.string()),
    // The event the catch-up keeps failing on, and how many runs it failed.
    failingEventId: v.optional(v.string()),
    failedAttempts: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
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
    .index("by_created", ["userId", "createdAt"])
    .index("by_saved", ["userId", "savedAt"])
    .index("by_user_deleted_archived_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "createdAt",
    ])
    .index("by_user_deleted_archived_saved", [
      "userId",
      "isDeleted",
      "isArchived",
      "savedAt",
    ])
    .index("by_user_deleted_archived_type_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "type",
      "createdAt",
    ])
    .index("by_user_deleted_archived_type_saved", [
      "userId",
      "isDeleted",
      "isArchived",
      "type",
      "savedAt",
    ])
    .index("by_user_deleted_archived_favorited_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "createdAt",
    ])
    .index("by_user_deleted_archived_favorited_saved", [
      "userId",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "savedAt",
    ])
    .index("by_user_deleted_archived_host_created", [
      "userId",
      "isDeleted",
      "isArchived",
      "urlHost",
      "createdAt",
    ])
    .index("by_user_deleted_archived_host_saved", [
      "userId",
      "isDeleted",
      "isArchived",
      "urlHost",
      "savedAt",
    ])
    .index("by_user_deleted_archived_shuffle", [
      "userId",
      "isDeleted",
      "isArchived",
      "shuffleKey",
    ])
    .index("by_user_deleted_archived_type_shuffle", [
      "userId",
      "isDeleted",
      "isArchived",
      "type",
      "shuffleKey",
    ])
    .index("by_user_deleted_archived_favorited_shuffle", [
      "userId",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "shuffleKey",
    ])
    .index("by_user_deleted_created", ["userId", "isDeleted", "createdAt"])
    .index("by_user_deleted_saved", ["userId", "isDeleted", "savedAt"])
    .index("by_isDeleted_deletedAt", ["isDeleted", "deletedAt"])
    .index("by_aiPending_and_isDeleted_and_createdAt", [
      "aiPending",
      "isDeleted",
      "createdAt",
    ])
    .index("by_updated", ["userId", "updatedAt"])
    // No search index covers colors or styles: they are arrays, which
    // search indexes skip, so color and style searches read the library in
    // date order (card/visualFilters.ts). Text search uses
    // cardSearchDocuments.
    .index("by_user_url_deleted", ["userId", "url", "isDeleted"])
    .index("by_user_urlkey_deleted", ["userId", "urlKey", "isDeleted"]),
  workflowDispatches: defineTable({
    kind: v.union(
      v.literal("cardProcessing"),
      v.literal("export"),
      v.literal("import"),
      v.literal("accountDeletion"),
      v.literal("maintenance"),
      v.literal("deleteObjects"),
      v.literal("analyticsEvent")
    ),
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
    reset: v.optional(v.literal(true)),
    error: v.optional(v.string()),
    lastReconciledAt: v.optional(v.number()),
  })
    .index("by_state_and_notBefore", ["state", "notBefore"])
    .index("by_state_and_sentAt", ["state", "sentAt"])
    .index("by_state_and_lastReconciledAt_and_sentAt", [
      "state",
      "lastReconciledAt",
      "sentAt",
    ])
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
    leaseUntil: v.optional(v.number()),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .index("by_userId_and_dueAt", ["userId", "dueAt"]),
  sweepCursors: defineTable({
    name: v.literal("vectorLedger"),
    cursor: v.union(v.string(), v.null()),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),
  vectorShards: defineTable({
    userId: v.string(),
    shard: v.number(),
  }).index("by_userId", ["userId"]),
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
    // Read only until `migration/backfillFolderCardCounts` copies it into
    // `folderCardCounts` (folder/folderRows.ts), which holds the live count.
    activeCardCount: v.number(),
    deletingAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_and_nameKey", ["userId", "nameKey"])
    .index("by_userId_and_createdAt", ["userId", "createdAt"]),
  folderCardCounts: defineTable({
    folderId: v.id("folders"),
    userId: v.string(),
    shard: v.number(),
    count: v.number(),
  }).index("by_folderId_and_shard", ["folderId", "shard"]),
  folderCards: defineTable({
    folderId: v.id("folders"),
    cardId: v.id("cards"),
    userId: v.string(),
    isDeleted: v.optional(v.literal(true)),
    isArchived: v.optional(v.literal(true)),
    type: cardTypeValidator,
    cardCreatedAt: v.number(),
    // The card's `savedAt ?? createdAt`. Every row has it since the
    // production backfill; readers still read `cardSavedAt ?? cardCreatedAt`.
    cardSavedAt: v.optional(v.number()),
    addedAt: v.number(),
  })
    .index("by_folderId_and_isDeleted_and_isArchived_and_cardCreatedAt", [
      "folderId",
      "isDeleted",
      "isArchived",
      "cardCreatedAt",
    ])
    .index("by_folderId_and_isDeleted_and_isArchived_and_cardSavedAt", [
      "folderId",
      "isDeleted",
      "isArchived",
      "cardSavedAt",
    ])
    .index("by_folderId_and_isDeleted_and_cardCreatedAt", [
      "folderId",
      "isDeleted",
      "cardCreatedAt",
    ])
    .index("by_folderId_and_isDeleted_and_cardSavedAt", [
      "folderId",
      "isDeleted",
      "cardSavedAt",
    ])
    .index("by_cardId_and_folderId", ["cardId", "folderId"])
    .index("by_userId", ["userId"]),
  userTagSummaries: defineTable({
    userId: v.string(),
    items: v.array(v.object({ name: v.string(), count: v.number() })),
    isComplete: v.boolean(),
    computedAt: v.number(),
  }).index("by_userId", ["userId"]),
  userTagCounts: defineTable({
    userId: v.string(),
    tag: v.string(),
    count: v.number(),
  }).index("by_userId_and_tag", ["userId", "tag"]),
  // Count changes the tag sync records without touching the shared
  // `userTagCounts` rows; the tag summary refresh folds them in.
  tagCountDeltas: defineTable({
    userId: v.string(),
    tag: v.string(),
    delta: v.number(),
  }).index("by_userId", ["userId"]),
  // One row, written when `migration/backfillTagCounts` has counted every
  // tag row. Until then tag summaries recount `cardSearchTags`.
  tagCountStates: defineTable({
    key: v.literal("global"),
    readyAt: v.number(),
  }).index("by_key", ["key"]),
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
    ocrText: v.optional(v.string()),
    isDeleted: v.optional(v.boolean()),
    type: cardTypeValidator,
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    isHidden: v.optional(v.literal(true)),
    urlHost: v.optional(v.string()),
    sourceUpdatedAt: v.number(),
    // The card's `createdAt` and `_creationTime`, so a text search orders its
    // matches without loading them.
    cardCreatedAt: v.number(),
    // The card's `savedAt ?? createdAt`; read `cardSavedAt ?? cardCreatedAt`
    // on rows written before it existed.
    cardSavedAt: v.optional(v.number()),
    cardCreationTime: v.number(),
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
    /**
     * A document's searchable start, or one part of a transcript: a
     * transcript is split into parts of at most `SEARCH_PREFIX_MAX_BYTES`.
     */
    text: v.string(),
    /** The R2 object holding a document's whole text. */
    sourceKey: v.optional(r2KeyValidator),
    /** A transcript part's place, from 0. */
    part: v.optional(v.number()),
    charCount: v.number(),
    truncated: v.boolean(),
  })
    .index("by_cardId", ["cardId"])
    .index("by_userId", ["userId"])
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["userId"],
    }),
  // Save by email (inbound/): whether mail sent from an account's sign-in
  // email to the shared save@ address becomes cards. Off until turned on.
  inboundEmailSettings: defineTable({
    userId: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastReceivedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),
  // Account display preferences (settings/preferences.ts), kept off `users`,
  // which stays identity-only. `locale` is a code from @teak/i18n's
  // SUPPORTED_LOCALES; readers treat any other value as English.
  userPreferences: defineTable({
    userId: v.string(),
    locale: v.string(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),
  // One per email delivered, so a redelivery never saves twice. Attachments
  // are uploaded by the Email Worker and finalized one by one.
  inboundEmailReceipts: defineTable({
    userId: v.string(),
    messageKey: v.string(),
    outcome: v.union(
      v.literal("saved"),
      v.literal("dropped_limit"),
      v.literal("dropped_rate"),
      v.literal("empty")
    ),
    cardIds: v.array(v.id("cards")),
    createdAt: v.number(),
    pendingAttachments: v.optional(
      v.array(
        v.object({
          index: v.number(),
          fileKey: r2KeyValidator,
          fileName: v.string(),
          mimeType: v.string(),
          size: v.number(),
          state: v.union(
            v.literal("unclaimed"),
            v.literal("pending"),
            v.literal("done"),
            v.literal("dropped")
          ),
          claimToken: v.optional(v.string()),
          claimedAt: v.optional(v.number()),
          cardId: v.optional(v.id("cards")),
        })
      )
    ),
  })
    .index("by_userId_and_messageKey", ["userId", "messageKey"])
    .index("by_userId", ["userId"])
    .index("by_createdAt", ["createdAt"]),
  // `[[Title|teak:<id>]]` links in each text card's content, rebuilt after
  // every content save (card/cardLinks.ts).
  cardLinks: defineTable({
    userId: v.string(),
    fromCardId: v.id("cards"),
    toCardId: v.id("cards"),
    createdAt: v.number(),
  })
    .index("by_fromCardId_and_toCardId", ["fromCardId", "toCardId"])
    .index("by_toCardId", ["toCardId"])
    .index("by_userId", ["userId"]),
  linkedPdfs: defineTable({
    userId: v.string(),
    sourceCardId: v.id("cards"),
    pdfUrl: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed")
    ),
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
  // A list of links pasted into the web composer, saved in the background as
  // one link card each (card/pasteLinks.ts). The counts are stored at start,
  // so every toast reads the normalized numbers. Removed 7 days after it
  // finishes.
  linkPasteJobs: defineTable({
    userId: v.string(),
    /** At most 100, already normalized and unique by URL key. */
    urls: v.array(v.string()),
    total: v.number(),
    omittedOverLimit: v.number(),
    omittedRepeats: v.number(),
    omittedUnsafe: v.number(),
    nextIndex: v.number(),
    created: v.number(),
    resaved: v.number(),
    failed: v.number(),
    /** Retries spent on the URL at `nextIndex`. */
    attempts: v.number(),
    status: v.union(
      v.literal("running"),
      v.literal("done"),
      v.literal("stopped_at_limit"),
      v.literal("failed")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_user_status", ["userId", "status"])
    .index("by_status_finished", ["status", "finishedAt"]),
  cardSearchTags: defineTable({
    cardId: v.id("cards"),
    userId: v.string(),
    tag: v.string(),
    isDeleted: v.optional(v.boolean()),
    type: cardTypeValidator,
    isFavorited: v.optional(v.boolean()),
    isArchived: v.optional(v.literal(true)),
    cardCreatedAt: v.number(),
    // The card's `savedAt ?? createdAt`. Every row has it since the
    // production backfill; readers still read `cardSavedAt ?? cardCreatedAt`.
    cardSavedAt: v.optional(v.number()),
    sourceUpdatedAt: v.number(),
    syncGeneration: v.number(),
    // Set while the row is counted in `userTagCounts` (outside Trash and
    // Archive). Rows written before counting existed lack it until
    // `migration/backfillTagCounts` runs.
    isCounted: v.optional(v.literal(true)),
  })
    .index("by_cardId_and_tag", ["cardId", "tag"])
    .index("by_cardId_and_generation", ["cardId", "syncGeneration"])
    .index("by_user_tag_deleted_created", [
      "userId",
      "tag",
      "isDeleted",
      "cardCreatedAt",
      "cardId",
    ])
    .index("by_user_tag_deleted_saved", [
      "userId",
      "tag",
      "isDeleted",
      "cardSavedAt",
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
    .index("by_user_tag_deleted_archived_saved", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "cardSavedAt",
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
    .index("by_user_tag_deleted_archived_type_saved", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "type",
      "cardSavedAt",
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
    .index("by_user_tag_deleted_archived_favorited_saved", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "isFavorited",
      "cardSavedAt",
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
    ])
    .index("by_user_tag_deleted_archived_type_favorited_saved", [
      "userId",
      "tag",
      "isDeleted",
      "isArchived",
      "type",
      "isFavorited",
      "cardSavedAt",
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
    cardSavedAt: v.optional(v.number()),
    tagCountsChanged: v.optional(v.boolean()),
    // The `syncGeneration` this chain writes. It moves only when the tag set
    // changes, so flag changes patch rows in place. Missing on older rows,
    // whose chains wrote `generation`.
    tagGeneration: v.optional(v.number()),
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
    .index("by_jobId_and_urlKey", ["jobId", "urlKey"])
    .index("by_job_source", ["jobId", "sourceIndex"])
    .index("by_job_status_source", ["jobId", "status", "sourceIndex"])
    .index("by_user", ["userId"]),
  // Unused; kept for old rows until `.agents/sunset.md` says it can go.
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
  // The admin overview as the Files Worker last counted it (hourly), one row
  // with onboarding cards and one without. Aggregates only.
  adminOverviews: defineTable({
    includeOnboarding: v.boolean(),
    ...adminOverviewFields,
  }).index("by_includeOnboarding", ["includeOnboarding"]),
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
