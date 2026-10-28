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
  const stillOpen: string[] = [];
  let unrecorded = 0;
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
      stillOpen.push(instanceId);
      continue;
    }
    if (ending.status === "running") {
      summary.running += 1;
      stillOpen.push(instanceId);
      continue;
    }
    try {
      await convex.mutation(internal.workflowDispatch.complete, {
        instanceId,
        status: ending.status,
        ...(ending.status === "errored" ? { error: ending.error } : {}),
      });
    } catch (error) {
      // One run Convex can't finish must not stop the others, the pruning
      // or the rotation: it moves to the back and the run reports it below.
      console.error("[reconcile] completion not recorded", {
        error: error instanceof Error ? error.message : String(error),
        instanceId,
      });
      unrecorded += 1;
      stillOpen.push(instanceId);
      continue;
    }
    summary[ending.status === "complete" ? "completed" : "errored"] += 1;
  }
  if (stillOpen.length > 0) {
    // Moves these runs behind the ones not checked yet. A Convex deployment
    // older than this Worker refuses the call; the reconcile works without it.
    await convex
      .mutation(internal.workflowDispatch.markReconciled, {
        instanceIds: stillOpen,
      })
      .catch((error: unknown) => {
        console.warn("[reconcile] could not record checked runs", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
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
  if (unrecorded > 0) {
    throw new Error(
      `reconcile_incomplete: ${String(unrecorded)} of ${String(summary.checked)} completions not recorded`
    );
  }
  return summary;
};
