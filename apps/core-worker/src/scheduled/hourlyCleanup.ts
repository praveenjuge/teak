import { internal } from "@teak/convex/_generated/api";
import type { ConvexRpc } from "../convexRpc";
import type { FilesOpsEnv } from "../ops";
import { callFilesOp } from "../workflows/filesOps";

/** Convex returns at most this many expired uploads or sessions per call. */
const EXPIRED_PAGE = 50;
const MAX_PAGES = 100;

const drain = async (
  page: () => Promise<{ deleted: number; hasMore: boolean }>
): Promise<number> => {
  let deleted = 0;
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const result = await page();
    deleted += result.deleted;
    if (!result.hasMore) {
      break;
    }
  }
  return deleted;
};

const abortUpload = async (env: FilesOpsEnv, key: string, uploadId: string) => {
  const aborted = await callFilesOp(env, {
    op: "abort-multipart",
    params: { key, uploadId },
  });
  if (aborted.kind !== "ok") {
    throw new Error("upload_abort_unavailable");
  }
};

export const startIdempotencyCleanup = (convex: ConvexRpc) =>
  convex.mutation(internal.operationalRetention.startIdempotencyCleanup, {});

export const cleanUpSearchCaches = async (convex: ConvexRpc) => ({
  relevance: await drain(() =>
    convex.mutation(internal.search.relevanceCache.cleanupExpired, {})
  ),
  semantic: await drain(() =>
    convex.mutation(internal.search.semanticCache.cleanupExpired, {})
  ),
});

export const expireImportUploads = async (
  env: FilesOpsEnv,
  convex: ConvexRpc
): Promise<number> => {
  let expired = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const jobs = await convex.query(internal.dataImport.findExpiredUploads, {
      limit: EXPIRED_PAGE,
      now: Date.now(),
    });
    let pageExpired = 0;
    let failed = 0;
    for (const job of jobs) {
      try {
        if (job.uploadId) {
          await abortUpload(env, job.sourceKey, job.uploadId);
        }
        if (
          await convex.mutation(internal.dataImport.expireAbandonedUpload, {
            jobId: job._id,
          })
        ) {
          pageExpired += 1;
        }
      } catch (error) {
        failed += 1;
        console.error("[cron] import upload not expired", {
          error: error instanceof Error ? error.message : String(error),
          jobId: job._id,
        });
      }
    }
    expired += pageExpired;
    if (failed > 0) {
      throw new Error(
        `Import cleanup incomplete for ${failed} jobs; retry required`
      );
    }
    if (pageExpired < EXPIRED_PAGE) {
      break;
    }
  }
  return expired;
};

/**
 * Deletes expired upload sessions, aborting the multipart upload of any
 * still uploading. An abort that fails is left to the bucket's lifecycle.
 */
export const expireUploadSessions = async (
  env: FilesOpsEnv,
  convex: ConvexRpc
): Promise<number> => {
  let cleaned = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const sessions = await convex.query(
      internal.fileUploads.findExpiredSessions,
      { limit: EXPIRED_PAGE, now: Date.now() }
    );
    for (const session of sessions) {
      if (session.status === "uploading") {
        await abortUpload(env, session.sourceKey, session.uploadId).catch(
          () => undefined
        );
      }
      await convex.mutation(internal.fileUploads.deleteSession, {
        sessionId: session._id,
      });
      cleaned += 1;
    }
    if (sessions.length < EXPIRED_PAGE) {
      break;
    }
  }
  return cleaned;
};
