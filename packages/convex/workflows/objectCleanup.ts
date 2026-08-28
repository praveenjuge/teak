/**
 * Durable Object Deletion Workflow
 *
 * Replaces synchronous Convex R2 component deletes. The initiating mutation
 * atomically records the immutable object keys requiring cleanup (as durable
 * workflow arguments), then this workflow calls the Files Worker's
 * `delete-objects` op. Failures are retried by the workflow step and recorded
 * for operational visibility; already-deleted cards are never restored.
 */

import type { RetryBehavior } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "../storage/filesWorkerClient";
import { isR2KeyInNamespace } from "../storage/r2";
import { workflow } from "./manager";

const internalAny = internal as any;

// Retry up to five times with 500 ms initial backoff and a factor of two.
export const OBJECT_DELETION_STEP_RETRY: RetryBehavior = {
  base: 2,
  initialBackoffMs: 500,
  maxAttempts: 5,
};

// The Files Worker accepts at most 100 keys per delete-objects call.
const DELETE_BATCH_SIZE = 100;

export const deleteObjectsAction = internalAction({
  args: { keys: v.array(v.string()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (_ctx, { keys }) => {
    if (!isFilesWorkerConfigured()) {
      throw new Error("files_worker_not_configured");
    }
    const unique = Array.from(
      new Set(keys.filter((key) => key.length > 0 && isR2KeyInNamespace(key)))
    );
    if (unique.length !== keys.filter((key) => key.length > 0).length) {
      throw new Error("invalid_storage_key_namespace");
    }
    let deleted = 0;
    for (let index = 0; index < unique.length; index += DELETE_BATCH_SIZE) {
      const outcome = await callFilesWorkerJson<{ deleted: number }>({
        op: "delete-objects",
        params: { keys: unique.slice(index, index + DELETE_BATCH_SIZE) },
      });
      // NOT_FOUND-style fallbacks cannot occur: batch deletes treat missing
      // objects as success on the worker.
      if (outcome.kind !== "ok") {
        throw new Error("files_worker_delete_objects_unavailable");
      }
      deleted += outcome.data.deleted;
    }
    return { deleted };
  },
});

export const recordObjectDeletionFailure = internalMutation({
  args: {
    error: v.string(),
    keys: v.array(v.string()),
  },
  returns: v.null(),
  handler: (_ctx, { error, keys }) => {
    console.error(
      "[workflow/objectCleanup] Permanent storage object deletion failed",
      { count: keys.length, error, keys }
    );
    return null;
  },
});

export const objectDeletionWorkflow: any = workflow.define({
  args: {
    keys: v.array(v.string()),
  },
  returns: v.object({
    deleted: v.boolean(),
  }),
  handler: async (step, { keys }: { keys: string[] }) => {
    try {
      await step.runAction(
        internalAny["workflows/objectCleanup"].deleteObjectsAction,
        { keys },
        {
          name: "delete-storage-objects",
          retry: OBJECT_DELETION_STEP_RETRY,
        }
      );
      return { deleted: true };
    } catch (error) {
      // Record failures for operational visibility without restoring
      // already-deleted cards.
      await step.runMutation(
        internalAny["workflows/objectCleanup"].recordObjectDeletionFailure,
        {
          error: error instanceof Error ? error.message : String(error),
          keys,
        }
      );
      return { deleted: false };
    }
  },
});

/**
 * Kick off cleanup for a set of immutable object keys. Called via
 * ctx.scheduler.runAfter(0, ...) from the initiating mutation so the keys are
 * recorded durably in the same transaction that deletes the owning records.
 */
export const startObjectDeletion = internalMutation({
  args: { keys: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, { keys }) => {
    const usable = keys.filter((key) => key.length > 0);
    for (const key of usable) {
      if (!isR2KeyInNamespace(key)) {
        throw new Error("invalid_storage_key_namespace");
      }
    }
    if (usable.length === 0) {
      return null;
    }
    await workflow.start(
      ctx,
      internalAny["workflows/objectCleanup"].objectDeletionWorkflow,
      { keys: usable },
      { startAsync: true }
    );
    return null;
  },
});
