import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { removeCardUsage } from "./card/cardUsage";
import { TELEMETRY_OPERATIONS } from "./shared/telemetry";
import { cardStorageObjectKeys } from "./storage/r2";

const ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE = 20;

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

export interface AccountImportDeletionObject {
  reportKey?: string;
  sourceKey: string;
  uploadId?: string;
}

interface AccountDataDeletionOptions {
  deleteImportObjects: (
    objects: AccountImportDeletionObject[]
  ) => Promise<unknown>;
  observe: <T>(
    input: {
      name: string;
      operation: typeof TELEMETRY_OPERATIONS.auth;
      surface: "backend";
      userId: string;
    },
    callback: () => Promise<T>
  ) => Promise<T>;
}

export const runAccountDataDeletion = (
  ctx: ActionCtx,
  userId: string,
  { deleteImportObjects, observe }: AccountDataDeletionOptions
) =>
  observe(
    {
      name: "auth.deleteAccountData",
      operation: TELEMETRY_OPERATIONS.auth,
      surface: "backend",
      userId,
    },
    async () => {
      await ctx.runMutation(internal.accountDeletion.beginAccountDataDeletion, {
        userId,
      });
      let deletedCards = 0;
      let deletedStorageObjectCount = 0;
      while (true) {
        const batch = await ctx.runQuery(
          internal.accountDeletion.getAccountCardDeletionBatch,
          { userId }
        );
        if (batch.cardIds.length === 0) {
          break;
        }
        if (batch.objectKeys.length > 0) {
          await ctx.runAction(
            (internal as any)["workflows/objectCleanup"].deleteObjectsAction,
            { keys: batch.objectKeys }
          );
        }
        deletedCards += await withOptimisticConcurrencyRetry(() =>
          ctx.runMutation(internal.accountDeletion.deleteAccountDataBatch, {
            cardIds: batch.cardIds,
            userId,
          })
        );
        deletedStorageObjectCount += batch.objectKeys.length;
      }
      while (true) {
        const batch = await ctx.runQuery(
          internal.accountDeletion.getAccountImportDeletionBatch,
          { userId }
        );
        if (batch.jobIds.length === 0 && batch.itemIds.length === 0) {
          break;
        }
        if (batch.objects.length > 0) {
          await deleteImportObjects(batch.objects);
        }
        await withOptimisticConcurrencyRetry(() =>
          ctx.runMutation(internal.accountDeletion.deleteAccountImportRows, {
            itemIds: batch.itemIds,
            jobIds: batch.jobIds,
            userId,
          })
        );
      }
      const finalCards = await ctx.runQuery(
        internal.accountDeletion.getAccountCardDeletionBatch,
        { userId }
      );
      const finalImports = await ctx.runQuery(
        internal.accountDeletion.getAccountImportDeletionBatch,
        { userId }
      );
      if (
        finalCards.cardIds.length > 0 ||
        finalImports.jobIds.length > 0 ||
        finalImports.itemIds.length > 0
      ) {
        throw new Error("Account data changed during deletion");
      }
      await ctx.runMutation(internal.accountDeletion.removeAccountCardUsage, {
        userId,
      });
      return { deletedCards, deletedStorageObjectCount };
    }
  );

export const getAccountCardDeletionBatchHandler = async (
  ctx: QueryCtx,
  userId: string
) => {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q: any) => q.eq("userId", userId))
    .take(20);
  const readyCards: typeof cards = [];
  for (const card of cards) {
    const tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId", (query) => query.eq("cardId", card._id))
      .take(ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE + 1);
    if (tagDocuments.length <= ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE) {
      readyCards.push(card);
    }
  }
  return {
    cardIds: cards.map((card) => card._id),
    objectKeys: Array.from(
      new Set(readyCards.flatMap((card) => cardStorageObjectKeys(card)))
    ),
  };
};

export const getAccountCardDeletionBatch = internalQuery({
  args: { userId: v.string() },
  returns: v.object({
    cardIds: v.array(v.id("cards")),
    objectKeys: v.array(v.string()),
  }),
  handler: (ctx, { userId }) => getAccountCardDeletionBatchHandler(ctx, userId),
});

