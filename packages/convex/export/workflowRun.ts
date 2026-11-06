import type { Infer } from "convex/values";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { exportRunParamsValidator } from "../schema/validators/dispatch";
import { ACTIVE_EXPORT_STATUSES, EXPORT_FAILURE_CLASS } from "./constants";

/** An export whose workflow died fails, unless it already finished. */
export const failExportRun = async (
  ctx: MutationCtx,
  { jobId }: Infer<typeof exportRunParamsValidator>
): Promise<void> => {
  const job = await ctx.db.get("exportJobs", jobId);
  if (job && (ACTIVE_EXPORT_STATUSES as string[]).includes(job.status)) {
    await ctx.runMutation(internal.dataExport.failExport, {
      failureClass: EXPORT_FAILURE_CLASS.UNKNOWN,
      jobId,
    });
  }
};
