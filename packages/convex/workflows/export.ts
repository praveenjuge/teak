/**
 * Durable export workflow.
 *
 * Orchestration (each step is retried/durable via @convex-dev/workflow):
 *   1. markRunning (honors pre-start cancellation)
 *   2. snapshot the user's active cards into exportJobItems, page by page,
 *      enforcing the V1 caps (10,000 cards / 5 GB estimated)
 *   3. run the Node archive action (reads R2, builds ZIP, writes artifact)
 *   4. complete or fail the job
 *
 * Cancellation is cooperative: the workflow checks the job's cancelRequested
 * flag between phases and the Node action re-checks before persisting.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import {
  EXPORT_FAILURE_CLASS,
  MAX_EXPORT_BYTES,
  MAX_EXPORT_CARDS,
} from "../export/constants";
import { workflow } from "./manager";

const internalWorkflow = internal as Record<string, any>;

const SNAPSHOT_PAGE_SIZE = 200;
const PER_CARD_JSON_BYTES = 2 * 1024;
const ITEM_CLEANUP_PAGE_SIZE = 200;
const WORKFLOW_LOG_PREFIX = "[workflow/export]";

async function cleanupItems(step: any, jobId: string) {
  for (;;) {
    const result = await step.runMutation(
      internalWorkflow.dataExport.deleteJobItemsPage,
      { jobId, numItems: ITEM_CLEANUP_PAGE_SIZE }
    );
    if (!result.hasMore) {
      break;
    }
  }
}

export const exportWorkflow = workflow.define({
  args: { jobId: v.id("exportJobs"), userId: v.string() },
  returns: v.object({
    status: v.union(
      v.literal("ready"),
      v.literal("failed"),
      v.literal("canceled")
    ),
  }),
  handler: async (step, { jobId, userId }) => {
    const running = await step.runMutation(internalWorkflow.dataExport.markRunning, {
      jobId,
    });
    if (running.canceled) {
      await step.runMutation(internalWorkflow.dataExport.failExport, {
        jobId,
        failureClass: EXPORT_FAILURE_CLASS.CANCELED,
      });
      return { status: "canceled" as const };
    }

    // Phase 1: snapshot active cards with cap enforcement.
    let cursor: string | null = null;
    let totalCount = 0;
    let totalBytes = 0;
    for (;;) {
      const page: {
        cursor: string | null;
        isDone: boolean;
        addedCount: number;
        addedBytes: number;
      } = await step.runMutation(
        internalWorkflow.dataExport.recordSnapshotPage,
        { jobId, cursor, numItems: SNAPSHOT_PAGE_SIZE }
      );
      totalCount += page.addedCount;
      totalBytes += page.addedBytes;

      const estimatedBytes = totalBytes + totalCount * PER_CARD_JSON_BYTES;
      if (totalCount > MAX_EXPORT_CARDS || estimatedBytes > MAX_EXPORT_BYTES) {
        await cleanupItems(step, jobId);
        await step.runMutation(internalWorkflow.dataExport.failExport, {
          jobId,
          failureClass: EXPORT_FAILURE_CLASS.CAP_EXCEEDED,
        });
        console.warn(`${WORKFLOW_LOG_PREFIX} cap exceeded for job ${jobId}`);
        return { status: "failed" as const };
      }

      if (page.isDone) {
        break;
      }
      cursor = page.cursor;

      const canceled = await step.runQuery(
        internalWorkflow.dataExport.isCancelRequested,
        { jobId }
      );
      if (canceled) {
        await cleanupItems(step, jobId);
        await step.runMutation(internalWorkflow.dataExport.failExport, {
          jobId,
          failureClass: EXPORT_FAILURE_CLASS.CANCELED,
        });
        return { status: "canceled" as const };
      }
    }

    // Phase 2: build + store the archive (Node action).
    const archive = await step.runAction(
      internalWorkflow["export/runExport"].runExportArchive,
      { jobId, userId }
    );

    if (!archive.ok) {
      await cleanupItems(step, jobId);
      await step.runMutation(internalWorkflow.dataExport.failExport, {
        jobId,
        failureClass: archive.failureClass ?? EXPORT_FAILURE_CLASS.UNKNOWN,
      });
      return {
        status:
          archive.failureClass === EXPORT_FAILURE_CLASS.CANCELED
            ? ("canceled" as const)
            : ("failed" as const),
      };
    }

    await step.runMutation(internalWorkflow.dataExport.completeExport, {
      jobId,
      artifactKey: archive.artifactKey,
      artifactBytes: archive.artifactBytes,
      cardCount: archive.cardCount,
      filesIncluded: archive.filesIncluded,
      filesOmitted: archive.filesOmitted,
    });

    // Snapshot items are temporary; remove them once the artifact exists.
    await cleanupItems(step, jobId);

    return { status: "ready" as const };
  },
});

export const startExportWorkflow = internalMutation({
  args: { jobId: v.id("exportJobs") },
  returns: v.object({ workflowId: v.string() }),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new Error("Export job not found");
    }
    const workflowId = await workflow.start(
      ctx,
      internalWorkflow["workflows/export"].exportWorkflow,
      { jobId, userId: job.userId },
      { startAsync: true }
    );
    await ctx.db.patch(jobId, {
      workflowId: typeof workflowId === "string" ? workflowId : undefined,
      updatedAt: Date.now(),
    });
    return { workflowId: typeof workflowId === "string" ? workflowId : "" };
  },
});
