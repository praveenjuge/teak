"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { type ActionCtx, internalAction } from "../_generated/server";
import { TELEMETRY_OPERATIONS } from "../shared/telemetry";
import { callFilesWorkerJson } from "../storage/filesWorkerClient";
import { buildR2UserPrefix } from "../storage/r2";
import { assertR2KeyInNamespace } from "../storage/r2Keys";
import { withBackendErrorCapture } from "../telemetry/posthog";
import { importStagedPartKeys } from "./indexItems";

const observeImport =
  <TArgs, TResult>(
    name: string,
    handler: (ctx: ActionCtx, args: TArgs) => Promise<TResult>
  ) =>
  (ctx: ActionCtx, args: TArgs): Promise<TResult> =>
    withBackendErrorCapture(
      {
        name,
        operation: TELEMETRY_OPERATIONS.import,
        stage: "import",
        surface: "backend",
        workflowId:
          args &&
          typeof args === "object" &&
          "jobId" in args &&
          typeof args.jobId === "string"
            ? args.jobId
            : undefined,
      },
      () => handler(ctx, args)
    );

async function abortImportUpload(key: string, uploadId?: string) {
  if (!uploadId) {
    return;
  }
  assertR2KeyInNamespace(key);
  const result = await callFilesWorkerJson({
    op: "abort-multipart",
    params: { key, uploadId },
  });
  if (result.kind !== "ok") {
    throw new Error("import_upload_abort_unavailable");
  }
}

async function queueImportObjectDeletion(
  ctx: ActionCtx,
  keys: Array<string | undefined>
) {
  await ctx.runMutation(internal.storage.objectDeletion.enqueue, {
    keys: keys.filter((key): key is string => Boolean(key)),
  });
}

async function queueUnclaimedImportFiles(ctx: ActionCtx, jobId: string) {
  let fileCursor: string | null = null;
  do {
    const files: {
      keys: string[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.dataImport.getUnclaimedFileKeysPage, {
      jobId,
      paginationOpts: { cursor: fileCursor, numItems: 200 },
    });
    await queueImportObjectDeletion(ctx, files.keys);
    fileCursor = files.isDone ? null : files.continueCursor;
  } while (fileCursor);
}

export const cleanupImportJob = internalAction({
  args: { jobId: v.id("importJobs") },
  returns: v.null(),
  handler: observeImport(
    "import.cleanup",
    async (ctx, { jobId }: { jobId: string }) => {
      const job = await ctx.runQuery(internal.dataImport.getJob, { jobId });
      if (!job) {
        return null;
      }
      await abortImportUpload(job.sourceKey, job.uploadId);
      await queueImportObjectDeletion(ctx, [
        job.sourceKey,
        job.reportKey,
        ...importStagedPartKeys(
          buildR2UserPrefix(job.userId),
          jobId,
          job.stagedItems
        ),
      ]);
      await queueUnclaimedImportFiles(ctx, jobId);
      for (;;) {
        const result = await ctx.runMutation(
          internal.dataImport.deleteItemsPage,
          { jobId, limit: 200 }
        );
        if (!result.count) {
          break;
        }
      }
      await ctx.runMutation(internal.dataImport.deleteJob, { jobId });
      return null;
    }
  ),
});

export const cleanupExpiredUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: observeImport(
    "import.cleanup_expired",
    async (ctx, _args: Record<string, never>) => {
      const jobs = await ctx.runQuery(internal.dataImport.findExpiredUploads, {
        now: Date.now(),
        limit: 50,
      });
      let failureCount = 0;
      for (const job of jobs) {
        try {
          await abortImportUpload(job.sourceKey, job.uploadId);
          await queueImportObjectDeletion(ctx, [job.sourceKey]);
          await ctx.runMutation(internal.dataImport.finishJob, {
            jobId: job._id,
            status: "failed",
            failureClass: "upload_expired",
          });
        } catch {
          failureCount += 1;
        }
      }
      if (failureCount) {
        throw new Error(
          `Import cleanup incomplete for ${failureCount} jobs; retry required`
        );
      }
      return null;
    }
  ),
});
