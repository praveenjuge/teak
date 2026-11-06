import { filesCardKeyPrefix, importInstanceId } from "@teak/files-protocol";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { queueObjectDeletion } from "../storage/objectDeletion";
import { getR2KeyPrefix } from "../storage/r2Keys";
import { reportFromMutation } from "../telemetry/alerts";
import {
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { ACTIVE_IMPORT_STATUSES } from "./constants";
import { importStagedPartKeys } from "./indexItems";

/**
 * An import whose workflow died fails, and the parts it staged in R2 are
 * deleted: no run will read them again. A job that can't be finished (its
 * account is being deleted) is reported, and its parts still go.
 */
const failImportRun = async (
  ctx: MutationCtx,
  { params: { jobId } }: DispatchRow<"import">
): Promise<void> => {
  const job = await ctx.db.get("importJobs", jobId);
  if (
    !(job && (ACTIVE_IMPORT_STATUSES as readonly string[]).includes(job.status))
  ) {
    return;
  }
  try {
    await ctx.runMutation(internal.dataImport.finishJob, {
      failureClass: "import_workflow_failed",
      jobId,
      status: "failed",
    });
  } catch (error) {
    await reportFromMutation(ctx, "import_workflow_finish_failed", {
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        200
      ),
      job_id: jobId,
    });
  }
  await queueObjectDeletion(
    ctx,
    importStagedPartKeys(
      filesCardKeyPrefix(getR2KeyPrefix(), job.userId),
      jobId,
      job.stagedItems
    )
  );
};

export const queueImportWorkflow = async (
  ctx: MutationCtx,
  jobId: Id<"importJobs">
): Promise<string> => {
  const instanceId = importInstanceId(jobId);
  await insertDispatch(ctx, {
    instanceId,
    key: `import:${jobId}`,
    kind: "import",
    params: { jobId },
  });
  return instanceId;
};

export const importDispatch: DispatchKindSpec<"import"> = {
  delivery: "workflow",
  onFailure: failImportRun,
  staleAfterMs: 6 * 60 * 60 * 1000,
  workflow: "import",
};
