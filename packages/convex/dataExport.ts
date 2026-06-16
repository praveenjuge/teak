/**
 * Export feature Convex functions.
 *
 * Public surface (all derive the authenticated user server-side):
 *   - getLatestExport      query    latest job summary + quota state
 *   - startExport          mutation create + kick off a background export
 *   - cancelExport         mutation request cancellation of the active job
 *   - getExportDownloadUrl action   short-lived signed download URL
 *
 * Internal surface (used by the workflow / cleanup cron):
 *   - getJob, getExportCardsPage, recordSnapshotPage
 *   - markRunning, completeExport, failExport, isCancelRequested
 *   - findExpiredReadyJobs, expireJob, deleteJobItemsPage
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  ACTIVE_EXPORT_STATUSES,
  DOWNLOAD_URL_TTL_SECONDS,
  EXPORT_FAILURE_CLASS,
  EXPORT_STATUS,
} from "./export/constants";
import {
  computeExpiry,
  isActiveCard,
  isExpired,
  isWithinQuota,
  quotaResetInMs,
} from "./export/serialize";
import { getR2Url } from "./storage/r2";

const internalAny = internal as Record<string, any>;

const RECENT_JOBS_SCAN = 50;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const exportSummaryValidator = v.object({
  id: v.id("exportJobs"),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("ready"),
    v.literal("failed"),
    v.literal("canceled"),
    v.literal("expired")
  ),
  cardCount: v.optional(v.number()),
  filesIncluded: v.optional(v.number()),
  filesOmitted: v.optional(v.number()),
  artifactBytes: v.optional(v.number()),
  failureClass: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  /** True when the artifact is ready and not yet expired. */
  downloadAvailable: v.boolean(),
});

const startResultValidator = v.object({
  started: v.boolean(),
  reason: v.optional(
    v.union(v.literal("quota_exceeded"), v.literal("already_active"))
  ),
  quotaResetMs: v.optional(v.number()),
  job: v.optional(exportSummaryValidator),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function requireUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const user = await ctx.auth.getUserIdentity();
  if (!user) {
    throw new Error("User must be authenticated");
  }
  return user.subject;
}

type ExportJobDoc = {
  _id: Id<"exportJobs">;
  status: string;
  cardCount?: number;
  filesIncluded?: number;
  filesOmitted?: number;
  artifactBytes?: number;
  artifactKey?: string;
  failureClass?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  expiresAt?: number;
  quotaCountedAt?: number;
  cancelRequested?: boolean;
  userId: string;
};

function summarizeJob(job: ExportJobDoc, nowMs: number) {
  return {
    id: job._id,
    status: job.status as
      | "pending"
      | "running"
      | "ready"
      | "failed"
      | "canceled"
      | "expired",
    cardCount: job.cardCount,
    filesIncluded: job.filesIncluded,
    filesOmitted: job.filesOmitted,
    artifactBytes: job.artifactBytes,
    failureClass: job.failureClass,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    expiresAt: job.expiresAt,
    downloadAvailable:
      job.status === EXPORT_STATUS.READY &&
      Boolean(job.artifactKey) &&
      !isExpired(job.expiresAt, nowMs),
  };
}

async function getRecentJobs(
  ctx: QueryCtx | MutationCtx,
  userId: string
): Promise<ExportJobDoc[]> {
  return (await ctx.db
    .query("exportJobs")
    .withIndex("by_user_created", (q) => q.eq("userId", userId))
    .order("desc")
    .take(RECENT_JOBS_SCAN)) as unknown as ExportJobDoc[];
}

function findActiveJob(jobs: ExportJobDoc[]): ExportJobDoc | undefined {
  return jobs.find((job) =>
    (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status)
  );
}

function findLastSuccessfulAt(jobs: ExportJobDoc[]): number | undefined {
  let latest: number | undefined;
  for (const job of jobs) {
    if (typeof job.quotaCountedAt === "number") {
      latest = latest === undefined ? job.quotaCountedAt : Math.max(latest, job.quotaCountedAt);
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export const getLatestExport = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      job: v.union(v.null(), exportSummaryValidator),
      canStartNew: v.boolean(),
      quotaResetMs: v.number(),
    })
  ),
  handler: async (ctx) => {
    let userId: string;
    try {
      userId = await requireUserId(ctx);
    } catch {
      return null;
    }

    const now = Date.now();
    const jobs = await getRecentJobs(ctx, userId);
    const latest = jobs[0];
    const lastSuccessfulAt = findLastSuccessfulAt(jobs);
    const active = findActiveJob(jobs);
    const canStartNew = !active && isWithinQuota(lastSuccessfulAt, now);

    return {
      job: latest ? summarizeJob(latest, now) : null,
      canStartNew,
      quotaResetMs: quotaResetInMs(lastSuccessfulAt, now),
    };
  },
});

