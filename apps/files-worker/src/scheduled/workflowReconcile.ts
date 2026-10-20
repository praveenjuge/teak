import { internal } from "@teak/convex/_generated/api";
import { isWorkflowName } from "@teak/files-protocol";
import type { ConvexRpc } from "../convexRpc";
import {
  isMissingInstance,
  type WorkflowBindingsEnv,
  workflowBinding,
} from "../workflows/dispatch";

const STALE_PAGE = 200;
const MAX_PRUNE_PAGES = 10;

export interface ReconcileSummary {
  checked: number;
  completed: number;
  errored: number;
  pruned: number;
  running: number;
}

type Ending =
  | { error: string; status: "errored" }
  | { status: "complete" }
  | { status: "running" };

const endingOf = async (
  binding: Workflow,
  instanceId: string
): Promise<Ending> => {
  let instance: WorkflowInstance;
  try {
    instance = await binding.get(instanceId);
  } catch (error) {
    if (isMissingInstance(error)) {
      return { error: "instance_missing", status: "errored" };
    }
    throw error;
  }
  const { error, status } = await instance.status();
  switch (status) {
    case "complete":
      return { status: "complete" };
    case "errored":
    case "terminated":
      return {
        error: (error?.message || status).slice(0, 300),
        status: "errored",
      };
    default:
      return { status: "running" };
  }
};

export const reconcileWorkflows = async (
  env: WorkflowBindingsEnv,
  convex: ConvexRpc
): Promise<ReconcileSummary> => {
  const summary: ReconcileSummary = {
    checked: 0,
    completed: 0,
    errored: 0,
    pruned: 0,
    running: 0,
  };
  const stale = await convex.query(internal.workflowDispatch.listStale, {
    limit: STALE_PAGE,
  });
  for (const { instanceId, workflow } of stale) {
    const binding = isWorkflowName(workflow)
      ? workflowBinding(env, workflow)
      : undefined;
    if (!binding) {
      continue;
    }
    summary.checked += 1;
    let ending: Ending;
    try {
      ending = await endingOf(binding, instanceId);
    } catch (error) {
      console.error("[reconcile] instance lookup failed", {
        error: error instanceof Error ? error.message : String(error),
        instanceId,
      });
      continue;
    }
    if (ending.status === "running") {
      summary.running += 1;
      continue;
    }
    await convex.mutation(internal.workflowDispatch.complete, {
      instanceId,
      status: ending.status,
      ...(ending.status === "errored" ? { error: ending.error } : {}),
    });
    summary[ending.status === "complete" ? "completed" : "errored"] += 1;
  }
  for (let page = 0; page < MAX_PRUNE_PAGES; page += 1) {
    const { deleted, hasMore } = await convex.mutation(
      internal.workflowDispatch.pruneFinished,
      {}
    );
    summary.pruned += deleted;
    if (!hasMore) {
      break;
    }
  }
  return summary;
};
