import { parseCardObjectKey } from "@teak/files-protocol";
import { DELETE_OBJECTS_MAX_KEYS } from "../ops";
import { isValidUploadKey } from "../storage/upload";
import { reportBackgroundError } from "../telemetry";
import type { FilesOpCaller } from "../workflows/deps";
import type { ObjectDeletionMessage } from "../workflows/dispatch";
import { callFilesOp } from "../workflows/filesOps";
import type { BackgroundEnv } from "../workflows/runtime";
import { sendInBatches } from "./sendBatch";

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
  const batches = chunk(usable, DELETE_OBJECTS_MAX_KEYS);
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
      for (const keyBatch of chunk(
        [...new Set(usable)],
        DELETE_OBJECTS_MAX_KEYS
      )) {
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

export const handleObjectDeletionDeadLetters = async (
  batch: MessageBatch<unknown>,
  env: BackgroundEnv,
  ctx: Pick<ExecutionContext, "waitUntil"> | undefined
): Promise<void> => {
  for (const message of batch.messages) {
    const keys = messageKeys(message.body) ?? [];
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
