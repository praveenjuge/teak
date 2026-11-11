import { NonRetryableError } from "cloudflare:workflows";
import { type ConvexRpc, ConvexRpcError } from "../convexRpc";
import { callFilesOp, type OpCaller } from "./filesOps";
import { convexFor, type WorkflowRun } from "./runtime";

export type { OpCaller } from "./filesOps";

/** A workflow's Convex and op callers; tests pass their own. */
export interface OpDeps {
  convex?: ConvexRpc;
  ops?: OpCaller;
}

export const resolveOpDeps = (
  run: WorkflowRun<unknown>,
  deps: OpDeps = {}
): { convex: ConvexRpc; ops: OpCaller } => ({
  convex: deps.convex ?? convexFor(run.env, run.params),
  ops: deps.ops ?? ((spec) => callFilesOp(run.env, spec)),
});

export const STEP_BUDGET_MS = 60_000;

export const withinBudget = (startedAt: number, budgetMs = STEP_BUDGET_MS) =>
  Date.now() - startedAt < budgetMs;

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
