import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalMutation,
  internalQuery,
  type MutationCtx,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import type { DeletionBatchKind } from "./accountDeletionBatch";
import { accountDeletionStage } from "./accountDeletionStages";
import { removeCardUsage } from "./card/cardUsage";
import { deleteCardTextContents } from "./card/textContents";
import { readAccountChangesPaused } from "./env";
import { findLegacyBetterAuthUser } from "./legacyBetterAuth";
import { getDeletionRetryPrincipal, getSessionUser } from "./securitySessions";
import { ACCOUNT_CHANGES_PAUSED_MESSAGE } from "./shared/constants";
import { MAX_FOLDERS_PER_CARD } from "./shared/folders";
import { TELEMETRY_OPERATIONS } from "./shared/telemetry";
import { startWorkflow } from "./workflows/manager";
import { currentWorkosDeletionTarget } from "./workosDeletionCompletion";

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

/**
 * While an account deletion runs, its batches own every row the user has.
 * Background writers stand down instead of writing: Convex conflicts on rows
 * read or written, so a racing write makes the deletion batches retry until
 * the whole deletion fails.
 */
export const accountDeletionOwnsRows = async (
  ctx: DatabaseReaderCtx,
  userId: string | undefined
): Promise<boolean> =>
  userId !== undefined && Boolean(await getAccountDeletionState(ctx, userId));

/** `accountDeletionOwnsRows`, read once per user for a batch of many cards. */
export const createAccountDeletionGate = (ctx: DatabaseReaderCtx) => {
  const owned = new Map<string, Promise<boolean>>();
  return (userId: string): Promise<boolean> => {
    let result = owned.get(userId);
    if (!result) {
      result = accountDeletionOwnsRows(ctx, userId);
      owned.set(userId, result);
    }
    return result;
  };
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

export const ACCOUNT_DELETION_DRAIN_BUDGET_MS = 20_000;

export const drainStorageWithinBudget = async (
  ctx: Pick<ActionCtx, "runAction">,
  binding: { stateId: Id<"accountDeletionStates">; generation: number },
  kinds: readonly DeletionBatchKind[],
  now: () => number = Date.now
): Promise<boolean> => {
  const deadline = now() + ACCOUNT_DELETION_DRAIN_BUDGET_MS;
  for (const kind of kinds) {
    while (
      !(await ctx.runAction(internal.accountDeletionData.drainStorageBatch, {
        ...binding,
        kind,
      }))
    ) {
      if (now() >= deadline) {
        return false;
      }
    }
  }
  return true;
};

interface AccountDataDeletionOptions {
  boundedDeletion: {
    stateId: Id<"accountDeletionStates">;
    generation: number;
  };
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
  { observe, boundedDeletion }: AccountDataDeletionOptions
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
      if (
        !(await drainStorageWithinBudget(ctx, boundedDeletion, [
          "cards",
          "imports",
        ]))
      ) {
        return false;
      }
      await ctx.runMutation(internal.accountDeletion.removeAccountCardUsage, {
        userId,
      });
      return true;
    }
  );

declare const ownerIndexBrand: unique symbol;

/** Card ids read from one owner's `by_user_deleted` index. */
export type OwnedCardIds = Id<"cards">[] & {
  readonly [ownerIndexBrand]: true;
};

export const takeOwnedCards = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  limit: number
) => {
  const cards = await ctx.db
    .query("cards")
    .withIndex("by_user_deleted", (q) => q.eq("userId", userId))
    .take(limit);
  return { cards, cardIds: cards.map((card) => card._id) as OwnedCardIds };
};

export const deleteAccountDataHandler = async (
  ctx: MutationCtx,
  cardIds: OwnedCardIds
) => {
  let deletedCards = 0;
  for (const cardId of cardIds) {
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
    await deleteCardTextContents(ctx, cardId);
    const folderRows = await ctx.db
      .query("folderCards")
      .withIndex("by_cardId_and_folderId", (query) =>
        query.eq("cardId", cardId)
      )
      .take(MAX_FOLDERS_PER_CARD);
    for (const folderRow of folderRows) {
      await ctx.db.delete("folderCards", folderRow._id);
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

export const beginAccountDataDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await beginAccountDeletion(ctx, userId);
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
  owner: Doc<"users">
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
    throw new ConvexError(ACCOUNT_CHANGES_PAUSED_MESSAGE);
  }
  const legacy = await findLegacyBetterAuthUser(ctx, owner);
  const target = await currentWorkosDeletionTarget();
  const stateId = await ctx.db.insert("accountDeletionStates", {
    userId: owner.teakUserId,
    startedAt: Date.now(),
    initiationProvider: "workos",
    ...(legacy ? { betterAuthUserId: legacy._id } : {}),
    ...(owner.workosUserId ? { workosUserId: owner.workosUserId } : {}),
    ...(target ? { workosTarget: target } : {}),
    stage: accountDeletionStage("accessAndBilling"),
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
          .withIndex("by_workosUserId", (q) =>
            q.eq("workosUserId", retry.workosUserId)
          )
          .take(2);
        if (rows.length === 1) {
          const state = await getAccountDeletionState(ctx, rows[0].teakUserId);
          if (
            state &&
            state.workosUserId === retry.workosUserId &&
            (retry.externalId === null ||
              retry.externalId === undefined ||
              retry.externalId === state.userId)
          ) {
            return null;
          }
        }
      }
      throw new ConvexError("User must be authenticated");
    }
    const rows = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", session.teakUserId))
      .take(2);
    if (rows.length !== 1 || rows[0].deletedAt !== undefined) {
      throw new ConvexError("Account binding unavailable");
    }
    const owner = rows[0];
    return initiateAccountDeletion(ctx, owner);
  },
});
