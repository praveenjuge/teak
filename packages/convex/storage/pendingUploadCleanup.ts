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
const PENDING_UPLOAD_SEGMENT = `/cards/${PENDING_UPLOAD_CARD_ID}/`;
// R2 supports pages up to 1,000 objects. The cleanup only needs object
// metadata, so request the full page to keep ordinary sweeps to one list call.
const LIST_PAGE_LIMIT = 1000;
const DELETE_BATCH_SIZE = 100;
// Hard page cap so a pathological bucket cannot spin the cron forever; the
// next hourly run resumes from wherever listing left off.
const MAX_LIST_PAGES = 200;
// Transient files-worker failures (network resets, 5xx) should not fail the
// whole hourly sweep: retry the idempotent list/delete ops with backoff. One
// budget is shared across every call in a run so intermittent failures cannot
// consume the action's execution window.
const RETRY_DELAYS_MS = [1000, 4000];
const SWEEP_RETRY_BUDGET_MS = 30_000;

const isTransientFilesWorkerError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.startsWith("files_worker_network_error:") ||
    /^files_worker_error:[A-Z0-9_]+:(?:429|5\d\d):/u.test(message)
  );
};

export const withFilesWorkerRetry = async <T>(
  operation: () => Promise<T>,
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS,
  budget?: { remainingMs: number }
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const delay = retryDelaysMs[attempt];
      if (
        delay === undefined ||
        !isTransientFilesWorkerError(error) ||
        (budget !== undefined && delay > budget.remainingMs)
      ) {
        break;
      }
      if (budget !== undefined) {
        budget.remainingMs -= delay;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
};

export const sweepStalePendingUploadsHandler = async (): Promise<null> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  const staleBefore = Date.now() - STALE_AFTER_MS;
  let cursor: string | null = null;
  let pages = 0;
  const retryBudget = { remainingMs: SWEEP_RETRY_BUDGET_MS };
  do {
    const outcome = await withFilesWorkerRetry(
      () =>
        callFilesWorkerJson<{ cursor: string | null; deleted: number }>({
          op: "cleanup-stale-pending-upload-page",
          params: {
            ...(cursor ? { cursor } : {}),
            pendingCardId: PENDING_UPLOAD_CARD_ID,
            prefix: buildR2ListPrefix(),
            staleBefore,
          },
        }),
      RETRY_DELAYS_MS,
      retryBudget
    );
    if (outcome.kind !== "ok") {
      throw new Error("files_worker_cleanup_unavailable");
    }
    cursor = outcome.data.cursor;
    pages += 1;
  } while (cursor && pages < MAX_LIST_PAGES);
  if (cursor) {
    throw new Error("files_worker_cleanup_page_limit");
  }
  return null;
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: sweepStalePendingUploadsHandler,
});
