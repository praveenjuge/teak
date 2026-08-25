"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  type FilesWorkerListObjectsResult,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";
import { PENDING_UPLOAD_CARD_ID } from "./r2";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const PENDING_UPLOAD_SEGMENT = `/cards/${PENDING_UPLOAD_CARD_ID}/`;
const LIST_PAGE_LIMIT = 1000;
const DELETE_BATCH_SIZE = 100;
// Hard page cap so a pathological bucket cannot spin the cron forever; the
// next hourly run resumes from wherever listing left off.
const MAX_LIST_PAGES = 200;

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
      prefix: "users/",
      limit: LIST_PAGE_LIMIT,
    };
    if (cursor) {
      params.cursor = cursor;
    }
    const outcome = await callFilesWorkerJson<FilesWorkerListObjectsResult>({
      op: "list-objects",
      params,
    });
    if (outcome.kind !== "ok") {
      throw new Error("files_worker_list_objects_unavailable");
    }
    cursor = outcome.data.cursor;
    pages += 1;

    const staleKeys = stalePendingUploadKeys(outcome.data.objects);
    for (let index = 0; index < staleKeys.length; index += DELETE_BATCH_SIZE) {
      const deleted = await callFilesWorkerJson<{ deleted: number }>({
        op: "delete-objects",
        params: { keys: staleKeys.slice(index, index + DELETE_BATCH_SIZE) },
      });
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
