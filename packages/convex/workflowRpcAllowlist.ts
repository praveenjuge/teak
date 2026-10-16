// The Convex functions the Files Worker's workflows and queues may call over
// the workflow RPC gateway (workflowGateway.ts). Anything else is refused,
// so the signing secret can't reach the rest of the backend's internal
// functions. Names are `path:export`, as `getFunctionName` gives them.
// Worker tests check every name they call is listed here.

export const WORKFLOW_RPC_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  // Workflow lifecycle (workflowDispatch.ts).
  "workflowDispatch:complete",
  "workflowDispatch:listStale",
  "workflowDispatch:pruneFinished",
  // Cron heartbeats for the tasks Cloudflare runs.
  "adminHealth:recordCronRun",
]);

export const isWorkflowRpcFunction = (name: string): boolean =>
  WORKFLOW_RPC_FUNCTIONS.has(name);
