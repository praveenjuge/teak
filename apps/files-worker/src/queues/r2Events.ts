import { callFilesOp, type FilesOpOutcome } from "../workflows/filesOps";
import type { BackgroundEnv } from "../workflows/runtime";

/**
 * Pending uploads (`.../cards/upload-pending-v2/...`) are objects a client
 * uploaded but never finalized into a card. The bucket's event notification
 * sends each one here when it is written; the consumer holds it in the
 * queue until it is 24 hours old, then deletes it if it is still there and
 * was not uploaded again since. The weekly cron sweep (`sweepStalePendingUploads`)
 * is the backstop for any event that never arrived.
 */

/** R2 event notification, as the bucket sends it. */
export interface R2EventNotification {
  account?: string;
  action: string;
  bucket?: string;
  eventTime: string;
  object: { eTag?: string; key: string; size?: number };
}

/** A pending upload re-queued until it is old enough to judge. */
export interface PendingUploadCheck {
  key: string;
  kind: "pending-upload-check";
  /** When the object was written (ms), from the original event. */
  uploadedAt: number;
}

export const PENDING_UPLOAD_SEGMENT = "/cards/upload-pending-v2/";
export const PENDING_UPLOAD_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** Queues delays a message by at most 12 hours. */
export const MAX_QUEUE_DELAY_SECONDS = 12 * 60 * 60;

const CREATE_ACTIONS = new Set([
  "CompleteMultipartUpload",
  "CopyObject",
  "PutObject",
]);
const USER_PREFIXES = ["users/", "dev/users/"] as const;

export const isPendingUploadKey = (key: string): boolean =>
  USER_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
  key.includes(PENDING_UPLOAD_SEGMENT) &&
  !key.split("/").includes("..");

/** The pending upload a message is about, or null to just acknowledge it. */
export const pendingUploadOf = (
  body: unknown
): { key: string; uploadedAt: number } | null => {
  if (!body || typeof body !== "object") {
    return null;
  }
  const message = body as Partial<PendingUploadCheck & R2EventNotification>;
  const key =
    message.kind === "pending-upload-check" ? message.key : message.object?.key;
  if (typeof key !== "string" || !isPendingUploadKey(key)) {
    return null;
  }
  if (message.kind === "pending-upload-check") {
    return typeof message.uploadedAt === "number" &&
      Number.isFinite(message.uploadedAt)
      ? { key, uploadedAt: message.uploadedAt }
      : null;
  }
  if (
    !(typeof message.action === "string" && CREATE_ACTIONS.has(message.action))
  ) {
    return null;
  }
  const uploadedAt = Date.parse(String(message.eventTime));
  return Number.isFinite(uploadedAt) ? { key, uploadedAt } : null;
};

/** Seconds until the next look, capped at the queue's maximum delay. */
export const recheckDelaySeconds = (uploadedAt: number, now: number): number =>
  Math.min(
    MAX_QUEUE_DELAY_SECONDS,
    Math.max(
      1,
      Math.ceil((uploadedAt + PENDING_UPLOAD_STALE_AFTER_MS - now) / 1000)
    )
  );

/** Deletes the object when it is still there and at least 24 hours old. */
const deleteIfStale = async (
  bucket: R2Bucket,
  key: string,
  now: number
): Promise<boolean> => {
  const head = await bucket.head(key);
  if (!head || head.uploaded.getTime() > now - PENDING_UPLOAD_STALE_AFTER_MS) {
    // Gone (finalized or deleted), or written again: its own event covers it.
    return false;
  }
  await bucket.delete(key);
  return true;
};

export const handleR2EventsBatch = async (
  batch: MessageBatch<unknown>,
  env: Pick<BackgroundEnv, "BUCKET" | "R2_EVENTS">,
  now = Date.now()
): Promise<void> => {
  const later: { body: PendingUploadCheck; message: Message<unknown> }[] = [];
  const due: { key: string; message: Message<unknown> }[] = [];
  for (const message of batch.messages) {
    const pending = pendingUploadOf(message.body);
    if (!pending) {
      message.ack();
    } else if (pending.uploadedAt + PENDING_UPLOAD_STALE_AFTER_MS > now) {
      later.push({
        body: { kind: "pending-upload-check", ...pending },
        message,
      });
    } else {
      due.push({ key: pending.key, message });
    }
  }
  if (later.length > 0) {
    try {
      if (!env.R2_EVENTS) {
        throw new Error("r2_events_queue_missing");
      }
      await env.R2_EVENTS.sendBatch(
        later.map(({ body }) => ({
          body,
          delaySeconds: recheckDelaySeconds(body.uploadedAt, now),
        }))
      );
      for (const { message } of later) {
        message.ack();
      }
    } catch (error) {
      console.error("[r2-events] pending uploads not re-queued", {
        count: later.length,
        error: error instanceof Error ? error.message : String(error),
      });
      for (const { message } of later) {
        message.retry({ delaySeconds: 60 });
      }
    }
  }
  for (const { key, message } of due) {
    try {
      await deleteIfStale(env.BUCKET, key, now);
      message.ack();
    } catch (error) {
      console.error("[r2-events] pending upload cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      message.retry({ delaySeconds: 60 });
    }
  }
};

interface CleanupPage {
  cursor: string | null;
  deleted: number;
}
const SWEEP_BUDGET_MS = 5 * 60 * 1000;

export interface PendingSweepSummary {
  complete: boolean;
  deleted: number;
}

/**
 * The weekly backstop: walks every user prefix with the
 * `cleanup-stale-pending-uploads` op (ten list pages a call) until done or
 * out of time. Each run starts over; the R2 events do the daily work.
 */
export const sweepStalePendingUploads = async (
  env: BackgroundEnv,
  deps: { budgetMs?: number; clock?: () => number } = {}
): Promise<PendingSweepSummary> => {
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + (deps.budgetMs ?? SWEEP_BUDGET_MS);
  let deleted = 0;
  for (const prefix of USER_PREFIXES) {
    let cursor: string | null = null;
    do {
      if (clock() >= deadline) {
        return { complete: false, deleted };
      }
      const outcome: FilesOpOutcome<CleanupPage> = await callFilesOp(env, {
        op: "cleanup-stale-pending-uploads",
        params: { prefix, ...(cursor ? { cursor } : {}) },
      });
      if (outcome.kind !== "ok") {
        throw new Error(`pending_upload_sweep_failed:${outcome.code}`);
      }
      deleted += outcome.data.deleted;
      cursor = outcome.data.cursor;
    } while (cursor);
  }
  return { complete: true, deleted };
};