export const startExport = mutation({
  args: {},
  returns: startResultValidator,
  handler: async (ctx, _args) => {
    const userId = await requireUserId(ctx);
    const now = Date.now();
    const jobs = await getRecentJobs(ctx, userId);

    const active = findActiveJob(jobs);
    if (active) {
      return {
        started: false,
        reason: "already_active" as const,
        job: summarizeJob(active, now),
      };
    }

    const lastSuccessfulAt = findLastSuccessfulAt(jobs);
    if (!isWithinQuota(lastSuccessfulAt, now)) {
      return {
        started: false,
        reason: "quota_exceeded" as const,
        quotaResetMs: quotaResetInMs(lastSuccessfulAt, now),
      };
    }

    const jobId = (await ctx.db.insert("exportJobs", {
      userId,
      status: EXPORT_STATUS.PENDING,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    })) as Id<"exportJobs">;

    await ctx.scheduler.runAfter(
      0,
      internalAny["workflows/export"].startExportWorkflow,
      { jobId }
    );

    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc;
    return { started: true, job: summarizeJob(job, now) };
  },
});

export const cancelExport = mutation({
  args: { jobId: v.id("exportJobs") },
  returns: v.object({ canceled: v.boolean() }),
  handler: async (ctx, { jobId }) => {
    const userId = await requireUserId(ctx);
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job || job.userId !== userId) {
      throw new Error("Export job not found");
    }

    const now = Date.now();
    const isActive = (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status);
    if (!isActive) {
      return { canceled: false };
    }

    await ctx.db.patch(jobId, {
      cancelRequested: true,
      // Pending jobs can be canceled immediately; running jobs flip to canceled
      // cooperatively but we mark intent now so the UI reflects it.
      status: EXPORT_STATUS.CANCELED,
      failureClass: EXPORT_FAILURE_CLASS.CANCELED,
      completedAt: now,
      updatedAt: now,
    });
    return { canceled: true };
  },
});

export const getExportDownloadUrl = action({
  args: { jobId: v.id("exportJobs") },
  returns: v.union(v.null(), v.object({ url: v.string(), expiresInSeconds: v.number() })),
  handler: async (ctx, { jobId }): Promise<{ url: string; expiresInSeconds: number } | null> => {
    const user = await ctx.auth.getUserIdentity();
    if (!user) {
      throw new Error("User must be authenticated");
    }

    const job = (await ctx.runQuery(internalAny.dataExport.getJob, {
      jobId,
    })) as ExportJobDoc | null;

    if (!job || job.userId !== user.subject) {
      throw new Error("Export job not found");
    }

    const now = Date.now();
    if (
      job.status !== EXPORT_STATUS.READY ||
      !job.artifactKey ||
      isExpired(job.expiresAt, now)
    ) {
      return null;
    }

    const url = await getR2Url(job.artifactKey);
    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  },
});

// ---------------------------------------------------------------------------
// Internal functions (workflow + cleanup)
// ---------------------------------------------------------------------------

export const getJob = internalQuery({
  args: { jobId: v.id("exportJobs") },
  returns: v.any(),
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const markRunning = internalMutation({
  args: { jobId: v.id("exportJobs"), workflowId: v.optional(v.string()) },
  returns: v.object({ canceled: v.boolean() }),
  handler: async (ctx, { jobId, workflowId }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return { canceled: true };
    }
    if (job.cancelRequested || job.status === EXPORT_STATUS.CANCELED) {
      return { canceled: true };
    }
    await ctx.db.patch(jobId, {
      status: EXPORT_STATUS.RUNNING,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      ...(workflowId ? { workflowId } : {}),
    });
    return { canceled: false };
  },
});

/**
 * Snapshot one page of the user's active cards into exportJobItems. Returns the
 * pagination cursor and running totals so the workflow can enforce caps without
 * loading the whole library at once.
 */
export const recordSnapshotPage = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    addedCount: v.number(),
    addedBytes: v.number(),
  }),
  handler: async (ctx, { jobId, cursor, numItems }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      throw new Error("Export job not found");
    }

    const page = await ctx.db
      .query("cards")
      .withIndex("by_created", (q) => q.eq("userId", job.userId))
      .order("desc")
      .paginate({ cursor, numItems });

    let addedCount = 0;
    let addedBytes = 0;
    const now = Date.now();

    for (const card of page.page) {
      if (!isActiveCard(card)) {
        continue;
      }
      await ctx.db.insert("exportJobItems", {
        jobId,
        userId: job.userId,
        cardId: card._id,
        ...(card.fileKey ? { fileKey: card.fileKey } : {}),
        createdAt: now,
      });
      addedCount += 1;
      addedBytes += card.fileMetadata?.fileSize ?? 0;
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      addedCount,
      addedBytes,
    };
  },
});

