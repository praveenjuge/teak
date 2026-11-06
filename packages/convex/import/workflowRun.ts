import { filesCardKeyPrefix } from "@teak/files-protocol";
import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { importRunParamsValidator } from "../schema/validators/dispatch";
import { getR2KeyPrefix } from "../storage/r2Keys";
import { reportFromMutation } from "../telemetry/alerts";
import { enqueueObjectDeletion } from "../workflowDispatch";
import { ACTIVE_IMPORT_STATUSES } from "./constants";
import { importStagedPartKeys } from "./indexItems";

/**
 * An import whose workflow died fails, and the parts it staged in R2 are
 * deleted: no run will read them again. A job that can't be finished (its
 * account is being deleted) is reported, and its parts still go.
 */
export const failImportRun = async (
  ctx: MutationCtx,
  { jobId }: Infer<typeof importRunParamsValidator>
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
  await enqueueObjectDeletion(
    ctx,
    importStagedPartKeys(
      filesCardKeyPrefix(getR2KeyPrefix(), job.userId),
      jobId,
      job.stagedItems
    )
  );
};