export const deleteAccountDataHandler = async (
  ctx: MutationCtx,
  _userId: string,
  cardIds: Id<"cards">[]
) => {
  let deletedCards = 0;
  for (const cardId of cardIds) {
    // Deliberately no ctx.db.get("cards", cardId) ownership re-check here:
    // card ownership is immutable (no code path patches cards.userId) and
    // the caller derives these IDs from the by_user_deleted index for this
    // user, so the extra read only widened the mutation's conflict surface.
    // The writers that raced these batches are fenced off during account
    // deletion in patchCardWithSearchSync.
    const tagDocuments = await ctx.db
      .query("cardSearchTags")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .take(ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE + 1);
    for (const tagDocument of tagDocuments.slice(
      0,
      ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE
    )) {
      await ctx.db.delete("cardSearchTags", tagDocument._id);
    }
    if (tagDocuments.length > ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE) {
      continue;
    }
    const searchDocument = await ctx.db
      .query("cardSearchDocuments")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique();
    if (searchDocument) {
      await ctx.db.delete("cardSearchDocuments", searchDocument._id);
    }
    const searchTagSyncState = await ctx.db
      .query("cardSearchTagSyncStates")
      .withIndex("by_cardId", (query) => query.eq("cardId", cardId))
      .unique();
    if (searchTagSyncState) {
      await ctx.db.delete("cardSearchTagSyncStates", searchTagSyncState._id);
    }
    try {
      await ctx.db.delete("cards", cardId);
      deletedCards += 1;
    } catch (error) {
      // Only the already-deleted race is skippable. Anything else (backend
      // failure, invalid ID) must surface so the deletion action retries or
      // fails loudly instead of reporting progress it did not make. The
      // production backend says "Delete on nonexistent document ID ..."
      // while convex-test says "Delete on non-existent doc", so match both
      // spellings.
      if (
        !(
          error instanceof Error &&
          /non-?existent|not found/i.test(error.message)
        )
      ) {
        throw error;
      }
    }
  }
  return deletedCards;
};

export const deleteAccountDataBatch = internalMutation({
  args: { cardIds: v.array(v.id("cards")), userId: v.string() },
  returns: v.number(),
  handler: async (ctx, { cardIds, userId }) =>
    deleteAccountDataHandler(ctx, userId, cardIds),
});

export const getAccountImportDeletionBatch = internalQuery({
  args: { userId: v.string() },
  returns: v.object({
    itemIds: v.array(v.id("importJobItems")),
    jobIds: v.array(v.id("importJobs")),
    objects: v.array(
      v.object({
        reportKey: v.optional(v.string()),
        sourceKey: v.string(),
        uploadId: v.optional(v.string()),
      })
    ),
  }),
  handler: async (ctx, { userId }) => {
    const jobs = await ctx.db
      .query("importJobs")
      .withIndex("by_user_created", (q: any) => q.eq("userId", userId))
      .take(100);
    const items = await ctx.db
      .query("importJobItems")
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(100);
    return {
      itemIds: items.map((item) => item._id),
      jobIds: jobs.map((job) => job._id),
      objects: jobs.map((job) => ({
        sourceKey: job.sourceKey,
        reportKey: job.reportKey,
        uploadId: job.uploadId,
      })),
    };
  },
});

export const deleteAccountImportRows = internalMutation({
  args: {
    itemIds: v.array(v.id("importJobItems")),
    jobIds: v.array(v.id("importJobs")),
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { itemIds, jobIds, userId }) => {
    for (const itemId of itemIds) {
      const item = await ctx.db.get("importJobItems", itemId);
      if (item?.userId === userId) {
        await ctx.db.delete("importJobItems", itemId);
      }
    }
    for (const jobId of jobIds) {
      const job = await ctx.db.get("importJobs", jobId);
      if (job?.userId === userId) {
        await ctx.db.delete("importJobs", jobId);
      }
    }
    return null;
  },
});

export const beginAccountDataDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await beginAccountDeletion(ctx, userId);
    return null;
  },
});

export const finishAccountDataDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await finishAccountDeletion(ctx, userId);
    return null;
  },
});

export const removeAccountCardUsageHandler = async (
  ctx: MutationCtx,
  userId: string
) => {
  await removeCardUsage(ctx, userId);
  return null;
};

export const removeAccountCardUsage = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: (ctx, { userId }) => removeAccountCardUsageHandler(ctx, userId),
});
