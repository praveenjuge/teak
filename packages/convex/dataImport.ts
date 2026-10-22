import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { assertAccountNotDeleting } from "./accountDeletion";
import { newImportFolderCache } from "./folder/folders";
import {
  ACTIVE_IMPORT_STATUSES,
  IMPORT_FAILURE_SAMPLE_LIMIT,
  IMPORT_PART_BYTES,
} from "./import/constants";
import { createImportedCard, importItemFields } from "./import/items";
import { importModeValidator, stagedItemsValidator } from "./schema";
import { requireSessionUserId, resolveStoredUserId } from "./securitySessions";
import { buildR2UserPrefix, queueObjectDeletion } from "./storage/r2";
import { queueImportWorkflow } from "./workflowDispatch";

const activeStatuses = new Set<string>(ACTIVE_IMPORT_STATUSES);

const summaryValidator = v.object({
  id: v.id("importJobs"),
  mode: importModeValidator,
  status: v.union(
    v.literal("uploading"),
    v.literal("queued"),
    v.literal("parsing"),
    v.literal("importing"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("canceled")
  ),
  phase: v.string(),
  fileName: v.string(),
  fileSize: v.number(),
  fileLastModified: v.number(),
  parsedCount: v.number(),
  processedCount: v.number(),
  createdCount: v.number(),
  skippedCount: v.number(),
  failedCount: v.number(),
  failureClass: v.optional(v.string()),
  reportAvailable: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const itemInputValidator = v.object({
  ...importItemFields,
  status: v.union(
    v.literal("pending"),
    v.literal("skipped"),
    v.literal("failed")
  ),
});

function summarize(job: Doc<"importJobs">) {
  return {
    id: job._id,
    mode: job.mode,
    status: job.status,
    phase: job.phase,
    fileName: job.fileName,
    fileSize: job.fileSize,
    fileLastModified: job.fileLastModified,
    parsedCount: job.parsedCount,
    processedCount: job.processedCount,
    createdCount: job.createdCount,
    skippedCount: job.skippedCount,
    failedCount: job.failedCount,
    failureClass: job.failureClass,
    reportAvailable: Boolean(job.reportKey),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

export const getLatestImport = query({
  args: {},
  returns: v.union(v.null(), summaryValidator),
  handler: async (ctx) => {
    let userId: string;
    try {
      userId = await requireSessionUserId(ctx);
    } catch {
      return null;
    }
    const job = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .first();
    return job ? summarize(job) : null;
  },
});

export const getImportFailureSamples = query({
  args: { jobId: v.id("importJobs") },
  returns: v.array(
    v.object({ sourceIndex: v.number(), item: v.string(), reason: v.string() })
  ),
  handler: async (ctx, { jobId }) => {
    const userId = await requireSessionUserId(ctx);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId) {
      throw new Error("Import job not found");
    }
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_job_status_source", (q) =>
        q.eq("jobId", jobId).eq("status", "failed")
      )
      .take(IMPORT_FAILURE_SAMPLE_LIMIT);
    return items.map((item) => ({
      sourceIndex: item.sourceIndex,
      item: item.content || item.fileName || `Item ${item.sourceIndex + 1}`,
      reason: item.failureReason ?? "Import failed",
    }));
  },
});

export const markCancelRequested = internalMutation({
  args: { jobId: v.id("importJobs"), userId: v.string() },
  returns: v.object({
    uploadId: v.optional(v.string()),
    sourceKey: v.string(),
    active: v.boolean(),
  }),
  handler: async (ctx, { jobId, userId }) => {
    await assertAccountNotDeleting(ctx, userId);
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId) {
      throw new Error("Import job not found");
    }
    if (!activeStatuses.has(job.status)) {
      return { sourceKey: job.sourceKey, active: false };
    }
    await ctx.db.patch(jobId, {
      cancelRequested: true,
      phase: "Canceling import",
      updatedAt: Date.now(),
    });
    return { uploadId: job.uploadId, sourceKey: job.sourceKey, active: true };
  },
});

export const reserveJob = internalMutation({
  args: {
    userId: v.string(),
    mode: importModeValidator,
    fileName: v.string(),
    fileSize: v.number(),
    fileLastModified: v.number(),
    sourceKey: v.string(),
    uploadExpiresAt: v.number(),
  },
  returns: v.id("importJobs"),
  handler: async (ctx, args) => {
    await assertAccountNotDeleting(ctx, args.userId);
    const previous = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();
    for (const status of ACTIVE_IMPORT_STATUSES) {
      const active = await ctx.db
        .query("importJobs")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", args.userId).eq("status", status)
        )
        .first();
      if (active) {
        throw new ConvexError({
          code: "IMPORT_ACTIVE",
          message: "An import is already active",
        });
      }
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("importJobs", {
      ...args,
      status: "uploading",
      phase: "Uploading",
      cancelRequested: false,
      parsedCount: 0,
      processedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    if (previous && !activeStatuses.has(previous.status)) {
      await ctx.scheduler.runAfter(
        0,
        internal["import/runImport"].cleanupImportJob,
        { jobId: previous._id }
      );
    }
    return jobId;
  },
});

export const attachMultipart = internalMutation({
  args: { jobId: v.id("importJobs"), uploadId: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId, uploadId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    await assertAccountNotDeleting(ctx, job.userId);
    await ctx.db.patch(jobId, { uploadId, updatedAt: Date.now() });
    return null;
  },
});

// Opaque part ETags: R2 returns 32-character MD5s, Miniflare's local R2 longer
// tokens. R2 verifies each one again when the upload completes.
const PART_ETAG_PATTERN = /^"?[A-Za-z0-9+/=_-]{1,512}"?$/u;

export const recordImportPart = mutation({
  args: {
    jobId: v.id("importJobs"),
    partNumber: v.number(),
    etag: v.string(),
    size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireSessionUserId(ctx);
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.userId !== userId ||
      job.status !== "uploading" ||
      !job.uploadId ||
      (job.uploadExpiresAt ?? 0) <= Date.now()
    ) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Import upload not found",
      });
    }
    const totalParts = Math.ceil(job.fileSize / IMPORT_PART_BYTES);
    const expectedSize =
      args.partNumber === totalParts
        ? job.fileSize - IMPORT_PART_BYTES * (totalParts - 1)
        : IMPORT_PART_BYTES;
    if (
      !Number.isSafeInteger(args.partNumber) ||
      args.partNumber < 1 ||
      args.partNumber > totalParts ||
      args.size !== expectedSize ||
      !PART_ETAG_PATTERN.test(args.etag)
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Uploaded part metadata is invalid",
      });
    }
    const etag = args.etag.replace(/^"(.*)"$/u, "$1");
    const uploadedParts = (job.uploadedParts ?? [])
      .filter((part) => part.partNumber !== args.partNumber)
      .concat({ partNumber: args.partNumber, etag, size: args.size })
      .sort((left, right) => left.partNumber - right.partNumber);
    await ctx.db.patch(args.jobId, { uploadedParts, updatedAt: Date.now() });
    return null;
  },
});

