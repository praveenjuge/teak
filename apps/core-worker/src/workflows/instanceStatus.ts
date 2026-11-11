import { errorMessage } from "../errors";

type InstanceState = InstanceStatus["status"];

const FINISHED: ReadonlySet<InstanceState> = new Set([
  "complete",
  "errored",
  "terminated",
]);

/**
 * The instance has stopped for good. Every other state, `unknown` included,
 * may still run, so a caller that must wait for a run to stop keeps waiting.
 */
export const isFinishedState = (state: InstanceState): boolean =>
  FINISHED.has(state);

/** Workflows' `get` throws for an ID it has no instance for. */
export const isMissingInstance = (error: unknown): boolean =>
  /not[\s._-]?found|does not exist/iu.test(errorMessage(error));

/** The instance's status, or null when Workflows has no such instance. */
export const readInstanceStatus = async (
  binding: Workflow,
  instanceId: string
): Promise<InstanceStatus | null> => {
  let instance: WorkflowInstance;
  try {
    instance = await binding.get(instanceId);
  } catch (error) {
    if (isMissingInstance(error)) {
      return null;
    }
    throw error;
  }
  return await instance.status();
};
