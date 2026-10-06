import { v } from "convex/values";
import { internal } from "../_generated/api";
import { workflow } from "./manager";

function storageFailureReason(
  error: unknown
): "storage_source_changed" | "object_write_pending" | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (error.message.includes("deletion_storage_source_changed")) {
    return "storage_source_changed";
  }
  if (error.message.includes("deletion_object_write_pending")) {
    return "object_write_pending";
  }
  return undefined;
}

// Every external operation is idempotent. Completed steps survive process failure;
// advancing a stage is guarded against stale callbacks and changed generations.
export const accountDeletionWorkflow = workflow.define({
  args: { stateId: v.id("accountDeletionStates"), generation: v.number() },
  returns: v.null(),
  handler: async (step, binding) => {
    for (let stage = 0; stage < 6; stage++) {
      const state = await step.runQuery(
        internal.accountDeletionJobs.getState,
        binding
      );
      if ((state.stage ?? 0) > stage) {
        continue;
      }
      try {
        let done = false;
        while (!done) {
          done = await step.runAction(
            internal.accountDeletionActions.runStage,
            { ...binding, stage },
            {
              name: `delete-account-stage-${stage}`,
              retry: { maxAttempts: 5, initialBackoffMs: 1000, base: 2 },
            }
          );
        }
      } catch (error) {
        const reason = storageFailureReason(error);
        await step.runMutation(internal.accountDeletionJobs.recordFailure, {
          ...binding,
          stage,
          ...(reason ? { reason } : {}),
        });
        throw error;
      }
      await step.runMutation(internal.accountDeletionJobs.advance, {
        ...binding,
        stage,
      });
    }
    await step.runMutation(internal.accountDeletionJobs.finalize, binding);
    return null;
  },
});
