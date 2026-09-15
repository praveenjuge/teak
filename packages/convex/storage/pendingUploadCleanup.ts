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
const RETRY_DELAYS_MS = [1000, 4000] as const;

const isTransientFilesWorkerError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("files_worker_network_error:") ||
    /^files_worker_error:[A-Z0-9_]+:(?:429|5\d\d):/u.test(message)
  );
};

export const withTransientFilesWorkerRetry = async <T>(
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

export const buildStalePendingCleanupSpec = (now = Date.now()) => ({
  op: "cleanup-stale-pending-uploads" as const,
  params: {
    pendingCardId: PENDING_UPLOAD_CARD_ID,
    prefix: buildR2ListPrefix(),
    staleBefore: now - STALE_AFTER_MS,
  },
});

export const sweepStalePendingUploadsHandler = async (): Promise<null> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  try {
    const outcome = await withTransientFilesWorkerRetry(() =>
      callFilesWorkerJson<{
        deleted: number;
        pages: number;
      }>(buildStalePendingCleanupSpec())
    );
    if (outcome.kind !== "ok") {
      throw new Error("files_worker_cleanup_unavailable");
    }
  } catch {
    throw new Error("files_worker_cleanup_unavailable");
  }
  return null;
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: sweepStalePendingUploadsHandler,
});