export const getJob = internalQuery({
  args: { jobId: v.id("importJobs") },
  returns: v.any(),
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
});

export const getWorkflowJob = internalQuery({
  args: { jobId: v.id("importJobs") },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.string(),
      mode: importModeValidator,
      status: v.string(),
      sourceKey: v.string(),
      sourceEtag: v.optional(v.string()),
      fileSize: v.number(),
      cancelRequested: v.boolean(),
      createdCount: v.number(),
      skippedCount: v.number(),
      failedCount: v.number(),
      userKeyPrefix: v.string(),
      stagedItems: v.optional(stagedItemsValidator),
    })
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return null;
    }
    return {
      userId: job.userId,
      mode: job.mode,
      status: job.status,
      sourceKey: job.sourceKey,
      ...(job.sourceEtag ? { sourceEtag: job.sourceEtag } : {}),
      fileSize: job.fileSize,
      cancelRequested: job.cancelRequested === true,
      createdCount: job.createdCount,
      skippedCount: job.skippedCount,
      failedCount: job.failedCount,
      userKeyPrefix: buildR2UserPrefix(job.userId),
      ...(job.stagedItems ? { stagedItems: job.stagedItems } : {}),
    };
  },
});

export const findUploadForUser = internalQuery({
  args: { userId: v.string() },
  returns: v.any(),
  handler: (ctx, { userId }) =>
    ctx.db
      .query("importJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "uploading")
      )
      .order("desc")
      .first(),
});

// Outlasts the longest action, so a live claim always has a running owner.
const COMPLETION_CLAIM_MS = 10 * 60 * 1000;

const holdsClaim = (job: Doc<"importJobs">, token: string) =>
  job.status === "uploading" &&
  job.completionClaim?.token === token &&
  job.completionClaim.expiresAt > Date.now();

