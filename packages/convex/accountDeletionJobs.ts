import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";
import {
  ACCOUNT_DELETION_PROGRESS_GRACE_MS,
  ACCOUNT_DELETION_STAGES_DONE,
  accountDeletionStage,
} from "./accountDeletion/stages";
import {
  accountDeletionNeedsOperator,
  queueAccountDeletionWorkflow,
} from "./workflowDispatch";
import {
  expectedWorkosDeletionResolution,
  sameWorkosDeletionTarget,
} from "./workos/deletionCompletion";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
export const readDeletionState = async (
  ctx: Pick<QueryCtx, "db">,
  {
    stateId,
    generation,
  }: { stateId: Id<"accountDeletionStates">; generation: number }
): Promise<Doc<"accountDeletionStates">> => {
  const state = await ctx.db.get("accountDeletionStates", stateId);
  if (!state || state.generation !== generation) {
    throw new Error("stale_deletion_generation");
  }
  const owners = await ctx.db
    .query("users")
    .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
    .take(2);
  if (owners.length !== 1 || owners[0].workosUserId !== state.workosUserId) {
    throw new Error("deletion_binding_changed");
  }
  return state;
};
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
export const saveSessionCursor = internalMutation({
  args: {
    ...bindingArgs,
    previous: v.union(v.string(), v.null()),
    next: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, previous, next }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (
      !state ||
      state.generation !== generation ||
      state.stage !== accountDeletionStage("providerSessions") ||
      (state.providerSessionCursor ?? null) !== previous
    ) {
      throw new Error("stale_deletion_session_page");
    }
    await ctx.db.patch("accountDeletionStates", stateId, {
      providerSessionCursor: next,
    });
    return null;
  },
});
export const finalize = internalMutation({
  args: bindingArgs,
  returns: v.boolean(),
  handler: async (ctx, { stateId, generation }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (
      !state ||
      state.generation !== generation ||
      state.stage !== ACCOUNT_DELETION_STAGES_DONE
    ) {
      throw new Error("stale_deletion_stage");
    }
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", state.userId))
      .take(2);
    if (owners.length !== 1 || owners[0].workosUserId !== state.workosUserId) {
      throw new Error("deletion_binding_changed");
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
    const owner = owners[0];
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
      if (
        providers.length !== 1 ||
        providers[0]._id !== owner._id ||
        !state.workosTarget
      ) {
        throw new Error("deletion_workos_target_unavailable");
      }
      const previous = owner.workosDeletionCompletion;
      if (
        previous &&
        (previous.stateId !== stateId ||
          previous.generation !== generation ||
          previous.workosUserId !== state.workosUserId ||
          previous.startedAt !== state.startedAt ||
          !Number.isFinite(previous.completedAt) ||
          previous.completedAt < state.startedAt ||
          !sameWorkosDeletionTarget(previous.target, state.workosTarget))
      ) {
        throw new Error("deletion_completion_conflict");
      }
      const completedAt = previous?.completedAt ?? Date.now();
      await ctx.db.patch("users", owner._id, {
        ...redaction,
        deletedAt: owner.deletedAt ?? completedAt,
        workosDeletionCompletion: previous ?? {
          version: 1,
          stateId,
          generation,
          workosUserId: state.workosUserId,
          startedAt: state.startedAt,
          completedAt,
          target: state.workosTarget,
        },
      });
      const page = await ctx.db
        .query("migrationQuarantine")
        .withIndex("by_workosUserId_and_reason_and_resolvedAt", (q) =>
          q
            .eq("workosUserId", state.workosUserId)
            .eq("reason", "workos_user_deleted")
            .eq("resolvedAt", undefined)
        )
        .paginate({
          numItems: 100,
          cursor: state.deletionReceiptCursor ?? null,
        });
      for (const receipt of page.page) {
        const resolvedAt = await expectedWorkosDeletionResolution(ctx, receipt);
        if (resolvedAt !== undefined) {
          await ctx.db.patch("migrationQuarantine", receipt._id, {
            resolvedAt,
          });
        }
      }
      if (!page.isDone) {
        await ctx.db.patch("accountDeletionStates", stateId, {
          deletionReceiptCursor: page.continueCursor,
        });
        return false;
      }
    } else {
      await ctx.db.patch("users", owner._id, {
        ...redaction,
        deletedAt: owner.deletedAt ?? Date.now(),
      });
    }
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
        v.literal("storage_source_changed"),
        v.literal("object_write_pending"),
        v.literal("analytics_deletion_failed")
      )
    ),
  },
  returns: v.null(),
  handler: async (ctx, { stateId, generation, stage, reason }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== stage) {
      return null;
    }
    const failureCode = `account_deletion_stage_${stage}_${reason ?? "failed"}`;
    await ctx.db.patch("accountDeletionStates", stateId, {
      failureCode,
      nextAttemptAt: Date.now() + 300_000,
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