/** Page through snapshot items, joining each to its (active) card document. */
export const getExportCardsPage = internalQuery({
  args: {
    jobId: v.id("exportJobs"),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    cards: v.array(v.any()),
  }),
  handler: async (ctx, { jobId, cursor, numItems }) => {
    const page = await ctx.db
      .query("exportJobItems")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .paginate({ cursor, numItems });

    const cards: any[] = [];
    for (const item of page.page) {
      const card = await ctx.db.get(item.cardId);
      if (!card || !isActiveCard(card)) {
        continue;
      }
      cards.push({
        _id: card._id,
        type: card.type,
        content: card.content,
        url: card.url,
        notes: card.notes,
        tags: card.tags,
        isFavorited: card.isFavorited,
        fileKey: card.fileKey,
        fileMetadata: card.fileMetadata,
        colors: card.colors,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      });
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      cards,
    };
  },
});

export const completeExport = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    artifactKey: v.string(),
    artifactBytes: v.number(),
    cardCount: v.number(),
    filesIncluded: v.number(),
    filesOmitted: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = (await ctx.db.get(args.jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return null;
    }
    // If the job was canceled while the archive was being built/uploaded, do not
    // resurrect it as "ready". Discard the just-written artifact instead so it
    // doesn't linger in R2, and leave the canceled state (and quota) untouched.
    if (
      job.status === EXPORT_STATUS.CANCELED ||
      job.cancelRequested === true
    ) {
      await ctx.scheduler.runAfter(
        0,
        internalAny["export/runExport"].deleteArtifact,
        { artifactKey: args.artifactKey }
      );
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: EXPORT_STATUS.READY,
      artifactKey: args.artifactKey,
      artifactBytes: args.artifactBytes,
      cardCount: args.cardCount,
      filesIncluded: args.filesIncluded,
      filesOmitted: args.filesOmitted,
      completedAt: now,
      quotaCountedAt: now,
      expiresAt: computeExpiry(now),
      updatedAt: now,
    });
    return null;
  },
});

export const failExport = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    failureClass: v.union(
      v.literal("cap_exceeded"),
      v.literal("archive_failed"),
      v.literal("storage_failed"),
      v.literal("canceled"),
      v.literal("unknown")
    ),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, failureClass }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return null;
    }
    const now = Date.now();
    const status =
      failureClass === EXPORT_FAILURE_CLASS.CANCELED
        ? EXPORT_STATUS.CANCELED
        : EXPORT_STATUS.FAILED;
    await ctx.db.patch(jobId, {
      status,
      failureClass,
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const isCancelRequested = internalQuery({
  args: { jobId: v.id("exportJobs") },
  returns: v.boolean(),
  handler: async (ctx, { jobId }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    return Boolean(
      !job || job.cancelRequested || job.status === EXPORT_STATUS.CANCELED
    );
  },
});

/** Find ready jobs whose artifact has expired, for cleanup. */
export const findExpiredReadyJobs = internalQuery({
  args: { nowMs: v.number(), limit: v.number() },
  returns: v.array(
    v.object({ _id: v.id("exportJobs"), artifactKey: v.optional(v.string()) })
  ),
  handler: async (ctx, { nowMs, limit }) => {
    const candidates = await ctx.db
      .query("exportJobs")
      .withIndex("by_status_expires", (q) =>
        q.eq("status", EXPORT_STATUS.READY).lte("expiresAt", nowMs)
      )
      .take(limit);
    return candidates.map((job) => ({
      _id: job._id,
      artifactKey: job.artifactKey,
    }));
  },
});

/** Mark a job expired (artifact deletion handled by the caller action). */
export const expireJob = internalMutation({
  args: { jobId: v.id("exportJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: EXPORT_STATUS.EXPIRED,
      artifactKey: undefined,
      updatedAt: now,
    });
    return null;
  },
});

/** Delete a page of snapshot items for a job. Returns whether more remain. */
export const deleteJobItemsPage = internalMutation({
  args: { jobId: v.id("exportJobs"), numItems: v.number() },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, { jobId, numItems }) => {
    const items = await ctx.db
      .query("exportJobItems")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(numItems);
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    return { deleted: items.length, hasMore: items.length === numItems };
  },
});
