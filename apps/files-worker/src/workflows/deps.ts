import { NonRetryableError } from "cloudflare:workflows";
import type { FilesErrorCode, FilesOp } from "@teak/files-protocol";
import { type ConvexRpc, ConvexRpcError } from "../convexRpc";
import { callFilesOp, type FilesOpOutcome } from "./filesOps";
import { convexFor, type WorkflowRun } from "./runtime";

export type FilesOpCaller = <T>(spec: {
  fallbackCodes?: readonly FilesErrorCode[];
  op: FilesOp;
  params: Record<string, unknown>;
}) => Promise<FilesOpOutcome<T>>;

/**
 * What a workflow reaches outside itself. Production uses the run's
 * deployment and this Worker's own ops; tests pass a fake Convex and may wrap
 * the ops.
 */
export interface WorkflowDeps {
  convex?: ConvexRpc;
  ops?: FilesOpCaller;
}

export const resolveDeps = (
  run: WorkflowRun<unknown>,
  deps: WorkflowDeps = {}
): { convex: ConvexRpc; ops: FilesOpCaller } => ({
  convex: deps.convex ?? convexFor(run.env, run.params),
  ops: deps.ops ?? ((spec) => callFilesOp(run.env, spec)),
});

/** The op's data; throws `<failure>:<code>` when it declined. */
export const requireOp = async <T>(
  ops: FilesOpCaller,
  spec: { op: FilesOp; params: Record<string, unknown> },
  failure: string
): Promise<T> => {
  const outcome = await ops<T>(spec);
  if (outcome.kind !== "ok") {
    throw new Error(`${failure}:${outcome.code}`);
  }
  return outcome.data;
};

/** A step that keeps working through pages until it runs out of time. */
export const STEP_BUDGET_MS = 60_000;

export const withinBudget = (startedAt: number, budgetMs = STEP_BUDGET_MS) =>
  Date.now() - startedAt < budgetMs;

/**
 * A Convex function that threw gave its answer; retrying the step would ask
 * again. Only transport failures (`convex_rpc_unavailable`) retry.
 */
export const settleConvexErrors = async <T>(
  callback: () => Promise<T>
): Promise<T> => {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof ConvexRpcError) {
      throw new NonRetryableError(error.message);
    }
    throw error;
  }
};

/** Convex or the network was briefly out of reach; the step should retry. */
export const isTransientError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith("convex_rpc_unavailable");
