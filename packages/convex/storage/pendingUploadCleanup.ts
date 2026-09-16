"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { internalAction } from "../_generated/server";
import {
  callFilesWorkerJson,
  isFilesWorkerConfigured,
} from "./filesWorkerClient";
import { buildR2ListPrefix } from "./r2Keys";

// Transient files-worker failures (network resets, 5xx) should not fail the
// whole hourly sweep: retry the idempotent bounded worker operation with
// backoff without consuming the action's execution window.
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

export interface StalePendingCleanupDependencies {
  cleanup: (args: {
    cursor?: string;
    prefix: string;
  }) => Promise<{ cursor: string | null }>;
  getCursor: () => Promise<string | null>;
  setCursor: (cursor: string | null) => Promise<void>;
}

export const runStalePendingCleanup = async (
  dependencies: StalePendingCleanupDependencies
): Promise<null> => {
  const cursor = await dependencies.getCursor();
  const outcome = await dependencies.cleanup({
    ...(cursor ? { cursor } : {}),
    prefix: buildR2ListPrefix(),
  });
  await dependencies.setCursor(outcome.cursor);
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
    cleanup: async (params) => {
      const outcome = await withFilesWorkerRetry(
        () =>
          callFilesWorkerJson<{ cursor: string | null; deleted: number }>({
            op: "cleanup-stale-pending-uploads",
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
      ctx.runQuery(internal.storage.pendingUploadCleanupState.getCursor, {}),
    setCursor: (cursor) =>
      ctx.runMutation(internal.storage.pendingUploadCleanupState.setCursor, {
        cursor,
      }),
  });
};

export const sweepStalePendingUploads = internalAction({
  args: {},
  returns: v.null(),
  handler: (ctx: ActionCtx) => sweepStalePendingUploadsHandler(ctx),
});
