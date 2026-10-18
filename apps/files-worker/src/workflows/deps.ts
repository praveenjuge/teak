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

export const isTransientError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith("convex_rpc_unavailable");
