import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  mutation,
  type QueryCtx,
} from "./_generated/server";
import {
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  accountDeletionStage,
} from "./accountDeletionStages";
import { removeCardUsage } from "./card/cardUsage";
import { deleteCardTextRows } from "./card/textContents";
import { findLegacyBetterAuthUser } from "./legacyBetterAuth";
import {
  getDeletionRetryPrincipal,
  getSessionUser,
  UNAUTHENTICATED_ERROR,
} from "./securitySessions";
import { MAX_FOLDERS_PER_CARD } from "./shared/folders";
import { queueAccountDeletionWorkflow } from "./workflowDispatch";
import { currentWorkosDeletionTarget } from "./workosDeletionCompletion";

const ACCOUNT_CARD_TAG_DELETE_BATCH_SIZE = 20;

type DatabaseReaderCtx = Pick<MutationCtx | QueryCtx, "db">;

export const getAccountDeletionState = (
  ctx: DatabaseReaderCtx,
  userId: string
) =>
  ctx.db
    .query("accountDeletionStates")
    .withIndex("by_userId", (query) => query.eq("userId", userId))
    .unique();

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

declare const ownerIndexBrand: unique symbol;

export type OwnedCardIds = Id<"cards">[] & {
  readonly [ownerIndexBrand]: true;
};

export const takeOwnedCards = async (
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  limit: number,
  maxBytes = Number.POSITIVE_INFINITY
) => {
  const cards: Doc<"cards">[] = [];
  let bytes = 0;
  for await (const card of ctx.db
    .query("cards")
    .withIndex("by_user_deleted_created", (q) => q.eq("userId", userId))) {
    bytes += JSON.stringify(card).length;
    if (cards.length > 0 && bytes > maxBytes) {
      break;
    }
    cards.push(card);
    if (cards.length >= limit) {
      break;
    }
  }
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
      .withIndex("by_cardId_and_tag", (query) => query.eq("cardId", cardId))
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
    await deleteCardTextRows(ctx, cardId);
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
      // Reading the card first would widen Convex's OCC read set. The
      // production backend says "Delete on nonexistent document ID ..." and
      // convex-test says "Delete on non-existent doc".
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
    nextAttemptAt: Date.now() + ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  });
  const workflowId = await queueAccountDeletionWorkflow(ctx, {
    stateId,
    generation: 1,
  });
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
      throw new ConvexError(UNAUTHENTICATED_ERROR);
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
