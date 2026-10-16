import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { enqueueObjectDeletion } from "../workflowDispatch";
import { assertR2KeyInNamespace } from "./r2Keys";

/**
 * Queues objects for deletion from an action. Mutations call
 * `enqueueObjectDeletion` directly, in the transaction that drops the rows
 * that referenced the objects.
 */
export const enqueue = internalMutation({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { keys }) => {
    const usable = keys.filter((key) => key.length > 0);
    for (const key of usable) {
      assertR2KeyInNamespace(key);
    }
    await enqueueObjectDeletion(ctx, usable);
    return null;
  },
});
