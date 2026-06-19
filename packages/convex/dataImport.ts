import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  query,
} from "./_generated/server";
import { createCardForUserHandler } from "./card/createCard";
import {
  ACTIVE_IMPORT_STATUSES,
  IMPORT_FAILURE_SAMPLE_LIMIT,
} from "./import/constants";
import {
  cardTypeValidator,
  colorValidator,
  importModeValidator,
} from "./schema";

const internalAny = internal as Record<string, any>;
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
  sourceIndex: v.number(),
  status: v.union(
    v.literal("pending"),
    v.literal("skipped"),
    v.literal("failed")
  ),
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
  failureCode: v.optional(v.string()),
  failureReason: v.optional(v.string()),
});

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<any> };
}) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("User must be authenticated");
  }
  return identity.subject as string;
}

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
      userId = await requireUserId(ctx);
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
    const userId = await requireUserId(ctx);
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
        internalAny["import/runImport"].cleanupImportJob,
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
    await ctx.db.patch(jobId, { uploadId, updatedAt: Date.now() });
    return null;
  },
});

export const getJob = internalQuery({
  args: { jobId: v.id("importJobs") },
  returns: v.any(),
  handler: (ctx, { jobId }) => ctx.db.get(jobId),
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

export const markQueued = internalMutation({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.cancelRequested) {
      throw new Error("Import was canceled");
    }
    await ctx.db.patch(jobId, {
      status: "queued",
      phase: "Waiting to parse",
      uploadId: undefined,
      uploadExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internalAny["workflows/import"].startImportWorkflow,
      { jobId }
    );
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

export const insertItems = internalMutation({
  args: { jobId: v.id("importJobs"), items: v.array(itemInputValidator) },
  returns: v.null(),
  handler: async (ctx, { jobId, items }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
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

export const getItemsByIds = internalQuery({
  args: { jobId: v.id("importJobs"), itemIds: v.array(v.id("importJobItems")) },
  returns: v.any(),
  handler: async (ctx, { jobId, itemIds }) => {
    const items: Doc<"importJobItems">[] = [];
    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId);
      if (item?.jobId === jobId) {
        items.push(item);
      }
    }
    return items;
  },
});

function errorData(error: unknown) {
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === "object"
  ) {
    return error.data as { code?: string; message?: string; retryAt?: number };
  }
  return { message: error instanceof Error ? error.message : "Import failed" };
}

function existingUrl(ctx: MutationCtx, userId: string, url: string) {
  return ctx.db
    .query("cards")
    .withIndex("by_user_url_deleted", (q) =>
      q.eq("userId", userId).eq("url", url).eq("isDeleted", undefined)
    )
    .first();
}

export const createPendingBatch = internalMutation({
  args: { jobId: v.id("importJobs"), itemIds: v.array(v.id("importJobItems")) },
  returns: v.object({
    retryAt: v.optional(v.number()),
    limitReached: v.boolean(),
  }),
  handler: async (ctx, { jobId, itemIds }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Import job not found");
    }
    if (job.cancelRequested) {
      return { limitReached: false };
    }
    let created = 0,
      skipped = 0,
      failed = 0;
    for (const itemId of itemIds) {
      const item = await ctx.db.get(itemId);
      if (!item || item.jobId !== jobId || item.status !== "pending") {
        continue;
      }
      if (item.url && (await existingUrl(ctx, job.userId, item.url))) {
        await ctx.db.patch(itemId, {
          status: "skipped",
          failureCode: "DUPLICATE_URL",
          failureReason: "URL already exists",
          updatedAt: Date.now(),
        });
        skipped += 1;
        continue;
      }
      try {
        const cardId = await createCardForUserHandler(
          ctx,
          job.userId,
          {
            type: item.type,
            content: item.content,
            url: item.url,
            tags: item.tags,
            notes: item.notes,
            colors: item.colors,
            fileKey: item.extractedFileKey,
            metadata: item.extractedFileKey
              ? {
                  fileName: item.fileName,
                  fileSize: item.fileSize,
                  mimeType: item.mimeType,
                  duration: item.duration,
                  width: item.width,
                  height: item.height,
                }
              : undefined,
          },
          {
            importedVisibleFields: {
              createdAt: item.importedCreatedAt,
              isFavorited: item.isFavorited,
            },
            source: "import",
          }
        );
        await ctx.db.patch(itemId, {
          status: "created",
          cardId,
          updatedAt: Date.now(),
        });
        if (item.extractedFileKey) {
          await ctx.scheduler.runAfter(
            0,
            internal.storage.r2.syncUploadedObjectMetadata,
            { key: item.extractedFileKey }
          );
        }
        created += 1;
      } catch (error) {
        const data = errorData(error);
        if (data.code === "RATE_LIMITED") {
          await ctx.db.patch(jobId, {
            processedCount: job.processedCount + created + skipped + failed,
            createdCount: job.createdCount + created,
            skippedCount: job.skippedCount + skipped,
            failedCount: job.failedCount + failed,
            phase: "Waiting for card rate limit",
            updatedAt: Date.now(),
          });
          return {
            retryAt: data.retryAt ?? Date.now() + 60_000,
            limitReached: false,
          };
        }
        await ctx.db.patch(itemId, {
          status: "failed",
          failureCode: data.code ?? "CREATE_FAILED",
          failureReason: data.message ?? "Import failed",
          updatedAt: Date.now(),
        });
        failed += 1;
        if (data.code === "CARD_LIMIT_REACHED") {
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

export const failPendingPage = internalMutation({
  args: {
    jobId: v.id("importJobs"),
    code: v.string(),
    reason: v.string(),
    limit: v.number(),
  },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { jobId, code, reason, limit }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return { count: 0 };
    }
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_job_status_source", (q) =>
        q.eq("jobId", jobId).eq("status", "pending")
      )
      .take(limit);
    for (const item of items) {
      await ctx.db.patch(item._id, {
        status: "failed",
        failureCode: code,
        failureReason: reason,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(jobId, {
      processedCount: job.processedCount + items.length,
      failedCount: job.failedCount + items.length,
      updatedAt: Date.now(),
    });
    return { count: items.length };
  },
});

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

export const setExtractedFile = internalMutation({
  args: { itemId: v.id("importJobItems"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, { itemId, key }) => {
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
      uploadId: undefined,
      uploadExpiresAt: undefined,
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
  returns: v.any(),
  handler: (ctx, { now, limit }) =>
    ctx.db
      .query("importJobs")
      .withIndex("by_status_upload_expires", (q) =>
        q.eq("status", "uploading").lt("uploadExpiresAt", now)
      )
      .take(limit),
});

export const deleteItemsPage = internalMutation({
  args: { jobId: v.id("importJobs"), limit: v.number() },
  returns: v.object({ count: v.number() }),
  handler: async (ctx, { jobId, limit }) => {
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_job_source", (q) => q.eq("jobId", jobId))
      .take(limit);
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    return { count: items.length };
  },
});

export const deleteJob = internalMutation({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    if (await ctx.db.get(jobId)) {
      await ctx.db.delete(jobId);
    }
    return null;
  },
});
