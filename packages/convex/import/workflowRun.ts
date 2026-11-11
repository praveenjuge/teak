import { filesCardKeyPrefix, importInstanceId } from "@teak/files-protocol";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assertAccountNotDeleting,
  getAccountDeletionState,
} from "../accountDeletion/gate";
import { queueObjectDeletion } from "../storage/objectDeletion";
import { getR2KeyPrefix } from "../storage/r2Keys";
import {
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { ACTIVE_IMPORT_STATUSES } from "./constants";
import { importStagedPartKeys } from "./indexItems";

const PHASE_BY_END = {
  canceled: "Import canceled",
  completed: "Import complete",
  failed: "Import failed",
} as const;

export const finishImportJob = async (
  ctx: MutationCtx,
  {
    failureClass,
    jobId,
    reportKey,
    status,
  }: {
    failureClass?: string;
    jobId: Id<"importJobs">;
    reportKey?: string;
    status: keyof typeof PHASE_BY_END;
  }
): Promise<void> => {
  const job = await ctx.db.get("importJobs", jobId);
  if (!job) {
    throw new Error("Import job not found");
  }
  await assertAccountNotDeleting(ctx, job.userId);
  const now = Date.now();
  await ctx.db.patch("importJobs", jobId, {
    status,
    phase: PHASE_BY_END[status],
    reportKey,
    failureClass,
    completionClaim: undefined,
    uploadId: undefined,
    uploadExpiresAt: undefined,
    uploadedParts: undefined,
    completedAt: now,
    updatedAt: now,
  });
};

/**
 * An import whose workflow died fails, and the parts it staged in R2 are
 * deleted: no run will read them again. While its account is being deleted
 * the job is left to account deletion, which cancels it.
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
  if (!(await getAccountDeletionState(ctx, job.userId))) {
    await finishImportJob(ctx, {
      failureClass: "import_workflow_failed",
      jobId,
      status: "failed",
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
