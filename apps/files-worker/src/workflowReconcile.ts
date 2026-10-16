import { internal } from "@teak/convex/_generated/api";
import { isWorkflowName } from "@teak/files-protocol";
import type { ConvexRpc } from "./convexRpc";
import {
  type WorkflowBindingsEnv,
  workflowBinding,
} from "./workflows/dispatch";

/**
 * The hourly reconcile for one deployment. Convex keeps a dispatch row per
 * workflow run until the run reports how it ended (`runReported`). A run
 * that died before it could report (terminated, errored past its report
 * step, or lost) would leave its job "running" forever, so this looks up
 * every run that has gone quiet for longer than its kind allows and reports
 * the ending on its behalf. Runs still going are left alone. Then it prunes
 * finished dispatch rows past retention.
 */

const STALE_PAGE = 200;
const MAX_PRUNE_PAGES = 10;

export interface ReconcileSummary {
  checked: number;
  completed: number;
  errored: number;
  pruned: number;
  running: number;
}

/** Workflows' `get` throws for an ID it has no instance for. */
const isMissingInstance = (error: unknown): boolean =>
  /not[\s._-]?found|does not exist/iu.test(
    error instanceof Error ? error.message : String(error)
  );

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
      // A lookup that failed for another reason is tried again next hour.
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
