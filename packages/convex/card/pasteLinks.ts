import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  query,
} from "../_generated/server";
import {
  getSessionUser,
  requireSessionUser,
  type TeakUserId,
} from "../securitySessions";
import {
  CARD_ERROR_CODES,
  LINK_PASTE_ACTIVE_CODE,
  LINK_PASTE_LIMIT,
  LINK_PASTE_MAX_INPUT,
} from "../shared/constants";
import { sanitizeExternalUrl, UnsafeUrlError } from "../shared/utils/safeUrl";
import { urlKey } from "../shared/utils/urlKey";
import { queueBackendEvent } from "../telemetry/schedule";
import { createCardForUserHandler } from "./createCard";

export const LINK_PASTE_BATCH = 10;
export const LINK_PASTE_RETRY_DELAYS_MS = [5000, 30_000, 120_000] as const;
export const LINK_PASTE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_PAGE = 200;

const FINISHED_STATUSES = ["done", "stopped_at_limit", "failed"] as const;

const PERMANENT_ERROR_CODES = new Set<string>([
  "INVALID_INPUT",
  "INVALID_STORAGE_KEY",
  CARD_ERROR_CODES.CONTENT_TOO_LARGE,
  CARD_ERROR_CODES.INVALID_UTF8,
]);

export interface NormalizedLinkPaste {
  omittedOverLimit: number;
  omittedRepeats: number;
  omittedUnsafe: number;
  urls: string[];
}

export const normalizePastedUrls = (lines: string[]): NormalizedLinkPaste => {
  const seen = new Set<string>();
  const kept: string[] = [];
  let omittedRepeats = 0;
  let omittedUnsafe = 0;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const url = sanitizeExternalUrl(line);
    if (!url) {
      omittedUnsafe += 1;
      continue;
    }
    const key = urlKey(url) ?? url;
    if (seen.has(key)) {
      omittedRepeats += 1;
      continue;
    }
    seen.add(key);
    kept.push(url);
  }
  return {
    urls: kept.slice(0, LINK_PASTE_LIMIT),
    omittedOverLimit: Math.max(0, kept.length - LINK_PASTE_LIMIT),
    omittedRepeats,
    omittedUnsafe,
  };
};

const errorCode = (error: unknown): string | undefined => {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === "object" && "code" in data) {
      return typeof data.code === "string" ? data.code : undefined;
    }
  }
  return undefined;
};

const retryAtOf = (error: unknown): number | undefined => {
  if (error instanceof ConvexError) {
    const data: unknown = error.data;
    if (data && typeof data === "object" && "retryAt" in data) {
      return typeof data.retryAt === "number" ? data.retryAt : undefined;
    }
  }
  return undefined;
};

type JobProgress = Pick<
  Doc<"linkPasteJobs">,
  "attempts" | "created" | "failed" | "nextIndex" | "resaved" | "status"
>;

const finish = async (
  ctx: MutationCtx,
  job: Doc<"linkPasteJobs">,
  progress: JobProgress,
  now: number
) => {
  await ctx.db.patch("linkPasteJobs", job._id, {
    ...progress,
    updatedAt: now,
    finishedAt: now,
  });
  if (progress.status === "done" || progress.status === "stopped_at_limit") {
    await queueBackendEvent(ctx, "link_paste_saved", job.userId, {
      count: job.total,
      created: progress.created,
      resaved: progress.resaved,
      stopped_at_limit: progress.status === "stopped_at_limit",
    });
  }
};

export const runLinkPasteBatch = async (
  ctx: MutationCtx,
  jobId: Id<"linkPasteJobs">
): Promise<void> => {
  const job = await ctx.db.get("linkPasteJobs", jobId);
  if (job?.status !== "running") {
    return;
  }
  const progress: JobProgress = {
    attempts: job.attempts,
    created: job.created,
    failed: job.failed,
    nextIndex: job.nextIndex,
    resaved: job.resaved,
    status: "running",
  };
  const next = () => {
    progress.nextIndex += 1;
    progress.attempts = 0;
  };
  let resumeAt: number | undefined;
  let saved = 0;
  while (saved < LINK_PASTE_BATCH && progress.nextIndex < job.urls.length) {
    const url = job.urls[progress.nextIndex];
    try {
      const { outcome } = await createCardForUserHandler(
        ctx,
        // Written from the signed-in session that started the job.
        job.userId as TeakUserId,
        { content: url, url },
        { source: "web" }
      );
      progress[outcome === "resaved" ? "resaved" : "created"] += 1;
      saved += 1;
      next();
    } catch (error) {
      const code = errorCode(error);
      const now = Date.now();
      if (code === CARD_ERROR_CODES.RATE_LIMITED) {
        resumeAt = Math.max(now, retryAtOf(error) ?? now + 1000);
        break;
      }
      if (code === CARD_ERROR_CODES.CARD_LIMIT_REACHED) {
        progress.status = "stopped_at_limit";
        break;
      }
      if (code === "ACCOUNT_DELETION_IN_PROGRESS") {
        progress.status = "failed";
        break;
      }
      if (
        error instanceof UnsafeUrlError ||
        (code !== undefined && PERMANENT_ERROR_CODES.has(code))
      ) {
        progress.failed += 1;
        next();
        continue;
      }
      if (progress.attempts >= LINK_PASTE_RETRY_DELAYS_MS.length) {
        console.error("[pasteLinks] gave up on a link", error);
        progress.failed += 1;
        next();
        continue;
      }
      resumeAt = now + LINK_PASTE_RETRY_DELAYS_MS[progress.attempts];
      progress.attempts += 1;
      break;
    }
  }

  const now = Date.now();
  if (progress.status === "running" && progress.nextIndex >= job.urls.length) {
    progress.status = "done";
  }
  if (progress.status !== "running") {
    await finish(ctx, job, progress, now);
    return;
  }
  await ctx.db.patch("linkPasteJobs", job._id, {
    ...progress,
    updatedAt: now,
  });
  if (resumeAt === undefined) {
    await ctx.scheduler.runAfter(0, internal.card.pasteLinks.processLinkPaste, {
      jobId,
    });
  } else {
    await ctx.scheduler.runAt(
      resumeAt,
      internal.card.pasteLinks.processLinkPaste,
      { jobId }
    );
  }
};

