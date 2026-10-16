import type { WorkflowRun } from "./runtime";

/** The periodic jobs the maintenance workflow runs, one per instance. */
export const MAINTENANCE_TASKS = [
  "card-cleanup",
  "export-cleanup",
  "orphan-sweep",
] as const;
export type MaintenanceTask = (typeof MAINTENANCE_TASKS)[number];

export interface MaintenanceParams {
  task: MaintenanceTask;
}

export const runMaintenance = (
  _run: WorkflowRun<MaintenanceParams>
): Promise<unknown> => Promise.reject(new Error("not_implemented"));
