import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseReaderCtx = Pick<MutationCtx | QueryCtx, "db">;

export const getAccountDeletionState = async (
  ctx: DatabaseReaderCtx,
  userId: string
) => {
  const tableQuery = (ctx.db as any)?.query?.("accountDeletionStates");
  if (typeof tableQuery?.withIndex !== "function") {
    return null;
  }
  const indexedQuery = tableQuery.withIndex("by_userId", (query: any) =>
    query.eq("userId", userId)
  );
  if (typeof indexedQuery?.unique !== "function") {
    return null;
  }
  const state = await indexedQuery.unique();
  return state && typeof state.startedAt === "number" ? state : null;
};

export const assertAccountNotDeleting = async (
  ctx: DatabaseReaderCtx,
  userId: string
) => {
  if (await getAccountDeletionState(ctx, userId)) {
    throw new ConvexError({
      code: "ACCOUNT_DELETION_IN_PROGRESS",
      message: "Account deletion is already in progress",
    });
  }
};

export const beginAccountDeletion = async (
  ctx: MutationCtx,
  userId: string
) => {
  const existing = await getAccountDeletionState(ctx, userId);
  if (!existing) {
    await ctx.db.insert("accountDeletionStates", {
      userId,
      startedAt: Date.now(),
    });
  }
};

export const finishAccountDeletion = async (
  ctx: MutationCtx,
  userId: string
) => {
  const existing = await getAccountDeletionState(ctx, userId);
  if (existing) {
    await ctx.db.delete("accountDeletionStates", existing._id);
  }
};

// Production evidence: account deletion batches race scheduled card search
// sync jobs that keep writing the same cardSearchTagSyncStates documents.
// Convex retries a conflicted mutation immediately, so under a hot writer
// every internal retry conflicts again and the whole deletion fails with a
// 500. Back off at the action level so the scheduled jobs can drain before
// the batch runs again.
export const ACCOUNT_DELETION_OCC_RETRY_DELAYS_MS: number[] = [
  250, 500, 1000, 2000, 4000,
];

export const isOptimisticConcurrencyConflict = (error: unknown): boolean =>
  error instanceof Error &&
  error.message.includes("changed while this") &&
  error.message.includes("was being run");

export const withOptimisticConcurrencyRetry = async <T>(
  run: () => Promise<T>,
  options?: {
    retryDelaysMs?: number[];
    sleep?: (delayMs: number) => Promise<void>;
  }
): Promise<T> => {
  const retryDelaysMs =
    options?.retryDelaysMs ?? ACCOUNT_DELETION_OCC_RETRY_DELAYS_MS;
  const sleep =
    options?.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }));
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (
        !isOptimisticConcurrencyConflict(error) ||
        attempt >= retryDelaysMs.length
      ) {
        throw error;
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }
};
