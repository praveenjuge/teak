import { parseCardObjectKey } from "@teak/files-protocol";
import { reportBackgroundError } from "../telemetry";
import { isValidUploadKey } from "../upload";
import type { FilesOpCaller } from "../workflows/deps";
import type { ObjectDeletionMessage } from "../workflows/dispatch";
import { callFilesOp } from "../workflows/filesOps";
import type { BackgroundEnv } from "../workflows/runtime";
import { sendInBatches } from "./sendBatch";

// Storage objects whose rows are gone. Convex queues them through `dispatch`
// (its outbox); workflows in this Worker queue them directly.

/** delete-objects takes at most this many keys per call. */
const MAX_KEYS_PER_DELETE = 100;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const messageKeys = (body: unknown): string[] | null => {
  const keys = (body as Partial<ObjectDeletionMessage> | null)?.keys;
  return Array.isArray(keys)
    ? keys.filter((key): key is string => typeof key === "string")
    : null;
};

/**
 * Queues objects for deletion. Without the queue binding (local runs) they
 * are deleted at once. Returns how many keys were accepted.
 */
export const queueObjectDeletions = async (
  env: BackgroundEnv,
  keys: readonly (string | undefined)[],
  ops: FilesOpCaller = (spec) => callFilesOp(env, spec)
): Promise<number> => {
  const usable = [
    ...new Set(
      keys.filter(
        (key): key is string => Boolean(key) && isValidUploadKey(key as string)
      )
    ),
  ];
  const batches = chunk(usable, MAX_KEYS_PER_DELETE);
  if (env.OBJECT_DELETIONS) {
    const failed = await sendInBatches(
      env.OBJECT_DELETIONS,
      batches.map((batch) => ({ keys: batch }))
    );
    const [error] = failed.values();
    if (error !== undefined) {
      throw new Error(`object_deletion_queue_failed:${error}`);
    }
    return usable.length;
  }
  for (const batch of batches) {
    const outcome = await ops({
      op: "delete-objects",
      params: { keys: batch },
    });
    if (outcome.kind !== "ok") {
      throw new Error(`object_delete_failed:${outcome.code}`);
    }
  }
  return usable.length;
};

/**
 * Deletes each message's keys. A message whose delete fails is retried by
 * the queue, then dead-lettered; R2 treats a missing key as deleted, so a
 * retry repeats nothing harmful.
 */
export const handleObjectDeletionBatch = async (
  batch: MessageBatch<unknown>,
  env: BackgroundEnv,
  ops: FilesOpCaller = (spec) => callFilesOp(env, spec)
): Promise<void> => {
  for (const message of batch.messages) {
    const keys = messageKeys(message.body);
    const usable = keys?.filter(isValidUploadKey) ?? [];
    if (!keys || usable.length < keys.length) {
      console.error("[queues/object-deletions] skipped invalid keys", {
        id: message.id,
        skipped: keys ? keys.length - usable.length : "body",
      });
    }
    try {
      for (const keyBatch of chunk([...new Set(usable)], MAX_KEYS_PER_DELETE)) {
        const outcome = await ops({
          op: "delete-objects",
          params: { keys: keyBatch },
        });
        if (outcome.kind !== "ok") {
          throw new Error(`object_delete_failed:${outcome.code}`);
        }
      }
      message.ack();
    } catch (error) {
      console.warn("[queues/object-deletions] delete failed, retrying", {
        attempts: message.attempts,
        error: error instanceof Error ? error.message : String(error),
        id: message.id,
      });
      message.retry();
    }
  }
};

/** Deletions the queue gave up on: reported, then dropped. */
export const handleObjectDeletionDeadLetters = async (
  batch: MessageBatch<unknown>,
  env: BackgroundEnv,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined
): Promise<void> => {
  for (const message of batch.messages) {
    const keys = messageKeys(message.body) ?? [];
    // Keys name users and files; logs carry only the card and role of one.
    const sample = keys[0] ? parseCardObjectKey(keys[0]) : {};
    console.error("[queues/object-deletions] gave up deleting objects", {
      id: message.id,
      keyCount: keys.length,
      ...sample,
    });
    await reportBackgroundError(
      env,
      ctx,
      new Error("object_deletion_dead_lettered"),
      {
        keyCount: keys.length,
        ...(sample.cardId ? { cardId: sample.cardId } : {}),
        ...(sample.role ? { role: sample.role } : {}),
        task: "object-deletions",
      }
    );
    message.ack();
  }
};
