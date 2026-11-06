import type { Infer } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { accountDeletionRunParamsValidator } from "../schema/validators/dispatch";
import { reportFromMutation } from "../telemetry/alerts";
import { queueAccountDeletionWorkflow } from "../workflowDispatch";

const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export const accountDeletionRetryDelayMs = (failures: number): number =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));

/**
 * Failures another attempt can't fix: the storage being deleted changed
 * under the run. An operator resolves it, then runs
 * `accountDeletionJobs:retry`.
 */
export const accountDeletionNeedsOperator = (failureCode?: string): boolean =>
  failureCode?.endsWith("_storage_source_changed") === true;

const consecutiveFailures = async (
  ctx: MutationCtx,
  key: string
): Promise<number> => {
  const recent = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
    .order("desc")
    .take(20);
  const firstOther = recent.findIndex((row) => row.state !== "failed");
  return firstOther === -1 ? recent.length : firstOther;
};

const hasNewerLiveAttempt = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">
): Promise<boolean> => {
  const newer = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) =>
      q.eq("key", row.key).gte("createdAt", row.createdAt)
    )
    // Newest first: a live attempt is the latest one queued.
    .order("desc")
    .take(20);
  return newer.some(
    (other) =>
      other._id !== row._id &&
      (other.state === "pending" || other.state === "sent")
  );
};

/**
 * A deletion whose run died starts again as a new attempt, backing off with
 * each failure in a row, unless an operator has to look first.
 */
export const retryAccountDeletionRun = async (
  ctx: MutationCtx,
  row: Doc<"workflowDispatches">,
  { generation, stateId }: Infer<typeof accountDeletionRunParamsValidator>
): Promise<void> => {
  const state = await ctx.db.get("accountDeletionStates", stateId);
  if (state?.generation !== generation) {
    return;
  }
  // A newer attempt already queued or running (an operator's `retry` while
  // this one ran) carries the deletion on: another attempt here would leave
  // two runs racing on the same stage for good.
  if (await hasNewerLiveAttempt(ctx, row)) {
    return;
  }
  if (accountDeletionNeedsOperator(state.failureCode)) {
    await reportFromMutation(ctx, "account_deletion_needs_operator", {
      failure_code: state.failureCode ?? "",
      state_id: stateId,
    });
    return;
  }
  const delayMs = accountDeletionRetryDelayMs(
    await consecutiveFailures(ctx, row.key)
  );
  await ctx.db.patch("accountDeletionStates", stateId, {
    nextAttemptAt: Date.now() + delayMs,
  });
  await queueAccountDeletionWorkflow(ctx, { generation, stateId }, { delayMs });
};
