"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";
import { PENDING_UPLOAD_CARD_ID } from "./r2";
import { buildR2ListPrefix } from "./r2Keys";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_LIST_PAGES = 200;

export const buildStalePendingCleanupSpec = (now = Date.now()) => ({
  op: "cleanup-stale-pending-uploads" as const,
  params: {
    maxPages: MAX_LIST_PAGES,
    pendingCardId: PENDING_UPLOAD_CARD_ID,
    prefix: buildR2ListPrefix(),
    staleBefore: now - STALE_AFTER_MS,
  },
});

export const sweepStalePendingUploadsHandler = async (): Promise<null> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  const outcome = await callFilesWorkerJson<{
    deleted: number;
    pages: number;
    truncated: boolean;
  }>(buildStalePendingCleanupSpec());
  if (outcome.kind !== "ok") {
    throw new Error("files_worker_cleanup_unavailable");
  }
  return null;
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: sweepStalePendingUploadsHandler,
});