/**
 * Claims an upload for one `completeImportUpload` call. A second call while
 * the claim is live is refused before it reaches R2.
 */
export const claimCompletion = internalMutation({
  args: { jobId: v.id("importJobs"), userId: v.string(), uploadId: v.string() },
  returns: v.string(),
  handler: async (ctx, { jobId, userId, uploadId }) => {
    const job = await ctx.db.get(jobId);
    if (
      !job ||
      job.userId !== userId ||
      job.status !== "uploading" ||
      job.uploadId !== uploadId ||
      job.cancelRequested
    ) {
      throw new Error("Import upload not found");
    }
    await assertAccountNotDeleting(ctx, userId);
    const now = Date.now();
    if (job.uploadExpiresAt !== undefined && job.uploadExpiresAt <= now) {
      throw new ConvexError({
        code: "UPLOAD_EXPIRED",
        message: "This upload has expired",
      });
    }
    if ((job.completionClaim?.expiresAt ?? 0) > now) {
      throw new ConvexError({
        code: "UPLOAD_COMPLETING",
        message: "This import is already being completed",
      });
    }
    const token = crypto.randomUUID();
    await ctx.db.patch(jobId, {
      completionClaim: { token, expiresAt: now + COMPLETION_CLAIM_MS },
      updatedAt: now,
    });
    return token;
  },
});

export const holdsCompletionClaim = internalQuery({
  args: { jobId: v.id("importJobs"), token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { jobId, token }) => {
    const job = await ctx.db.get(jobId);
    return job ? holdsClaim(job, token) : false;
  },
});

