import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { workflow } from "./workflows/manager";
import {
  expectedWorkosDeletionResolution,
  sameWorkosDeletionTarget,
} from "./workosDeletionCompletion";

const bindingArgs = {
  stateId: v.id("accountDeletionStates"),
  generation: v.number(),
};
export const getState = internalQuery({
  args: bindingArgs,
  handler: async (ctx, { stateId, generation }) => {
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
  },
});
// Protected E2E callers validate canonical authority before this durable lookup.
// Provider absence cannot mark unfinished local cleanup complete.
export const getDeletionStatus = internalQuery({
  args: { userId: v.string(), email: v.string(), workosUserId: v.string() },
  handler: async (ctx, { userId, email, workosUserId }) => {
    const owners = await ctx.db
      .query("users")
      .withIndex("by_teakUserId", (q) => q.eq("teakUserId", userId))
      .take(2);
    if (owners.length === 0) {
      return { status: "missing" as const };
    }
    if (
      owners.length !== 1 ||
      owners[0].workosUserId !== workosUserId ||
      owners[0].email.trim().toLowerCase() !== email.trim().toLowerCase()
    ) {
      return { status: "conflict" as const };
    }
    const states = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .take(2);
    if (
      states.length > 1 ||
      (states[0] && states[0].workosUserId !== workosUserId)
    ) {
      return { status: "conflict" as const };
    }
    if (states[0]) {
      return {
        status: "pending" as const,
        userId,
        stage: states[0].stage,
        failureCode: states[0].failureCode,
      };
    }
    return {
      status:
        owners[0].deletedAt === undefined
          ? ("missing" as const)
          : ("completed" as const),
      userId,
    };
  },
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
      state.stage !== 1 ||
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
  returns: v.null(),
  handler: async (ctx, { stateId, generation }) => {
    const state = await ctx.db.get("accountDeletionStates", stateId);
    if (!state || state.generation !== generation || state.stage !== 6) {
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
      // Stage six durably confirms storage and both providers finished under
      // the state's pinned target. Credential rotation cannot undo completion;
      // current target pins are checked separately before settling any receipt.
      // Commit the retained proof with the owner tombstone, before bounded
      // receipt settlement; retries cannot mint a different completion.
      const completedAt = previous?.completedAt ?? Date.now();
      await ctx.db.patch("users", owner._id, {
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
        await ctx.scheduler.runAfter(0, internal.accountDeletionJobs.finalize, {
          stateId,
          generation,
        });
        return null;
      }
    } else {
      await ctx.db.patch("users", owner._id, {
        deletedAt: owner.deletedAt ?? Date.now(),
      });
    }
    await ctx.db.delete("accountDeletionStates", stateId);
    return null;
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
    if (state.stage !== 0) {
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
    // The revocations and cursor commit together. A lost action response resumes
    // from this durable page without revisiting all earlier grants.
    await ctx.db.patch("accountDeletionStates", state._id, {
      localConsentCursor: page.continueCursor,
    });
    return page.isDone;
  },
});
export const redrive = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const states = await ctx.db
      .query("accountDeletionStates")
      .withIndex("by_nextAttemptAt", (q) =>
        q.gt("nextAttemptAt", 0).lte("nextAttemptAt", Date.now())
      )
      .take(20);
    for (const state of states) {
      if (!state.workflowId || state.generation === undefined) {
        continue;
      }
      if (state.stage === 6) {
        // Cleanup is already terminal; receipt pagination runs outside the
        // original workflow. Resume its fenced transaction even if that
        // workflow completed or its retained journal was later cleaned up.
        await ctx.scheduler.runAfter(0, internal.accountDeletionJobs.finalize, {
          stateId: state._id,
          generation: state.generation,
        });
        await ctx.db.patch("accountDeletionStates", state._id, {
          nextAttemptAt: Date.now() + 300_000,
        });
        continue;
      }
      const status = await workflow.status(
        ctx,
        state.workflowId as Parameters<typeof workflow.status>[1]
      );
      if (status.type === "failed" || status.type === "canceled") {
        // Restart only terminated executions. A running action can still write externally.
        await workflow.restart(
          ctx,
          state.workflowId as Parameters<typeof workflow.restart>[1]
        );
      }
      await ctx.db.patch("accountDeletionStates", state._id, {
        nextAttemptAt: Date.now() + 300_000,
      });
    }
    return null;
  },
});

export const recordFailure = internalMutation({
  args: {
    ...bindingArgs,
    stage: v.number(),
    reason: v.optional(
      v.union(
        v.literal("storage_source_changed"),
        v.literal("object_write_pending")
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
      requiresOperatorResolution: reason === "storage_source_changed",
      storageKind: state.storageProgress?.kind,
      completedKeyCount: state.storageProgress?.offset,
    });
    return null;
  },
});
