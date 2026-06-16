/**
 * Scheduled cleanup for expired export artifacts.
 *
 * For each ready job whose retention window has passed:
 *   - delete the ZIP artifact from R2
 *   - remove any leftover snapshot items
 *   - mark the job expired (and drop the artifact key)
 *
 * Reschedules itself while a full batch is processed.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { workflow } from "./manager";

const internalWorkflow = internal as Record<string, any>;

const BATCH_SIZE = 25;
const ITEM_CLEANUP_PAGE_SIZE = 200;
const WORKFLOW_LOG_PREFIX = "[workflow/exportCleanup]";

export const exportCleanupWorkflow = workflow.define({
  args: {},
  returns: v.object({ expiredCount: v.number(), hasMore: v.boolean() }),
  handler: async (step) => {
    const now = Date.now();
    const expired = await step.runQuery(
      internalWorkflow.dataExport.findExpiredReadyJobs,
      { nowMs: now, limit: BATCH_SIZE }
    );

    if (expired.length === 0) {
      return { expiredCount: 0, hasMore: false };
    }

    let expiredCount = 0;
    for (const job of expired) {
      if (job.artifactKey) {
        await step.runAction(
          internalWorkflow["export/runExport"].deleteArtifact,
          { artifactKey: job.artifactKey }
        );
      }
      for (;;) {
        const result = await step.runMutation(
          internalWorkflow.dataExport.deleteJobItemsPage,
          { jobId: job._id, numItems: ITEM_CLEANUP_PAGE_SIZE }
        );
        if (!result.hasMore) {
          break;
        }
      }
      await step.runMutation(internalWorkflow.dataExport.expireJob, {
        jobId: job._id,
      });
      expiredCount += 1;
    }

    const hasMore = expired.length === BATCH_SIZE;
    if (hasMore) {
      await step.runMutation(
        internalWorkflow["workflows/exportCleanup"].startExportCleanupWorkflow,
        { startAsync: true }
      );
    }

    if (expiredCount > 0) {
      console.info(`${WORKFLOW_LOG_PREFIX} expired ${expiredCount} exports`);
    }

    return { expiredCount, hasMore };
  },
});

export const startExportCleanupWorkflow = internalMutation({
  args: { startAsync: v.optional(v.boolean()) },
  returns: v.union(
    v.object({ workflowId: v.string() }),
    v.object({ expiredCount: v.number(), hasMore: v.boolean() })
  ),
  handler: async (ctx, { startAsync }) => {
    const result = await workflow.start(
      ctx,
      internalWorkflow["workflows/exportCleanup"].exportCleanupWorkflow,
      {},
      { startAsync: startAsync ?? true }
    );
    if (typeof result === "string") {
      return { workflowId: result };
    }
    return result;
  },
});
