"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerListObjectsResult,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";
import { PENDING_UPLOAD_CARD_ID } from "./r2";
import { buildR2ListPrefix } from "./r2Keys";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const PENDING_UPLOAD_SEGMENT = `/cards/${PENDING_UPLOAD_CARD_ID}/`;
const LIST_PAGE_LIMIT = 1000;
const DELETE_BATCH_SIZE = 100;
// Hard page cap so a pathological bucket cannot spin the cron forever; the
// next hourly run resumes from wherever listing left off.
const MAX_LIST_PAGES = 200;
// Transient files-worker failures (network resets, 5xx) should not fail the
// whole hourly sweep: retry the idempotent list/delete ops with backoff.
const RETRY_DELAYS_MS = [1000, 4000];

const isTransientFilesWorkerError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("files_worker_network_error:") ||
    /^files_worker_error:[A-Z0-9_]+:5\d\d:/.test(message)
  );
};

export const withFilesWorkerRetry = async <T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (delay === undefined || !isTransientFilesWorkerError(error)) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};


export const stalePendingUploadKeys = (
  objects: Array<{ key: string; lastModified: number }>,
  now = Date.now()
): string[] =>
  objects.flatMap((object) => {
    if (
      !object.key.includes(PENDING_UPLOAD_SEGMENT) ||
      object.lastModified > now - STALE_AFTER_MS
    ) {
      return [];
    }
    return [object.key];
  });

export const sweepStalePendingUploadsHandler = async (): Promise<null> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  let cursor: string | null = null;
  let pages = 0;

  do {
    const params: Record<string, unknown> = {
      prefix: buildR2ListPrefix(),
      limit: LIST_PAGE_LIMIT,
    };
    if (cursor) {
      params.cursor = cursor;
    }
    const outcome = await withFilesWorkerRetry(() =>
      callFilesWorkerJson<FilesWorkerListObjectsResult>({
        op: "list-objects",
        params,
      })
    );
    if (outcome.kind !== "ok") {
      throw new Error("files_worker_list_objects_unavailable");
    }
    cursor = outcome.data.cursor;
    pages += 1;

    const staleKeys = stalePendingUploadKeys(outcome.data.objects);
    for (let index = 0; index < staleKeys.length; index += DELETE_BATCH_SIZE) {
      const deleted = await withFilesWorkerRetry(() =>
        callFilesWorkerJson<{ deleted: number }>({
          op: "delete-objects",
          params: { keys: staleKeys.slice(index, index + DELETE_BATCH_SIZE) },
        })
      );
      if (deleted.kind !== "ok") {
        throw new Error("files_worker_delete_objects_unavailable");
      }
    }
  } while (cursor && pages < MAX_LIST_PAGES);

  return null;
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: sweepStalePendingUploadsHandler,
});

