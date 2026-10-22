import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  action,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
  query,
} from "./_generated/server";
import {
  buildArtifactKey,
  exportArtifactObjectKeys,
} from "./export/artifactKey";
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
import { readLiveFolders } from "./folder/folders";
import { requireSessionUserId } from "./securitySessions";
import { getR2Url } from "./storage/fileUrls";
import { enqueueObjectDeletion, queueExportWorkflow } from "./workflowDispatch";

const RECENT_JOBS_SCAN = 50;

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
  processedCount: v.optional(v.number()),
  stage: v.optional(v.union(v.literal("snapshotting"), v.literal("archiving"))),
  failureClass: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
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

type ExportCardRow = Pick<
  Doc<"cards">,
  | "_id"
  | "aiSummary"
  | "aiTags"
  | "colors"
  | "completedAt"
  | "content"
  | "createdAt"
  | "fileKey"
  | "fileMetadata"
  | "folderIds"
  | "isArchived"
  | "isFavorited"
  | "isHidden"
  | "metadataTitle"
  | "notes"
  | "sourceTitle"
  | "sourceUrl"
  | "tags"
  | "type"
  | "updatedAt"
  | "url"
>;

interface ExportJobDoc {
  _id: Id<"exportJobs">;
  artifactBytes?: number;
  artifactKey?: string;
  cancelRequested?: boolean;
  cardCount?: number;
  completedAt?: number;
  createdAt: number;
  expiresAt?: number;
  failureClass?: string;
  filesIncluded?: number;
  filesOmitted?: number;
  processedCount?: number;
  quotaCountedAt?: number;
  stage?: "snapshotting" | "archiving";
  status: string;
  updatedAt: number;
  userId: string;
}

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
    processedCount: job.processedCount,
    stage: job.stage,
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
      latest =
        latest === undefined
          ? job.quotaCountedAt
          : Math.max(latest, job.quotaCountedAt);
    }
  }
  return latest;
}

const latestExportValidator = v.object({
  job: v.union(v.null(), exportSummaryValidator),
  canStartNew: v.boolean(),
  quotaResetMs: v.number(),
});

async function readLatestExport(ctx: QueryCtx, userId: string) {
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
}

async function startExportJob(ctx: MutationCtx, userId: string) {
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

  const workflowId = await queueExportWorkflow(ctx, jobId, userId);
  await ctx.db.patch(jobId, { workflowId });

  const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc;
  return { started: true, job: summarizeJob(job, now) };
}

export const getLatestExport = query({
  args: {},
  returns: v.union(v.null(), latestExportValidator),
  handler: async (ctx) => {
    let userId: string;
    try {
      userId = await requireSessionUserId(ctx);
    } catch {
      return null;
    }
    return await readLatestExport(ctx, userId);
  },
});

export const startExport = mutation({
  args: {},
  returns: startResultValidator,
  handler: async (ctx, _args) =>
    await startExportJob(ctx, await requireSessionUserId(ctx)),
});

export const getLatestExportForUser = internalQuery({
  args: { userId: v.string() },
  returns: latestExportValidator,
  handler: async (ctx, { userId }) => await readLatestExport(ctx, userId),
});

export const startExportForUser = internalMutation({
  args: { userId: v.string() },
  returns: startResultValidator,
  handler: async (ctx, { userId }) => await startExportJob(ctx, userId),
});

export const cancelExport = mutation({
  args: { jobId: v.id("exportJobs") },
  returns: v.object({ canceled: v.boolean() }),
  handler: async (ctx, { jobId }) => {
    const userId = await requireSessionUserId(ctx);
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
      status: EXPORT_STATUS.CANCELED,
      failureClass: EXPORT_FAILURE_CLASS.CANCELED,
      completedAt: now,
      updatedAt: now,
    });
    return { canceled: true };
  },
});

export async function readExportDownloadUrl(
  ctx: ActionCtx,
  userId: string,
  jobId: Id<"exportJobs">
): Promise<{ url: string; expiresInSeconds: number } | null> {
  const job = (await ctx.runQuery(internal.dataExport.getJob, {
    jobId,
  })) as ExportJobDoc | null;

  if (!job || job.userId !== userId) {
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
}

export const getExportDownloadUrl = action({
  args: { jobId: v.id("exportJobs") },
  returns: v.union(
    v.null(),
    v.object({ url: v.string(), expiresInSeconds: v.number() })
  ),
  handler: async (
    ctx,
    { jobId }
  ): Promise<{ url: string; expiresInSeconds: number } | null> =>
    await readExportDownloadUrl(ctx, await requireSessionUserId(ctx), jobId),
});

export const getJob = internalQuery({
  args: { jobId: v.id("exportJobs") },
  returns: v.any(),
  handler: async (ctx, { jobId }) => ctx.db.get(jobId),
});

export const markRunning = internalMutation({
  args: { jobId: v.id("exportJobs"), workflowId: v.optional(v.string()) },
  returns: v.object({
    canceled: v.boolean(),
    artifactKey: v.optional(v.string()),
  }),
  handler: async (ctx, { jobId, workflowId }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return { canceled: true };
    }
    if (job.cancelRequested || job.status === EXPORT_STATUS.CANCELED) {
      return { canceled: true };
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: EXPORT_STATUS.RUNNING,
      startedAt: now,
      updatedAt: now,
      ...(workflowId ? { workflowId } : {}),
    });
    return {
      canceled: false,
      artifactKey: await buildArtifactKey(job.userId, jobId, now),
    };
  },
});

