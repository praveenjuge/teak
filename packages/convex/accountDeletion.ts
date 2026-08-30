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