export const startLinkPaste = mutation({
  args: { urls: v.array(v.string()) },
  returns: v.object({ jobId: v.id("linkPasteJobs") }),
  handler: async (ctx, { urls }) => {
    const user = await requireSessionUser(ctx);
    const userId = user.teakUserId;
    if (urls.length > LINK_PASTE_MAX_INPUT) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Paste at most ${LINK_PASTE_MAX_INPUT} lines at a time`,
      });
    }
    const running = await ctx.db
      .query("linkPasteJobs")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "running")
      )
      .first();
    if (running) {
      throw new ConvexError({
        code: LINK_PASTE_ACTIVE_CODE,
        message: "Your last pasted links are still being saved",
      });
    }
    const normalized = normalizePastedUrls(urls);
    const now = Date.now();
    const jobId = await ctx.db.insert("linkPasteJobs", {
      userId,
      urls: normalized.urls,
      total: normalized.urls.length,
      omittedOverLimit: normalized.omittedOverLimit,
      omittedRepeats: normalized.omittedRepeats,
      omittedUnsafe: normalized.omittedUnsafe,
      nextIndex: 0,
      created: 0,
      resaved: 0,
      failed: normalized.omittedUnsafe,
      attempts: 0,
      status: "running",
      createdAt: now,
      updatedAt: now,
    });
    await runLinkPasteBatch(ctx, jobId);
    return { jobId };
  },
});

export const processLinkPaste = internalMutation({
  args: { jobId: v.id("linkPasteJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    await runLinkPasteBatch(ctx, jobId);
    return null;
  },
});

const linkPasteStatusValidator = v.union(
  v.literal("running"),
  v.literal("done"),
  v.literal("stopped_at_limit"),
  v.literal("failed")
);

export const getLinkPaste = query({
  args: { jobId: v.id("linkPasteJobs") },
  returns: v.union(
    v.null(),
    v.object({
      status: linkPasteStatusValidator,
      total: v.number(),
      processed: v.number(),
      created: v.number(),
      resaved: v.number(),
      failed: v.number(),
      omittedOverLimit: v.number(),
      omittedRepeats: v.number(),
    })
  ),
  handler: async (ctx, { jobId }) => {
    const user = await getSessionUser(ctx);
    if (!user) {
      return null;
    }
    const job = await ctx.db.get("linkPasteJobs", jobId);
    if (!job || job.userId !== user.teakUserId) {
      return null;
    }
    return {
      status: job.status,
      total: job.total,
      processed: job.nextIndex,
      created: job.created,
      resaved: job.resaved,
      failed: job.failed,
      omittedOverLimit: job.omittedOverLimit,
      omittedRepeats: job.omittedRepeats,
    };
  },
});

export const sweepFinishedLinkPastes = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const cutoff = Date.now() - LINK_PASTE_RETENTION_MS;
    let deleted = 0;
    let more = false;
    for (const status of FINISHED_STATUSES) {
      const page = await ctx.db
        .query("linkPasteJobs")
        .withIndex("by_status_finished", (q) =>
          q.eq("status", status).lt("finishedAt", cutoff)
        )
        .take(SWEEP_PAGE);
      for (const job of page) {
        await ctx.db.delete("linkPasteJobs", job._id);
      }
      deleted += page.length;
      more ||= page.length === SWEEP_PAGE;
    }
    if (more) {
      await ctx.scheduler.runAfter(
        0,
        internal.card.pasteLinks.sweepFinishedLinkPastes,
        {}
      );
    }
    return { deleted };
  },
});
