import { accountDeletionInstanceId } from "@teak/files-protocol";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { reportFromMutation } from "../telemetry/alerts";
import {
  type DispatchKindSpec,
  type DispatchRow,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { accountDeletionNeedsOperator } from "./stages";

/**
 * Each failed run is started again as a new attempt. Attempts are numbered
 * by when they were queued, not by counting earlier rows: those are pruned
 * after a week while Cloudflare keeps instances longer, and a reused ID
 * would never start.
 */
export const queueAccountDeletionWorkflow = async (
  ctx: MutationCtx,
  binding: { generation: number; stateId: Id<"accountDeletionStates"> },
  options: { delayMs?: number } = {}
): Promise<string> => {
  const key = `accountDeletion:${binding.stateId}:${binding.generation}`;
  const latest = await ctx.db
    .query("workflowDispatches")
    .withIndex("by_key_and_createdAt", (q) => q.eq("key", key))
    .order("desc")
    .first();
  const instanceId = accountDeletionInstanceId(
    binding.stateId,
    binding.generation,
    Math.max(Date.now(), (latest?.createdAt ?? 0) + 1)
  );
  await insertDispatch(ctx, {
    delayMs: options.delayMs,
    instanceId,
    key,
    kind: "accountDeletion",
    params: binding,
  });
  return instanceId;
};

const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = 6 * 60 * 60 * 1000;

export const accountDeletionRetryDelayMs = (failures: number): number =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));

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
const retryAccountDeletionRun = async (
  ctx: MutationCtx,
  row: DispatchRow<"accountDeletion">
): Promise<void> => {
  const { generation, stateId } = row.params;
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

export const accountDeletionDispatch: DispatchKindSpec<"accountDeletion"> = {
  delivery: "workflow",
  onFailure: retryAccountDeletionRun,
  staleAfterMs: 6 * 60 * 60 * 1000,
  workflow: "account-deletion",
};
