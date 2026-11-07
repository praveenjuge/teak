import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import {
  ACCOUNT_DELETION_FAILURE_REASONS,
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  ACCOUNT_DELETION_STAGES_DONE,
  accountDeletionFailureCode,
  accountDeletionNeedsOperator,
  accountDeletionStage,
} from "./accountDeletion/stages";
import {
  accountDeletionRetryDelayMs,
  queueAccountDeletionWorkflow,
} from "./accountDeletion/workflowRun";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
/**
 * The deletion this run belongs to, and the one owner it still deletes:
 * a stale generation or an owner row that changed stops the run.
 */
const readDeletionBinding = async (
  ctx: Pick<QueryCtx, "db">,
  {
    stateId,
    generation,
  }: { stateId: Id<"accountDeletionStates">; generation: number }
): Promise<{
  owner: Doc<"users">;
  state: Doc<"accountDeletionStates">;
}> => {
  const state = await ctx.db.get("accountDeletionStates", stateId);
  if (!state || state.generation !== generation) {
    throw new Error("stale_deletion_generation");
  }
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
    .take(2);
  const owner = owners[0];
  if (owners.length !== 1 || owner?.workosUserId !== state.workosUserId) {
    throw new Error("deletion_binding_changed");
  }
  return { owner, state };
};

export const readDeletionState = async (
  ctx: Pick<QueryCtx, "db">,
  binding: { stateId: Id<"accountDeletionStates">; generation: number }
): Promise<Doc<"accountDeletionStates">> =>
  (await readDeletionBinding(ctx, binding)).state;
export const getState = internalQuery({
  args: bindingArgs,
  handler: (ctx, binding) => readDeletionState(ctx, binding),
});
export const advance = internalMutation({
  args: { ...bindingArgs, stage: v.number() },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, stage }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== stage) {
      throw new Error("stale_deletion_stage");
    }
    await ctx.db.patch("accountDeletionStates", stateId, {
      stage: stage + 1,
      failureCode: undefined,
      nextAttemptAt: Date.now() + ACCOUNT_DELETION_PROGRESS_GRACE_MS,
    });
    return null;
  },
});
export const finalize = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, { stateId, generation }) => {
    const { state, owner } = await readDeletionBinding(ctx, {
      stateId,
      generation,
    });
    if (state.stage !== ACCOUNT_DELETION_STAGES_DONE) {
      throw new Error("stale_deletion_stage");
    }
    if (
      !Number.isInteger(generation) ||
      generation < 1 ||
      !Number.isFinite(state.startedAt) ||
      state.startedAt < 0 ||
      state.startedAt > Date.now()
    ) {
      throw new Error("deletion_completion_invalid");
    }
    const redaction =
      owner.identityOrigin === "workos"
        ? {}
        : { email: "", emailVerified: false };
    if (state.workosUserId) {
      const providers = await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) =>
          q.eq("workosUserId", state.workosUserId)
        )
        .take(2);
      if (providers.length !== 1 || providers[0]._id !== owner._id) {
        throw new Error("deletion_binding_changed");
      }
    }
    // A deleted account keeps its row for its ID and deletion date, not the
    // person's name.
    await ctx.db.patch("users", owner._id, {
      ...redaction,
      name: undefined,
      deletedAt: owner.deletedAt ?? Date.now(),
    });
    await ctx.db.delete("accountDeletionStates", stateId);
    return true;
  },
});
export const revokeLocalPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      args
    );
    const keys: boolean = await ctx.runMutation(
      internal.apiKeys.revokeDeletionKeysPage,
      { ownerId: state.userId }
    );
    return keys;
  },
});
export const revokeConsentPage = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, binding) => {
    const state: Doc<"accountDeletionStates"> = await ctx.runQuery(
      internal.accountDeletionJobs.getState,
      binding
    );
    if (state.stage !== accountDeletionStage("accessAndBilling")) {
      throw new Error("stale_deletion_stage");
    }
    const page = await ctx.db
      .query("workosConsents")
      .withIndex("by_userId_and_firstSeenAt", (q) =>
        q.eq("userId", state.userId)
      )
      .paginate({ numItems: 100, cursor: state.localConsentCursor ?? null });
    for (const row of page.page) {
      if (row.revokedAt === undefined) {
        await ctx.db.patch("workosConsents", row._id, {
          revokedAt: Date.now(),
        });
      }
    }
    await ctx.db.patch("accountDeletionStates", state._id, {
      localConsentCursor: page.continueCursor,
    });
    return page.isDone;
  },
});
export const recordFailure = internalMutation({
  args: {
    ...bindingArgs,
    stage: v.number(),
    reason: v.optional(
      v.union(
        ...ACCOUNT_DELETION_FAILURE_REASONS.map((reason) => v.literal(reason))
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, stage, reason }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== stage) {
      return null;
    }
    const failureCode = accountDeletionFailureCode(stage, reason);
    await ctx.db.patch("accountDeletionStates", stateId, {
      failureCode,
      nextAttemptAt: Date.now() + accountDeletionRetryDelayMs(1),
    });
    console.error("account_deletion_retry_required", {
      stateId,
      stage,
      failureCode,
      requiresOperatorResolution: accountDeletionNeedsOperator(failureCode),
      storageKind: state.storageProgress?.kind,
      completedKeyCount: state.storageProgress?.offset,
    });
    return null;
  },
});
/**
 * Starts a deletion the retries stopped on again, once an operator has
 * resolved what blocked it. Run it from the Convex dashboard.
 */
export const retry = internalMutation({
  args: { stateId: v.id("accountDeletionStates") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { stateId }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || typeof state.generation !== "number") {
      return null;
    }
    await ctx.db.patch("accountDeletionStates", stateId, {
      failureCode: undefined,
      nextAttemptAt: Date.now() + ACCOUNT_DELETION_PROGRESS_GRACE_MS,
    });
    return await queueAccountDeletionWorkflow(ctx, {
      generation: state.generation,
      stateId,
    });
  },
});