export const releaseCompletionClaim = internalMutation({
  args: { jobId: v.id("importJobs"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, { jobId, token }) => {
    const job = await ctx.db.get(jobId);
    if (job?.completionClaim?.token === token) {
      await ctx.db.patch(jobId, { completionClaim: undefined });
    }
    return null;
  },
});

export const markQueued = internalMutation({
  args: { jobId: v.id("importJobs"), claim: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { jobId, claim }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.cancelRequested) {
      throw new Error("Import was canceled");
    }
    const claimable =
      claim === undefined
        ? job.status === "uploading" &&
          (job.completionClaim?.expiresAt ?? 0) <= Date.now()
        : holdsClaim(job, claim);
    if (!claimable) {
      throw new Error("Import upload is no longer being completed");
    }
    await assertAccountNotDeleting(ctx, job.userId);
    await ctx.db.patch(jobId, {
      status: "queued",
      phase: "Waiting to parse",
      completionClaim: undefined,
      uploadId: undefined,
      uploadExpiresAt: undefined,
      uploadedParts: undefined,
      stagedItems: { pages: 0, parts: 0, cursor: 0, part: 1, offset: 0 },
      workflowId: await queueImportWorkflow(ctx, jobId),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const setPhase = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    status: v.union(v.literal("parsing"), v.literal("importing")),
    phase: v.string(),
  },
  returns: v.object({ canceled: v.boolean() }),
  handler: async (ctx, { jobId, status, phase }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    await assertAccountNotDeleting(ctx, job.userId);
    if (job.cancelRequested) {
      return { canceled: true };
    }
    await ctx.db.patch(jobId, {
      status,
      phase,
      startedAt: job.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    return { canceled: false };
  },
});

/** Legacy staging: jobs queued before `stagedItems`. See `.agents/sunset.md`. */
export const insertItems = internalMutation({
  args: { jobId: v.id("importJobs"), items: v.array(itemInputValidator) },
  returns: v.null(),
  handler: async (ctx, { jobId, items }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    await assertAccountNotDeleting(ctx, job.userId);
    let parsedDelta = 0,
      processedDelta = 0,
      skippedDelta = 0,
      failedDelta = 0;
    for (const item of items) {
      const exists = await ctx.db
        .query("importJobItems")
        .withIndex("by_job_source", (q) =>
          q.eq("jobId", jobId).eq("sourceIndex", item.sourceIndex)
        )
        .first();
      if (exists) {
        continue;
      }
      if (item.status === "pending" && item.url) {
        const duplicate = await ctx.db
          .query("importJobItems")
          .withIndex("by_jobId_and_url", (q) =>
            q.eq("jobId", jobId).eq("url", item.url)
          )
          .first();
        if (duplicate) {
          item.status = "skipped";
          item.failureCode = "SOURCE_DUPLICATE";
          item.failureReason = "Duplicate URL in import file";
        }
      }
      const now = Date.now();
      await ctx.db.insert("importJobItems", {
        ...item,
        jobId,
        userId: job.userId,
        createdAt: now,
        updatedAt: now,
      });
      parsedDelta += 1;
      if (item.status !== "pending") {
        processedDelta += 1;
      }
      if (item.status === "skipped") {
        skippedDelta += 1;
      }
      if (item.status === "failed") {
        failedDelta += 1;
      }
    }
    await ctx.db.patch(jobId, {
      parsedCount: job.parsedCount + parsedDelta,
      processedCount: job.processedCount + processedDelta,
      skippedCount: job.skippedCount + skippedDelta,
      failedCount: job.failedCount + failedDelta,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Legacy staging: jobs queued before `stagedItems`. See `.agents/sunset.md`. */
export const getPendingItems = internalQuery({
  args: { jobId: v.id("importJobs"), limit: v.number() },
  returns: v.any(),
  handler: (ctx, { jobId, limit }) =>
    ctx.db
      .query("importJobItems")
      .withIndex("by_job_status_source", (q) =>
        q.eq("jobId", jobId).eq("status", "pending")
      )
      .take(limit),
});

export const getUnclaimedFileKeysPage = internalQuery({
  args: {
    jobId: v.id("importJobs"),
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    keys: v.array(v.string()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, { jobId, paginationOpts }) => {
    const page = await ctx.db
      .query("importJobItems")
      .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, 200),
      });
    return {
      keys: page.page.flatMap((item) =>
        item.status !== "created" && item.extractedFileKey
          ? [item.extractedFileKey]
          : []
      ),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export { importedBookmarkTitle } from "./import/items";

/** Legacy staging: jobs queued before `stagedItems`. See `.agents/sunset.md`. */
export const createPendingBatch = internalMutation({
  args: { jobId: v.id("importJobs"), itemIds: v.array(v.id("importJobItems")) },
  returns: v.object({
    retryAt: v.optional(v.number()),
    limitReached: v.boolean(),
    failureClass: v.optional(v.literal("identity_mapping_unavailable")),
  }),
  handler: async (ctx, { jobId, itemIds }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    if (job.cancelRequested) {
      return { limitReached: false };
    }
    const userId = await resolveStoredUserId(ctx, job.userId);
    if (!userId) {
      return {
        limitReached: false,
        failureClass: "identity_mapping_unavailable" as const,
      };
    }
    let created = 0,
      skipped = 0,
      failed = 0;
    const folderCache = newImportFolderCache();
    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.jobId !== jobId || item.status !== "pending") {
        continue;
      }
      const outcome = await createImportedCard(
        ctx,
        job,
        userId,
        item,
        folderCache
      );
      if (outcome.kind === "duplicate") {
        await ctx.db.patch(itemId, {
          status: "skipped",
          failureCode: "DUPLICATE_URL",
          failureReason: "URL already exists",
          updatedAt: Date.now(),
        });
        skipped += 1;
        continue;
      }
      if (outcome.kind === "created") {
        await ctx.db.patch(itemId, {
          status: "created",
          cardId: outcome.cardId,
          updatedAt: Date.now(),
        });
        created += 1;
        continue;
      }
      if (outcome.code === "RATE_LIMITED") {
        await ctx.db.patch(jobId, {
          processedCount: job.processedCount + created + skipped + failed,
          createdCount: job.createdCount + created,
          skippedCount: job.skippedCount + skipped,
          failedCount: job.failedCount + failed,
          phase: "Waiting for card rate limit",
          updatedAt: Date.now(),
        });
        return {
          retryAt: outcome.retryAt ?? Date.now() + 60_000,
          limitReached: false,
        };
      }
      await ctx.db.patch(itemId, {
        status: "failed",
        failureCode: outcome.code ?? "CREATE_FAILED",
        failureReason: outcome.message ?? "Import failed",
        updatedAt: Date.now(),
      });
      failed += 1;
      if (outcome.code === "CARD_LIMIT_REACHED") {
        await ctx.db.patch(jobId, {
          processedCount: job.processedCount + created + skipped + failed,
          createdCount: job.createdCount + created,
          skippedCount: job.skippedCount + skipped,
          failedCount: job.failedCount + failed,
          updatedAt: Date.now(),
        });
        return { limitReached: true };
      }
    }
    await ctx.db.patch(jobId, {
      processedCount: job.processedCount + created + skipped + failed,
      createdCount: job.createdCount + created,
      skippedCount: job.skippedCount + skipped,
      failedCount: job.failedCount + failed,
      updatedAt: Date.now(),
    });
    return { limitReached: false };
  },
});

/** Legacy staging: jobs queued before `stagedItems`. See `.agents/sunset.md`. */
export const failItems = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    itemIds: v.array(v.id("importJobItems")),
    code: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, itemIds, code, reason }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return null;
    }
    let count = 0;
    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId);
      if (item?.jobId === jobId && item.status === "pending") {
        await ctx.db.patch(itemId, {
          status: "failed",
          failureCode: code,
          failureReason: reason,
          updatedAt: Date.now(),
        });
        count += 1;
      }
    }
    await ctx.db.patch(jobId, {
      processedCount: job.processedCount + count,
      failedCount: job.failedCount + count,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** Legacy staging: jobs queued before `stagedItems`. See `.agents/sunset.md`. */
export const setExtractedFile = internalMutation({
  args: { itemId: v.id("importJobItems"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId, key }) => {
    const item = await ctx.db.get(itemId);
    if (!item) {
      throw new Error("Import item not found");
    }
    await assertAccountNotDeleting(ctx, item.userId);
    await ctx.db.patch(itemId, {
      extractedFileKey: key,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const finishJob = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    status: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("canceled")
    ),
    reportKey: v.optional(v.string()),
    failureClass: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, status, reportKey, failureClass }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    await assertAccountNotDeleting(ctx, job.userId);
    let phase = "Import failed";
    if (status === "completed") {
      phase = "Import complete";
    } else if (status === "canceled") {
      phase = "Import canceled";
    }
    await ctx.db.patch(jobId, {
      status,
      phase,
      reportKey,
      failureClass,
      completionClaim: undefined,
      uploadId: undefined,
      uploadExpiresAt: undefined,
      uploadedParts: undefined,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const getFailureReportRows = internalQuery({
  args: {
    jobId: v.id("importJobs"),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.any(),
  handler: (ctx, { jobId, cursor, limit }) =>
    ctx.db
      .query("importJobItems")
      .withIndex("by_job_status_source", (q) =>
        q.eq("jobId", jobId).eq("status", "failed")
      )
      .paginate({ cursor, numItems: limit }),
});

export const findExpiredUploads = internalQuery({
  args: { now: v.number(), limit: v.number() },
  returns: v.array(
    v.object({
      _id: v.id("importJobs"),
      sourceKey: v.string(),
      uploadId: v.optional(v.string()),
    })
  ),
  handler: async (ctx, { now, limit }) =>
    (
      await ctx.db
        .query("importJobs")
        .withIndex("by_status_upload_expires", (q) =>
          q.eq("status", "uploading").lt("uploadExpiresAt", now)
        )
        .take(limit)
    )
      .filter((job) => (job.completionClaim?.expiresAt ?? 0) <= now)
      .map(({ _id, sourceKey, uploadId }) => ({ _id, sourceKey, uploadId })),
});

/**
 * Fails an import whose upload expired, once the Files Worker has aborted its
 * multipart upload, and queues the source for deletion. A job that is no
 * longer an expired upload is left alone, so a repeated run does nothing.
 */
export const expireAbandonedUpload = internalMutation({
  args: { jobId: v.id("importJobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    const expiresAt = job?.uploadExpiresAt;
    if (
      job?.status !== "uploading" ||
      !expiresAt ||
      expiresAt >= Date.now() ||
      (job.completionClaim?.expiresAt ?? 0) > Date.now()
    ) {
      return false;
    }
    await assertAccountNotDeleting(ctx, job.userId);
    await queueObjectDeletion(ctx, job.sourceKey);
    await ctx.db.patch(jobId, {
      status: "failed",
      phase: "Import failed",
      failureClass: "upload_expired",
      completionClaim: undefined,
      uploadId: undefined,
      uploadExpiresAt: undefined,
      uploadedParts: undefined,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const deleteItemsPage = internalMutation({
  args: { jobId: v.id("importJobs"), limit: v.number() },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { jobId, limit }) => {
    const job = await ctx.db.get(jobId);
    if (job) {
      await assertAccountNotDeleting(ctx, job.userId);
    }
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
      .take(limit);
    for (const item of items) {
      await assertAccountNotDeleting(ctx, item.userId);
      await ctx.db.delete(item._id);
    }
    return { count: items.length };
  },
});

export const deleteJob = internalMutation({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (job) {
      await assertAccountNotDeleting(ctx, job.userId);
      await ctx.db.delete(jobId);
    }
    return null;
  },
});
