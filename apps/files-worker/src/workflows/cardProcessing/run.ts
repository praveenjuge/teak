import type { WorkflowRun } from "../runtime";

export const runCardProcessing = (
  _run: WorkflowRun<Record<string, unknown>>
): Promise<unknown> => Promise.reject(new Error("not_implemented"));