export const recordExportProgress = internalMutation({
  args: {
    jobId: v.id("exportJobs"),
    processedCount: v.optional(v.number()),
    stage: v.optional(
      v.union(v.literal("snapshotting"), v.literal("archiving"))
    ),
  },
  returns: v.null(),
  handler: async (ctx, { jobId, processedCount, stage }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      return null;
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (processedCount !== undefined) {
      patch.processedCount = processedCount;
    }
    if (stage !== undefined) {
      patch.stage = stage;
    }
    await ctx.db.patch(jobId, patch);
    return null;
  },
});

/**
 * Snapshots a page as one `exportJobItems` row per card. Exports now use
 * `getExportSnapshotPage`; this stays for runs that snapshotted before, and for
 * a new Worker that reaches a Convex deployment without it
 * (`.agents/sunset.md`).
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
        ...(card.type !== "text" && card.fileKey
          ? { fileKey: card.fileKey }
          : {}),
        createdAt: now,
      });
      addedCount += 1;
      addedBytes +=
        card.type === "text" ? 0 : (card.fileMetadata?.fileSize ?? 0);
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      addedCount,
      addedBytes,
    };
  },
});

const toExportCardRow = (card: Doc<"cards">): ExportCardRow => ({
  _id: card._id,
  type: card.type,
  content: card.content,
  url: card.url,
  sourceUrl: card.sourceUrl,
  sourceTitle: card.sourceTitle,
  notes: card.notes,
  tags: card.tags,
  isFavorited: card.isFavorited,
  fileKey: card.type === "text" ? undefined : card.fileKey,
  fileMetadata: card.type === "text" ? undefined : card.fileMetadata,
  colors: card.colors,
  aiTags: card.aiTags,
  aiSummary: card.aiSummary,
  metadataTitle: card.metadataTitle,
  isArchived: card.isArchived,
  completedAt: card.completedAt,
  isHidden: card.isHidden,
  folderIds: card.folderIds,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

/**
 * One page of the cards an export takes, newest first. It writes nothing: the
 * export workflow keeps the ids in its own step results.
 */
export const getExportSnapshotPage = internalQuery({
  args: {
    jobId: v.id("exportJobs"),
    cursor: v.union(v.string(), v.null()),
    numItems: v.number(),
  },
  returns: v.object({
    cursor: v.union(v.string(), v.null()),
    isDone: v.boolean(),
    cardIds: v.array(v.id("cards")),
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

    const cardIds: Id<"cards">[] = [];
    let addedBytes = 0;
    for (const card of page.page) {
      if (!isActiveCard(card)) {
        continue;
      }
      cardIds.push(card._id);
      addedBytes +=
        card.type === "text" ? 0 : (card.fileMetadata?.fileSize ?? 0);
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      cardIds,
      addedBytes,
    };
  },
});

const MAX_EXPORT_CARDS_PER_READ = 200;

/**
 * The current contents of snapshotted cards, in the order given. Cards deleted
 * since the snapshot, or not the job owner's, are left out.
 */
export const getExportCardsByIds = internalQuery({
  args: { jobId: v.id("exportJobs"), cardIds: v.array(v.id("cards")) },
  returns: v.array(v.any()),
  handler: async (ctx, { jobId, cardIds }) => {
    if (cardIds.length > MAX_EXPORT_CARDS_PER_READ) {
      throw new Error("Too many cards in one read");
    }
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return [];
    }
    const cards: ExportCardRow[] = [];
    const fetched = await Promise.all(
      cardIds.map((cardId) => ctx.db.get(cardId))
    );
    for (const card of fetched) {
      if (card && card.userId === job.userId && isActiveCard(card)) {
        cards.push(toExportCardRow(card));
      }
    }
    return cards;
  },
});

/**
 * Reads cards through `exportJobItems` rows, which only `recordSnapshotPage`
 * writes (`.agents/sunset.md`).
 */
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

    const cards: ExportCardRow[] = [];
    const fetched = await Promise.all(
      page.page.map((item) => ctx.db.get(item.cardId))
    );
    for (const card of fetched) {
      if (!(card && isActiveCard(card))) {
        continue;
      }
      cards.push(toExportCardRow(card));
    }

    return {
      cursor: page.isDone ? null : page.continueCursor,
      isDone: page.isDone,
      cards,
    };
  },
});

export const getExportFolderNames = internalQuery({
  args: { jobId: v.id("exportJobs") },
  returns: v.array(v.object({ id: v.id("folders"), name: v.string() })),
  handler: async (ctx, { jobId }) => {
    const job = (await ctx.db.get(jobId)) as unknown as ExportJobDoc | null;
    if (!job) {
      return [];
    }
    return (await readLiveFolders(ctx, job.userId)).map((folder) => ({
      id: folder._id,
      name: folder.name,
    }));
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
    const job = (await ctx.db.get(
      args.jobId
    )) as unknown as ExportJobDoc | null;
    if (!job) {
      return null;
    }
    if (job.status === EXPORT_STATUS.CANCELED || job.cancelRequested === true) {
      await enqueueObjectDeletion(
        ctx,
        exportArtifactObjectKeys(args.artifactKey)
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

/** Drains `exportJobItems` rows left by older runs (`.agents/sunset.md`). */
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
