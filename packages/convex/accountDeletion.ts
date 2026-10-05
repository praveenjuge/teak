import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import { removeCardUsage } from "./card/cardUsage";
import { readAccountChangesPaused, readAuthPrimary } from "./env";
import { getDeletionRetryPrincipal, getSessionUser } from "./securitySessions";
import { TELEMETRY_OPERATIONS } from "./shared/telemetry";
import { cardStorageObjectKeys } from "./storage/r2";
import { startWorkflow } from "./workflows/manager";

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
  // Old Better Auth afterDelete hooks must not finish a workflow-owned state.
  if (existing && existing.generation === undefined) {
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
  boundedDeletion?: {
    stateId: Id<"accountDeletionStates">;
    generation: number;
  };
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
  { deleteImportObjects, observe, boundedDeletion }: AccountDataDeletionOptions
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
      if (boundedDeletion) {
        for (const kind of ["cards", "imports"] as const) {
          const empty: boolean = await ctx.runAction(
            internal.accountDeletionData.drainStorageBatch,
            { ...boundedDeletion, kind }
          );
          if (!empty) {
            return {
              done: false,
              deletedCards: 0,
              deletedStorageObjectCount: 0,
            };
          }
        }
        await ctx.runMutation(internal.accountDeletion.removeAccountCardUsage, {
          userId,
        });
        return { done: true, deletedCards: 0, deletedStorageObjectCount: 0 };
      }
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
          await ctx.runAction(internal.accountDeletionData.deleteKeys, {
            keys: batch.objectKeys,
          });
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
      objects: [
        ...jobs.map((job) => ({
          sourceKey: job.sourceKey,
          reportKey: job.reportKey,
          uploadId: job.uploadId,
        })),
        ...items.flatMap((item) =>
          item.extractedFileKey ? [{ sourceKey: item.extractedFileKey }] : []
        ),
      ],
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

export const isDeleting = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) =>
    Boolean(await getAccountDeletionState(ctx, userId)),
});

export const initiateAccountDeletion = async (
  ctx: MutationCtx,
  owner: Doc<"users">,
  provider: "betterauth" | "workos"
): Promise<null> => {
  const existing = await getAccountDeletionState(ctx, owner.teakUserId);
  if (existing) {
    if (existing.workosUserId !== owner.workosUserId) {
      throw new ConvexError("Account binding unavailable");
    }
    return null;
  }
  if (owner.deletedAt !== undefined) {
    return null;
  }
  if (readAccountChangesPaused()) {
    throw new ConvexError(
      "Account changes are paused while we upgrade sign-in"
    );
  }
  const legacy =
    provider === "betterauth"
      ? { _id: owner.teakUserId }
      : await ctx.runQuery(components.betterAuth.adapter.findOne, {
          model: "user",
          where: [{ field: "_id", value: owner.teakUserId }],
        });
  const clientId = process.env.WORKOS_CLIENT_ID;
  const environmentId = process.env.WORKOS_ENVIRONMENT_ID;
  const apiKey = process.env.WORKOS_API_KEY;
  const credentialFingerprint = apiKey
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(apiKey)
          )
        ),
        (byte) => byte.toString(16).padStart(2, "0")
      ).join("")
    : undefined;
  const target =
    clientId && environmentId && credentialFingerprint
      ? {
          clientId,
          environmentId,
          issuer: `https://api.workos.com/user_management/${clientId}`,
          credentialFingerprint,
        }
      : undefined;
  const stateId = await ctx.db.insert("accountDeletionStates", {
    userId: owner.teakUserId,
    startedAt: Date.now(),
    initiationProvider: provider,
    ...(legacy ? { betterAuthUserId: legacy._id } : {}),
    ...(owner.workosUserId ? { workosUserId: owner.workosUserId } : {}),
    ...(target ? { workosTarget: target } : {}),
    stage: 0,
    generation: 1,
    nextAttemptAt: Date.now() + 60_000,
  });
  const workflowId = await startWorkflow(
    ctx,
    internal["workflows/accountDeletion"].accountDeletionWorkflow,
    { stateId, generation: 1 },
    { startAsync: true }
  );
  await ctx.db.patch("accountDeletionStates", stateId, { workflowId });
  return null;
};

export const deleteMyAccount = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const session = await getSessionUser(ctx);
    if (!session) {
      const retry = await getDeletionRetryPrincipal(ctx);
      if (retry) {
        const rows = await ctx.db
          .query("users")
          .withIndex(
            retry.provider === "workos" ? "by_workosUserId" : "by_teakUserId",
            (q) =>
              retry.provider === "workos"
                ? q.eq("workosUserId", retry.providerUserId)
                : q.eq("teakUserId", retry.providerUserId)
          )
          .take(2);
        if (rows.length === 1) {
          const state = await getAccountDeletionState(ctx, rows[0].teakUserId);
          if (
            state &&
            (retry.provider === "betterauth"
              ? state.betterAuthUserId === retry.providerUserId
              : state.workosUserId === retry.providerUserId &&
                (retry.externalId === null ||
                  retry.externalId === undefined ||
                  retry.externalId === state.userId))
          ) {
            return null;
          }
        }
      }
      throw new ConvexError("User must be authenticated");
    }
    if (readAuthPrimary() !== "workos") {
      throw new ConvexError("WorkOS account deletion is not enabled");
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", session.teakUserId))
      .take(2);
    if (rows.length !== 1 || rows[0].deletedAt !== undefined) {
      throw new ConvexError("Account binding unavailable");
    }
    const owner = rows[0];
    return initiateAccountDeletion(ctx, owner, session.provider);
  },
});
