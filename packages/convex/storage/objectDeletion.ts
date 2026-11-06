import { MAX_DISPATCH_DELETE_KEYS } from "@teak/files-protocol";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  DEAD_LETTER_RETRY_MS,
  type DispatchKindSpec,
  insertDispatch,
} from "../workflowDispatch/outbox";
import { assertR2KeyInNamespace } from "./r2Keys";

/**
 * The one way to delete stored objects. The keys are queued in the workflow
 * dispatch outbox, in the same transaction as the change that orphaned
 * them, and the Core Worker deletes them. Missing and repeated keys are
 * skipped. A key outside this deployment's namespace throws: Teak only
 * deletes keys it built, so a foreign one is a bug to surface, not a key to
 * drop quietly.
 */
export const queueObjectDeletion = async (
  ctx: MutationCtx,
  keys: string | undefined | readonly (string | undefined)[]
): Promise<number> => {
  const listed = typeof keys === "object" ? keys : [keys];
  const usable = [
    ...new Set(listed.filter((key): key is string => Boolean(key))),
  ];
  for (const key of usable) {
    assertR2KeyInNamespace(key);
  }
  for (let i = 0; i < usable.length; i += MAX_DISPATCH_DELETE_KEYS) {
    await insertDispatch(ctx, {
      key: "deleteObjects",
      keys: usable.slice(i, i + MAX_DISPATCH_DELETE_KEYS),
      kind: "deleteObjects",
    });
  }
  return usable.length;
};

/** For actions, which can't write the outbox themselves. */
export const enqueue = internalMutation({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { keys }) => {
    await queueObjectDeletion(ctx, keys);
    return null;
  },
});

export const objectDeletionDispatch: DispatchKindSpec<"deleteObjects"> = {
  delivery: "delete-objects",
  // Keys a deletion gave up on are queued again a day later, so a Worker
  // outage longer than the retries delays a deletion instead of leaking it.
  onFailure: async (ctx, row) => {
    await insertDispatch(ctx, {
      delayMs: DEAD_LETTER_RETRY_MS,
      key: "deleteObjects",
      keys: row.keys ?? [],
      kind: "deleteObjects",
    });
  },
  // A sent deletion counts as delivered after this long.
  staleAfterMs: 60 * 60 * 1000,
};
