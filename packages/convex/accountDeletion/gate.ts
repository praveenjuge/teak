import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Whether an account is being deleted. Every writer that must stand down
 * during a deletion asks here, so this module imports nothing else of
 * Teak's: card, tag and folder code depend on it without depending on the
 * deletion itself.
 */
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
