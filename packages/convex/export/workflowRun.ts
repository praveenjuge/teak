import { exportInstanceId } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { ACTIVE_EXPORT_STATUSES, EXPORT_FAILURE_CLASS } from "./constants";

/** An export whose workflow died fails, unless it already finished. */
const failExportRun = async (
  ctx: MutationCtx,
  { params: { jobId } }: DispatchRow<"export">
): Promise<void> => {
  const job = await ctx.db.get("exportJobs", jobId);
  if (job && (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status)) {
    await ctx.runMutation(internal.dataExport.failExport, {
      failureClass: EXPORT_FAILURE_CLASS.UNKNOWN,
      jobId,
    });
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
