"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";
import { PENDING_UPLOAD_CARD_ID } from "./r2";
import { buildR2ListPrefix } from "./r2Keys";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
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

const internalAny = internal as Record<string, any>;

export interface StalePendingCleanupDependencies {
  cleanupPage: (args: {
    cursor?: string;
    pendingCardId: string;
    prefix: string;
    staleBefore: number;
  }) => Promise<{ cursor: string | null }>;
  getCursor: () => Promise<string | null>;
  setCursor: (cursor: string | null) => Promise<void>;
}

export const runStalePendingCleanup = async (
  dependencies: StalePendingCleanupDependencies,
  now = Date.now()
): Promise<null> => {
  const staleBefore = now - STALE_AFTER_MS;
  let cursor = await dependencies.getCursor();
  let pages = 0;
  do {
    const outcome = await dependencies.cleanupPage({
      ...(cursor ? { cursor } : {}),
      pendingCardId: PENDING_UPLOAD_CARD_ID,
      prefix: buildR2ListPrefix(),
      staleBefore,
    });
    cursor = outcome.cursor;
    pages += 1;
  } while (cursor && pages < MAX_LIST_PAGES);
  await dependencies.setCursor(cursor);
  return null;
};

export const sweepStalePendingUploadsHandler = async (
  ctx: ActionCtx
): Promise<null> => {
  if (!isFilesWorkerConfigured()) {
    throw new Error("files_worker_not_configured");
  }
  const retryBudget = { remainingMs: SWEEP_RETRY_BUDGET_MS };
  return await runStalePendingCleanup({
    cleanupPage: async (params) => {
      const outcome = await withFilesWorkerRetry(
        () =>
          callFilesWorkerJson<{ cursor: string | null; deleted: number }>({
            op: "cleanup-stale-pending-upload-page",
            params,
          }),
        RETRY_DELAYS_MS,
        retryBudget
      );
      if (outcome.kind !== "ok") {
        throw new Error("files_worker_cleanup_unavailable");
      }
      return outcome.data;
    },
    getCursor: () =>
      ctx.runQuery(internalAny.storage.pendingUploadCleanupState.getCursor, {}),
    setCursor: (cursor) =>
      ctx.runMutation(internalAny.storage.pendingUploadCleanupState.setCursor, {
        cursor,
      }),
  });
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) => sweepStalePendingUploadsHandler(ctx),
});
