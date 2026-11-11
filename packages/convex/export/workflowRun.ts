import { exportInstanceId } from "@teak/files-protocol";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import {
  ACTIVE_EXPORT_STATUSES,
  EXPORT_FAILURE_CLASS,
  EXPORT_STATUS,
  type ExportFailureClass,
} from "./constants";

/** Ends an export as canceled or failed, for the reason `failureClass`. */
export const failExportJob = async (
  ctx: MutationCtx,
  jobId: Id<"exportJobs">,
  failureClass: ExportFailureClass
): Promise<void> => {
  const job = await ctx.db.get("exportJobs", jobId);
  if (!job) {
    return;
  }
  const now = Date.now();
  await ctx.db.patch("exportJobs", jobId, {
    status:
      failureClass === EXPORT_FAILURE_CLASS.CANCELED
        ? EXPORT_STATUS.CANCELED
        : EXPORT_STATUS.FAILED,
    failureClass,
    completedAt: now,
    updatedAt: now,
  });
};

/** An export whose workflow died fails, unless it already finished. */
const failExportRun = async (
  ctx: MutationCtx,
  { params: { jobId } }: DispatchRow<"export">
): Promise<void> => {
  const job = await ctx.db.get("exportJobs", jobId);
  if (job && (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status)) {
    await failExportJob(ctx, jobId, EXPORT_FAILURE_CLASS.UNKNOWN);
  }
};

export const queueExportWorkflow = async (
  ctx: MutationCtx,
  jobId: Id<"exportJobs">,
  userId: string
): Promise<string> => {
  const instanceId = exportInstanceId(jobId);
  await insertDispatch(ctx, {
    instanceId,
    key: `export:${jobId}`,
    kind: "export",
    params: { jobId, userId },
  });
  return instanceId;
};

export const exportDispatch: DispatchKindSpec<"export"> = {
  delivery: "workflow",
  onFailure: failExportRun,
  staleAfterMs: 2 * 60 * 60 * 1000,
  workflow: "export",
};
