import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { getAccountDeletionState } from "./gate";
import {
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  accountDeletionStage,
} from "./stages";
import { queueAccountDeletionWorkflow } from "./workflowRun";

// Sign-in reads only the owner's mapping row, so deletion marks it too.
const markOwnerDeleting = async (
  ctx: MutationCtx,
  userId: string,
  startedAt: number
) => {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
    .take(2);
  for (const row of rows) {
    if (row.deletionStartedAt === undefined) {
      await ctx.db.patch("users", row._id, { deletionStartedAt: startedAt });
    }
  }
};

export const beginAccountDeletion = async (
  ctx: MutationCtx,
  userId: string
) => {
  const existing = await getAccountDeletionState(ctx, userId);
  if (!existing) {
    const startedAt = Date.now();
    await ctx.db.insert("accountDeletionStates", { userId, startedAt });
    await markOwnerDeleting(ctx, userId, startedAt);
  }
};

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
  const startedAt = Date.now();
  const stateId = await ctx.db.insert("accountDeletionStates", {
    userId: owner.teakUserId,
    startedAt,
    initiationProvider: "workos",
    ...(owner.workosUserId ? { workosUserId: owner.workosUserId } : {}),
    stage: accountDeletionStage("accessAndBilling"),
    generation: 1,
    nextAttemptAt: Date.now() + ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  });
  const workflowId = await queueAccountDeletionWorkflow(ctx, {
    stateId,
    generation: 1,
  });
  await ctx.db.patch("accountDeletionStates", stateId, { workflowId });
  await markOwnerDeleting(ctx, owner.teakUserId, startedAt);
  return null;
};
